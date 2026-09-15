#!/usr/bin/env python3
"""Read-only identity and host exposure checks for the isolated prototype."""

import argparse
import json
import subprocess
import time
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise RuntimeError("Local fixture endpoint attempted an HTTP redirect")


LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True)


def inspect_enclave(enclave):
    ids = docker("ps", "-q", "--filter", f"label=kurtosis_enclave_name={enclave}").split()
    if not ids:
        raise RuntimeError("No running enclave service containers")
    containers = json.loads(docker("inspect", *ids))
    services = {}
    for container in containers:
        labels = container["Config"].get("Labels") or {}
        name = labels.get("kurtosis_service_name", container["Name"])
        ports = container["NetworkSettings"].get("Ports") or {}
        for private_port, bindings in ports.items():
            for binding in bindings or []:
                if binding["HostIp"] not in ("127.0.0.1", "::1"):
                    raise RuntimeError(f"Non-loopback host binding: {name}:{private_port}")
        services[name] = {
            "containerId": container["Id"],
            "imageId": container["Image"],
            "ports": ports,
            "revision": labels.get("org.opencontainers.image.revision"),
        }
    return services


def url_for(service, private_port):
    bindings = service["ports"].get(private_port) or []
    binding = next((entry for entry in bindings if entry["HostIp"] == "127.0.0.1"), None)
    if binding is None:
        raise RuntimeError(f"Missing IPv4 loopback mapping for {private_port}")
    return f"http://127.0.0.1:{binding['HostPort']}"


def request_json(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with LOCAL_HTTP.open(request, timeout=10) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("enclave")
    parser.add_argument("--bind-only", action="store_true")
    parser.add_argument("--output")
    parser.add_argument("--chain-id", type=int, choices=(3151914, 3151915), default=3151914)
    args = parser.parse_args()
    services = inspect_enclave(args.enclave)
    if args.bind_only:
        print(json.dumps({"enclave": args.enclave, "loopbackOnly": True, "services": services}, indent=2))
        return

    expected = {
        "el-1-gqrl-qrysm": ("execution", "9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9"),
        "cl-1-qrysm-gqrl": ("beacon", "9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3"),
        "vc-1-gqrl-qrysm": ("validator", "9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3"),
    }
    for name, (image, revision) in expected.items():
        service = services[name]
        image_info = json.loads(docker("image", "inspect", f"quantapool-prototype/{image}:20260914"))[0]
        if service["imageId"] != image_info["Id"] or service["revision"] != revision:
            raise RuntimeError(f"Source/image identity mismatch for {name}")

    rpc_url = url_for(services["el-1-gqrl-qrysm"], "8545/tcp")
    beacon_url = url_for(services["cl-1-qrysm-gqrl"], "3500/tcp")

    def rpc(method, params=None):
        reply = request_json(rpc_url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []})
        if "error" in reply:
            raise RuntimeError(str(reply["error"]))
        return reply["result"]

    if int(rpc("qrl_chainId"), 16) != args.chain_id:
        raise RuntimeError("Unexpected chain ID; public fixtures must not be used")
    initial_block = int(rpc("qrl_blockNumber"), 16)
    deadline = time.monotonic() + 300
    while int(rpc("qrl_blockNumber"), 16) <= initial_block:
        if time.monotonic() >= deadline:
            raise RuntimeError("Execution block height did not advance")
        time.sleep(2)
    genesis = request_json(beacon_url + "/qrl/v1/beacon/genesis")
    spec = request_json(beacon_url + "/qrl/v1/config/spec")["data"]
    for key, expected_value in {
        "SECONDS_PER_SLOT": "3" if args.chain_id == 3151915 else "6", "SLOTS_PER_EPOCH": "8", "SHARD_COMMITTEE_PERIOD": "16",
        "MIN_VALIDATOR_WITHDRAWABILITY_DELAY": "16", "DEPOSIT_CHAIN_ID": str(args.chain_id),
        "EPOCHS_PER_EXECUTION_VOTING_PERIOD": "64",
        "EXECUTION_FOLLOW_DISTANCE": "512", "MAX_SEED_LOOKAHEAD": "4",
        "SECONDS_PER_EXECUTION_BLOCK": "3" if args.chain_id == 3151915 else "6",
        "MAX_EFFECTIVE_BALANCE": "40000000000000",
    }.items():
        if str(spec.get(key)) != expected_value:
            raise RuntimeError(f"Unexpected active beacon config: {key}")
    result = {
        "enclave": args.enclave, "chainId": args.chain_id, "rpcUrl": rpc_url,
        "beaconUrl": beacon_url, "loopbackOnly": True, "services": services,
        "executionGenesis": rpc("qrl_getBlockByNumber", ["0x0", False])["hash"],
        "beaconGenesis": genesis["data"], "beaconConfig": spec,
        "initialBlock": initial_block, "observedBlock": int(rpc("qrl_blockNumber"), 16),
    }
    encoded = json.dumps(result, indent=2) + "\n"
    if args.output:
        with open(args.output, "w") as output:
            output.write(encoded)
    print(encoded)


if __name__ == "__main__":
    main()
