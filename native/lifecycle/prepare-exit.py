#!/usr/bin/env python3
"""Export a public exit after canonical registration, using only the fixture key."""

from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import subprocess
import time

from context import context, read_json, validator_at


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wait-seconds", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.wait_seconds <= 5400:
        raise RuntimeError("Registration wait must be bounded to at most 90 minutes")
    if os.environ.get("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151916":
        raise RuntimeError("Explicit disposable local network selector 3151916 is required")
    runtime, network, probe, _ = context()
    validator = validator_at(network, probe, "head")
    deadline = time.monotonic() + args.wait_seconds
    while validator is None and time.monotonic() < deadline:
        time.sleep(min(24, max(0, deadline - time.monotonic())))
        validator = validator_at(network, probe, "head")
    if validator is None:
        raise RuntimeError("The funded validator has no canonical index yet; an index-bound exit cannot be exported")
    key_dir = runtime / "controlled-key"
    public_dir = runtime / "public-exit"
    public_dir.mkdir(mode=0o700, exist_ok=True)
    public_dir.chmod(0o700)
    public_file = public_dir / f"validator-exit-{validator['index']}.json"
    if public_file.exists():
        raise RuntimeError("A public exit already exists; preserve the original signature")
    grpc = next(binding for binding in network["services"]["cl-1-qrysm-gqrl"]["ports"]["4000/tcp"] if binding["HostIp"] == "127.0.0.1")
    beacon = network["services"]["cl-1-qrysm-gqrl"]
    inspected = json.loads(subprocess.check_output(["docker", "inspect", beacon["containerId"]], text=True))[0]
    config_source = next(arg.split("=", 1)[1] for arg in inspected["Config"]["Cmd"] if arg.startswith("--chain-config-file="))
    subprocess.run(["docker", "cp", f"{beacon['containerId']}:{config_source}", str(key_dir / "config.yaml")], check=True)
    command = [
        str(runtime.parent / "bin/validator"), "--chain-config-file=" + str(key_dir / "config.yaml"),
        "accounts", "voluntary-exit", "--accept-terms-of-use", "--force-exit",
        "--wallet-dir=" + str(key_dir / "wallet"), "--wallet-password-file=" + str(key_dir / "fixture-password.txt"),
        "--public-keys=" + probe["validatorPubkey"], "--beacon-rpc-provider=127.0.0.1:" + grpc["HostPort"],
        "--exit-json-output-dir=" + str(public_dir),
    ]
    with (runtime / "prepare-exit.log").open("w") as log:
        subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
    message = json.loads(public_file.read_text())
    if message["message"]["validator_index"] != validator["index"]:
        raise RuntimeError("Exported exit refers to another validator")
    head = read_json(network["beaconUrl"] + "/qrl/v1/beacon/headers/head")["data"]["header"]["message"]
    result = {
        "preparedAt": datetime.now(timezone.utc).isoformat(), "validatorIndex": validator["index"],
        "validatorPubkey": probe["validatorPubkey"], "signedEpoch": message["message"]["epoch"],
        "observedHeadSlot": head["slot"], "activationEpoch": validator["validator"]["activation_epoch"],
        "beaconGenesis": network["beaconGenesis"], "executionGenesis": network["executionGenesis"],
        "chainId": network["chainId"], "file": str(public_file),
        "sha256": hashlib.sha256(public_file.read_bytes()).hexdigest(), "broadcastBySigner": False,
        "bootstrapBlock": probe["bootstrap"]["blockNumber"],
        "pooledFundingAlreadyRecorded": bool(probe.get("pooledFunding")),
        "availabilityScope": "Exported after operator-funded canonical bootstrap registration; compare the separate pooled-funding receipt and stored public exit event.",
    }
    (runtime / "prepare-exit-result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "validatorPubkey"}, indent=2))


if __name__ == "__main__":
    main()
