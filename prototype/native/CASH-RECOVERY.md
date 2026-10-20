# Native cash recovery execution

[CashRecoveryPool.hyp](../contracts/CashRecoveryPool.hyp) is an isolated candidate for the expired-verifier portion of a native-QRL pool. It holds all fixture deposits as cash. It implements neither normal staking rewards nor validator funding, normal-state withdrawals or reserved senior claims. It must not receive public user deposits.

The immutable verifier must report Live for entry. Actual expiry is visible before any keeper calls `expire()`. Any caller can then start irreversible recovery. All existing nontransferable share balances freeze by disabling entry and recording the existing total, without iterating over holders. Neither the verifier nor any administrator can replace beneficiaries or shares.

The experiment recognizes native withdrawals even though they do not invoke contract code:

```text
cumulativeRecovered = actualContractBalance + totalAlreadyPaid
cumulativeEntitlement(user) = floor(cumulativeRecovered * userShares / frozenTotalShares)
claimable(user) = cumulativeEntitlement(user) - alreadyPaid(user)
```

Claims synchronize cash first and pay only the caller. Hyperion's native `uint512` intermediate preserves the full product of two `uint256` inputs before division. Every action has constant accounting cost. Actual claims can include recipient execution costs; a reverting recipient affects its own transaction only. Rounding residue stays below one base unit per nonzero holder, and later receipts preserve each fractional right. There is no last-claimant sweep or expiry of recovery rights. Stray cash in a pool with no holders stays unallocated.

The contract earns zero fees. It cannot send arbitrary amounts, redirect a claim or increase operator entitlement. There is no fee or rescue function. Normal-state custody and staking guarantees cannot be inferred from this deliberately limited recovery experiment.

## Executed results

The actual pinned go-qrl QRVM passed 335 steps, including getters and 28 expected reverts. A genuine captured certificate with 86 verified committee positions first renews the recoverable verifier. Test time then advances beyond its deadline and an independent caller starts recovery. Nine credit operations execute go-qrl's native withdrawal-credit routine with explicitly synthetic withdrawal tuples. No new network transactions or validators are created by these tests.

Coverage includes Live/CatchingUp/Expired entry checks, irreversible recovery, immutable payment identity, repeated claims, late credits after earlier full payout, complete single-holder drain, multi-holder dust, zero-holder cash, checked aggregate overflow, 401-bit intermediate multiplication, failed receiver rollback and all four guarded entry points during a callback. Typical successful claims in this fixture use approximately 71,505 to 108,505 gas before refunds; starting a funded recovery uses 82,614 gas. These measurements include intrinsic gas and exclude actual signed-transaction fees.

The companion [wind-down-model.js](wind-down-model.js) addresses the reserves absent from the VM experiment. It preserves pending-deposit refunds, existing cash-backed principal/reward claims and already-earned cash-backed fees. Active and unfunded queued shares bear residual losses and receive later returns together. Ten tests cover 26,730 exhaustive small receipt/claim histories and 50,000 deterministic actions over 500 snapshots. Model construction and auditing iterate over fixtures; production cutover must reuse existing on-chain mappings and totals, with no snapshot reporter or import authority.

## Reproduce

Run from QuantaPool with the exact source revisions in [source-lock.json](../source-lock.json). Set `QRL_PROTOTYPE_SOURCE_ROOT` to the pinned source directory. Compile the recoverable verifier first using [its commands](../recovery/README.md#reproduce).

```sh
"$QRL_PROTOTYPE_SOURCE_ROOT/hyperion/build/hypc/hypc" --abi --bin --bin-runtime --optimize --optimize-runs=1 --via-ir --output-dir build/prototype --overwrite prototype/contracts/CashRecoveryPool.hyp
GOWORK=off GOMAXPROCS=2 go -C prototype/execution build -mod=readonly -p=2 -o ../../build/prototype-execution .
node prototype/native/make-recovery-plan.js
build/prototype-execution -plan build/prototype/cash-recovery-plan.json -report build/prototype/cash-recovery-execution.json
node --test prototype/native/wind-down-model.test.js
```

The plan and metadata retain input hashes and the test policy. Its callback companion compiles to a separate test artifact and has no authority in the pool contract. See [candidate decisions](DECISIONS.md) for integration requirements and the limitations of indefinite recovery after operator disappearance.
