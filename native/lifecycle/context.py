#!/usr/bin/env python3
"""Strictly local read-only identity and routing guards for lifecycle helpers."""
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
NETWORK_RUNTIME = ROOT / "findings/native-network-20260915"
RUNTIME = NETWORK_RUNTIME / "lifecycle"
EXPECTED_EXECUTION_GENESIS = "0x8d1e379de4945aedd2214a623e65ca82a54077e481d6c8a79ba4798d01d2130e"
EXPECTED_GENESIS = {"genesis_time": "1789469418", "genesis_validators_root": "0xa2343fe2ab8aeb68ec846c05423bbebf74664289676af7bb026e9dd68e8bff80", "genesis_fork_version": "0x31519160"}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise RuntimeError("Fixture endpoint attempted a redirect")

HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def read_json(url, payload=None):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("Literal loopback HTTP endpoint required")
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with HTTP.open(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404 and error.headers.get_content_type() != "application/json":
            raise RuntimeError("Unknown route must not be treated as missing validator or skipped block") from error
        raise

def normalized(value):
    return value.removeprefix("0x").removeprefix("Q").lower()

def network_context(require_selector=True):
    if require_selector and os.environ.get("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151916":
        raise RuntimeError("Explicit isolated local network3151916 selector required")
    network = json.loads((NETWORK_RUNTIME / "network.json").read_text())
    for endpoint in (network["rpcUrl"], network["beaconUrl"]):
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.path not in ("", "/"):
            raise RuntimeError("Unexpected base endpoint path")
    def rpc(method, params):
        result = read_json(network["rpcUrl"], {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if "error" in result:
            raise RuntimeError(str(result["error"]))
        return result["result"]
    if network["chainId"] != 3151916 or int(rpc("qrl_chainId", []), 16) != 3151916:
        raise RuntimeError("Unexpected fixture chain")
    if network["executionGenesis"] != EXPECTED_EXECUTION_GENESIS or rpc("qrl_getBlockByNumber", ["0x0", False])["hash"] != EXPECTED_EXECUTION_GENESIS:
        raise RuntimeError("Unexpected execution genesis")
    if network["beaconGenesis"] != EXPECTED_GENESIS or read_json(network["beaconUrl"] + "/qrl/v1/beacon/genesis")["data"] != EXPECTED_GENESIS:
        raise RuntimeError("Unexpected consensus genesis/domain")
    spec = read_json(network["beaconUrl"] + "/qrl/v1/config/spec")["data"]
    if spec != network["beaconConfig"]:
        raise RuntimeError("Active consensus configuration changed")
    code = rpc("qrl_getCode", [network["canonicalDeposit"]["address"], "latest"])
    if hashlib.sha256(bytes.fromhex(code[2:])).hexdigest() != "73b5c62b351824e49a9681e99813d70ee3f1238372a79e0dd1afac5f88700fc1":
        raise RuntimeError("Canonical deposit runtime mismatch")
    return network, rpc

def context():
    network, rpc = network_context()
    state = json.loads((RUNTIME / "pool.json").read_text())
    fixture = json.loads((RUNTIME / "fixture.json").read_text())
    if state["chainId"] != 3151916 or state["genesis"] != EXPECTED_EXECUTION_GENESIS or fixture["genesis"] != EXPECTED_EXECUTION_GENESIS:
        raise RuntimeError("Pool or fixture belongs to another chain")
    state["validatorPubkey"] = fixture["validatorPubkey"]
    return RUNTIME, network, state, rpc

def validator_at(network, pool, state):
    try:
        result = read_json(network["beaconUrl"] + f"/qrl/v1/beacon/states/{state}/validators/" + pool["validatorPubkey"])
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    data = result["data"]
    validator = data["validator"]
    if normalized(validator["pubkey"]) != normalized(pool["validatorPubkey"]) or normalized(validator["withdrawal_recipient"]) != normalized(pool["address"]):
        raise RuntimeError("Canonical validator identity/recipient mismatch")
    return data
