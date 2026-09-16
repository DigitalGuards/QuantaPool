# Independent public exit: funded validator result

On 2026-09-14, an independent process verified and relayed the public exit for newly registered validator 64 on the isolated loopback chain 3151915. The relay had no signing key. This exercised the unchanged Qrysm protocol after a real 40,000 QRL deposit into the canonical deposit contract through `NativeReturnProbe`.

| Observation | Actual result (UTC) |
|---|---|
| Source pins | Qrysm `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3`; go-qrl `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9` |
| Local configuration | Chain 3151915; genesis time 1789394127; 3-second slots; 8 slots per epoch; 16 active epochs before exit; 16-epoch withdrawal delay |
| Pooled-funding fixture | 40,000 QRL funded at execution block 132, 14:02:03; canonical beacon deposit inclusion at slot 1280 |
| Public exit availability | Exported at 14:59:50.279532, observed head 1287; canonical index 64; signed epoch 0; activation epoch was still far future |
| Canonical activation | Epoch 167; earliest eligible voluntary exit epoch 183, 15:08:39 |
| Premature relay | HTTP 400 at 15:02:30.564, head 1341: active for 0 of 16 required epochs; server identified eligibility epoch 183 |
| Independent signature check | Native ML-DSA verification passed against the canonical public key and actual fork/genesis domain |
| Eligible relay | Same public message accepted with HTTP 200 at 15:09:30.354, after observing head 1481, epoch 185 |
| Inclusion | Exact message and signature included at slot 1482 |
| Finalized scheduling | At 15:11:06.556737, finalized slot 1496 records exit epoch 190 and withdrawable epoch 206 |

Public message SHA-256: `e4d5abdb4c2c4d7210b4f1fd75d90382a655c1af706155c28f506af69ba4b865`.

Canonical public-key SHA-256: `ded1283f362ff9a68ee09d2dcae3ca5408f1fcf558df2aba40e08a3947870cf6`.

Native exit domain: `0x04000000a68b370bfaf107f43b8a84de552415e494187ade51e248d9c7b76615`.

Finalized slot 1496 state root: `0x3373ac382b8bd9105097b72c5d989ede0aca46f64b31dce75155726ceca16879`.

## Scope and reproduction

The signer exported the message without broadcasting. The relay checked the exact literal loopback origin, canonical key, genesis validators root, genesis time, fork and `DEPOSIT_CHAIN_ID`. Its submission interface requires the time and chain-ID pins. These operational guards distinguish the two local fixtures. Native signing domains omit execution chain ID and genesis time, so fixtures sharing the same genesis validators root and fork version share the native exit domain.

From `prototype/protocol`, supply the selected disposable fixture's public inputs:

```sh
GOWORK=off GOMAXPROCS=2 go run -mod=readonly -tags=develop ./cmd/relay-exit -beacon "$LOCAL_BEACON_ORIGIN" -genesis-root "$LOCAL_GENESIS_VALIDATORS_ROOT" -genesis-time "$LOCAL_GENESIS_TIME" -deposit-chain-id "$LOCAL_CHAIN_ID" -exit-file "$PUBLIC_EXIT_JSON" -verify-only
GOWORK=off GOMAXPROCS=2 go run -mod=readonly -tags=develop ./cmd/relay-exit -beacon "$LOCAL_BEACON_ORIGIN" -genesis-root "$LOCAL_GENESIS_VALIDATORS_ROOT" -genesis-time "$LOCAL_GENESIS_TIME" -deposit-chain-id "$LOCAL_CHAIN_ID" -exit-file "$PUBLIC_EXIT_JSON" -submit-local-exit
python3 scripts/observe-exit.py --network "$LOCAL_NETWORK_JSON" --exit-file "$PUBLIC_EXIT_JSON" --expected-index 64 --expected-public-key-sha256 "$PUBLIC_KEY_SHA256" --stage finalized-exit-observation --output "$LOCAL_EXIT_OBSERVATION_JSON"
```

The actual observed inclusion slot and validator identity must be used for a fresh reproduction. This already scheduled exit cannot be successfully submitted again.

Ignored artifacts under `findings/native-qrl-prototype/lifecycle/` retain the public signer metadata, signature verification, premature rejection, successful submission, inclusion and finalized scheduling: `prepare-exit-result.json`, `exit-signature-verification.json`, `exit-availability-and-premature.json`, `exit-before-eligibility.json`, `exit-accepted.json`, `exit-inclusion.json`, `exit-finalized.json` and `public-exit/validator-exit-64.json`.

Public exit availability was demonstrated after full funding and canonical registration. This lifecycle does not establish safe admission before pooled funding. The relay required no new operator signature, while continued chain operation and durable public-message availability remain liveness assumptions. Public availability also permits any holder to force the eligible exit. Future fork compatibility remains a separate requirement.

The finalized scheduling readback here is a local RPC observation. The separately recorded finality/validator-proof execution and native cash-return lifecycle determine the stronger contract and asset-flow evidence. Withdrawability starts at slot 1648; this document alone makes no claim that principal has already returned.
