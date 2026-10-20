#!/usr/bin/env python3
"""Prepare one public exit message using a disposable, guarded local fixture."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request


def main():
    if os.environ.get("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151914":
        raise RuntimeError("Explicit QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151914 is required")
    network_dir = Path(__file__).resolve().parent
    runtime_dir = network_dir.parent.parent / "findings/native-qrl-prototype"
    network_file = runtime_dir / "network.json"
    network = json.loads(network_file.read_text())
    subprocess.run(
        ["python3", str(network_dir / "verify-network.py"), network["enclave"], "--output", str(network_file)],
        check=True, stdout=subprocess.DEVNULL,
    )
    network = json.loads(network_file.read_text())
    if network["chainId"] != 3151914:
        raise RuntimeError("Unexpected chain ID")
    with urllib.request.urlopen(network["beaconUrl"] + "/qrl/v1/beacon/states/head/validators/63", timeout=10) as response:
        validator = json.load(response)["data"]
    if validator["validator"]["activation_epoch"] != "0":
        raise RuntimeError("Fixture validator 63 must be a genesis validator")
    pubkey = validator["validator"]["pubkey"]
    service = network["services"]["vc-1-gqrl-qrysm"]
    container = json.loads(subprocess.check_output(["docker", "inspect", service["containerId"]], text=True))[0]
    args = container["Config"]["Cmd"]

    def argument(name):
        return next(value.split("=", 1)[1] for value in args if value.startswith(name + "="))

    signer_dir = Path(tempfile.mkdtemp(prefix="exit-signer-", dir=runtime_dir))
    for remote_path, local_name in (
        (argument("--wallet-dir"), "wallet"),
        (argument("--wallet-password-file"), "password.txt"),
        (argument("--chain-config-file"), "config.yaml"),
    ):
        subprocess.run(["docker", "cp", f"{service['containerId']}:{remote_path}", str(signer_dir / local_name)], check=True)
    beacon = network["services"]["cl-1-qrysm-gqrl"]
    grpc_binding = next(entry for entry in beacon["ports"]["4000/tcp"] if entry["HostIp"] == "127.0.0.1")
    output_dir = runtime_dir / "public-exit"
    output_dir.mkdir(mode=0o700, exist_ok=True)
    output_dir.chmod(0o700)
    command = [
        str(runtime_dir / "bin/validator"),
        "--chain-config-file=" + str(signer_dir / "config.yaml"),
        "accounts", "voluntary-exit", "--accept-terms-of-use", "--force-exit",
        "--wallet-dir=" + str(signer_dir / "wallet"),
        "--wallet-password-file=" + str(signer_dir / "password.txt"),
        "--public-keys=" + pubkey,
        "--beacon-rpc-provider=127.0.0.1:" + grpc_binding["HostPort"],
        "--exit-json-output-dir=" + str(output_dir),
    ]
    with (runtime_dir / "prepare-exit.log").open("w") as log:
        subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
    public_file = output_dir / "validator-exit-63.json"
    signed_exit = json.loads(public_file.read_text())
    if signed_exit.get("message", {}).get("validator_index") != "63":
        raise RuntimeError("Generated exit does not identify fixture validator 63")
    with urllib.request.urlopen(network["beaconUrl"] + "/qrl/v1/beacon/headers/head", timeout=10) as response:
        head = json.load(response)["data"]["header"]["message"]
    result = {
        "validatorIndex": "63", "signedEpoch": signed_exit["message"]["epoch"],
        "validatorPubkey": pubkey, "observedHeadSlot": head["slot"],
        "activationEpoch": validator["validator"]["activation_epoch"],
        "beaconGenesis": network["beaconGenesis"], "file": str(public_file),
        "broadcastBySigner": False,
        "scope": "Disposable genesis validator fixture; does not establish new-validator bootstrap availability",
    }
    (runtime_dir / "prepare-exit-result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "validatorPubkey"}, indent=2))


if __name__ == "__main__":
    main()
