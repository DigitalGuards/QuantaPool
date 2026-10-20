#!/usr/bin/env python3
"""Capture bounded public finality inputs from the identified local QRL chain."""

import argparse
import datetime
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError("redirects are prohibited")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--bootstrap-slot", type=int, default=80)
    parser.add_argument("--attested-slots", type=int, nargs="+", default=[112, 144, 208, 288])
    parser.add_argument("--allow-unfinalized-updates", action="store_true",
                        help="capture available signed updates after a node-observed finalized bootstrap")
    args = parser.parse_args()
    bootstrap, attested_slots = args.bootstrap_slot, args.attested_slots
    if (bootstrap < 0 or not 1 <= len(attested_slots) <= 4
            or attested_slots != sorted(set(attested_slots))
            or not bootstrap < attested_slots[0] or attested_slots[-1] >= 2**53):
        raise ValueError("requires one to four increasing bounded updates after the bootstrap")
    manifest_path = args.output_dir / "manifest.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        previous_slots = [int(update["attestedSlot"]) for update in previous["updates"]]
        if (int(previous["bootstrapSlot"]) != bootstrap
                or previous_slots != attested_slots[:len(previous_slots)]):
            raise ValueError("use a separate directory for a different capture sequence")
    network = json.loads(args.network.read_text())
    origin = network["beaconUrl"]
    url = urllib.parse.urlparse(origin)
    if (network["chainId"] not in (3151914, 3151915) or network["loopbackOnly"] is not True
            or url.scheme != "http" or not ipaddress.ip_address(url.hostname).is_loopback
            or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment):
        raise ValueError("requires the identified prototype's literal loopback HTTP origin")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    args.output_dir.mkdir(parents=True, exist_ok=True)
    files = {}

    def read(path, accept="application/json"):
        request = urllib.request.Request(origin.rstrip("/") + path, headers={"Accept": accept})
        with opener.open(request, timeout=30) as response:
            content_type = response.headers.get_content_type()
            raw = response.read((16 << 20) + 1)
        if len(raw) > 16 << 20:
            raise ValueError("response exceeds bounded capture size")
        return content_type, raw

    def save(name, raw):
        (args.output_dir / name).write_bytes(raw)
        files[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

    def get(path, name):
        _, raw = read(path)
        value = json.loads(raw)
        save(name, raw)
        return value

    genesis = get("/qrl/v1/beacon/genesis", "genesis.json")["data"]
    if genesis != network["beaconGenesis"]:
        raise ValueError("local beacon genesis changed")
    spec = get("/qrl/v1/config/spec", "spec.json")["data"]
    if spec != network["beaconConfig"]:
        raise ValueError("local beacon configuration changed")
    if spec["DEPOSIT_CHAIN_ID"] != str(network["chainId"]):
        raise ValueError("beacon deposit chain ID differs from the selected fixture")
    if spec["SLOTS_PER_EPOCH"] != "8" or spec["EPOCHS_PER_SYNC_COMMITTEE_PERIOD"] != "8":
        raise ValueError("this capture uses the reviewed local 64-slot committee periods")
    config_lines = []
    for key, value in sorted(spec.items()):
        if not re.fullmatch(r"[A-Z0-9_]+", key) or not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
            raise ValueError("unexpected YAML input shape")
        config_lines.append(f"{key}: {value}")
    save("config.yml", ("\n".join(config_lines) + "\n").encode())
    finality = get("/qrl/v1/beacon/headers/finalized", "observed-finalized-header.json")
    required_finalized = bootstrap if args.allow_unfinalized_updates else attested_slots[-1] + 1
    if int(finality["data"]["header"]["message"]["slot"]) < required_finalized:
        raise ValueError("required bootstrap/update is not finalized in the local node view")
    updates = []
    for slot in sorted({bootstrap, *attested_slots, *(slot + 1 for slot in attested_slots)}):
        get(f"/qrl/v1/beacon/headers/{slot}", f"header-{slot}.json")
        content_type, raw = read(f"/qrl/v1/debug/beacon/states/{slot}", "application/octet-stream")
        if content_type != "application/octet-stream":
            raise ValueError("beacon did not return requested SSZ state bytes")
        save(f"state-{slot}.ssz", raw)
    for slot in attested_slots:
        checkpoints = get(f"/qrl/v1/beacon/states/{slot}/finality_checkpoints", f"checkpoints-{slot}.json")
        finalized_root = checkpoints["data"]["finalized"]["root"]
        finalized_header = get(f"/qrl/v1/beacon/headers/{finalized_root}", f"finalized-header-{slot}.json")
        finalized_slot = finalized_header["data"]["header"]["message"]["slot"]
        get(f"/qrl/v1/beacon/headers/{finalized_slot}", f"header-{finalized_slot}.json")
        content_type, raw = read(f"/qrl/v1/debug/beacon/states/{finalized_slot}", "application/octet-stream")
        if content_type != "application/octet-stream":
            raise ValueError("beacon did not return finalized-state SSZ")
        save(f"state-{finalized_slot}.ssz", raw)
        signed = get(f"/qrl/v1/beacon/blocks/{slot + 1}", f"block-{slot + 1}.json")
        aggregate = signed["data"]["message"]["body"]["sync_aggregate"]
        signatures = aggregate["sync_committee_signatures"]
        bits = bytes.fromhex(aggregate["sync_committee_bits"][2:])
        updates.append({
            "attestedSlot": str(slot),
            "signatureSlot": str(slot + 1),
            "finalizedSlot": finalized_header["data"]["header"]["message"]["slot"],
            "participants": sum(value.bit_count() for value in bits),
            "signatures": len(signatures),
            "uniqueSignatures": len(set(signatures)),
            "signatureBytes": sum(len(bytes.fromhex(value[2:])) for value in signatures),
        })
    manifest = {
        "schemaVersion": 1,
        "chainId": network["chainId"],
        "qrysmCommit": "9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3",
        "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "genesisValidatorsRoot": genesis["genesis_validators_root"],
        "bootstrapSlot": str(bootstrap),
        "updatesObservedFinalized": int(finality["data"]["header"]["message"]["slot"]) >= attested_slots[-1] + 1,
        "updates": updates,
        "files": files,
        "boundary": "Actual historical public chain data. RPC capture alone is not a finality proof or bootstrap trust anchor. Native verification and VM acceptance are separate steps.",
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({key: manifest[key] for key in ("bootstrapSlot", "updates", "boundary")}, indent=2))


if __name__ == "__main__":
    main()
