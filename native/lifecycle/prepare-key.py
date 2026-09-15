#!/usr/bin/env python3
"""Create one fresh disposable key, then public deposits after pool binding."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import subprocess

from context import NETWORK_RUNTIME, RUNTIME, ROOT, network_context, normalized

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind-pool", action="store_true")
    args = parser.parse_args()
    network, _ = network_context()
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    key_dir = RUNTIME / "controlled-key"
    binary_dir = NETWORK_RUNTIME / "bin"
    def run(command, name):
        with (RUNTIME / name).open("w") as output:
            result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError("Fixture command failed; inspect ignored " + name)
    fixture_file = RUNTIME / "fixture.json"
    if not args.bind_pool:
        if fixture_file.exists():
            raise RuntimeError("Fixture already exists; preserve its signing identity")
        run([str(binary_dir / "key-fixture"), "-mode", "prepare", "-key-dir", str(key_dir)], "key-generation.log")
        public = json.loads((key_dir / "public.json").read_text())
        wallet = key_dir / "wallet"
        password = key_dir / "fixture-password.txt"
        run([str(binary_dir / "validator"), "wallet", "create", "--accept-terms-of-use", "--wallet-dir=" + str(wallet), "--keymanager-kind=local", "--wallet-password-file=" + str(password)], "wallet-create.log")
        run([str(binary_dir / "validator"), "accounts", "import", "--accept-terms-of-use", "--wallet-dir=" + str(wallet), "--keys-dir=" + str(key_dir / "generated"), "--wallet-password-file=" + str(password), "--account-password-file=" + str(password)], "wallet-import.log")
        fixture = {"preparedAt": datetime.now(timezone.utc).isoformat(), "chainId": 3151916, "genesis": network["executionGenesis"], "beaconGenesis": network["beaconGenesis"], "validatorPubkey": public["pubkey"], "freshRandomFixture": True, "depositBound": False}
        fixture_file.write_text(json.dumps(fixture, indent=2) + "\n")
        fixture_file.chmod(0o600)
        print(json.dumps({"freshValidatorPrepared": True, "publicKeySha256": hashlib.sha256(bytes.fromhex(normalized(public["pubkey"]))).hexdigest()}))
        return
    fixture = json.loads(fixture_file.read_text())
    pool = json.loads((RUNTIME / "pool.json").read_text())
    if pool["chainId"] != 3151916 or pool["genesis"] != network["executionGenesis"] or fixture["genesis"] != network["executionGenesis"] or fixture["depositBound"]:
        raise RuntimeError("Pool binding must be new and match this fixture")
    public_dir = RUNTIME / "deposits"
    run([str(binary_dir / "key-fixture"), "-mode", "deposits", "-key-dir", str(key_dir), "-recipient", pool["address"], "-output", str(public_dir)], "deposit-generation.log")
    for qrl in (2000, 38000, 40000):
        data = json.loads((public_dir / f"deposit-{qrl}.json").read_text())[0]
        if normalized(data["pubkey"]) != normalized(fixture["validatorPubkey"]) or normalized(data["withdrawal_recipient"]) != normalized(pool["address"]) or data["fork_version"] != "0x31519160":
            raise RuntimeError("Generated deposit identity mismatch")
    fixture["depositBound"] = True
    fixture["withdrawalRecipient"] = pool["address"]
    fixture_file.write_text(json.dumps(fixture, indent=2) + "\n")
    print(json.dumps({"publicDepositVariantsQrl": [2000, 38000, 40000], "recipient": pool["address"]}))

if __name__ == "__main__":
    main()
