# Additional review before integration

Date: 2026-09-16. The starting candidate was `c41d4d56650d80d27ec40078ce055210052c2683`, targeting `dev` in PR #46. Two additional independent agent passes reviewed the accounting and authentication scopes. These are internal defensive reviews, not external audits or formal verification. Neither pass found a new confirmed contract defect. Contract source and the native pool ABI remain unchanged by this follow-up.

## Review results

| Scope | Confirmed result | Evidence boundary |
|---|---|---|
| Accounting, fees, losses and withdrawals | Immutable beneficiaries, cash-backed reserves, future-cutoff admission, proportional losses, realized-gain-only fees, FIFO and cumulative recovery remain consistent. Zero-value request completion preserves late-return rights. | Independent source review of `NativeLedger`, `NativeQrlPool` and admission checks; 38 model tests passed, including the existing 20,000 seeded actions. |
| Finality, proofs and validator funding | Native committee signatures/transitions, full-width account proofs, complete portfolio history and canonical withdrawal recipient checks remain bound to the intended immutable graph. Signed exit authorization precedes pooled funding. | Independent read-only comparison with clean pinned Qrysm `3b816311ac3e86b7a7af40a062ae290318554f7a` and go-qrl `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9`. This pass ran no new network transactions. |

The accounting review examined whether operator preparation could bypass future-cutoff admission. The existing requirement that the preparation block precede the applied authenticated cutoff resolves that concern. It was not reported as a vulnerability.

## Low: older pending refunds hidden by cancelled history, fixed

`frontend/src/stores/poolStore.ts`, `fetchActivity`, originally limited deposit events to the latest 64 before filtering cancelled records. After a user cancelled those deposits, older pending deposits remained outside that list. The existing manual deposit-ID refund control and on-chain claims remained available, so the defect affected refund discovery rather than entitlement or custody.

The store now excludes beneficiary-scoped `PendingCancelled` IDs before applying the 64-record limit. Authoritative `getPending` checks still validate cancellation state and beneficiary. The real-store regression creates 65 pending deposits, cancels the newest 64 and verifies that the oldest deposit becomes visible with one record read. It failed against the prior implementation and passed after the fix. A separate reviewer checked the fix and focused test.

All 42 frontend tests, lint, typecheck, changed-file Prettier checks and the production build passed. Wallet and RPC responses in this regression are synthetic; no signature or transaction was requested.

## Additional randomized native execution

The new state-machine corpus exercises the actual compiled ledger fixture in the pinned native QRVM. It adds delayed and same-block cutoffs, interleaved checkpoint batches and claims, refunds, cancellations, low liquidity, wide integer values, losses, terminal drains and permanent recovery with later receipts. Its generator maintains separate cash-flow and fee totals alongside differential checks against the BigInt model.

The executed corpus contains 12 histories across four seeds and three profiles: 768 randomized action selections, 1,668 complete invariant snapshots and 62,164 native-VM steps, including 234 expected reverts. These step counts include mutations, view assertions, balance checks and synthetic clock advances. The four seeds are `0x183d9417`, `0x25abe190`, `0x37ca6b21` and `0x48df123a`.

The final full `npm test` passed through the pinned compiler and native runner: 38 model tests, 65,217 total native-VM steps including 385 expected reverts, and 32 tooling tests. The integrated randomized generation/execution phase took 3.47 seconds, excluding compilation and the other suites. All native contract source fingerprints remain unchanged from the starting candidate.

See [the component test documentation](testing/README.md) for exact seeds, commands, counts and limits. Generated plans and results remain under ignored `build/native/fuzz/`. The corpus is part of `npm run test:vm` and the full local `npm test`; hosted CI does not execute the native compiler/VM gate.

The reference model and contract express the same intended accounting rules, so agreement can miss a shared specification error. These are bounded reproducible property tests with synthetic economics and finality. They provide no new real-validator lifecycle, finality-proof or production-scale execution result.

## Integration decision and launch boundary

The two reviews support integration into `dev` as an implementation candidate, subject to passing the final local and hosted checks. No new mutable privilege, fee rule or storage-layout change is introduced by this follow-up.

The [publication review's launch gates](FINAL-SECURITY-REVIEW.md#network-evidence-and-remaining-launch-gates) remain in effect: trusted deployment anchor/configuration and sampled-committee assumptions; exact final-bytecode funded-validator lifecycle; broader actual multi-validator histories; viable proof timing and operating costs; public early-exit policy; and operator-controlled transaction-tip routing. The 64-validator lifetime cap and narrow portfolio runtime margin remain explicit constraints.

Merging code performs no deployment or legacy recovery and changes no upstream QRL protocol behavior. The fixed 10% fee remains limited to eligible realized net consensus gains; principal and recovery receipts remain fee-exempt.
