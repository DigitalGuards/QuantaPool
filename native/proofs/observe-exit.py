#!/usr/bin/env python3
"""Read bounded public exit observations from the identified native pool fixture."""

import argparse
import datetime
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("redirects are prohibited")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", required=True, type=Path)
    parser.add_argument("--exit-file", required=True, type=Path)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--scan-from", type=int)
    parser.add_argument("--scan-to", type=int)
    parser.add_argument("--expected-index", help="explicit canonical validator index for the funded lifecycle")
    parser.add_argument("--expected-public-key-sha256", help="public identity hash pinned independently from the exit file")
    args = parser.parse_args()
    source_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(source_root / "native/lifecycle"))
    from context import network_context
    network_context()
    network = json.loads(args.network.read_text())
    if args.network.resolve() != (source_root / "findings/native-network-20260915/network.json").resolve():
        raise ValueError("exact native fixture manifest required")
    origin = network["beaconUrl"]
    url = urllib.parse.urlparse(origin)
    if (network["chainId"] != 3151916 or network["loopbackOnly"] is not True
            or url.scheme != "http" or not ipaddress.ip_address(url.hostname).is_loopback
            or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment):
        raise ValueError("requires the identified prototype's literal loopback HTTP origin")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(path):
        with opener.open(origin.rstrip("/") + path, timeout=15) as response:
            body = response.read((16 << 20) + 1)
        if len(body) > 16 << 20:
            raise ValueError("response exceeds bounded observation size")
        return json.loads(body)

    expected_genesis = network["beaconGenesis"]["genesis_validators_root"]
    if get("/qrl/v1/beacon/genesis")["data"] != network["beaconGenesis"]:
        raise ValueError("local beacon genesis changed")
    specification = get("/qrl/v1/config/spec")["data"]
    if specification != network["beaconConfig"] or specification["DEPOSIT_CHAIN_ID"] != str(network["chainId"]):
        raise ValueError("local beacon configuration or deposit chain ID changed")
    public_bytes = args.exit_file.read_bytes()
    public_exit = json.loads(public_bytes)
    index = public_exit["message"]["validator_index"]
    expected_index = args.expected_index
    expected_key_hash = args.expected_public_key_sha256
    if (expected_index is None or not re.fullmatch(r"[0-9]+", expected_index)
            or int(expected_index) >= 1 << 40 or index != expected_index):
        raise ValueError("the public message must match an explicit bounded canonical validator index")
    if expected_key_hash is None:
        raise ValueError("the funded lifecycle requires an independently pinned public-key hash")
    if expected_key_hash is not None and not re.fullmatch(r"[0-9a-f]{64}", expected_key_hash):
        raise ValueError("expected public-key hash must be 64 lowercase hexadecimal characters")
    result = {
        "stage": args.stage,
        "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "genesisValidatorsRoot": expected_genesis,
        "genesisTime": network["beaconGenesis"]["genesis_time"],
        "chainId": network["chainId"],
        "executionGenesis": network["executionGenesis"],
        "validatorIndex": index,
        "expectedPublicKeySHA256": expected_key_hash,
        "publicMessageSHA256": hashlib.sha256(public_bytes).hexdigest(),
        "observationBoundary": "local RPC observations; no contract-verifiable finality proof",
        "states": {},
    }
    for state_id in ("head", "finalized"):
        header = get("/qrl/v1/beacon/headers/" + state_id)
        # Pin the state lookup to the same block slot and compare its root, so
        # a progressing head does not mix header and validator observations.
        message = header["data"]["header"]["message"]
        state_root = message["state_root"]
        state_path = "/qrl/v1/beacon/states/" + message["slot"]
        if get(state_path + "/root")["data"]["root"] != state_root:
            raise ValueError("observed block and fixed-slot state roots disagree")
        state_result = {
            "slot": message["slot"],
            "epoch": str(int(message["slot"]) // int(network["beaconConfig"]["SLOTS_PER_EPOCH"])),
            "blockRoot": header["data"]["root"],
            "stateRoot": state_root,
        }
        try:
            data = get(state_path + "/validators/" + index)["data"]
        except urllib.error.HTTPError as error:
            if state_id == "finalized" and error.code == 404 and error.headers.get_content_type() == "application/json":
                result["states"][state_id] = {**state_result, "validatorPresent": False}
                continue
            raise
        validator = data["validator"]
        if data["index"] != index:
            raise ValueError("validator index mismatch")
        public_key_hash = hashlib.sha256(bytes.fromhex(validator["pubkey"][2:])).hexdigest()
        if expected_key_hash is not None and public_key_hash != expected_key_hash:
            raise ValueError("canonical validator public key differs from independently pinned identity")
        result["states"][state_id] = {
            **state_result,
            "validatorPresent": True,
            "status": data["status"],
            "balance": data["balance"],
            "publicKeySHA256": public_key_hash,
            "withdrawalRecipient": validator["withdrawal_recipient"],
            "activationEpoch": validator["activation_epoch"],
            "exitEpoch": validator["exit_epoch"],
            "withdrawableEpoch": validator["withdrawable_epoch"],
        }
    if args.scan_from is not None:
        end = args.scan_to if args.scan_to is not None else int(result["states"]["head"]["slot"])
        if args.scan_from < 0 or end < args.scan_from or end - args.scan_from > 64:
            raise ValueError("block scan must be at most 65 nonnegative slots")
        result["scannedSlots"] = [args.scan_from, end]
        result["includedExits"] = []
        result["skippedSlots"] = []
        for slot in range(args.scan_from, end + 1):
            try:
                block = get("/qrl/v1/beacon/blocks/" + str(slot))
            except urllib.error.HTTPError as error:
                if error.code == 404 and error.headers.get_content_type() == "application/json":
                    result["skippedSlots"].append(slot)
                    continue
                raise
            for signed_exit in block["data"]["message"]["body"]["voluntary_exits"]:
                if signed_exit["message"]["validator_index"] == index:
                    result["includedExits"].append({
                        "slot": str(slot),
                        "exitEpoch": signed_exit["message"]["epoch"],
                        "signatureSHA256": hashlib.sha256(bytes.fromhex(signed_exit["signature"][2:])).hexdigest(),
                        "matchesPublicMessage": signed_exit == public_exit,
                    })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
