# Independent public exit: local protocol result

On 2026-09-14, an independent relay process submitted a previously signed exit for disposable genesis validator 63 to the fresh loopback-only prototype network. The relay read the public JSON file and performed no signing. Unmodified Qrysm accepted and included the message, and its finalized state subsequently recorded the scheduled exit.

| Observation | Actual result |
|---|---|
| Source pins | Qrysm `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3`; go-qrl `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9` |
| Local chain configuration | Chain ID 3151914; 6-second slots; 8 slots per epoch; 16 active epochs before exit; 16-epoch withdrawal delay |
| Public message prepared | Validator 63, activation epoch 0, signed exit epoch 0; observed head slot 17, epoch 2. The upstream CLI exported JSON without broadcasting. |
| Premature submission | HTTP 400 at epoch 4: validator had been active for 4 of the required 16 epochs. |
| Signature/domain check | Real ML-DSA verification passed against the canonical validator public key, explicit genesis root and current fork `0x10000038`. |
| Eligible submission | HTTP 200 at 13:10:59 UTC, after observing head slot 130, epoch 16. The same public message was submitted. |
| Block inclusion | Block slot 131 contains the exact original message and signature. |
| Finalized state observation | At 13:13:42 UTC, finalized slot 136, epoch 17, records `active_exiting`, `exitEpoch=21`, `withdrawableEpoch=37`. |

Public message file SHA-256: `811970dc6d97df7ddf4d0be2084c4b07a9ce03d77fd4f62d9206fe00fedc2235`.

Genesis validators root: `0xa2343fe2ab8aeb68ec846c05423bbebf74664289676af7bb026e9dd68e8bff80`.

Exit signing domain: `0x04000000a68b370bfaf107f43b8a84de552415e494187ade51e248d9c7b76615`.

Finalized slot 136 state root: `0x5c10c0074ecbc0c28fc043b9ffb771d77525a8ee28120af21c5ba9fad70880f0`.

## Reproduction and artifacts

From `prototype/protocol`, with the disposable network's literal loopback origin, explicit genesis root and public exit file:

```sh
GOWORK=off GOMAXPROCS=2 go run -tags=develop ./cmd/relay-exit -beacon "$LOCAL_BEACON_ORIGIN" -genesis-root "$LOCAL_GENESIS_VALIDATORS_ROOT" -exit-file "$PUBLIC_EXIT_JSON" -verify-only
GOWORK=off GOMAXPROCS=2 go run -mod=readonly -tags=develop ./cmd/relay-exit -beacon "$LOCAL_BEACON_ORIGIN" -genesis-root "$LOCAL_GENESIS_VALIDATORS_ROOT" -genesis-time "$LOCAL_GENESIS_TIME" -deposit-chain-id "$LOCAL_CHAIN_ID" -exit-file "$PUBLIC_EXIT_JSON" -submit-local-exit
python3 scripts/observe-exit.py --network "$LOCAL_NETWORK_JSON" --exit-file "$PUBLIC_EXIT_JSON" --stage finalized-exit-scheduling --scan-from 131 --scan-to 131 --output "$LOCAL_EXIT_OBSERVATION_JSON"
```

The observer reads QRL's `/qrl/v1/beacon/blocks/{slot}` endpoint, compares the included message, and checks fixed-slot state roots against the observed head/finalized headers. It rejects another chain ID or a non-loopback origin. A fresh reproduction must use its own genesis root and observed inclusion slot. Resubmitting this already scheduled exit is expected to fail.

Ignored local artifacts under `findings/native-qrl-prototype/`: `prepare-exit-result.json`, `public-exit/validator-exit-63.json`, `live-exit-premature.json`, `live-exit-signature-verification.json`, `live-exit-accepted.json`, `live-exit-inclusion.json`, and `live-exit-finalized.json`.

## Scope of the demonstrated guarantee

No fresh operator signature or authorization was needed for relay, inclusion or finalized exit scheduling. The local validator services continued normal consensus operation. This result does not establish network availability after every validator disappears.

This live case uses an existing disposable genesis validator with a zero withdrawal recipient. It demonstrates exit authorization and scheduling. Full withdrawal and credit into a pool contract were not exercised. The separate synthetic-state protocol tests demonstrate the 2,000 QRL bootstrap, canonical index availability and presigning before a 38,000 QRL top-up.

The finalized-state readback is a local node observation. QuantaPool still needs a contract-verifiable finality anchor for authenticated economic accounting. Durable availability of a public exit, future fork compatibility and the ability of any message holder to force an eligible exit remain separate design requirements.
