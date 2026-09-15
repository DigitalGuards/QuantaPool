#!/usr/bin/env python3
"""Finish the identified local lifecycle after terminal accounting, then stop its helpers."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import time

from context import ROOT, RUNTIME, network_context


def load(path):
    return json.loads(path.read_text())


def process_command(pid):
    path = Path(f"/proc/{pid}/cmdline")
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return None
    return raw.rstrip(b"\0").decode().split("\0") if raw else None


def stop_recorded_helper(name, record):
    pid = int(record["pid"])
    actual = process_command(pid)
    if actual is None:
        return {"name": name, "pid": pid, "status": "already finished"}
    if actual != record["command"]:
        raise RuntimeError(f"Refuse to signal reused or changed helper PID {pid}")
    os.kill(pid, signal.SIGTERM)
    end = time.monotonic() + 10
    while process_command(pid) is not None:
        if time.monotonic() >= end:
            raise RuntimeError(f"Recorded helper {name} did not finish after SIGTERM")
        time.sleep(0.25)
    return {"name": name, "pid": pid, "status": "stopped after completed drain"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch-seconds", type=int, default=900)
    args = parser.parse_args()
    if not 0 < args.watch_seconds <= 1800:
        raise RuntimeError("Terminal wait must be bounded to thirty minutes")
    if os.environ.get("QUANTAPOOL_PUBLIC_DEV_ACCOUNT") != "2" or os.environ.get("QUANTAPOOL_PUBLIC_DEV_CHAIN_ID") != "3151916":
        raise RuntimeError("Require the explicit local fixture transaction selector")
    network, _ = network_context()
    cleanup_file = RUNTIME / "helper-cleanup.json"
    if cleanup_file.exists():
        prior = load(cleanup_file)
        if prior["executionGenesis"] != network["executionGenesis"]:
            raise RuntimeError("Completed cleanup belongs to a different chain")
        print(json.dumps({"complete": True, "preserved": True, "completedAt": prior["completedAt"]}), flush=True)
        return
    pause = RUNTIME / "keeper.pause"
    acknowledgement = RUNTIME / "keeper/paused.json"
    deadline = time.monotonic() + args.watch_seconds
    while time.monotonic() < deadline:
        try:
            checkpoint = load(RUNTIME / "latest-checkpoint.json")
            pool = checkpoint["pool"]
            terminal = (checkpoint["snapshot"]["validatorBalance"] == "0" and
                        pool["stage"] == "0" and pool["queueHead"] == "3" and pool["requestCount"] == "3" and
                        (int(pool["claimReserve"]) > 0 or (RUNTIME / "final-claims.json").exists()) and
                        (RUNTIME / "terminal-finalized-observation.json").exists())
        except json.JSONDecodeError:
            time.sleep(1)
            continue
        if terminal and not pause.exists() and not (RUNTIME / ".transaction-lock").exists():
            try:
                descriptor = os.open(pause, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                break
            except FileExistsError:
                pass
        time.sleep(1)
    else:
        raise RuntimeError("Terminal finalized accounting was not ready during the bounded wait; no claims sent")
    with os.fdopen(descriptor, "w") as output:
        output.write("Finish authenticated terminal claims and preserve the completed local graph\n")
    created = pause.stat().st_mtime_ns
    try:
        deadline = time.monotonic() + 60
        while not (acknowledgement.exists() and acknowledgement.stat().st_mtime_ns >= created):
            if time.monotonic() >= deadline:
                raise RuntimeError("Finality keeper did not acknowledge terminal pause")
            time.sleep(1)
        print(json.dumps({"terminalAccountingReady": True, "appliedSlot": pool["appliedSlot"],
                          "claimReserve": pool["claimReserve"], "feeReserve": pool["feeReserve"]}), flush=True)
        for command, name in [(["node", "native/lifecycle/run.js", "claim-all"], "final-claim-run.log"),
                              (["node", "native/lifecycle/report.js"], "final-report-run.log")]:
            with (RUNTIME / name).open("a") as log:
                result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=180)
            if result.returncode:
                raise RuntimeError(f"Terminal action failed; inspect preserved {name}")
        result = load(RUNTIME / "completed-lifecycle.json")
        if result["executionGenesis"] != network["executionGenesis"] or result["accountedResidue"] != "0":
            raise RuntimeError("Complete identified zero-cash drain is required before helper cleanup")
        helpers = load(RUNTIME / "helper-processes.json")
        helpers["validator"] = load(RUNTIME / "validator-process.json")
        stopped = [stop_recorded_helper(name, helpers[name]) for name in
                   ["maintenance", "keeper", "observer", "exit-export", "validator"]]
        record = {"completedAt": datetime.now(timezone.utc).isoformat(), "chainId": 3151916,
                  "executionGenesis": network["executionGenesis"], "enclave": network["enclave"],
                  "helpers": stopped, "enclavePreserved": True,
                  "scope": "Only exact recorded lifecycle helper processes stopped after authenticated payouts and zero cash. Node, genesis-validator and Kurtosis services are preserved."}
        cleanup_file.write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps({"complete": True, "nativeUserPayout": result["nativeUserPayout"],
                          "earnedOperatorFee": result["earnedOperatorFee"], "accountedResidue": "0", "helpers": stopped}), flush=True)
    finally:
        pause.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
