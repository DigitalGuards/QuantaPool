# Native pool defensive source review

Review date: 2026-09-15. Scope: the seven contracts under `native/contracts/`, their accounting reference model, and the existing ledger, portfolio, gate and adapter test plans. The initial assessment was a bounded source review. The subsequent M1 constructor fix and synthetic native-VM regression execution are recorded separately below. The reviewer performed no network transactions or live state changes.

The initial review identified the deployment-configuration gap below. Follow-up review identified pool-specific recovery and validator-enrollment defects, now addressed in the source candidate with executed VM regressions. The original funded local graph predates these later runtime changes. The candidate's trusted initial checkpoint, sampled committee certificate, fixed fork, public exit availability, and execution-tip routing constraints remain separate documented product assumptions.

## M1: Canonical deposit address binding, resolved

**Severity:** Medium, configuration-dependent. **Category:** input validation and immutable target binding; OWASP A04:2021 Insecure Design.

**Source:** `native/contracts/NativeValidatorGate.hyp:62`, `native/contracts/NativeValidatorGate.hyp:65`, `native/contracts/NativeValidatorGate.hyp:149`.

The initial gate constructor verified the deposit target's runtime SHA-256 and stored the supplied address. It accepted any address with that exact runtime. Native beacon ingestion follows the network's configured deposit address, so bytecode identity alone did not establish that a payment would be ingested by consensus. The immutable top-up path subsequently paid the stored target.

**Invariant:** Pooled validator funding must reach the address ingested by the pinned native network. Identical runtime at an unrelated address does not establish that property.

**Impact boundary:** This is a deployment misconfiguration or deployment-anchor issue. There is no setter or post-deployment target-changing privilege. The inspected local lifecycle launcher supplies the qualified network manifest's canonical address. This review found no evidence that the current local deployment uses an incorrect target.

**Resolution:** The constructor now requires the pinned canonical address, consisting of 64 `0x42` bytes, and the existing runtime hash. This address is confirmed by pinned Qrysm commit `3b816311ac3e86b7a7af40a062ae290318554f7a`, `config/params/mainnet_config.go:105`. No getter, mutable configuration or runtime feature was added. The local lifecycle continues against its original frozen artifacts and correctly configured deployed graph.

**Executed regression evidence:** The native QRVM ran all three updated component plans: portfolio 75 steps/34 expected reverts, gate 53 steps/13 expected reverts, adapter 75 steps/4 expected reverts. Total: 203 steps and 51 expected reverts. Both gate plans reject the identical runtime at the generated copy address and accept the canonical-address allocation. Existing native bootstrap, top-up, rollback, recipient, exit and economic checks pass. Native runner Go tests also pass, including retention of full 64-byte storage values and rejection of an allocation over an existing account.

**Synthetic allocation boundary:** The original copy deployment remains at its original nonce. The runner executes the real pinned canonical constructor, captures the storage keys used by its native execution, and reads their completed 64-byte values from the native StateDB. An explicitly named `fixture-predeploy` operation installs that runtime, nonce and storage at the canonical address in the disposable in-memory VM. No balances are copied, no network genesis is modified, and no Ethereum storage layout is assumed. Synthetic finality/state fixtures remain synthetic.

**Runtime equivalence:** Isolated compilation used Hyperion `cee9d335984c139c1dc0b0e84ec13290031ea4b1`, binary SHA-256 `11b53f5b2519f381aa46d5704d9e0dde3f0ff2552be07b0cd3aba17741ee612a`. Before/after runtime templates are both 13,226 bytes. Removing only the length-delimited 88-byte Hyperion CBOR metadata and its 2-byte length footer leaves 13,136 identical bytes, SHA-256 `21ed14b297dd2d517156936c45cec23bb2d4cca0ce67db94d87f28f67e3a64b0`. ABI and immutable placeholder positions are identical; creation bytecode changes. This comparison covers compiler-produced runtime templates, with no replacement of the funded graph. Fixed gate source SHA-256: `6f49a7dcc56ed8fa8a2e4d01ea4a92eb073c672e4bd909da1610279ed865c8dd`.

**Reproduction:** `npm run test:proofs` runs the committed updated plans with the pinned compiler and native runner. The isolated review run kept output under ignored `findings/native-canonical-address-review/`, including `runtime-equivalence.json`, `summary.json`, and per-plan reports. Original lifecycle artifact files were checked byte-for-byte unchanged after verification.

## Source-supported properties

| Boundary | Source evidence | Conclusion within the stated assumptions |
| --- | --- | --- |
| User and fee beneficiaries | `NativeLedger.hyp:182`, `NativeLedger.hyp:240`, `NativeLedger.hyp:413`, `NativeLedger.hyp:424` | Requests retain the original caller. User claims pay that caller; earned fee claims pay the immutable recipient. No arbitrary payout recipient is accepted. |
| Reserved cash | `NativeLedger.hyp:375`, `NativeLedger.hyp:433`, `NativeLedger.hyp:442` | New reservations fit available cash after pending principal, existing claims, earned fees and quarantined cash. Payments update state before the external call and verify remaining reserves. |
| Withdrawal pricing | `NativeLedger.hyp:263`, `NativeLedger.hyp:316`, `NativeLedger.hyp:346` | The matched execution cutoff advances strictly, and admissions or withdrawal requests require a cutoff later than their request block. Existing users bear the checkpoint's economic change before new membership is admitted. |
| Matched accounting | `NativeLedger.hyp:265`, `NativeQrlPool.hyp:90`, `NativeValidatorGate.hyp:139` | Historical assets are normalized for subsequent known external contributions and native payouts. Execution-funded but beacon-unconsumed top-ups are counted exactly within the same execution cutoff and deposit cursor. |
| Native principal and fee classification | `NativeQrlPool.hyp:94`, `NativePortfolioVerifier.hyp:236`, `NativePortfolioVerifier.hyp:244`, `NativeLedger.hyp:270`, `NativeLedger.hyp:378` | Registered-validator withdrawals enter the consensus balance delta; registered-key deposits and admission principal are subtracted. Fee basis excludes gifts. Realized taxable gain is bounded by eligible net consensus income and charged with per-user fractional carry. |
| Complete portfolio | `NativePortfolioVerifier.hyp:205`, `NativePortfolioVerifier.hyp:225`, `NativePortfolioVerifier.hyp:257` | Every registered validator is proved in fixed order. Parent-linked occupied headers reach the prior anchor. Full deposit and withdrawal lists bind each interval's flows, with deposit-count reconciliation after the initial snapshot. |
| Validator admission | `NativeValidatorGate.hyp:94`, `NativePortfolioVerifier.hyp:149`, `NativeQrlPool.hyp:70` | The settled root, prepared public key, pool recipient, exact inactive 2,000 QRL state, RANDAO, top-up signature and public exit signature precede atomic adoption and funding. Any later native-deposit failure reverts the transaction. |
| Zero value and final exit | `NativeLedger.hyp:376`, `NativeQrlPool.hyp:108` | Zero-value members retain shares while an owned validator remains nonterminal. The final share cannot leave while authenticated validators or recorded in-flight funding remain outstanding. |
| Irreversible recovery | `NativeLedger.hyp:450`, `NativeLedger.hyp:460` | Expiry freezes existing shares, preserves already reserved cash and refundable pending deposits, and shares later free cash without earning new fees. Repeated claims use cumulative entitlement minus amounts already paid. |
| Proof binding | `NativeSSZ.hyp:89`, `NativeSSZ.hyp:145`, `NativeAccountProof.hyp:16` | Validator and balance proofs agree on list length and index. SSZ proof depth and generalized indices are fixed. Account inclusion hashes all native address bytes and rejects absent accounts, malformed RLP, wrong paths and trailing proof nodes. |

These are source conclusions, not a formal proof of conservation or release approval. In particular, the reference model and contract share an intended design, so agreement between them does not independently establish the economic specification.

## Privilege inventory

| Role or interface | Authority over existing assets |
| --- | --- |
| Initial deployer | Selects immutable component bindings, fee recipient and initial finality/configuration anchor. Deployment verification remains essential. |
| Owner, proxy admin, upgrader, pauser, emergency balance editor | No corresponding role or mutable authority exists in these seven contracts. |
| Validator gate | Can register a proven preparation and invoke the fixed top-up release. It has no arbitrary amount, recipient, balance-edit or rescue interface. |
| Validator signing key | Provides native signing and published exit authorization. Consensus downtime/losses and execution-tip routing remain the documented native-protocol limitations. |
| Immutable validator operator | Alone may create new preparation entries using its own 2,000 QRL. Compromise can harm future validator selection; disappearance prevents new enrollment. It cannot redirect user principal, alter beneficiaries or disable existing claims and published exits. |
| Fee recipient | Receives previously earned fee reserves. It cannot set the fee, change recipients, edit positions or withdraw principal. Anyone may execute the mechanical fee claim. |
| Checkpoint supplier or keeper | Supplies proofs and executes bounded work. No production economic-report setter exists. Invalid or incomplete work cannot become an accepted snapshot. |
| User | Can request, cancel and claim its own position through deterministic accounting. A rejecting payment receiver affects its own claim transaction; the guarded ledger prevents callback reentry. |

Relevant review categories include OWASP A01:2021 Broken Access Control and A04:2021 Insecure Design. HTTP authentication and security headers do not apply to these contract entry points.

## Remaining verification gaps

- The original frozen graph has now completed consumed top-up, real validator rewards, independent exit, authenticated terminal withdrawal, fee reservation and final user payouts with zero residue. [The implementation report](IMPLEMENTATION.md#real-network-milestones) records exact reconciliation and a resolved payout gas-estimation failure. A full funded validator lifecycle on the final hardened bytecode remains a separate pre-launch qualification; its native-VM regressions and actual liquid-principal recovery run do not imply that additional result.
- The integrated staging-race regression completes a newer portfolio while an older stage remains open, applies the new economics once, and preserves the original eligibility cutoff and phase. The pricing-window regressions below additionally change economic value and exercise automatic refresh before admission and reservation.
- Cover multiple admissions, multiple registered validators, an external top-up and a native withdrawal across the same interval, including skipped slots and aborted portfolio generations. The current adapter plan primarily exercises one admitted validator.
- Preserve bytecode-executed malformed-proof, wrong-recipient, wrong-index/domain, replay, stale-cutoff, reentrancy, zero-loss-cohort, fee-carry and cash-conservation checks as required release gates.
- Measure complete occupied-header history proof cost and keeper completion latency at realistic pool/network scale. Per-call batch limits alone do not establish that the entire interval can finish within the freshness window.

## Initial reviewed source fingerprints, before M1 hardening

| File | SHA-256 |
| --- | --- |
| `NativeLedger.hyp` | `0852c0d0be88038e5632f448ae2f10a1afb5c1501b5331f197258f5e6b28918b` |
| `NativeQrlPool.hyp` | `1021a58003f1a4df6c9c180b40d8809ff1b423adeb8c30d6eeeb9b9e999369a8` |
| `NativeValidatorGate.hyp` | `62697b23ed4032908968b2ff8d99b61ff800ace4d0be66baa9e1daf62ea6ad3f` |
| `NativePortfolioVerifier.hyp` | `e76c176511c577d51c50c38413b16f2dd79b9795d46c636e83ae47097be4c1ac` |
| `NativeSSZ.hyp` | `11c2d505e55bfc3192e36d79fa2c5ac0a72ca4cc6d42875fc6d3b6eb5428702b` |
| `NativeAccountProof.hyp` | `2affe66917975dbbade412e77db4001ddff220481ee178878188f625b1b58f6f` |
| `NativeFinalityVerifier.hyp` | `fd33810728c5b22cad26d02d0120b82f6a7b99631c500f89422e15e8f5b2fde1` |

## Follow-up findings and source hardening

**H1, high conditional withdrawal-liveness defect, resolved in source:** The original `NativeLedger.hyp:450` recovery path relied exclusively on global finality expiry. Valid finality updates could keep renewing that deadline while complete pool accounting became unavailable, leaving new user cash reservations and recovery both inaccessible. `NativeQrlPool.hyp:122` now derives a separate immutable recovery window from finality configuration and anchors its deadline to the last complete checkpoint actually applied by the pool, or the constructor checkpoint before first settlement. Only successful application renews it. At deadline plus one slot, normal mutation and settlement cannot revive the pool, even with healthy finality and a newer completed portfolio. Existing claims, earned fees, refundable pending principal and later proportional cash recovery remain available. This condition was established by source analysis and tested through the real pool bytecode with explicit synthetic finality/state inputs; it was not induced in the funded graph.

**H2, high validator-enrollment policy defect, resolved in source:** Unrestricted preparation let arbitrary callers enroll consensus keys and seek the 38,000 QRL pooled top-up. Recipient proofs protect payment routing but do not constrain who can misoperate those keys. `NativeValidatorGate.hyp:47` and `NativeValidatorGate.hyp:88` now bind a nonzero immutable validator operator and restrict preparation to that account. Authenticating and completing its prepared funding remains permissionless. Tests reject unauthorized preparation before native deposit state or cash changes, reject a zero operator configuration, and retain independent-caller successful admission. No negative consensus messages or live loss scenario were generated. Initial operator selection and compromise of that operator remain explicit trust boundaries.

**Lifetime capacity, enforced in source:** `NativePortfolioVerifier.hyp:159` limits total lifetime admissions to 64; terminal records continue consuming capacity. The gate rejects new preparation when the registry is full. The boundary test supplies 65 native-SSZ validator witnesses, performs 64 actual registration calls, rejects the 65th, commits a complete 64-validator portfolio with one authenticated terminal-zero record, and rejects another admission again. It uses a declared fixture gate caller and synthetic authority, without registry storage seeding. A separate real-gate test supplies an explicitly synthetic full-registry interface to prove rejection before accepting bootstrap QRL. Concurrent preparations made before capacity fills still carry the operator's admission risk.

**Executed final candidate gate:** `npm run test:proofs` passed 828 native QRVM steps, including 99 expected reverts across portfolio, gate, adapter, capacity, five recovery cases and executor scenarios. Recovery cases cover no first settlement, healthy global finality, exact deadline renewal, newer unapplied portfolio state, expired staging, preserved pending/user/fee claims, repeated claims and late cash without new fees. Runtime sizes: Finality 9,627 bytes; Portfolio 24,509; Gate 13,725; Pool 21,519. All fit the unmodified 24,576-byte limit. The Portfolio has 67 bytes of remaining runtime headroom. The detailed run and summary are under ignored `findings/native-final-hardening-tests.log` and `findings/native-final-hardening-summary.json`.

**Provenance boundary:** The constructor-only M1 runtime equivalence result above applies to that intermediate revision. Timeout, capacity and immutable operator hardening intentionally change runtime and, for the gate, constructor ABI. The existing funded lifecycle continues against its original frozen artifacts. Those files were rechecked byte-for-byte unchanged. A separately frozen current-source graph subsequently established execution of the new timeout on the actual network: its complete checkpoint at slot 2696 admitted 10 QRL, healthy global finality advanced while the pool deadline 2792 expired, an independent account began recovery at slot 2826, and the depositor recovered exactly 10 QRL at slot 2834. That test used genuine certificates and mined transactions, with zero new fees and zero remaining pool cash. See [the implementation evidence](IMPLEMENTATION.md#actual-pool-timeout-recovery-result) for its scope and the separate earlier unfunded probe failure.

## Publication review follow-up

The later [final security review](FINAL-SECURITY-REVIEW.md) records the zero-value FIFO liveness fix, wallet transaction-generation guards and monitoring corrections. The current pool runtime is 21,628 bytes. The intermediate source fingerprints, runtime sizes and deployed-graph evidence above remain historical evidence for their explicitly named revisions.

## Final residual-risk review

The lifetime cap bounds validator work; it does not establish an adequate production checkpoint budget. Every checkpoint still requires complete occupied-block history since its predecessor, native signatures and all registered records. Measured and projected costs are separated in [checkpoint capacity](proofs/SCALE.md). Congestion, archival availability, capture latency and operator funding of permissionless keeper transactions can close normal operation through the immutable timeout. Recovery preserves enforceable cash rights but cannot force unavailable native principal to return on a deadline.

The new timeout repairs the distinction between pool accounting health and global finality health. The fresh source deliberately winds down irreversibly when that accounting deadline passes. No operator can extend it through finality-only or portfolio-only work. Users must review the selected freshness/recovery windows, initial anchor, sampled-committee assumptions and supported fork before depositing.

README and architecture correctly identify operator tip routing, initial configuration trust, sampled and potentially repeated committee keys, fixed-fork limitations, public early exits, preparation risk and indefinite native return timing. Keep the enforced lifetime cap, independent pool timeout and immutable enrollment role explicit in those documents. Available-cash-first exit scheduling is a keeper policy: public exit signatures permit independent early exits, and gate exit-work events require queued demand without proving a liquidity deficit. The implementation supplies no legal classification or regulatory clearance.

## Superseded pricing window, 2026-10-20

**High, resolved in source:** A still-fresh stage previously admitted pending deposits and reserved withdrawals after a newer completed portfolio had proved changed economics. The stage used its older price with current free cash. The earlier staging-race regression permitted this coexistence and checked sequencing without changing economic value.

`NativeLedger` now checks the latest completed portfolio ID before every bounded admission and reservation batch. It applies an advancing snapshot atomically before processing any entry. Permissionless `settleCheckpoint()` can also refresh an unfinished stage. `NativeQrlPool` supplies the authenticated latest ID through an internal hook. Snapshot IDs must increase, and execution cutoffs must remain nondecreasing; a newer beacon snapshot sharing the applied execution cutoff can therefore refresh successfully. There are no new public methods or storage fields.

Refresh preserves the current phase, original eligibility cutoff, queue ends and heads. Already admitted units, fixed user claims, earned fees and pending principal remain intact through the economic update. The ordinary batch then performs only its authorized admissions or reservations. Entries at or after the original cutoff remain deferred until a later stage opened by another completed snapshot. The executor checks the current phase before calling either batch, including an existing withdrawal phase.

The updated staging-race test explicitly refreshes the open stage and rejects duplicate application. The production-bytecode pricing plans reuse the review's synthetic economic histories and regenerate their native SSZ and account proofs:

| Scenario | Allocation after the fix |
| --- | --- |
| 52,000 QRL cohort, 12,000 cash, 40,000 validator balance; a queued 20,000 QRL position; later return of 39,480 after a 520 loss | The remaining queue batch first applies the cutoff-128 loss. The withdrawer receives 19,800 QRL and bears 200 of the loss. The other 30,000 QRL holder retains 29,700 and the 2,000 QRL operator position retains 1,980, totaling 31,680. Fees remain zero. |
| 52,000 QRL cohort; pending newcomer supplies 52,000; cutoff 128 proves 5,200 income before admission | Existing positions become 55,000 and 2,200 QRL. The newcomer receives units worth 52,000 QRL less one base unit (`10^-18 QRL`) of admission rounding and captures zero proved income. Its subsequent full claim has the same amount and zero fee. |

**Liveness:** Portfolio churn adds one refresh to the next batch, with no loop over intermediate snapshots. Cumulative portfolio counters reconcile skipped snapshots. A fresh-stage abort remains unavailable solely because a newer portfolio exists, preventing an added reset mechanism. Churn tests complete 65 admissions in batches of 32, 32 and 1, then two FIFO reward requests in single-entry batches while newer portfolios keep completing. Both explicit refresh and automatic refresh preserve the withdrawal phase. A blocked FIFO head ends staging under the existing rule; a complete loss or unrepresentable admission also releases staging while preserving refunds and late-return rights. Permissionless transaction inclusion, usable proofs and actual validator liquidity remain operating assumptions.

The latest completed snapshot must still be within its freshness window. Tests accept age 64 and reject age 65 while global finality stays healthy; failed refresh leaves accounting and the pool deadline unchanged, and stale-stage abort permits the pending refund. Portfolio completion alone cannot extend the independent pool deadline. An atomic refresh at slot 4224 renews it to 8320; at slot 4225, the same unapplied portfolio cannot revive the pool, and recovery starts directly from the unfinished stage. Separate ledger-bytecode cases preserve and pay existing 90-unit user claims, 10-unit earned fees and 17-unit pending refunds through supersession, including a complete loss.

**Measured gas:** The comparison uses the unchanged starting revision `49814cc03f7a757304f1e5cb3ffc7df2819b63af`, the pinned compiler, identical native runner settings and regenerated public fixtures. Values include intrinsic gas and precede refunds. The ordinary admission benchmark queues 65 deposits for one beneficiary; it demonstrates the per-batch change for that fixture, with the bound still fixed at 32.

| Operation | Before | After | Change |
| --- | ---: | ---: | ---: |
| First 32-entry admission batch, no refresh | 579,616 | 585,187 | +5,571 |
| Second 32-entry admission batch, no refresh | 545,416 | 550,987 | +5,571 |
| Two-entry FIFO batch, no refresh | 139,671 | 145,242 | +5,571 |
| Loss-scenario reservation batch | 157,731 | 232,559 | +74,828, including automatic loss settlement |
| Income-scenario single admission | 141,822 | 235,554 | +93,732, including automatic income settlement |

A 32-entry admission batch that also applies the superseding income snapshot uses 673,348 gas in the churn fixture. Refresh performs one existing economic settlement, including logarithmic historical-flow and funding lookups, then visits at most the requested 32 entries. The pool runtime grows from 21,628 to 21,906 bytes and remains below the 24,576-byte limit. The portfolio runtime and its existing headroom are unchanged.

The ten focused pricing-window plans pass 950 native QRVM steps with 67 expected reverts. The original review scenarios also reproduce their old allocations against the unchanged starting bytecode. This is local native-bytecode qualification with synthetic finality authority and economic states. The earlier funded local-network graphs retain their separately documented bytecode and evidence.

The complete gate passes 43 model tests, 32 tooling tests and 66,455 native QRVM steps, including 458 expected reverts. The VM total comprises 2,357 deterministic ledger steps, 62,164 randomized ledger steps, 1,779 portfolio/gate/adapter/recovery/capacity/executor steps and 155 finality steps. Go runner and proof-package tests also pass. Commands used `nice -n 10`, `GOMAXPROCS=2`, `GOFLAGS=-buildvcs=false` and Go package parallelism of two; the full gate additionally used a two-CPU affinity limit.

| Gate | Exit code |
| --- | ---: |
| `npm ci` | 0 |
| `npm test` | 0 |
| `npm run test:model` | 0 |
| `npm run test:tooling` | 0 |
| Ten focused native pricing-window plans | 0 |
| Original review replay and paired gas comparison | 0 |
| `git diff --check` and added-text scan | 0 |
