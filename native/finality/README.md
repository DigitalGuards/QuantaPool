# Native finality regression evidence

Run `npm run compile && npm run test:finality` from the QuantaPool cell with the compiler in `config/hyperion-toolchain.json`. The default `npm test` includes this suite. The runner builds the unmodified pinned go-qrl execution VM with Go 1.26.5 and checks compiled source hashes before execution.

`testdata/public-certificates.json.gz` contains public proof material captured from the fresh, unmodified current-Qrysm local network. Its provenance file pins the source commits, fork, bootstrap slot, certificate slots and compressed file hash. Keys and repeated signatures are deduplicated losslessly. The artifact contains no validator secret or operational endpoint.

The current `NativeFinalityVerifier` bytecode authenticates the real finalized updates 640 to 680, 744 and 808, including committee periods 10, 11 and 12. The execution VM's clock and account balances are explicit fixtures. Live transaction receipts in the separate lifecycle establish mined execution; this replay establishes deterministic regression behavior.

The suite executes 155 steps with 35 expected reverts: malformed initial anchoring, altered finalized roots, wrong committee proofs, wrong fork, invalid signatures, duplicate seats with atomic rollback, 85 versus 86 positions, replay, historical catch-up, deadline renewal only with fresh state, and irreversible expiry even when an old proposal has all signatures.

Each accepted certificate verifies 86 of the native 128 committee positions. Repeated public keys can fill several positions. The initial trusted checkpoint and the sampled committee's key-honesty assumptions remain necessary; this verifier does not replay whole-network stake-weighted consensus or the native state transition.

## Measured execution cost

The three certificate replays each use 719,020 calldata bytes across 11 transactions. The first uses 39,751,664 VM gas; the next two use 23,399,306 and 23,401,442. The largest transaction uses 6,303,654 gas. These regression batches deliberately split the 85th and 86th positions. Totals include native VM intrinsic calldata accounting and exclude the signed transaction envelope. Live receipt gas and actual QRL fees are measured separately.

A measured additional uncached-key cost of 249,543 gas gives a conservative 44,862,140 VM-gas projection for 86 uncached keys. This extrapolation is not a measurement on a large network. Signature count and certificate size depend on committee positions; proof work for owned validators and every intervening occupied header grows with portfolio size and checkpoint interval. See [checkpoint batching measurements](../proofs/CHECKPOINT-EXECUTION.md).

The pinned mainnet configuration has 60-second slots, 128-slot epochs and eight epochs per committee period. Local 64-slot economic freshness is unsuitable for mainnet finality latency. Production timing, committee risk, occupied-slot support, gas funding and archive availability require separate qualification. Local transaction prices do not establish public-network operating cost.
