#!/usr/bin/env python3
"""Generate exactly one disposable public-fixture validator on the guarded chain."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def main():
    if os.environ.get("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151915":
        raise RuntimeError("Explicit disposable local network selector 3151915 is required")
    root = Path(__file__).resolve().parents[2]
    runtime = root / "findings/native-qrl-prototype/lifecycle"
    network_file = runtime / "network.json"
    network = json.loads(network_file.read_text())
    subprocess.run([
        "python3", str(root / "prototype/network/verify-network.py"), network["enclave"],
        "--chain-id", "3151915", "--output", str(network_file),
    ], check=True, stdout=subprocess.DEVNULL)
    probe = json.loads((runtime / "probe.json").read_text())
    if probe["chainId"] != 3151915 or probe["genesis"] != network["executionGenesis"]:
        raise RuntimeError("Receiver belongs to another chain")
    key_dir = runtime / "controlled-fixture-64"
    key_dir.mkdir(mode=0o700)
    constants = (root.parent / "qrl-package/src/package_io/constants.star").read_text()
    mnemonic = re.search(r'^DEFAULT_MNEMONIC\s*=\s*"([^"]+)"', constants, re.M).group(1)
    password_file = key_dir / "fixture-password.txt"
    password_file.write_text("Disposable-public-local-fixture-3151915-only\n")
    password_file.chmod(0o600)
    binary_dir = runtime.parent / "bin"

    def run(command, log_name):
        with (key_dir / log_name).open("w") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f"Fixture command failed; inspect ignored {log_name}")

    generated = key_dir / "generated"
    run([
        str(binary_dir / "deposit"), "new-seed", "--validator-start-index", "64",
        "--num-validators", "1", "--folder", str(generated), "--mnemonic", mnemonic,
        "--keystore-password-file", str(password_file), "--chain-name", "dev",
        "--execution-address", probe["address"], "--lightkdf",
    ], "generate.log")
    deposits = list(generated.glob("deposit_data-*.json"))
    if len(deposits) != 1:
        raise RuntimeError("Expected exactly one public deposit data file")
    deposit = json.loads(deposits[0].read_text())
    if len(deposit) != 1:
        raise RuntimeError("Expected exactly one new validator")
    shutil.copyfile(deposits[0], runtime / "deposit-data.json")
    wallet = key_dir / "wallet"
    run([
        str(binary_dir / "validator"), "wallet", "create", "--accept-terms-of-use",
        "--wallet-dir", str(wallet), "--keymanager-kind", "local",
        "--wallet-password-file", str(password_file),
    ], "wallet-create.log")
    run([
        str(binary_dir / "validator"), "accounts", "import", "--accept-terms-of-use",
        "--wallet-dir", str(wallet), "--keys-dir", str(generated),
        "--wallet-password-file", str(password_file), "--account-password-file", str(password_file),
    ], "wallet-import.log")
    print(json.dumps({"fixtureDerivationIndex": 64, "validatorCount": 1, "publicDepositFile": "deposit-data.json"}))


if __name__ == "__main__":
    main()
