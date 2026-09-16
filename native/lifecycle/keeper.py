#!/usr/bin/env python3
"""Bounded public-certificate keeper for the identified native lifecycle fixture."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import time

from context import ROOT, RUNTIME, NETWORK_RUNTIME, network_context, read_json

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch-seconds", type=int, default=0)
    parser.add_argument("--until-fresh", action="store_true", help="return only after economic freshness has at least32slots of margin")
    args = parser.parse_args()
    if args.until_fresh and args.watch_seconds == 0:
        raise RuntimeError("Freshness wait requires a positive bounded duration")
    if not 0 <= args.watch_seconds <= 14400:
        raise RuntimeError("Keeper duration must be bounded to four hours")
    network, _ = network_context()
    if os.environ.get("QUANTAPOOL_PUBLIC_DEV_ACCOUNT") != "2" or os.environ.get("QUANTAPOOL_PUBLIC_DEV_CHAIN_ID") != "3151916":
        raise RuntimeError("Explicit fixture transaction actor required")
    directory = RUNTIME / "keeper"
    directory.mkdir(mode=0o700, exist_ok=True)
    deadline = time.monotonic() + args.watch_seconds
    failures = 0
    while True:
        if (RUNTIME / "keeper.pause").exists():
            # A local transaction driver can hold the accepted root steady
            # while it settles that exact checkpoint. This is operational
            # coordination only; the on-chain functions stay permissionless.
            (directory / "paused.json").write_text(json.dumps({
                "observedAt": datetime.now(timezone.utc).isoformat(), "pid": os.getpid()
            }, indent=2) + "\n")
            if time.monotonic() >= deadline:
                return
            time.sleep(3)
            continue
        (directory / "paused.json").unlink(missing_ok=True)
        if (RUNTIME / ".transaction-lock").exists():
            if time.monotonic() >= deadline:
                return
            time.sleep(3)
            continue
        result = subprocess.run(["node", str(ROOT / "native/lifecycle/run.js"), "status"], capture_output=True, text=True)
        if result.returncode:
            if "EEXIST" in result.stderr:
                time.sleep(3)
                continue
            raise RuntimeError("Keeper could not read deployed fixture status: " + result.stderr.strip())
        status = json.loads(result.stdout.strip().splitlines()[-1])
        if status["finalityStatus"] == "2":
            raise RuntimeError("Finality trust expired permanently; keeper cannot reset the root")
        head = int(read_json(network["beaconUrl"] + "/qrl/v1/beacon/headers/head")["data"]["header"]["message"]["slot"])
        accepted = int(status["finalizedSlot"])
        period = int(status["currentPeriod"])
        heartbeat = {"observedAt": datetime.now(timezone.utc).isoformat(), "pid": os.getpid(), "headSlot": head, **status}
        (directory / "status.json").write_text(json.dumps(heartbeat, indent=2) + "\n")
        if args.until_fresh and status["finalityStatus"] == "0" and head - accepted <= 32:
            print(json.dumps({"economicFresh": True, "finalizedSlot": accepted, "headSlot": head}), flush=True)
            return
        candidate = None
        if head - accepted >= 24:
            latest = min(((head - 1) // 8) * 8, (period + 2) * 64 - 8)
            for attested in range(latest, max(accepted, latest - 64), -8):
                checkpoints = read_json(network["beaconUrl"] + f"/qrl/v1/beacon/states/{attested}/finality_checkpoints")["data"]
                finalized = read_json(network["beaconUrl"] + "/qrl/v1/beacon/headers/" + checkpoints["finalized"]["root"])["data"]["header"]["message"]
                slot = int(finalized["slot"])
                if slot > accepted and slot // 64 == (attested + 1) // 64:
                    candidate = attested
                    break
        if candidate is not None:
            capture = directory / f"from-{accepted}-attested-{candidate}"
            witness = capture / "witness.json"
            capture.mkdir(mode=0o700, exist_ok=True)
            if not witness.exists():
                with (capture / "capture.log").open("w") as log:
                    subprocess.run(["python3", str(ROOT / "native/proofs/capture-finality.py"),
                        "--network", str(NETWORK_RUNTIME / "network.json"), "--output-dir", str(capture),
                        "--bootstrap-slot", str(accepted), "--attested-slots", str(candidate), "--allow-unfinalized-updates"],
                        check=True, stdout=log, stderr=subprocess.STDOUT)
                with (capture / "native-verification.log").open("w") as log:
                    subprocess.run([str(NETWORK_RUNTIME / "bin/analyze-finality"), "-capture-dir", str(capture), "-output", str(witness)],
                        check=True, stdout=log, stderr=subprocess.STDOUT)
            with (capture / "transactions.log").open("a") as log:
                update = subprocess.run(["node", str(ROOT / "native/lifecycle/run.js"), "update", str(witness)], stdout=log, stderr=subprocess.STDOUT)
            if update.returncode:
                failures += 1
                if failures >= 3:
                    raise RuntimeError("Three bounded keeper updates failed; inspect preserved transaction logs")
            else:
                failures = 0
                print(json.dumps({"fromFinalizedSlot": accepted, "attestedSlot": candidate, "publicWitness": str(witness)}), flush=True)
        if time.monotonic() >= deadline:
            if args.until_fresh:
                raise RuntimeError("Bounded freshness wait ended without sufficient margin")
            return
        time.sleep(min(6, max(0, deadline - time.monotonic())))

if __name__ == "__main__":
    main()
