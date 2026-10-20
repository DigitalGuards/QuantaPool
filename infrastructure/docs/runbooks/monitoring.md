# Native monitoring checks

Configure the read-only exporter with an explicit `QRL_RPC_URL`, `QRL_CHAIN_ID` and `NATIVE_POOL_ADDRESS`. Its startup checks reject a different chain or an absent pool. See [exporter configuration](../../../monitoring/README.md).

The native contract dashboard covers risk assets, refundable pending deposits, reserved user claims, earned operator fees, validator count and verification status. Exact values remain integers on chain; Prometheus QRL observations use approximate floating point.

| Observation | Interpretation and response |
|---|---|
| Exporter `/health` fails | Inspect RPC availability, chain identity and complete-scrape errors |
| `quantapool_native_finality_status` is 1 | Verification needs authenticated catch-up; normal economic actions fail closed |
| `quantapool_native_finality_status` is 2 | Trust expired irreversibly; use the documented cash recovery lifecycle |
| `quantapool_native_pool_status` is 2 | Finality or complete pool accounting expired; anyone can begin cash recovery, including while finality remains healthy |
| Pending deposits or queue grow | Check fresh complete portfolio proofs, bounded ledger work and native validator exit progress |
| Free cash is low | Check existing cash-backed reservations and exit eligibility; there is no discretionary payout override |
| Earned fees increase | Reconcile realized eligible consensus gains and the fixed 10% fee; principal and unclassified receipts are fee-exempt |

Monitor native node synchronization, validator duties, disk capacity and proof-submission latency separately. Node metrics are operational observations and do not authenticate contract balances. A stale or incomplete portfolio can require more work even while the finality cursor remains current.

There is no token supply, token price, owner pause, reward oracle report or manual balance repair in this implementation. Expired verification cannot be restarted by monitoring or operator intervention. A replacement deployment requires users to exercise the available exit or recovery path themselves.
