# Bounded native checkpoint execution

`NativeCheckpointExecutor` is an optional immutable mechanical caller bound to one portfolio and its pool. It accepts up to three typed groups of block witnesses. Each group still passes through the portfolio's existing four-block bound, canonical header ancestry, complete native withdrawal and deposit lists, and checkpoint freshness checks. It holds no QRL and exposes no authority, generic call, recipient change, accounting setter or upgrade.

The final group can atomically append its proofs, finalize the complete portfolio, settle the pool, activate at most 32 eligible deposits, and process at most 32 FIFO requests when the pool reaches that stage. If any step fails, the complete transaction reverts. Larger queues remain available through the existing bounded permissionless functions. A fresh checkpoint is still required; the helper cannot extend its age limit.

The initial local attempt authenticated all 552 occupied blocks but its separate finalization transaction arrived at age 66 against a 64-slot limit. No snapshot was committed and the 42,000 QRL of pending user deposits stayed reserved. The helper removes the final confirmation and submission gap. A later live checkpoint committed the complete 1,184-block interval and activated the pending 42,000 QRL in its final transaction at age 62; measured costs and capacity limits are in `SCALE.md`. Three ordinary four-block groups measured 106,564 calldata bytes and approximately 4.60 million gas in the pinned QRVM; the final group with completion used approximately 4.70 million gas with the isolated staging fixture. Deposits and withdrawals can increase encoded block size, so callers must enforce the native signed-transaction and gas limits when choosing groups.

Qualification runs separately from the primary contract compiler output:

```sh
npm run test:proofs
node native/proofs/run-executor.js
node native/proofs/run-executor.js "$GATE_FIXTURE" "$CAPTURE_INPUTS"
```

The second command exercises the real pool, gate, native deposit contract and portfolio with synthetic finalized-state fixtures. The optional third command additionally replays actual captured native SSZ/MPT witnesses through the portfolio and helper, using an explicitly synthetic checkpoint authority and an isolated staging fixture. It checks complete ancestry, rejected malformed groups, rollback on premature completion, exactly-once commitment, immutable destinations and zero helper assets. These commands submit no network transactions. The live lifecycle uses its separately deployed, frozen finality verifier and records mined receipts independently.

`checkpoint.js` checks the graph bindings, captures the exact accepted finalized state, proves pool cash at the paired execution root, exports every registered validator, and supplies the complete parent-linked occupied interval. It invokes the immutable executor using bounded nonce-ordered transactions. The final transaction performs proof completion and ledger settlement atomically. The finality keeper is held locally while this bounded sequence runs; this coordination provides no contract authority.

Read-only `capture-flow.py --cache-dir "$PRIOR_FLOW_CAPTURE"` can reuse immutable-root keyed signed blocks. It checks their saved SHA-256 and byte count. Native `export-flow` then reconstructs every SSZ root and checks the complete parent chain again. Compact witness caches additionally recheck the native header SSZ root, both complete list roots and every branch before reuse; new blocks still pass through native signed-block decoding. Cache input cannot replace finality or proof verification. Cached replay of the initial 552-block interval produced byte-identical witnesses after native verification.

The executor's separate artifact directory and provenance manifest preserve the four core deployment artifacts. The live transaction driver freezes the helper artifact independently and verifies its reciprocal pool/portfolio bindings. Keep enough capture and submission throughput to stay within freshness limits; successful component execution alone does not establish that operational margin.
