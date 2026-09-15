# Qrysm loader refresh qualification

Checked on 2026-09-14 against a separate pristine checkout of cyyber/qrysm `main` at `6b0ef01f0a7dc395afdca827e7abecd5baa4f082`. Its immediate parent is the recorded prototype revision, `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3`. The original source checkouts and running local nodes were preserved.

The [upstream commit](https://github.com/cyyber/qrysm/commit/6b0ef01f0a7dc395afdca827e7abecd5baa4f082) changes only `config/params/loader.go`, `config/params/loader_test.go`, and `beacon-chain/node/config_test.go`. The loader checks the original hexadecimal `GENESIS_FORK_VERSION` length before generic hexadecimal padding. Exactly four bytes are required. Regression cases cover short hexadecimal values, quoted and escaped YAML keys, multiline values, aliases, startup validation, and preserving the active configuration after rejection.

Git object comparisons confirm identical `beacon-chain/core`, `beacon-chain/state`, `proto`, `crypto`, `config/fieldparams`, `config/params/mainnet_config.go`, `go.mod`, and `go.sum` objects between these revisions. Consensus transition logic, SSZ layouts, signature processing, and network constants used by the captures are unchanged. The execution account format remains supplied by the unchanged go-qrl pin.

The independently observed go-qrl `main` head remains `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9`; Hyperion `main` remains `cee9d335984c139c1dc0b0e84ec13290031ea4b1`.

## Actual validation

Go `1.26.5`, `GOWORK=off`, `GOMAXPROCS=2`, `-mod=readonly`, `-p=2`, and `-tags=develop` were used. Both commands ran with `-count=1`.

| Selected suite | Top-level tests passed | Subtests passed | Failed / skipped |
| --- | ---: | ---: | ---: |
| Full `./config/params` package | 47 | 538 | 0 / 0 |
| `./beacon-chain/node`, `TestConfigureChainConfig_RejectsUnsafeOverrides` | 1 | 105 | 0 / 0 |
| Total | 48 | 643 | 0 / 0 |

An initial parameter-test invocation without `develop` stopped at the package's explicit build-tag guard. The corrected invocation above passed. These are the selected upstream Go tests; this refresh did not execute a new live consensus lifecycle.

A local helper loaded both previously captured configuration files through the refreshed `params.UnmarshalConfig` and `BeaconChainConfig.Validate`. It verified the expected deposit chain/network IDs, four-byte fork version, slot duration, epoch size, and committee-period size. The same selected values were returned by the original loader.

| Existing local fixture | Fork version | Seconds / slot | Slots / epoch | Epochs / committee period | Latest loader |
| --- | --- | ---: | ---: | ---: | --- |
| 3151914 | `0x10000038` | 6 | 8 | 8 | Accepted |
| 3151915 | `0x10000038` | 3 | 8 | 8 | Accepted |

All four source checkouts were clean after qualification. No source patches, node restarts, public-network transactions, or legacy-state changes were performed.

## Reproduction and provenance

Run the selected tests from a clean checkout pinned to `6b0ef01f0a7dc395afdca827e7abecd5baa4f082`:

```sh
env GOWORK=off GOMAXPROCS=2 GOTOOLCHAIN=go1.26.5 \
  go test -mod=readonly -p=2 -tags=develop -count=1 -json ./config/params

env GOWORK=off GOMAXPROCS=2 GOTOOLCHAIN=go1.26.5 \
  go test -mod=readonly -p=2 -tags=develop -count=1 -json ./beacon-chain/node \
  -run '^TestConfigureChainConfig_RejectsUnsafeOverrides$'
```

Ignored evidence is under `findings/native-qrl-refresh/`: `report.json`, `source-comparison.json`, test JSONL logs, the read-only `validate-configs.go` helper, and configuration results with input SHA-256 hashes. With `QUANTAPOOL_ROOT` set to the local QuantaPool checkout, run the preserved helper from the refreshed Qrysm checkout:

```sh
env GOWORK=off GOMAXPROCS=2 GOTOOLCHAIN=go1.26.5 \
  go run -mod=readonly -p=2 \
  "$QUANTAPOOL_ROOT/findings/native-qrl-refresh/validate-configs.go" \
  "$QUANTAPOOL_ROOT/findings/native-qrl-finality/capture/config.yml" \
  "$QUANTAPOOL_ROOT/findings/native-qrl-finality/terminal/config.yml"
```

The existing [source lock](../source-lock.json), captured headers, signed messages, and mined transactions retain their actual `9b57ae` execution provenance. This supplementary qualification establishes compatibility with the subsequently observed loader fix. It does not relabel the running nodes or previous captures as executions of `6b0ef01`, establish production readiness, or broaden the verifier's documented trust assumptions.
