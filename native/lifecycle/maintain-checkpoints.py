#!/usr/bin/env python3
"""Bounded permissionless portfolio maintenance for the identified local graph."""
import argparse
from datetime import datetime, timezone
import json
import os
import subprocess
import time

from context import ROOT, RUNTIME, network_context, read_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch-seconds", type=int, default=7200)
    parser.add_argument("--interval-slots", type=int, default=64)
    args = parser.parse_args()
    if not 0 < args.watch_seconds <= 14400 or not 32 <= args.interval_slots <= 128:
        raise RuntimeError("Require a bounded four-hour run and32..128-slot intervals")
    if os.environ.get("QUANTAPOOL_PUBLIC_DEV_ACCOUNT") != "2" or os.environ.get("QUANTAPOOL_PUBLIC_DEV_CHAIN_ID") != "3151916":
        raise RuntimeError("Explicit public fixture transaction actor required")
    network, _ = network_context()
    directory = RUNTIME / "maintenance"
    directory.mkdir(mode=0o700, exist_ok=True)
    pause = RUNTIME / "keeper.pause"
    acknowledgement = RUNTIME / "keeper/paused.json"
    deadline = time.monotonic() + args.watch_seconds
    failures = 0
    while time.monotonic() < deadline:
        if pause.exists() or (RUNTIME / ".transaction-lock").exists():
            time.sleep(2)
            continue
        status = subprocess.run(["node", str(ROOT / "native/lifecycle/run.js"), "status"], capture_output=True, text=True)
        if status.returncode:
            if "EEXIST" in status.stderr:
                time.sleep(2)
                continue
            raise RuntimeError("Cannot read guarded portfolio status: " + status.stderr.strip())
        current = json.loads(status.stdout.strip().splitlines()[-1])
        if current["finalityStatus"] == "2":
            raise RuntimeError("Finality expired; ordinary checkpoint maintenance cannot reset it")
        head = int(read_json(network["beaconUrl"] + "/qrl/v1/beacon/headers/head")["data"]["header"]["message"]["slot"])
        target = int(current["finalizedSlot"])
        heartbeat = {"observedAt": datetime.now(timezone.utc).isoformat(), "pid": os.getpid(), "headSlot": head, **current}
        (directory / "status.json").write_text(json.dumps(heartbeat, indent=2) + "\n")
        if target - int(current["appliedSlot"]) < args.interval_slots or head - target > 28:
            time.sleep(2)
            continue
        block = read_json(network["beaconUrl"] + f"/qrl/v1/beacon/blocks/{target}")["data"]["message"]
        if int(block["body"]["execution_payload"]["block_number"]) <= int(current["registryMutationBlock"]):
            time.sleep(2)
            continue
        try:
            descriptor = os.open(pause, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            continue
        with os.fdopen(descriptor, "w") as output:
            output.write("Bounded periodic authenticated portfolio maintenance\n")
        created = pause.stat().st_mtime_ns
        try:
            wait_until = time.monotonic() + 60
            while not (acknowledgement.exists() and acknowledgement.stat().st_mtime_ns >= created):
                if time.monotonic() >= wait_until:
                    raise RuntimeError("Finality keeper did not acknowledge the bounded pause")
                time.sleep(1)
            log_file = directory / f"requested-slot-{target}.log"
            with log_file.open("a") as log:
                result = subprocess.run(["node", str(ROOT / "native/lifecycle/checkpoint.js")],
                    cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=300)
            if result.returncode:
                failures += 1
                print(json.dumps({"requestedSlot": target, "checkpointFailed": True, "consecutiveFailures": failures}), flush=True)
                if failures >= 3:
                    raise RuntimeError("Three consecutive checkpoint attempts failed; inspect preserved local evidence")
            else:
                failures = 0
                completed = json.loads((RUNTIME / "latest-checkpoint.json").read_text())
                print(json.dumps({"requestedSlot": target, "appliedSlot": completed["pool"]["appliedSlot"],
                    "riskAssets": completed["pool"]["riskAssets"], "ageAtCompletion": completed["ageAtCompletion"]}), flush=True)
        finally:
            pause.unlink(missing_ok=True)
        time.sleep(2)


if __name__ == "__main__":
    main()
