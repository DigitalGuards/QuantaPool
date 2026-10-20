# Native validator lifecycle result

The isolated chain completed actual operator-funded preparation, pooled funding, native validation, independently relayed exit, native return and user/fee payouts on 15 September 2026. The execution/beacon clients and consensus rules remained unchanged. Exact source pins and fixture parameters are in [the network source lock](../network/source-lock.json).

This result belongs to the original frozen four-contract graph. It predates later source hardening for immutable operator admission, the pool-checkpoint recovery deadline and capacity checks. Those protections have separate VM and isolated-graph evidence. The local lifecycle does not establish public-launch readiness.

## Actual milestones

| Operation | Beacon/execution slot or finalized state |
|---|---|
| Operator's own 2,000 QRL bootstrap | 776 |
| Users deposit 20,000 and 22,000 QRL | 778 and 780 |
| Native bootstrap registration, validator 64 | 1792 |
| Public signed exit becomes available | Observed head 1799, before pooled funding |
| Complete initial portfolio and pending-deposit admission | Finalized 1824, committed 1886 |
| Atomic operator-principal adoption and 38,000 QRL pooled top-up | 1888 |
| Native consensus consumes the top-up | 2816 |
| Authenticated 40,000 QRL validator + 4,000 QRL cash, zero fee | Finalized 2816 |
| Validator activation | Epoch 360, slot 2880 |
| Full-position requests, in FIFO order | 2933, 2935 and 2937 |
| Gate exit request | 2939 |
| Native public-exit acceptance / exact inclusion | Eligible state 3009 / block 3010 |
| Finalized exit state | 3016 |
| Full native principal withdrawal to the pool | 3177, withdrawal index 50805 |
| Complete terminal portfolio and all FIFO reservations | Finalized 3200 |
| Native user claims | 3234, 3293 and 3295 |
| Earned fee payout | 3297 |

The public exit was verified with the pinned native ML-DSA implementation and relayed without access to execution or validator signing keys. Its original signature was identical before funding, in gate storage and in the included beacon block. Canonical activation epoch 360 plus the unchanged 16-active-epoch rule made epoch 376 the earliest eligible exit. Actual state then recorded exit epoch 381 and withdrawable epoch 397. The full 40,000 QRL native return arrived directly at the pool.

The validator missed its activation-epoch attestation and incurred an actual 1.0041 QRL ordinary protocol penalty. Later correctly included attestations and other native rewards restored that loss and produced a positive final net result. The activation-edge explanation is an inference from the 3-second fixture timing. No slashing message or synthetic reward payment was sent on this chain.

At finalized state 2944, accepted accounting showed 44,007.135415902 QRL in assets and only 4,005.773507222 QRL liquid. All three requests remained queued with head zero, no reserved claims and no earned fee. The first full withdrawal could not be paid from that buffer, and later users did not bypass it.

## Exact native reconciliation

| Item | QRL |
|---|---:|
| User and operator stake contributions | 44,000 |
| Principal sent to native validation | 40,000 |
| Total consensus withdrawals received | 40,032.041092142 |
| Net consensus result, including the penalty | 32.041092142 |
| Total user principal and net-reward payouts | 44,028.836982927800000001 |
| Earned operator fee | 3.204109214199999999 |
| Remaining pool cash | 0 |

The fee is one smallest native unit below ten percent of the net consensus gain because of per-user rounding. It did not consume principal. All three participants recovered their full contributed principal in this run; that outcome is not a principal guarantee.

| Participant | Principal returned | Net rewards returned |
|---|---:|---:|
| User 0 | 20,000 | 13.107719512636363637 |
| User 3 | 22,000 | 14.4184914639 |
| Operator's ordinary stake | 2,000 | 1.310771951263636364 |

The final report rechecks the frozen creation bytecode against actual deployment transactions, canonical deposit and withdrawal tuples, and the complete contract-authenticated cumulative withdrawal total. Contributions plus net native returns equal payouts plus remaining cash exactly. User balance changes separately reconcile fixture proposer tips, native credits and transaction gas. Received execution tips are not an enforced pool reward guarantee.

## Runtime failures and operating cost

Two initial portfolio attempts crossed the immutable 64-slot freshness limit. Root-verified proof caching, bounded signing concurrency and a separately qualified mechanical executor allowed the initial 1,184-block backlog to commit at age 62; validator admission completed at age 64. Subsequent ordinary checkpoints generally committed at ages 32 to 37. All failed receipts remain preserved.

A user claim exhausted a 112,824 gas allowance after a latest-block estimate of 85,687. Actual tracing showed an out-of-gas storage write. The failed transaction preserved the entire user claim. Claim helpers now use a bounded 300,000 gas allowance and permit a named retry only after checking a canonical gas-exhausted failure. The original and retry messages remain separate in the journal. Unused gas is not charged; receipt gas after a successful refund can be lower than the minimum allowance needed to finish execution.

| Main-graph transaction group | Successful | Reverted | Actual gas used |
|---|---:|---:|---:|
| Four core deployments and mechanical executor | 5 | 0 | 15,941,263 |
| Finality certificates | 2,000 | 0 | 4,684,907,969 |
| Complete portfolio accounting | 464 | 11 | 1,475,699,365 |
| Funding, requests and payouts | 12 | 1 | 5,711,106 |

These are complete fixture-run costs through execution block 3297, including commissioning backlogs and failed attempts. Steady-interval costs and scaling limits are documented separately. Gas was paid by fixture transaction senders and did not debit pooled principal.

The ignored lifecycle directory contains `completed-lifecycle.json`, `final-claims.json`, `terminal-native-return.json`, `topup-authenticated-reconciliation.json`, `queued-low-liquidity-checkpoint.json`, `claim-gas-failure.json`, the independent exit evidence, exact signed messages and receipts. Run commands and guards are in [the lifecycle README](README.md).

After the zero-cash drain, the recorded portfolio-maintenance loop, finality keeper and controlled validator were stopped. The observer and exit exporter had already completed. The fresh enclave, execution/beacon clients and genesis validators remain running. Helper cleanup verifies exact recorded process arguments and preserves a separate cleanup manifest.
