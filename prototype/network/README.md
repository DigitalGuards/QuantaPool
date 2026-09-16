# Isolated prototype network

This harness builds unmodified cyyber clients and starts a disposable local QRL network. It never connects a signer to public or private hosted networks. The public account selector and exact chain checks apply only to this local fixture.

The network uses 64 genesis validators, chain ID `3151914`, six-second slots, eight slots per epoch, a 64-epoch execution voting period, a 16-epoch active tenure before voluntary exits, and a 16-epoch withdrawal delay. Slot and epoch timing are accelerated local configuration. Validator funding size and protocol rules come from the pinned upstream implementations. The published fixture keystores use the upstream CLI's light KDF option; these keys provide no secrecy.

The latest Qrysm configuration validation rejects the older local combination of eight slots and a 16-epoch execution voting period: the product is 128 slots, while the binary's SSZ state layout requires 512. The application-owned genesis wrapper selects 64 epochs so `64 * 8 = 512`. It checks the exact local chain and slot configuration before supplying this supported setting. Upstream source remains unchanged.

## Source pins

| Component | Commit |
| --- | --- |
| cyyber/go-qrl | `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9` |
| cyyber/qrysm | `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3` |
| cyyber/qrl-genesis-generator | `97d65b671a7b86602e932b6e2ec1e0a9bd5ca22c` |
| cyyber/qrl-package | `04fd3133a7107229531da425dc750129bb691514` |

Go `1.26.5` compiles the execution, beacon, validator, deposit CLI and qrysmctl binaries with `-mod=readonly -trimpath`, `CGO_ENABLED=0` and four build workers. The generator's application files are copied unchanged. It contains the five-argument, RANDAO-aware deposit contract runtime. Binary SHA-256 hashes, image build logs, active image IDs and genesis identities are recorded under the ignored `findings/native-qrl-prototype/` directory.

## Reproduce

Supply pristine checkouts at the listed commits. The source root contains `go-qrl/` and `qrysm/`; the genesis-generator directory is a separate argument. Set `QRL_PACKAGE_DIR` when the pinned package is outside the sibling workspace location.

```bash
bash prototype/network/build-images.sh SOURCE_ROOT GENESIS_GENERATOR_SOURCE
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151914 KURTOSIS_ENCLAVE=quantapool-native-proof-local bash prototype/network/start.sh
python3 prototype/network/verify-network.py quantapool-native-proof-local --output findings/native-qrl-prototype/network.json
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151914 python3 prototype/network/prepare-fixture-exit.py
```

The starter first launches a harmless TCP bind probe. It stops before generating funded fixtures unless every published service port binds to loopback. It then verifies the running client image identities, chain ID, active beacon parameters and advancing execution blocks. A failed startup stops only the newly created prototype enclave. Existing enclave records are preserved; use a new name after a stopped run.

`network.json` contains the dynamically assigned loopback `rpcUrl`, `beaconUrl`, execution genesis hash, beacon genesis validator root, effective beacon configuration and service identities. A client may select `QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0` with `QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151914` through the existing guarded deployer loader. Keep selectors command-scoped and use this manifest's RPC URL.

The exit preparation command copies only this validated enclave's disposable fixture wallet to an ignored directory and invokes the upstream validator CLI with `--exit-json-output-dir`. It signs genesis validator index 63 and performs no broadcast. The independent relay consumes only `public-exit/validator-exit-63.json`; it does not need wallet files. API acceptance, block inclusion and finality are separate observations. This genesis fixture cannot establish when a newly deposited validator's canonical index becomes available.

RPC responses and the locally supplied genesis root are test-environment inputs. This infrastructure harness does not implement a contract finality verifier or turn RPC data into authenticated on-chain accounting.

## Observed local execution

The 2026-09-14 run built all five binaries and four images, started the supported configuration, passed source/image/bind/chain checks, observed advancing execution blocks and beacon finalization of epoch 2, and exported the public exit for genesis validator 63 while head slot 17 was in epoch 2. Its signed message names epoch 0. The upstream CLI selected that message epoch; eligibility remains the protocol's separate 16-epoch active-tenure check. The export command checked the actual JSON file because the upstream CLI can log a write failure while returning success.

The local loopback URLs and exact genesis roots are in the ignored runtime manifest. They are deliberately absent from deployment defaults. Subsequent relay acceptance, inclusion and finalized validator state are recorded by the separate protocol prototype.
