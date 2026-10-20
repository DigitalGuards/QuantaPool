# Candidate change and validation record

This record describes the isolated prototype implementation phase. The earlier testnet contracts, their storage, the prior live experiments, upstream implementations, historical state and remote deployments were preserved during those tests. No contracts were removed and no migration ran. On 2026-09-15 the project owner clarified that the old testnet contracts may be abandoned; [clean native deployment](../../docs/TESTNET-RETIREMENT.md) now explicitly requires no legacy migration or compatibility. The results below retain their original provenance.

## Files

| Files | Change |
|---|---|
| `prototype/contracts/RecoverableFinalityVerifier.hyp` | New bounded recovery verifier; keeps the original feasibility verifier intact |
| `prototype/contracts/FinalizedPoolCashProbe.hyp` | New matched SSZ/account-trie consumer, bounded RLP library and separate pure test harness |
| `prototype/contracts/CashRecoveryPool.hyp` | New isolated cash recovery contract and separate callback test artifact |
| `prototype/recovery/make-plan.js`, `prototype/recovery/README.md` | Genuine-certificate recovery tests, policies and reproduction |
| `prototype/native/capture-checkpoint.py`, `verify-checkpoint.go` | Read-only local matched proof capture and independent native verification |
| `prototype/native/make-checkpoint-plan.js`, `verify-trie-fixtures.go` | Actual QRVM consumer tests and independent native construction of synthetic parser fixtures |
| `prototype/native/make-recovery-plan.js` | Actual QRVM expiry, native cash and callback tests |
| `prototype/native/wind-down-model.js`, `wind-down-model.test.js` | Reserve-aware arithmetic reference, exhaustive and seeded tests |
| `prototype/native/DECISIONS.md`, `CASH-RECOVERY.md`, `CHECKPOINT-DESIGN.md`, `UPSTREAM-REFRESH.md`, `VALIDATION.md` | Selected defaults, trust limits, measured evidence and review record |
| `prototype/README.md` | Links and current phase status |

Generated plans, bytecode, witnesses and reports remain in ignored build/findings directories. The supplied regulatory report was read for its technical control checklist; this work does not change its legal conclusions.

## New storage and invariants

The new verifier has immutable bootstrap/domain/timing configuration; mutable committee and verified-checkpoint progress; a trust anchor and optional permanent-expiry latch; and positional proposal/key-cache mappings. Every begin, signature submission and finalization checks the prior trust deadline. Only fresh finalized progress can renew it. Expiry is observable without a keeper transaction and cannot be reversed.

The cash observer has immutable verifier/account references and stores only the last authenticated slot, execution block, consumed-deposit cursor and cash balance. Roots and balances have no administrator setter. Slot advances strictly; execution block and deposit cursor cannot regress. Account inclusion authenticates all 64 address bytes. An absent account is rejected. A genuine zero-balance existing account succeeds.

The recovery experiment has one immutable verifier, fixed membership after cutover, cumulative native receipts/payments, per-user nontransferable shares and paid debt, and a reentrancy guard. It has no proxy storage or upgrade route. Its invariants are:

- Total paid plus actual remaining cash equals cumulative recognized native cash after synchronization.
- Each user receives at most the floor of its fixed fraction of cumulative cash.
- Every earlier claim preserves entitlement to later receipts.
- Sum of fixed entitlements never exceeds cumulative cash; residual rounding stays below one base unit per nonzero holder.
- No caller changes a beneficiary, creates a new recovery fee or sweeps residue.
- In the separate reserve model, actual cash covers remaining pending refunds, cash-backed claims, earned fee reserves and unpaid residual entitlements.

Normal deposits, rewards, slashing, funding and withdrawal queues still need one integrated ledger. Neither the observer nor the reserve reference grants a trusted reporter authority to import production balances.

## Executed gates

| Gate | Passed | Boundary |
|---|---:|---|
| Recovery verifier | 224 VM steps, 60 expected reverts | Real captured native signatures; simulated execution clock |
| Matched checkpoint consumer | 117 VM steps, 50 expected reverts | Real paired certificate and zero/positive account proofs; synthetic parser cases separately labelled |
| Cash recovery | 335 VM steps, 28 expected reverts | Real certificate; synthetic balances/time and 9 native withdrawal-credit tuples |
| Native trie cross-check | 14 fixtures | Each synthetic root independently rebuilt by unmodified go-qrl |
| Reserve-aware arithmetic | 10 tests | 26,730 exhaustive histories; 50,000 actions across 500 seeded snapshots |
| Latest Qrysm loader qualification | 48 top-level tests, 643 subtests | New upstream loader fix; both existing local configurations validated |

All 676 new QRVM steps pass. Expected failures require real contract reversion; an out-of-gas result does not satisfy a rejection test. Compiler warnings identify the pinned Hyperion compiler as a development build. No production toolchain qualification is inferred.

The largest successful recovery signature batch uses 100,036 calldata bytes and 6,304,280 gas before refunds. Matched cash observations use 3,908 bytes/367,891 gas for the drained pool and 3,716 bytes/327,135 gas for the positive fixture. Recovery cutover uses 82,614 gas on a funded fixture. These are VM measurements including intrinsic gas. The previously mined full-certificate measurements and realistic cadence estimates remain in [the finality cost report](../finality/README.md); this phase does not remeasure a larger validator network.

The prior actual withdrawal lifecycle remains recorded separately: 40,000 QRL principal returned, 40.339819966 QRL consensus surplus, 36.3058379694 QRL user rewards, 4.0339819966 QRL operator fee, zero ending probe cash. Those mined receipts are preserved, and are not relabelled as a new recovery lifecycle.

## Reproduce

Use [source-lock.json](../source-lock.json), Go 1.26.5 and the recorded Hyperion development compiler. Set `QRL_PROTOTYPE_SOURCE_ROOT` to the pristine source directory. Node used for this phase was 22.22.3. Captured public witnesses must already exist at the documented default paths, or be recaptured through the guarded helpers. Old pruned account proofs cannot be recovered from a non-archive node by these commands.

```sh
"$QRL_PROTOTYPE_SOURCE_ROOT/hyperion/build/hypc/hypc" --abi --bin --bin-runtime --optimize --optimize-runs=1 --via-ir --base-path=prototype/contracts --output-dir build/prototype --overwrite prototype/contracts/RecoverableFinalityVerifier.hyp prototype/contracts/FinalizedPoolCashProbe.hyp prototype/contracts/CashRecoveryPool.hyp
GOWORK=off GOMAXPROCS=2 go -C prototype/execution build -mod=readonly -p=2 -o ../../build/prototype-execution .
node prototype/recovery/make-plan.js
build/prototype-execution -plan build/prototype/recovery-plan.json -report build/prototype/recovery-execution.json
node prototype/native/make-checkpoint-plan.js
build/prototype-execution -plan build/prototype/checkpoint-plan.json -report build/prototype/checkpoint-execution.json
node prototype/native/make-recovery-plan.js
build/prototype-execution -plan build/prototype/cash-recovery-plan.json -report build/prototype/cash-recovery-execution.json
node --test prototype/native/wind-down-model.test.js
```

Separate [native trie cross-check commands](CHECKPOINT-DESIGN.md#executed-evidence-and-reproduction) and [latest upstream qualification commands](UPSTREAM-REFRESH.md#reproduction-and-provenance) retain their own scopes and source pins. Syntax, Go formatting, whitespace and prohibited-punctuation checks pass on the added files. Existing testnet and frozen experiment contract hashes matched their pre-phase values at validation. This is a historical preservation check, not a native storage-compatibility requirement.

The full native pool remains behind the [documented accounting and security gates](DECISIONS.md). Economic checkpoint authenticity still assumes the trusted initial anchor and adequate sampled-committee honesty. This record is executable engineering evidence without a claim of launch readiness. The clean deployment requires no token migration.
