# Pinned QRL protocol evidence

This isolated module executes unmodified Qrysm protocol functions against synthetic beacon states. It does not implement a finality verifier or authenticate live RPC accounting. The production pool and token contracts are outside this module.

[The live exit result](LIVE-EXIT-RESULT.md) separately records actual loopback beacon acceptance, block inclusion and finalized exit scheduling for a previously signed public message.

Source pins are public Go module replacements in `go.mod`:

- Qrysm: `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3`, cyyber main snapshot.
- go-qrl: `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9`.
- go-qrllib: `cfa61a5adb6f`, exactly the pinned Qrysm dependency.
- Go: `1.26.5`. No upstream source patch, local replacement path or weakened eligibility constant is required.

Run from this directory:

```sh
GOWORK=off GOMAXPROCS=2 go test -tags=develop -p=2 -count=1 -v ./...
```

## Executed guarantees and boundaries

| Evidence | Execution | Boundary |
|---|---|---|
| Existing validator recipient | `ProcessDeposit`, real ML-DSA signatures and deposit Merkle branches | The canonical first recipient survives a later deposit carrying a different recipient. Funding must authenticate the canonical binding beforehand. |
| Bootstrap sequencing | 2,000 QRL deposit, index lookup, exit signing, 38,000 QRL top-up, registry/effective-balance processing | The canonical index exists while the validator is inactive. Signing can happen before pooled funding; finality of that index remains a separate dependency. |
| Independent presigned exit | Public SSZ encode/decode, `VerifyExitAndSignature`, `ProcessVoluntaryExits` after discarding the signer reference | The same 4,643 public bytes fail before eligibility and succeed at activation plus the unchanged 16-epoch minimum. This is synthetic-state execution. |
| Exit identity and domain | Wrong index, wrong key, wrong genesis domain and future exit epoch checks | Validation rejects these inputs. The REST submission helper needs separate live acceptance and inclusion evidence. |
| Future fork limit | Real domain/signature logic with synthetic first and second fork-state inputs | An original-version presign survives while its version remains the previous fork version; it fails after that version leaves the two-version fork state. Unknown future forks have no permanent presign guarantee. |
| Accounting witnesses | Native and protobuf Qrysm state roots, native field roots, complete validator/balance/slot SSZ branches | Constructor-pinned synthetic checkpoints are the trust anchor. Valid branches alone do not establish live finality, freshness or portfolio completeness. |
| Zero balance and withdrawals | `ExpectedWithdrawals` and `ProcessWithdrawals` | A terminal zero-balance validator produces no withdrawal receipt. A separate positive validator's 1,000 QRL excess is deducted by the real withdrawal function. |

All protocol configuration assertions use 64-byte recipients, 40,000 QRL validator size, 2,000 QRL minimum deposit, 128 slots per epoch and 16 active epochs before voluntary exit. The `develop` build tag enables upstream test configuration helpers. Signatures use the actual ML-DSA-87 implementation and are verified. Synthetic slot progression and finalized checkpoint inputs support focused function tests. They are not live block production or finality votes.

`testdata/checkpoints.json` contains five reproducible public state witnesses: initial balances, a configured loss/reward snapshot, an active zero balance, a terminal zero balance and a real reward-withdrawal result. The first two validator positions belong to the fixture pool. The third belongs to another recipient. The fixed public-key byte arrays in this file supply SSZ-shaped fixtures; they are separate from the actual ephemeral keys used by the signed protocol tests. The configured loss/reward snapshots test proof interpretation and do not claim that a slashing transition was executed.

The validator branches have 46 nodes at generalized index `43 * 2^41 + validatorIndex`. Balance branches have 44 nodes at `44 * 2^39 + floor(validatorIndex / 4)`, with four little-endian uint64 balances per chunk. Slot proofs use generalized index 34. Every exported branch reconstructs both canonical native and protobuf state roots, including the list length mix-in.

After inspecting an intended fixture change, regeneration is explicit:

```sh
QUANTAPOOL_UPDATE_PUBLIC_FIXTURES=1 GOWORK=off GOMAXPROCS=2 go test -tags=develop -p=2 -count=1 -run '^TestCanonicalCheckpointFixtures$' -v .
```

## Public funding vectors

The funding-vector test exports real signed deposits and exits for a pool-bound key and a key already bound to another recipient. Both canonical validator records and the checkpoint are outputs of actual `ProcessDeposit` calls. This test generates fresh ephemeral keys on each run. Only public messages and proofs are exported; fixture output must go to an ignored build directory.

Set `QUANTAPOOL_FIXTURE_POOL_RECIPIENT` to the predicted 64-byte pool address and `QUANTAPOOL_FUNDING_FIXTURE_PATH` to the ignored output path. From this directory, an example command is:

```sh
QUANTAPOOL_FIXTURE_POOL_RECIPIENT="$FIXTURE_POOL_RECIPIENT" QUANTAPOOL_FUNDING_FIXTURE_PATH=../../build/prototype/funding-fixture.json GOWORK=off GOMAXPROCS=2 go test -tags=develop -p=2 -count=1 -run '^TestFundingFixtureWithRealSignatures$' -v .
```

The consumer must explicitly identify the synthetic checkpoint trust anchor. Verifying these signatures and proofs in an execution VM demonstrates contract mechanics relative to that supplied root; it cannot establish live-chain finality by itself.

## Independent loopback relay

`cmd/relay-exit` takes an existing public signed exit file and accepts no signing key. It requires an explicit nonzero genesis validators root, literal loopback HTTP origin and one action flag. Submission also requires explicit genesis-time and deposit-chain-ID pins. It disables proxies and redirects, checks the server's genesis, checks the canonical validator index/public key and verifies the signature using Qrysm's domain function with the returned fork and explicit genesis root. These RPC identity checks are local test observations; they do not supply contract-verifiable finality.

```sh
GOWORK=off GOMAXPROCS=2 go run -tags=develop ./cmd/relay-exit -beacon "$LOCAL_BEACON_ORIGIN" -genesis-root "$LOCAL_GENESIS_VALIDATORS_ROOT" -genesis-time "$LOCAL_GENESIS_TIME" -deposit-chain-id "$LOCAL_DEPOSIT_CHAIN_ID" -exit-file "$PUBLIC_EXIT_JSON" -submit-local-exit
```

Use `-verify-only` in place of `-submit-local-exit` to check the public signature and domain without sending a message. Submission sends exactly one message to `/qrl/v1/beacon/pool/voluntary_exits`; the unmodified beacon evaluates eligibility.

The paired genesis-time and deposit-chain-ID flags identify the intended local fixture operationally. The two disposable networks reuse the initial 64-validator list and fork version, so they share `genesis_validators_root` and the native exit/sync signing domains. Native `ComputeDomain` incorporates the domain type, fork version and genesis validators root. It omits execution chain ID and genesis time. Endpoint, full-config, genesis-time and execution-genesis checks are test-routing safeguards; they create no cryptographic domain separation. Production must use the intended network's native genesis/fork assumptions and a reviewed initial trusted header. No cross-fixture replay experiment was performed.

The read-only exit observer additionally requires an explicit canonical index and independently pinned public-key SHA-256 for the funded lifecycle. It records missing finalized registration as an absence, and compares each observed validator with the state root at that exact block slot. Its inclusion scan requires the full public signed message to match.

HTTP acceptance, block inclusion, finality and subsequent withdrawal are distinct observations. The relay reports acceptance only. Durable public availability of the message, operation of an independent relayer and future fork compatibility remain separate requirements.

A publicly available presigned exit also lets any holder trigger that validator's exit as soon as protocol eligibility permits, even when the pool currently needs no exit. This forced-exit and repeated-replacement cost is a design tradeoff. A pool withdrawal condition cannot restrict an already public standalone signature at the beacon protocol layer.
