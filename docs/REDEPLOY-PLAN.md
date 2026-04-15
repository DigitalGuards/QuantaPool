# Redeploy Plan — v2.1 (withdrawal-prefix fix)

**Status:** drafted, awaiting user authorization to execute
**Trigger:** `DepositPool-v2.sol:565` now uses `bytes1(0x00)` (QRL `ExecutionAddressWithdrawalPrefixByte`). The live `DepositPoolV2` at `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` was deployed before this fix and will reject any real `staking-deposit-cli` deposit with `InvalidWithdrawalCredentials`.

## Scope of the bytecode change

Only `DepositPool-v2.sol` changed. `stQRLv2` and `ValidatorManager` bytecode is unchanged — but they're linked one-shot to the pool via `setStQRL` / `setDepositPool`, so any new pool forces a new token + new VM (or at least a new stQRL, since `stQRL.depositPool` is irreversible). Cleanest path is deploy all three, freshly wired.

## Live state that gets orphaned

| What | Amount | Recoverable? |
|------|--------|--------------|
| `pool.bufferedQRL` | 0 | — |
| Pool's validator stakes (MVP, sits in contract) | ~120,000 QRL | Yes — deployer can `batchExitValidator` + `claim-prep` + `claim` to drain, but there's no quick "sweep" function |
| stQRL supply | 39,504.95 shares | held by deployer; can be burned via `requestWithdrawal` → `claim` |
| Pending user withdrawals | 0 (just closed #1) | ✓ |
| `withdrawalReserve` | 0 | — |

Testnet-only, zero real money. User has more testnet QRL. **Decision: do not drain. Leave old contracts as historical artifact.** Note their addresses in `docs/v2-deprecated-addresses.md` so future Claude sessions don't accidentally re-target them.

## Execution steps

1. **Regenerate Hyperion artifacts** (source already fixed):
   ```bash
   node scripts/sync-hyperion.js
   node scripts/compile-hyperion.js
   ```
   Expect 3 fresh `build/hyperion/*.{abi,bin}` pairs. `grep -c "0x00" build/hyperion/DepositPoolV2.bin` should differ from the live bytecode.

2. **Confirm Foundry still green:** `forge test` (expect 187 pass incl. the 9 new `fundValidator` tests).

3. **Backup current addresses:**
   ```bash
   cp config/testnet-hyperion.json config/testnet-hyperion.v2.0.json.bak
   ```

4. **Deploy + wire:**
   ```bash
   node scripts/deploy-hyperion.js
   ```
   Deployer tx count: 5 (3 deploys + 2 wire calls). Cost: ~0.04 QRL gas. New addresses overwrite `config/testnet-hyperion.json.contracts`.

5. **Smoke-test new deployment:**
   ```bash
   node scripts/integration-test-v2.js status
   node scripts/integration-test-v2.js smoke
   node scripts/integration-test-v2.js rewards
   node scripts/integration-test-v2.js withdraw
   node scripts/integration-test-v2.js validator
   ```
   All should go green on the fresh addresses.

6. **Manual check of the fix:** construct a real-looking `fundValidator()` call (stub 2592-byte pubkey, 4595-byte sig, correct `0x00`+pool-address credentials, dummy root). On the old deployment this reverts with `InvalidWithdrawalCredentials`; on the new one it should proceed as far as the beacon deposit contract. A scripted version of this lives in `scripts/verify-prefix-fix.js` (TODO — add if the plan is approved).

7. **Update monitoring:**
   ```bash
   ssh 46.28.70.102 "cd /opt/quantapool/monitoring && ..."
   ```
   Update `.env` on the server with new addresses, restart contract-exporter, verify metrics land.

8. **Docs:**
   - `docs/V2-DEPLOYMENT-STATUS.md` — bump "Live deployment" table, add "v2.0 deprecated" section pointing at v2-deprecated-addresses.md.
   - `README.md` — if it hardcodes addresses, update.
   - `config/testnet-hyperion.json` — autoupdated by `deploy-hyperion.js`.

## What this does *not* unlock

- **Real beacon path still needs gqrl+qrysm running.** The prefix fix was necessary but not sufficient. Next milestone after redeploy is standing up a validator node on `46.28.70.102` so `fundValidator()` can be exercised end-to-end.
- **External audit.** The contract is testnet-only until reviewed.
- **Slashing constants.** Still placeholders upstream; no change needed in our code until QRL team publishes final values.

## Rollback

Nothing to roll back — old contracts keep running independently. If redeploy fails midway, restore `config/testnet-hyperion.json` from the `.bak`.
