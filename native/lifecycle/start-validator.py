#!/usr/bin/env python3
"""Start the single controlled fixture validator with explicit local paths."""

import json
import os
from pathlib import Path
import subprocess


def main():
    if os.environ.get("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151916":
        raise RuntimeError("Explicit disposable local network selector 3151916 is required")
    root = Path(__file__).resolve().parents[2]
    runtime = root / "findings/native-network-20260915/lifecycle"
    network_file = runtime.parent / "network.json"
    network = json.loads(network_file.read_text())
    subprocess.run([
        "python3", str(root / "native/network/verify-network.py"), network["enclave"],
        "--chain-id", "3151916", "--output", str(network_file),
    ], check=True, stdout=subprocess.DEVNULL)
    probe = json.loads((runtime / "pool.json").read_text())
    if not probe.get("bootstrap") or probe["genesis"] != network["executionGenesis"]:
        raise RuntimeError("Require the recorded local funding transaction")
    process_file = runtime / "validator-process.json"
    if process_file.exists():
        raise RuntimeError("A validator process is already recorded; inspect before restarting")
    key_dir = runtime / "controlled-key"
    beacon = network["services"]["cl-1-qrysm-gqrl"]
    inspected = json.loads(subprocess.check_output(["docker", "inspect", beacon["containerId"]], text=True))[0]
    config_source = next(arg.split("=", 1)[1] for arg in inspected["Config"]["Cmd"] if arg.startswith("--chain-config-file="))
    config_file = key_dir / "config.yaml"
    subprocess.run(["docker", "cp", f"{beacon['containerId']}:{config_source}", str(config_file)], check=True)
    grpc_binding = next(binding for binding in beacon["ports"]["4000/tcp"] if binding["HostIp"] == "127.0.0.1")
    command = [
        str(runtime.parent / "bin/validator"), "--accept-terms-of-use", "--disable-monitoring",
        "--chain-config-file=" + str(config_file), "--datadir=" + str(key_dir / "validator-data"),
        "--wallet-dir=" + str(key_dir / "wallet"), "--wallet-password-file=" + str(key_dir / "fixture-password.txt"),
        "--beacon-rpc-provider=127.0.0.1:" + grpc_binding["HostPort"],
        "--beacon-rest-api-provider=" + network["beaconUrl"],
        "--suggested-fee-recipient=" + probe["operatorAddress"],
    ]
    with (runtime / "controlled-validator.log").open("w") as log:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    record = {
        "pid": process.pid, "chainId": 3151916, "command": command,
        "withdrawalRecipient": probe["address"], "suggestedFeeRecipient": probe["operatorAddress"],
        "feeRoutingScope": "This fixture configures the proposer recipient; the protocol does not enforce that choice.",
    }
    process_file.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"pid": process.pid, "chainId": 3151916, "validatorCount": 1}))


if __name__ == "__main__":
    main()
