# Matched native-QRL accounting checkpoint

Status: source-grounded candidate design, native proof helpers, and an executed QRVM checkpoint consumer. The consumer authenticates account observations and accepts no funds. A complete pooled ledger remains a separate implementation requirement.

## Recommended proof boundary

Use one accepted finalized beacon state `F` for both sides of the pool balance sheet. Authenticate its `latest_execution_payload_header.state_root`, then prove the pool's execution account against that root. Authenticate the registered validators' balances and the consumed-deposit cursor against the same beacon state.

| Value | Pinned SSZ location | Branch depth |
|---|---|---|
| Latest execution payload header | Beacon state field 24, generalized index 56 | 5 |
| Execution account state root | Payload-header field 2, combined generalized index 898 | 9 |
| Execution block number `E` | Payload-header field 6, combined generalized index 902 | 9 |
| Consumed deposit cursor `I` | Beacon state field 10, generalized index 42 | 5 |
| Validator record and balance | Existing registered-index proofs | 46 and 44 |

These are Qrysm's actual field layouts: [native state field order](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/state/state-native/state_trie.go#L25), [payload-header fields](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/proto/engine/v1/execution_engine.proto#L57). Beacon slot and execution block number are separate authenticated values; their equality in this local fixture must never become a production assumption.

The finality trust anchor remains the reviewed initial header and authenticated committee chain. RPC data supplies witnesses. Agreement between RPC servers supplies no additional contract-verifiable authority. The existing bounded finality verifier's fork, skipped-slot, period and freshness restrictions continue to apply until explicitly extended and tested.

## Actual execution account proof format

The account-trie key is `Keccak256(addressBytes64)`. It uses all 64 raw address bytes; the textual `Q` prefix and address-checksum formatting are excluded. Trie nodes use legacy Keccak-256 and canonical RLP. The leaf account value is the RLP list `[nonce, balance, storageRoot, codeHash]`, with unsigned big-endian integer encoding. The balance is in execution base units. SSZ hashing remains SHA-256. See [address width](https://github.com/cyyber/go-qrl/blob/9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9/common/types.go#L39), [RPC proof generation](https://github.com/cyyber/go-qrl/blob/9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9/internal/qrlapi/api.go#L337), [trie hashing](https://github.com/cyyber/go-qrl/blob/9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9/trie/hasher.go#L37), and [account RLP encoding](https://github.com/cyyber/go-qrl/blob/9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9/core/types/gen_account_rlp.go#L9).

A contract consumer should bind an immutable pool address, require an existing account, verify every node/hash/path, decode exactly four account fields and reject malformed or unsupported integer widths. It must handle branch, extension, leaf and embedded-node references according to the pinned trie format. Bound proof work and reject unused/trailing proof material according to a documented canonical format. Never accept the RPC's separate `balance` field without deriving the same value from the proven RLP leaf. The native helper uses `trie.VerifyProof` with proof nodes indexed by their independently computed Keccak hashes and decodes `types.StateAccount` with native RLP.

## Why withdrawals do not double count

For the payload represented by `F`, Qrysm checks its withdrawal list against the expected list, decreases the corresponding beacon balances, and commits the latest execution payload header. Execution processes transactions, credits that payload's withdrawals, and computes the resulting execution state root. Therefore matched post-state proofs contain the decreased validator balance and the credited pool cash exactly once. See [Qrysm withdrawal processing](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/blocks/withdrawals.go#L46), [payload processing](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/blocks/payload.go#L147), and [execution withdrawal credit before state root](https://github.com/cyyber/go-qrl/blob/9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9/consensus/beacon/consensus.go#L197).

Current `address(this).balance` can include later withdrawals and execution credits. Adding it to historical beacon balances reintroduces double counting. A contract pause cannot stop consensus-layer credits. The matched account proof is the smallest general proof path identified here. A receipts-only alternative would need complete, ordered receipt coverage and its own cash-flow boundary.

## Deposits in flight

The funding gate should read the canonical deposit contract's count immediately before its atomic deposit, verify the expected increment afterwards, and append an immutable record containing global deposit index, amount, key/registered validator and execution block number. Read the count using its actual uint64 little-endian byte format. The native deposit contract emits the old count as the deposit index and then increments it. Qrysm consumes deposits in order and advances `execution_deposit_index` before applying the validator balance change. See [deposit contract](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/contracts/deposit/deposit_contract.hyp#L102) and [native deposit processing](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/blocks/deposit.go#L161).

At checkpoint `F`, a pool-funded deposit is in flight exactly when its funding block is at most `E(F)` and its global index is at least `I(F)`. Deposits with index below `I(F)` are already represented in authenticated validator balances. Future execution deposits are excluded from this historical checkpoint. Store cumulative funding amounts alongside the ordered immutable records so prefix lookup can use bounded binary search or staged ordered processing.

Global deposit indices and validator indices are different namespaces. The live fixture's fresh deposit had global index 0, its canonical validator index is 64, and its post-inclusion consumed-deposit cursor is 1. Record both identities and their binding; never substitute a validator index into the deposit-cursor comparison.

Conceptually, before liabilities:

```text
assets(F) = provenPoolCash(E(F))
          + sum(registeredValidatorBalances(F)) * 10^9
          + poolFundedDepositsInFlight(E(F), I(F))
```

The canonical deposit contract's retained execution balance is excluded. It is locked protocol funding, and counting it alongside the corresponding validator or in-flight entry would duplicate the same economic stake. Pending user-deposit escrow, reserved user claims and earned fee liabilities must be separately reconciled before calculating active-stake backing.

The consumed index alone cannot prove that an invalid fresh-key deposit produced a validator. The admission gate must enforce valid deposit data and the canonical recipient before pooled funding. The demonstrated existing-key top-up has an authenticated canonical validator. Operator-funded bootstrapping also needs an explicit economic booking: operator principal, or an irrevocable fee-exempt contribution. An unexplained 2,000 QRL bootstrap must never become an apparent staking reward.

## Smallest coherent ledger cutoff

Use checkpoint epochs for stake admission and withdrawal pricing. Incoming deposits remain non-transferable pending principal, excluded from the active reward base, until rewards/losses through their admitted cutoff are settled. Withdrawal requests remain subject to the defined stake loss exposure until an authenticated cutoff prices the exit and cash is reserved. This supplies a deterministic economic boundary for deposits immediately around reward/loss settlement.

The historical account balance requires historical flow/liability data at the same execution block. Two viable implementations are an append-only on-chain cumulative flow history indexed by execution block, or storage proofs for the pool's cumulative counters under the already authenticated account storage root. For a minimal candidate, prefer explicit checkpoint-epoch bookkeeping and append-only counters, then use bounded lookup/staging. Do not apply historical rewards to a current stake set containing later admissions. Do not combine a historical cash snapshot with current liabilities without rolling forward every corresponding known user payment/deposit exactly once. Rewards and consensus cash arriving after `F` belong to a later checkpoint.

This remains a ledger design requirement. Freshness bounds limit stale state; they do not themselves solve admission timing, loss allocation, registry completeness, fee high-water accounting or withdrawal-queue fairness.

## Candidate policies

Require a valid epoch-zero public exit for the canonical validator index and current reviewed domain before pooled top-up, and store the complete signed message on chain. Submission is permissionless. This eliminates a new-signature dependency after eligibility under the supported fork and message-availability assumptions. It also allows any holder to force an eligible exit, so planned churn and liquidity calculations must tolerate that behavior. For new keys, use the demonstrated operator-funded bootstrap and wait for authenticated canonical registration before releasing pooled funds. Future fork changes must fail closed until their signature-domain behavior is supported.

Promise deterministic allocation of native consensus staking economics and actually received pool cash. Configure execution tips to the pool and monitor routing, while explicitly stating that the signing-key operator can change that destination under unchanged upstream QRL. Unreceived tips are outside enforceable user claims and cannot be booked as assets or used to create an operator fee entitlement. Received tips or other unsolicited cash must be labelled separately from consensus rewards and handled by a deterministic declared rule. A candidate should never advertise guaranteed receipt of every execution tip.

Keep the operator fee at the intended 10% of eligible positive realized net rewards, with an explicit loss carryforward/high-water rule, deterministic rounding and immutable recipient. Pay only earned fee liabilities backed by available cash. Bootstrap principal, user contributions, principal returns and unreceived tips are outside the fee base. The complete ledger must test these rules; the earlier cash probe only established the narrower principal-first cash-return behavior.

## Executed evidence and reproduction

On unchanged local chain 3151915, the paired capture contains bootstrap 6296 and a real update with attested slot 6328, signature slot 6329 and finalized slot 6312. All 128 native sync signatures verify. Both account witnesses reconstruct that exact finalized beacon state root and the payload's execution state root:

- Drained pool: actual balance 0, four MPT nodes, 1,061 proof bytes.
- Separate positive fixture: canonical deposit contract balance 40,000 QRL, three nodes, 1,021 proof bytes. This account is excluded from pool assets.
- Both: native SSZ proofs at indices 898/902/42, consumed-deposit cursor 1, native account RLP verification, wrong-root rejection and rejection of a truncated 32-byte address key.

Ignored artifacts live under `findings/native-qrl-checkpoint/paired/{finality,pool,positive-account}/`. Each directory contains immutable captured inputs and a `witness.json`. The helpers use the existing pinned `prototype/protocol` module without changing its dependencies:

```sh
python3 prototype/native/capture-checkpoint.py --network "$LOCAL_NETWORK_JSON" --account "$POOL_ADDRESS" --slot "$FINALIZED_SLOT" --output-dir "$FRESH_CAPTURE_DIR"
cd prototype/protocol
GOWORK=off GOMAXPROCS=2 go run -mod=readonly -tags=develop ../native/verify-checkpoint.go -capture-dir "$CAPTURE_DIR" -output "$WITNESS_JSON"
```

The account proofs must be captured promptly with their finality update. A later proof request for the earlier terminal execution block 1664 failed with a missing-trie-node error after pruning. That is a witness-availability limitation. An archive service or promptly persisted public proof cache solves retention; neither service becomes a trusted reporter when the contract verifies the captured proof.

The paired signatures and proofs have also passed the intended contract path. `RecoverableFinalityVerifier` verifies the real certificate, then `FinalizedPoolCashProbe.observe` calls its restricted `economicCheckpoint()` and verifies the paired account proof. The actual go-qrl QRVM gate passed 117 checks, including 50 expected reverts. It covers incomplete 85-position quorum, the valid 86-position quorum, forged SSZ roots/cutoffs, missing/extra/wrong trie nodes, full 64-byte account identity, repeated observations, the 64/65-slot economic-age boundary and the 256/257-slot recovery-expiry boundary.

The same plan contains 14 separately labelled synthetic canonical trie fixtures and 15 malformed-parser inputs. Native Go trie construction independently reproduced every one of the 14 canonical roots, and native proof/RLP verification matched their expected balances. The fixtures cover single leaves, branches, odd/even and nearly full-length extension paths, empty leaf tails, uint64 nonce boundaries and uint256 balance boundaries. They establish parser coverage without claiming these fabricated roots were finalized by the network.

| Successful actual-capture operation | Gas before refunds, including intrinsic gas | Calldata bytes |
|---|---:|---:|
| Pure account proof, zero pool account | 287,630 | 1,924 |
| Pure account proof, positive fixture account | 246,978 | 1,732 |
| Economic checkpoint plus zero pool observation | 367,891 | 3,908 |
| Economic checkpoint plus positive fixture observation | 327,135 | 3,716 |

From the QuantaPool root, after compiling the pinned candidate contracts and execution runner:

```sh
node prototype/native/make-checkpoint-plan.js
build/prototype-execution -plan build/prototype/checkpoint-plan.json -report build/prototype/checkpoint-execution.json
cd prototype/protocol
GOWORK=off GOMAXPROCS=2 go run -mod=readonly -tags=develop ../native/verify-trie-fixtures.go -fixtures ../../build/prototype/checkpoint-plan.synthetic.json
```

The plan defaults to the preserved paired captures. Its metadata hashes each input witness; the execution report records per-step gas/calldata and expected reverts. Execution balances and clock remain explicit test fixtures. No new mined checkpoint deployment, full multi-validator ledger, loss allocation, fee accounting or withdrawal queue is established by this gate. No upstream source, existing deployment, legacy balance or signing key was changed by this work.
