# QuantaPool Performance Fee Security Review

Historical review of the retired token model. Its source locations, fee shares and deployment results do not describe the native implementation. See [current architecture](architecture.md) and [native review](../native/REVIEW.md).

Date: 2026-08-28

Audience: QuantaPool internal. This review is separate from the Qrysm and go-qrl audit reports.

Evidence tier: current source review, local executable validation, and deployment/readback on a disposable loopback Q128 enclave. No production deployment was performed.

## Executive result

No confirmed Critical or High vulnerability remains in the reviewed fee path. The review found no permissionless principal extraction, protocol fee overmint, or callback path from fee-share issuance.

The fixed fee is 1,000 basis points, equal to 10% or one tenth of fee-eligible validator rewards. It is collected as dilution-priced stQRL shares after complete cohort settlement, delayed principal reconciliation, whole-epoch gain capping, and prior-loss recovery.

One High liveness defect and one Low EL/CL finality race were fixed during this review. The High defect let a single out-of-scale checkpoint slot lock every user balance permanently; it is described in QP-FEE-005, together with the checkpoint bound and quiescent reseat that also remove the residual revenue-loss case. Three residual boundaries remain: one Medium revenue-undercollection policy issue, one Low cohort-accounting policy issue, and one Informational privileged trust boundary.

## Implemented design

- `contracts/hyperion/DepositPool-v2.hyp:196` fixes the fee at 1,000 basis points.
- `contracts/hyperion/DepositPool-v2.hyp:869-911` separates terminal settlement from delayed fee finalization, restores pending principal first, treats the finalized physical balance as a floor, and keeps unclassified drift fee-exempt.
- `contracts/hyperion/DepositPool-v2.hyp:1234-1331` caps eligible rewards by whole-epoch net gain, recovers prior losses, carries exact rounding residue, verifies the share quote, and records the fee-finalization block.
- `contracts/hyperion/stQRL-v2.hyp:462-521` restricts fee minting to DepositPool and uses post-mint dilution pricing rounded in favor of existing holders.
- `contracts/hyperion/DepositPool-v2.hyp:1173-1215` scales pool-level carry from a fixed close checkpoint only when burns create a new historical supply minimum.
- `contracts/hyperion/DepositPool-v2.hyp:1003-1006` and `contracts/hyperion/DepositPool-v2.hyp:1321` enforce a one-block accounting cooldown after fee finalization.
- `scripts/validator-lifecycle-qip55.js:1535-1829` block-tags every reward-classification read, binds Qrysm finality to canonical EL hashes, and rejects post-finality state drift.

## Open findings

### QP-FEE-001: Terminal and close-window rewards can remain fee-exempt

Severity: Medium

Class: POLICY, revenue undercollection

Attacker model: a permissionless donor can create balance ambiguity, or normal terminal income can arrive in the same close window as returned principal.

Violated objective: all genuine validator rewards should contribute to the 10% fee base exactly once.

Evidence: `contracts/hyperion/DepositPool-v2.hyp:833` closes ordinary reward recognition once delayed finalization is pending. `contracts/hyperion/DepositPool-v2.hyp:1487-1502` restores retired principal and deliberately leaves surplus unclassified. `scripts/validator-lifecycle-qip55.js:2204-2209` sets the standard finalizer's `lateEligibleAmount` to zero because finalized balance and validator state do not distinguish validator income from a direct donation.

Bounded reproduction: if 40,000 units of terminal principal return with 8 units of reward before settlement, settlement credits 40,000 as principal and leaves 8 unclassified. The standard delayed finalizer synchronizes the 8 as fee-exempt, so the protocol collects zero fee on that reward.

Impact: protocol revenue can be lower than the intended 10%. User principal remains protected, and this path does not overmint fee shares.

False-positive analysis: this is an intentional fail-safe under an information-theoretic ambiguity. Charging the unidentified surplus would let a direct donor force holders to pay a fee on a donation.

Required resolution: consume a consensus-authenticated terminal-withdrawal receipt that identifies validator, recipient, amount, and terminal status. The proposed interface is documented in `docs/TERMINAL-WITHDRAWAL-RECEIPTS.md`.

### QP-FEE-002: Replacement capital can inherit pool-level carry

Severity: Low

Class: POLICY, cohort fairness

Attacker model: a depositor enters before old shares leave, keeping aggregate supply at or above the historical minimum while the holder cohort changes.

Violated objective: loss shelter and fee rounding residue should follow the economic cohort that created them.

Evidence: `contracts/hyperion/DepositPool-v2.hyp:1173-1215` recalculates carry only when remaining supply reaches a new historical minimum. `contracts/hyperion/DepositPool-v2.hyp:1220-1227` stores one pool-wide close checkpoint.

Impact: replacement capital can receive part of an older cohort's loss shelter or fee dust. The practical result is conservative fee undercollection or small holder-to-holder accounting redistribution. It does not enable principal extraction or fee overmint.

False-positive analysis: the current behavior is deterministic, path independent for equivalent burns, and resistant to deposit-then-burn carry washing. The residual comes from pool-level attribution rather than rounding instability.

Required resolution: use per-share or per-account equalization if exact cohort attribution is a product requirement.

### QP-FEE-003: Reward evidence remains owner-attested metadata

Severity: Informational

Class: TRUST

Attacker model: compromised or malicious owner credentials.

Trust boundary: `recognizeValidatorRewards` and `finalizeProtocolFeeEpoch` are owner-only. On-chain evidence validation checks nonzero roots, replay protection, and monotonic slots at `contracts/hyperion/DepositPool-v2.hyp:975-995`; the contract does not verify Qrysm consensus proofs itself.

Impact: a compromised owner can affect availability and classify real positive surplus as fee-eligible within the whole-epoch net-gain cap. The cap and physical accounting prevent unsupported principal extraction or unbounded fee minting.

Required resolution: replace owner-attested provenance with a consensus-authenticated receipt or proof before treating reward classification as trustless.

## Resolved finding

### QP-FEE-004: Reward classification used an unbound EL/CL snapshot

Original severity: Low

Class: CWE-367

Original risk: an execution balance was frozen before an older finalized validator snapshot was checked. A terminal return could therefore look like reward temporarily, inflating gross reward statistics and the provisional exchange rate. The whole-epoch net-gain cap prevented fee overmint.

Resolution: `scripts/validator-lifecycle-qip55.js:1535-1664` now reads pool, token, fee, manager aggregate, validator enumeration, validator ID, canonical exit ID, balance, and block hash at one EL block. `scripts/validator-lifecycle-qip55.js:1738-1829` waits for a fresh non-optimistic Qrysm payload at or after that block and verifies its hash against canonical EL. `scripts/validator-lifecycle-qip55.js:2998-3077` rechecks exact current state and leaves later positive inflows unclassified.

Validation: focused tests cover exact block tags, a stale payload, bounded polling with an immutable freeze block, canonical hash mismatch, manager and fee-state drift, and permitted positive post-freeze inflow.

### QP-FEE-005: One out-of-scale checkpoint slot permanently locked every balance

Original severity: High

Class: CWE-670, liveness and permanent fund lock

Original risk: `_consumeRewardEvidence` required a strictly increasing `finalizedCheckpointSlot`, and
`lastRewardCheckpointSlot` had no reset path anywhere in the contract. `finalizeProtocolFeeEpoch` consumed
evidence through the same helper and was the only caller of `_closeProtocolFeeEpoch`, so it was the only way
to clear `feeEpochClosePending`. That flag is the gate inside `_permissionlessSyncAllowed`, which
`deposit`, `claimWithdrawal`, `syncRewards` and `emergencyWithdraw` all require.

The consequence: one successful `recognizeValidatorRewards` call carrying a mis-scaled slot, for example a
block number, a timestamp, or a wei-scale value supplied where a beacon slot was expected, raised
`lastRewardCheckpointSlot` beyond any slot the chain would reach. Every later `finalizeProtocolFeeEpoch`
then reverted with `RewardCheckpointNotMonotonic`, the epoch stayed pending forever, and deposits,
withdrawal claims, reward synchronization and emergency recovery were all permanently closed. No attacker
was needed and no recovery path existed. The operator script checked monotonicity off chain at
`scripts/validator-lifecycle-qip55.js:244` but never bounded the magnitude, so the contract accepted the
value that bricked it.

A second, narrower path reached the same wedge: `getProtocolFeeSharesByPooledQRL` reverts
`InvalidProtocolFeeAssets` once the fee target reaches pooled assets, and `_closeProtocolFeeEpoch` called it
through `getProtocolFeeQuote` without a guard, so an unpriceable fee would have reverted the close rather
than deferring it.

Resolution: `contracts/hyperion/DepositPool-v2.hyp:926-950` adds `forceFinalizeProtocolFeeEpoch`, an
owner-only evidence-free close. It keeps every safety precondition of the ordinary finalizer, namely zero
outstanding principal, the settlement-block delay, principal reconciliation and the physical-total floor,
and it classifies no new rewards. It therefore restores liveness without letting the owner mint a fee that
finalized evidence did not already support: rewards already verified under evidence still crystallize
normally on this path. `contracts/hyperion/DepositPool-v2.hyp:1277-1283` additionally retains an unpriceable
fee as carry instead of reverting the close.

Validation: `contracts/test/hyperion/semantic/ProtocolFeeLivenessRegression.hyp` reproduces the wedge end to
end. It records a slot at wei scale, settles into a pending close, asserts that the evidence-bound finalizer
is now permanently unusable and that deposits are refused, then asserts that the force path closes the epoch,
leaves the poisoned checkpoint untouched, still charges the full one tenth of the verified reward, and
restores deposits on the following block. The suite passes under default and optimized code generation.

Checkpoint hardening: the revenue-loss remainder is also closed.
`contracts/hyperion/DepositPool-v2.hyp:207` sets `MAX_CHECKPOINT_SLOT_ADVANCE` to 1,000,000 slots, and
`contracts/hyperion/DepositPool-v2.hyp:980-992` rejects any checkpoint that jumps further than that from the
previous one. QRL finalizes roughly one slot per minute, so the bound tolerates about 1.9 years of reporting
silence while refusing a value supplied at block, timestamp or wei scale. A zero pointer is treated as
unseeded, so the very first checkpoint still establishes the baseline and cannot be bounded against anything.
`contracts/hyperion/DepositPool-v2.hyp:952-970` covers that one remaining case with `resyncRewardCheckpoint`,
an owner-only reseat that requires a quiescent pool, meaning no open epoch and no pending close, so no
in-flight classification can be affected. Replay protection does not depend on the pointer:
`_usedRewardEvidenceRoots` retires each evidence root permanently and the resync never clears it, so no
consumed root becomes reusable. Because slot provenance is already owner-attested under QP-FEE-003, the
reseat grants no authority the owner did not already hold.

Validation of the hardening: `ProtocolFeeLivenessRegression.hyp` now also reseats the unseeded poison while
quiescent and confirms the retired root stays retired, then funds a fresh validator and asserts that a
checkpoint one slot beyond the bound is refused without moving the pointer, consuming the root or booking a
reward, that a checkpoint inside the bound classifies normally, and that the ordinary evidence-bound
finalizer still closes the resulting epoch and charges the fee.

Residual: the force path and the resync are owner-only and share the QP-FEE-003 trust boundary. Replacing
owner-attested slot provenance with a consensus-authenticated receipt, as QP-FEE-001 proposes, remains the
end state.

## Informational observations

- The loss branch at `contracts/hyperion/DepositPool-v2.hyp:1253-1256` clears `feeRewardRemainder` and
  `feeAssetCarryforward` when an epoch ends below its starting pooled total. Carry is fee value the protocol
  already earned but could not yet mint, so a loss epoch both adds the loss to the shelter and discards that
  earned dust. The direction is conservative and favors holders, and the amounts are sub-share, but the
  asymmetry is a policy choice worth stating rather than an arithmetic requirement.
- `PROTOCOL_FEE_BPS` at `contracts/hyperion/DepositPool-v2.hyp:196` is ABI and display surface only. All fee
  arithmetic uses `PROTOCOL_FEE_DIVISOR`. The two agree because 1,000 basis points is exactly one tenth, and
  `ProtocolFeeSemanticRegression.hyp:141` pins the published rate, but the compiler still cannot tie the two
  constants together. The declaration now carries an explicit note that they must always describe the same
  rate, and that the exact remainder carry requires the rate to stay a unit fraction. Any future rate change
  must move both, and a rate that is not 1/N would require replacing the carry with a `mulDiv` form and a
  fresh rounding proof.
- Independent re-derivation of the dilution price confirms it is exact rather than approximate. For a fee
  target `f`, pooled `A` including the virtual offset and shares `T` including the virtual offset, the minted
  share count `f * T / (A - f)` is worth exactly `f` after the mint, and both `mulDivDown` roundings move the
  residual to existing holders.
- The pool refuses deposits and withdrawal claims for the entire time any validator principal is outstanding,
  by way of `_permissionlessSyncAllowed`. That is a deliberate solvency-first choice and it is what makes the
  `feeEpochStartShares` invariant hold structurally, but it constrains what the product can claim about
  liquidity. Worth confirming the user-facing copy matches.

## Important clean passes

- Fee assets are capped at one tenth of verified rewards and by whole-epoch net gain.
- Prior losses absorb later candidate rewards before any fee accrues.
- Dilution pricing rounds in favor of existing holders and requires the exact previewed share count.
- Principal recovery is reconciled before reward classification.
- Historical-minimum checkpoints prevent split-burn rounding drift and temporary deposit carry washing.
- A one-unit donation cannot freeze delayed finalization because the finalized physical amount is a floor.
- Receipt-block deposit, claim, sync, reserve, and funding races are blocked by the finalization marker.
- Fee minting is restricted to DepositPool and invokes no recipient callback.
- Frontend and monitoring ABIs are checked against current Hyperion artifacts.

## Validation record

- `npm test`: passed. All selected Q128, release-blocker, unexpected-exit, protocol-fee and protocol-fee-liveness semantic suites passed under default and optimized code generation. Tooling passed 149 of 149 tests.
- Independent randomized arithmetic check: 200,000 fee-quote and carry cases passed.
- DepositPoolV2 runtime after the QP-FEE-005 fix, checkpoint hardening and the rate change: 22,772 bytes, leaving 1,804 bytes below the 24,576-byte limit.
- Frontend: 14 of 14 tests passed; lint passed; TypeScript and Vite production build passed.
- Monitoring: JavaScript syntax passed, Prometheus rule YAML parsed, and every inline ABI entry matched the canonical artifacts.
- Disposable Q128 enclave: fingerprinted deployment refused without exact confirmation, deployed all three predicted contracts, waited for configured finality, and verified reciprocal links, Q128 immutables, the published rate, paused launch state, zeroed fee state, bytecode size, and runtime bytes after expected immutable substitution. The enclave, loopback bridges, and temporary config were removed afterward. This run was performed at 1,250 bps and has NOT been repeated since the rate change; it must be re-run before any fee-enabled deployment.
- Text hygiene: `git diff --check` passed and no U+2014 was present in added lines or untracked files.

## Rate change: 1,250 to 1,000 basis points (2026-08-29)

The published fee was lowered from 12.5% to 10% before any fee-enabled deployment. Verified market context at
the time of the change: Lido charges 10% of staking rewards, split 5% to node operators and 5% to the DAO
treasury; Rocket Pool's post-Saturn-I structure takes roughly 14% from liquid stakers, as a 5% base
commission plus a 9% RPL-weighted revenue pool. 10% is the prevailing standard among Ethereum liquid-staking
protocols. Because `PROTOCOL_FEE_BPS` is `constant` with no setter, the rate can only change by redeploying,
so this was decided before launch rather than after.

The change was safe to make cheaply because 10%, like 12.5%, is a unit fraction. The exact remainder carry
depends on the fee being `1/PROTOCOL_FEE_DIVISOR`, and its invariant `N * F + R == sum of eligible rewards`
is generic in `N`. A rate such as 11% or 12% would not have been a drop-in.

What changed: `PROTOCOL_FEE_BPS` 1250 to 1000 and `PROTOCOL_FEE_DIVISOR` 8 to 10, the deployment-time rate
assertion in `scripts/deploy-hyperion.js`, the divisor-dependent constants in the rounding sweep and the
exact fee amounts in the net-gain-cap, late-income and prior-loss-recovery phases, both semantic expectation
traces, and the user-facing copy on the stake, legal and how-it-works pages. The displayed percentage was
already read live from the on-chain constant, so only prose was literal.

The rate-change review found that `scripts/validator-lifecycle-qip55.js` still derived finalization
expectations from a local divisor of 8. A correct 10% finalization transaction would therefore have succeeded
on chain and then failed the tool's post-transaction verification. The local divisor was removed. The tool
now reads `PROTOCOL_FEE_BPS` in the same block-tagged fee snapshot, derives and validates its exact
unit-fraction divisor, binds the rate through finalization, and rejects a missing or unsupported rate. Its
fixtures now verify the 10% fee target, dilution-priced shares, realized fee assets, and carry state. Focused
validation passed 78 of 78 tests, and the complete tooling gate passed 149 of 149 tests.

Re-validation of the arithmetic: an independent randomized check re-derived the carry invariant at N=10 over
600,000 multi-epoch cases plus an exhaustive residue sweep, confirming cumulative fee is exactly
`floor(total / 10)`, the remainder never leaves range, and the protocol never overcharges. The 1..8 planck
rounding sweep still triggers three carry rollovers at the new divisor, ending at remainder 6 planck and fee
3 planck.

## Release status

The source implementation and local validation are ready for project review. Production enablement still requires an explicit QIP-55 fee-recipient decision, pinned reviewed commits and compiler identity, acceptance or resolution of QP-FEE-001 and QP-FEE-002, and a fresh production deployment review. No commit, push, pull request, or production deployment was performed during this review.
