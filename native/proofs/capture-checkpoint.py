#!/usr/bin/env python3
"""Capture a matched public beacon/execution checkpoint from a disposable local fixture."""

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
    parser.add_argument("--network", type=Path, required=True)
    parser.add_argument("--account", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--slot", type=int,
                        help="explicit already-finalized occupied slot for paired finality evidence")
    args = parser.parse_args()
    network = json.loads(args.network.read_text())
    if network["chainId"] != 3151916 or network["loopbackOnly"] is not True:
        raise ValueError("requires an identified disposable fixture")
    if not re.fullmatch(r"Q[0-9a-fA-F]{128}", args.account):
        raise ValueError("account must contain exactly 64 address bytes")
    for field in ("beaconUrl", "rpcUrl"):
        url = urllib.parse.urlparse(network[field])
        if (url.scheme != "http" or not ipaddress.ip_address(url.hostname).is_loopback
                or url.username or url.password or url.path not in ("", "/")
                or url.query or url.fragment):
            raise ValueError("requires literal loopback HTTP origins")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise ValueError("use a fresh output directory to preserve captured witnesses")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def read(url, data=None, accept="application/json"):
        request = urllib.request.Request(url, data=data, headers={
            "Accept": accept, "Content-Type": "application/json"})
        with opener.open(request, timeout=20) as response:
            raw = response.read((16 << 20) + 1)
            content_type = response.headers.get_content_type()
        if len(raw) > 16 << 20:
            raise ValueError("response exceeds capture limit")
        return raw, content_type

    def beacon(path):
        return json.loads(read(network["beaconUrl"] + path)[0])

    def rpc(method, params):
        raw, _ = read(network["rpcUrl"], json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode())
        response = json.loads(raw)
        if "error" in response:
            raise ValueError(response["error"])
        return response["result"]

    genesis = beacon("/qrl/v1/beacon/genesis")["data"]
    spec = beacon("/qrl/v1/config/spec")["data"]
    if genesis != network["beaconGenesis"] or spec != network["beaconConfig"]:
        raise ValueError("beacon fixture identity changed")
    if (int(rpc("qrl_chainId", []), 16) != network["chainId"]
            or spec["DEPOSIT_CHAIN_ID"] != str(network["chainId"])
            or rpc("qrl_getBlockByNumber", ["0x0", False])["hash"] != network["executionGenesis"]):
        raise ValueError("execution fixture identity changed")
    header = beacon("/qrl/v1/beacon/headers/finalized")
    if args.slot is not None:
        if not 0 <= args.slot <= int(header["data"]["header"]["message"]["slot"]):
            raise ValueError("requested checkpoint is not yet finalized in the node view")
        header = beacon(f"/qrl/v1/beacon/headers/{args.slot}")
    slot = header["data"]["header"]["message"]["slot"]
    block = beacon(f"/qrl/v1/beacon/blocks/{slot}")
    payload = block["data"]["message"]["body"]["execution_payload"]
    execution = rpc("qrl_getBlockByHash", [payload["block_hash"], False])
    if (execution["stateRoot"] != payload["state_root"]
            or int(execution["number"], 16) != int(payload["block_number"])):
        raise ValueError("execution header differs from beacon payload")
    proof = rpc("qrl_getProof", [args.account, [], {
        "blockHash": payload["block_hash"], "requireCanonical": True}])
    state, content_type = read(network["beaconUrl"] + f"/qrl/v1/debug/beacon/states/{slot}",
                               accept="application/octet-stream")
    if content_type != "application/octet-stream":
        raise ValueError("expected canonical SSZ state bytes")
    config = []
    for key, value in sorted(spec.items()):
        if not re.fullmatch(r"[A-Z0-9_]+", key) or not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
            raise ValueError("unexpected configuration shape")
        config.append(f"{key}: {value}")
    files = {"state.ssz": state, "config.yml": ("\n".join(config) + "\n").encode()}
    values = {"header.json": header, "execution.json": execution, "account.json": proof,
              "genesis.json": genesis, "spec.json": spec}
    files.update({name: (json.dumps(value, indent=2) + "\n").encode()
                  for name, value in values.items()})
    manifest = {"chainId": network["chainId"], "slot": slot, "account": args.account,
                "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "qrysmCommit": "3b816311ac3e86b7a7af40a062ae290318554f7a",
                "goQrlCommit": "9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9",
                "files": {name: {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
                          for name, raw in files.items()},
                "boundary": "Node-observed finalized header; native proof verification and contract finality acceptance are separate steps."}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        (args.output_dir / name).write_bytes(raw)
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"slot": slot, "executionBlock": payload["block_number"],
                      "proofNodes": len(proof["accountProof"]), "output": str(args.output_dir)}))


if __name__ == "__main__":
    main()
