#!/usr/bin/env python3
"""Install exactly the current canonical deposit runtime in this local genesis.

The pinned upstream generator still embeds the predecessor's one-QRL floor.
Current Qrysm changed only that floor to 2,000 QRL; constructor storage agrees.
"""
import hashlib
import json
import os
from pathlib import Path

if os.environ.get("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151916":
    raise RuntimeError("Explicit fixture selector required")
genesis_path = Path("/data/metadata/genesis.json")
genesis = json.loads(genesis_path.read_text())
if genesis["config"]["chainId"] != 3151916:
    raise RuntimeError("Unexpected execution genesis chain")
address = "Q" + "42" * 64
account = genesis["alloc"][address]
if account["balance"] != "0":
    raise RuntimeError("Unexpected prefunded deposit contract")
old = bytes.fromhex(account["code"].removeprefix("0x"))
if hashlib.sha256(old).hexdigest() != "139a1a7f9069b6e446f7834199140f19483435d663299649507c817b0cf2f66f":
    raise RuntimeError("Generator deposit runtime changed; review the new input")
# This is precisely the extraction performed by the current unmodified
# Qrysm DepositContractRuntimeCodeHex function in contracts/deposit/bytecode.go.
creation = Path("/work/deposit-creation.bin").read_text().strip().removeprefix("0x")
runtime = bytes.fromhex(creation.rsplit("f3fe", 1)[-1])
if hashlib.sha256(runtime).hexdigest() != "73b5c62b351824e49a9681e99813d70ee3f1238372a79e0dd1afac5f88700fc1":
    raise RuntimeError("Pinned canonical deposit runtime changed")
account["code"] = "0x" + runtime.hex()
genesis_path.write_text(json.dumps(genesis, indent=2) + "\n")
print("Installed exact current canonical deposit runtime before beacon genesis")
