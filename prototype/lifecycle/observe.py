#!/usr/bin/env python3
"""Bounded read-only observations of the real local funded validator lifecycle."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise RuntimeError("Local fixture endpoint attempted an HTTP redirect")


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def read_json(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with HTTP.open(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404 and error.headers.get_content_type() != "application/json":
            raise RuntimeError("Unknown API route must not be treated as an absent validator or skipped slot") from error
        raise


def normalized(value):
    return value.removeprefix("0x").removeprefix("Q").lower()


def context():
    runtime = Path(__file__).resolve().parents[2] / "findings/native-qrl-prototype/lifecycle"
    network = json.loads((runtime / "network.json").read_text())
    probe = json.loads((runtime / "probe.json").read_text())
    for endpoint in (network["rpcUrl"], network["beaconUrl"]):
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise RuntimeError("Only literal loopback fixture URLs are accepted")

    def rpc(method, params):
        result = read_json(network["rpcUrl"], {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if "error" in result:
            raise RuntimeError(str(result["error"]))
        return result["result"]

    if network["chainId"] != 3151915 or int(rpc("qrl_chainId", []), 16) != 3151915:
        raise RuntimeError("Wrong local fixture chain")
    if rpc("qrl_getBlockByNumber", ["0x0", False])["hash"] != network["executionGenesis"] or probe["genesis"] != network["executionGenesis"]:
        raise RuntimeError("Execution genesis mismatch")
    genesis = read_json(network["beaconUrl"] + "/qrl/v1/beacon/genesis")["data"]
    if genesis != network["beaconGenesis"]:
        raise RuntimeError("Beacon genesis mismatch")
    return runtime, network, probe, rpc


def validator_at(network, probe, state):
    try:
        result = read_json(network["beaconUrl"] + f"/qrl/v1/beacon/states/{state}/validators/" + probe["validatorPubkey"])
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    data = result["data"]
    validator = data["validator"]
    if normalized(validator["pubkey"]) != normalized(probe["validatorPubkey"]) or normalized(validator["withdrawal_recipient"]) != normalized(probe["address"]):
        raise RuntimeError("Unexpected canonical validator identity or recipient")
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch-seconds", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.watch_seconds <= 7200:
        raise RuntimeError("Observation duration must be bounded to at most two hours")
    runtime, network, probe, rpc = context()
    deadline = time.monotonic() + args.watch_seconds
    scan_slot = None
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
        if validator and scan_slot is None:
            scan_slot = max(int(probe["funding"]["blockNumber"]), (last_head or slot) - 8)
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
                matching = [item for item in payload.get("withdrawals", []) if item["validator_index"] == validator["index"]]
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
