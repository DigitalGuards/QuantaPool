#!/usr/bin/env python3
"""Bounded real-chain observations with canonical source/API identity checks."""
import argparse
from datetime import datetime, timezone
import json
import time
import urllib.error
from context import context, read_json, normalized, validator_at

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch-seconds", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.watch_seconds <= 7200:
        raise RuntimeError("Observation duration must be bounded to at most two hours")
    runtime, network, probe, rpc = context()
    deadline = time.monotonic() + args.watch_seconds
    scan_slot = int(probe["bootstrap"]["beaconHeadSlot"])
    events_file = runtime / "consensus-cash-events.jsonl"
    seen_slots = set()
    if events_file.exists():
        seen_slots = {json.loads(line)["beaconSlot"] for line in events_file.read_text().splitlines()}
        scan_slot = max(seen_slots, default=0) + 1
    last_head = None
    while True:
        head = read_json(network["beaconUrl"] + "/qrl/v1/beacon/headers/head")["data"]["header"]["message"]
        slot = int(head["slot"])
        validator = validator_at(network, probe, "head")
        finalized = validator_at(network, probe, "finalized") if validator else None
        result = {
            "observedAt": datetime.now(timezone.utc).isoformat(), "headSlot": slot,
            "headEpoch": slot // 8, "validator": validator, "finalizedValidator": finalized,
            "poolBalance": str(int(rpc("qrl_getBalance", [probe["address"], "latest"]), 16)),
            "evidenceScope": "Observed RPC state and canonical block execution; no contract-verifiable finality claim.",
        }
        if validator and not (runtime / "canonical-registration.json").exists():
            (runtime / "canonical-registration.json").write_text(json.dumps(result, indent=2) + "\n")
        if scan_slot is not None:
            for block_slot in range(scan_slot, slot + 1):
                try:
                    block = read_json(network["beaconUrl"] + f"/qrl/v1/beacon/blocks/{block_slot}")["data"]["message"]
                except urllib.error.HTTPError as error:
                    if error.code == 404:
                        continue
                    raise
                body = block["body"]
                payload = body["execution_payload"]
                matching = [item for item in payload.get("withdrawals", []) if validator and item["validator_index"] == validator["index"]]
                deposits = [item for item in body.get("deposits", []) if normalized(item["data"]["pubkey"]) == normalized(probe["validatorPubkey"])]
                if (matching or deposits) and block_slot not in seen_slots:
                    event = {"beaconSlot": block_slot, "executionBlock": payload["block_number"], "executionHash": payload["block_hash"], "withdrawals": matching, "deposits": deposits}
                    with events_file.open("a") as output:
                        output.write(json.dumps(event) + "\n")
                    seen_slots.add(block_slot)
            scan_slot = slot + 1
        (runtime / "lifecycle-observation.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({"headSlot": slot, "status": validator["status"] if validator else "deposit_waiting_for_consensus", "poolBalance": result["poolBalance"]}), flush=True)
        if finalized and finalized["status"] == "withdrawal_done" and finalized["balance"] == "0":
            (runtime / "terminal-finalized-observation.json").write_text(json.dumps(result, indent=2) + "\n")
            return
        if time.monotonic() >= deadline:
            return
        last_head = slot
        time.sleep(min(24, max(0, deadline - time.monotonic())))


if __name__ == "__main__":
    main()
