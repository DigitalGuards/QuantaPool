# Capture actual QRL finality inputs

This bounded, read-only tooling captures real headers, SSZ beacon states and sync-committee signatures from the identified loopback prototype chains. It decodes and verifies them with unmodified Qrysm `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3`, and checks compatibility with the scoped consumer's slot and committee policy. Contract acceptance is a separate step. The capture sends no transaction or validator operation.

## Executed capture

| Input | Attested slot | Signature slot | Finalized slot | Signature period |
|---|---:|---:|---:|---:|
| Initial trusted-header candidate | 80 | N/A | Explicit bootstrap assumption | 1 |
| Update A | 112 | 113 | 96 | 1 |
| Update B | 144 | 145 | 128 | 2 |
| Update C | 208 | 209 | 192 | 3 |
| Update D | 288 | 289 | 272 | 4 |

The actual local chain has 8 slots per epoch and 8 epochs per sync-committee period. All 512 captured ML-DSA-87 signatures passed unmodified `altair.VerifySyncCommitteeSigs`. Each aggregate has 128 participating positions and 128 signatures. A, B and C have 64 unique signatures; D has 63. Signature bytes total 592,256 per aggregate. Each committee contains 331,776 raw public-key bytes. Periods 1, 2 and 3 have the same 64 unique keys with two positions per key; their ordered vectors and committed roots change.

The bootstrap current committee authenticates A's signer vector. The next committee proved from finalized state 96 authenticates B's signer vector. The next committee proved from finalized state 128 authenticates C's signer vector. The next committee proved from finalized state 192 authenticates D's signer vector. These relationships were verified by exact root equality, including native committee and finality Merkle proofs.

D demonstrates an actual membership change: exited validator 63 is removed from period 4's committee. Its public-key SHA-256 is `801d9441026f926f0b588127e4f2082d248c9a2ebd6e6961454218a90e8e1dfa`, matching the earlier live exit observation. No new public key appears. The 128 positions now comprise 61 keys with two positions each and two keys with three positions each. This is distinct from the earlier ordered-vector changes.

## Commands

From QuantaPool:

```sh
python3 prototype/finality/capture/capture.py --network findings/native-qrl-prototype/network.json --output-dir findings/native-qrl-finality/capture
cd prototype/protocol
GOWORK=off GOMAXPROCS=2 go run -mod=readonly -tags=develop ../finality/capture/analyze.go -capture-dir ../../findings/native-qrl-finality/capture -output ../../findings/native-qrl-finality/capture/witness.json
```

The analyzer reuses the existing pinned protocol module without modifying `go.mod` or `go.sum`. `-mod=readonly` enforces that boundary. Raw SSZ, JSON, the hash manifest and the exported witness remain in ignored findings storage. The capture checks the exact expected genesis root, identified local chain ID 3151914 or 3151915, literal loopback origin and unchanged network configuration. It disables redirects and proxies and bounds each response to 16 MiB.

Explicit `--bootstrap-slot` and `--attested-slots` arguments support one to four increasing updates. A different bootstrap or update sequence requires a separate output directory; an existing sequence can be extended by appending updates. Historical defaults require the selected signature blocks to be finalized in the node's view. `--allow-unfinalized-updates` permits available signed blocks after a node-observed finalized bootstrap, matching the fresh-update use case. The actual finalized checkpoint proof and native signature checks remain mandatory.

The fresh capture used bootstrap 848, attested 880/signature 881/finalized 864, then attested 912/signature 913/finalized 896. All 256 signatures verified. The next committee proven under finalized state 864 authenticates the period-14 signer vector. Its order changes while the unique membership stays at 63 keys. Separate `witness-first.json` and `witness-second.json` files preserve each input consumed by the live runner.

The analyzer's optional `-validator-index INDEX` appends `finalizedValidatorWitnesses` for exactly that canonical index under each selected finalized state. Each checkpoint contains its slot, native state root, five-node slot branch and one validator witness. The witness includes the complete canonical fields, public-key SSZ root, 46-node validator branch, balance chunk and 44-node balance branch. List lengths, branch roots and the native/header state root are checked before export. This permits a consumer to authenticate a terminal zero balance against its accepted finalized state. The capture itself supplies no initial trust, and witnesses from different genesis roots require separate matching verifiers.

## Actual source primitives

- `/qrl/v1/debug/beacon/states/{slot}` with `Accept: application/octet-stream` supplies native SSZ state bytes.
- `/qrl/v1/beacon/headers/{slot}` and `/qrl/v1/beacon/blocks/{slot}` supply the header and actual sync aggregate.
- `/qrl/v1/beacon/states/{slot}/finality_checkpoints` identifies the captured finalized header; the analyzer crosschecks it against the decoded state and its proof.
- Native `CurrentSyncCommitteeProof`, `NextSyncCommitteeProof` and `FinalizedRootProof` produce five-, five- and six-node branches at generalized indexes 54, 55 and 105.
- Each exported committee position also has a seven-node branch authenticating its public-key SSZ root against the committee vector.
- The sync signature targets the previous-slot block root. Its domain uses the previous slot's epoch and the state's fork/genesis. The committee is selected from the signature-slot state. These are the pinned Qrysm verifier's actual inputs.

## State hash diagnostic

For the real captured states, consensus-native `HashTreeRoot` exactly matches the block header's state root. The generated protobuf `BeaconStateZond.HashTreeRoot` produces a different root. The analyzer isolates the difference to generated participation fields 15 and 16: their `PutBytes` followed by `MerkleizeWithMixin` differs from the native packed participation-byte root. Replacing only these two native field roots with the generated calculation reconstructs the complete differing protobuf root.

This is recorded for every state in `stateRootDiagnostics`. Every exported proof is verified against the actual consensus-native/header root. No upstream source, network configuration or state was changed to make a root match. Synthetic empty-participation fixtures from the earlier phase did not expose this generated-helper difference.

## Trust and implementation boundaries

RPC capture alone provides no contract-verifiable trust anchor. A consumer must explicitly establish its initial trusted bootstrap header, authenticate the committee branches under that header, verify signatures against those authenticated committees and enforce its update/finality/period policy. Agreement among RPC nodes supplies none of these checks.

The two local fixtures share their initial validator-root and fork-version values. Native exit and sync domains therefore coincide: execution chain ID and genesis time are absent from `ComputeDomain`. The tooling distinguishes the intended fixture through exact endpoint, full configuration and complete beacon-genesis checks, including genesis time. Those checks are operational safeguards. The actual finality verifier must start from the intended chain's reviewed trusted header and parameters. A matching validator root alone does not identify which disposable fixture supplied an observation.

The witness contains redundant full committee vectors and proofs for transparent testing. Its JSON size exceeds the actual cryptographic payload because full vectors and hexadecimal strings are repeated. This is not a proposed production message format. VM gas, transaction sizing, batching, quorum policy, replay protection, future fork handling, stale bootstrap recovery and economic accounting gates belong to the consuming prototype or a subsequent light-client project. Successful native signature checks alone do not qualify those properties.
