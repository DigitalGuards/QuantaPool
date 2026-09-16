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
- The integrated staging-race regression now executes completion of a newer portfolio while the old ledger stage remains open, rejects early overwrite, completes the old stage and consumes the new snapshot once. Final-user terminal checks still require the priced and latest portfolio to agree, so completion scheduling can defer the last exit.
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
