#!/usr/bin/env python3
"""Read-only complete occupied ancestry capture on the identified native fixture."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import shutil
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError("redirect prohibited")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", type=Path, required=True)
    parser.add_argument("--start-root", required=True)
    parser.add_argument("--stop-root", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-blocks", type=int, default=512)
    parser.add_argument("--cache-dir", type=Path, action="append", default=[])
    args = parser.parse_args()
    network = json.loads(args.network.read_text())
    if network["chainId"] != 3151916 or network["loopbackOnly"] is not True:
        raise ValueError("identified native fixture required")
    for root in (args.start_root, args.stop_root):
        if not re.fullmatch(r"0x[0-9a-f]{64}", root):
            raise ValueError("canonical header roots required")
    if args.start_root == args.stop_root or not 1 <= args.max_blocks <= 4096:
        raise ValueError("nonempty bounded interval required")
    url = urllib.parse.urlparse(network["beaconUrl"])
    if (url.scheme != "http" or not ipaddress.ip_address(url.hostname).is_loopback
            or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment):
        raise ValueError("literal loopback origin required")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise ValueError("fresh output directory required")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def read(path, accept="application/json"):
        request = urllib.request.Request(network["beaconUrl"] + path, headers={"Accept": accept})
        with opener.open(request, timeout=30) as response:
            raw = response.read((16 << 20) + 1)
            kind = response.headers.get_content_type()
        if len(raw) > 16 << 20 or kind != accept:
            raise ValueError("bounded response type/size mismatch")
        return raw

    if (json.loads(read("/qrl/v1/beacon/genesis"))["data"] != network["beaconGenesis"]
            or json.loads(read("/qrl/v1/config/spec"))["data"] != network["beaconConfig"]):
        raise ValueError("native fixture identity changed")
    cache = {}
    for directory in args.cache_dir:
        prior = json.loads((directory / "flow-manifest.json").read_text())
        if prior.get("chainId") != 3151916 or len(prior["blocks"]) > 4096:
            raise ValueError("incompatible bounded cache")
        for index, item in enumerate(prior["blocks"]):
            if Path(item["file"]).name != item["file"] or not item["file"].endswith(".ssz"):
                raise ValueError("invalid cached filename")
            parent = prior["blocks"][index + 1]["root"] if index + 1 < len(prior["blocks"]) else prior["stopRoot"]
            cache[item["root"]] = (directory / item["file"], item, parent)
    args.output_dir.mkdir(parents=True)
    reused = 0
    next_root = args.start_root
    result = []
    while next_root != args.stop_root:
        if len(result) == args.max_blocks:
            raise ValueError("stop root absent from bounded ancestry")
        if next_root in cache:
            source, item, parent = cache[next_root]
            raw = source.read_bytes()
            if len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
                raise ValueError("cached signed block changed")
            shutil.copyfile(source, args.output_dir / item["file"])
            result.append({**item, "parentRoot": parent})
            next_root = parent
            reused += 1
            continue
        header = json.loads(read(f"/qrl/v1/beacon/headers/{next_root}"))["data"]
        if header["root"] != next_root:
            raise ValueError("header lookup root mismatch")
        message = header["header"]["message"]
        raw = read(f"/qrl/v1/beacon/blocks/{next_root}", "application/octet-stream")
        filename = f"block-{message['slot']}.ssz"
        (args.output_dir / filename).write_bytes(raw)
        result.append({"file": filename, "root": next_root, "slot": message["slot"],
                       "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "parentRoot": message["parent_root"]})
        next_root = message["parent_root"]
    manifest = {"startRoot": args.start_root, "stopRoot": args.stop_root, "blocks": result,
                "chainId": 3151916, "cachedBlocks": reused, "boundary": "Public captured ancestry requires native root checks and separately authenticated finality."}
    (args.output_dir / "flow-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"occupiedBlocks": len(result), "cachedBlocks": reused, "output": str(args.output_dir)}))


if __name__ == "__main__":
    main()
