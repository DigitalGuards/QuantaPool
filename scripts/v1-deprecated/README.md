# v1-deprecated scripts

These scripts target the **v1** contract ABI (`stQRL`, `DepositPool`, `RewardsOracle`, `OperatorRegistry`) and **will fail** against the v2 contracts deployed from `scripts/deploy-hyperion.js`.

They are kept here for historical reference only. Do not run them against a v2 deployment.

| Script | First broken call against v2 |
|---|---|
| `deploy.js` | Deploys legacy `stQRL`/`DepositPool` ctor with arg; calls `setRewardsOracle()` (no v2 equivalent) |
| `configure.js` | Reads `rewardsOracle` from config; calls `setRewardsOracle()` |
| `test-deposit.js` | `stQRL.totalAssets()`, `stQRL.convertToShares()`, `pool.getQueueStatus()` |
| `upgrade-deposit-pool.js` | Reads `pendingDeposits`/`liquidReserve`; v1 ctor with arg |
| `fund-validator.js` | `pool.getQueueStatus()` |
| `integration-test.js` | All of the above; also `pool.liquidReserve()`, single-arg `getWithdrawalRequest(user)` |

## v2 equivalents

The v2 deployment path is:

1. `scripts/deploy-hyperion.js` — deploys all three v2 contracts and wires them.
2. `scripts/sync-hyperion.js` + `scripts/compile-hyperion.js` — regenerate `hyperion/artifacts/`.

A v2-correct integration test will be added under `scripts/` when written. Until then, see `test/` (Foundry) for behavioural coverage.
