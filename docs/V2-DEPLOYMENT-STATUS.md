# QuantaPool v2 Testnet Deployment - Status & Handoff

**Last updated:** 2026-08-03
**Branch:** `dev`
**Network:** QRL v2 testnet, chainId `1337`
**Deployment revision:** v2.3 security and accounting hardening

---

## Current deployment on QRL v2 testnet (v2.3)

| Contract | Address |
|----------|---------|
| **stQRLv2** | `Q7d4cA4872502a1ab02bCA855C093449aaE2bee58` |
| **DepositPoolV2** | `Q8e01Ea0bC7e337806154573A5B46Bb37F50Ea8fC` |
| **ValidatorManager** | `Qd84648a8F7314652B3E98D346645415eA03cce5f` |

The nonce-bound deployment completed on 2026-08-03 from the reviewed `dev` artifacts. All three contracts have deployed runtime bytecode matching those artifacts, the three one-shot links are correct, and the deployer is the sole owner. The token and pool are paused with zero supply, zero pooled QRL, zero staked QRL, and no validators. Keep them paused until migration and beacon-settlement procedures are independently validated.

The deployment required eight transactions: three contract creations, two immediate pause calls, and three one-shot wiring calls. `config/testnet-hyperion.json` is updated only after 12 confirmations and final ownership, link, bytecode, and paused-state checks.

One earlier stQRL creation at `Qd7D63e681aF8aae122366Ee537943078ED47E63E` is abandoned after the hosted RPC proxy rejected the following oversized deployment body. It has zero supply and no deposit-pool authority, so no account can mint through it. It is absent from every active config.

## Legacy v2.2 deployment - paused and migration-bound

| Contract | Address |
|----------|---------|
| **stQRLv2** | `QA2f23388d1e3986416A36d2Ef113850D6900b69C` |
| **DepositPoolV2** | `Q109d7C528a67b80eb638D4C85e7C4545ef9Bb9aC` |
| **ValidatorManager** | `QA5b6e85B7713670589e4eAf2F039380Ec2792c8C` |

The legacy token and pool were emergency-paused on 2026-08-03. They retain historical stake and validator state. Do not call `syncRewards`, `requestWithdrawal`, or `claimWithdrawal` on this pool because its missing off-contract stake accounting would record phantom slashing. Migration must wait for an atomic or independently verifiable beacon exit and reward-settlement procedure.

**Real validator deposit executed 2026-04-14:**
- Buffer top-up `pool.deposit(40000)` - tx `0x12e2b96b8f4ac2e80b8246a32af92d047dfdf6dcc3416e52a1dce5751c3fc8c6`
- `pool.fundValidator(pubkey, creds, sig, root)` - tx `0x61d6f48c7b17187abc3527577f65e6f100eda4ab50161d382e370321fbbd81c0`
- 40 000 QRL forwarded to beacon deposit contract `Q4242…`
- Local beacon confirmed `beacon_processed_deposits_total = 1`
- Validator `0xa40ca760bcc4…` is in the activation queue (`UNKNOWN_STATUS` → eventually `ACTIVE` after several epochs)

**Scenario 2 - end-to-end test of terraform + ansible + user-driven pool + second validator (2026-04-15):**
- Terraform provisioned 2 VPS (primary + backup). Monitoring module disabled on the new project (reused node #1 monitoring).
- Ansible deployed full stack on both (gqrl + qrysm-beacon + qrysm-validator). Drift fixes landed in commits `251e1db`, `ba18717`.
- Funded 8 throwaway user wallets (mnemonics in `.env.scenario2`, gitignored) via `scripts/fanout-test-wallets.js` - 40100 QRL total.
- 8 `pool.deposit()` calls (`scripts/scenario2-deposit.js`) → buffer 0 → 40092 QRL, shares 1:1 (8 txs, all green). Confirmed **overfund is benign**: 92 QRL sat safely alongside the 40k stake.
- Keystore generated on the primary host via rebuilt `staking-deposit-cli`. Mnemonic + seed persisted to a `0600` file on the host. `verify-deposit-data.js` passed all checks.
- `pool.fundValidator(pubkey, creds, sig, root)` - tx `0x8fe035435c620faac48ea719d386d2b4b4b77741b576ee7b2274d5ad6d6b2b61`. On-chain: `validatorCount: 1 → 2`, `bufferedQRL: 40092 → 92 QRL`.
- Keystore imported, `qrysm-validator.service` active. Validator `0xb86185d4fcf4…` now in `UNKNOWN_STATUS`, same ~24h eth1 voting window ahead as validator #1.

### Earlier deprecated deployments (v2.0 + v2.1) - DO NOT interact

| Rev | Contract | Address | Why orphaned |
|-----|----------|---------|--------------|
| v2.0 | stQRLv2 | `Q09046968aF19E745F4aBa7A9fa5CD946b4E981DB` | wrong withdrawal-credentials prefix (`bytes1(0x01)`) |
| v2.0 | DepositPoolV2 | `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` | holds ~120k QRL MVP stake; `fundValidator()` would revert |
| v2.0 | ValidatorManager | `Q1b083D7Dc47212DcBc4595249D9384Fa16cE6FC5` | superseded |
| v2.1 | stQRLv2 | `Qd4EC1BEBdD86A9Aa387295d82d0B3Ef3E84f955e` | wrong `SIGNATURE_LENGTH = 4595` (qrysm enforces 4627) |
| v2.1 | DepositPoolV2 | `QD4B89C98727a9C149fDaCf9DcE46E0E7846BaDC5` | holds ~40k QRL MVP stake; `fundValidator()` would revert |
| v2.1 | ValidatorManager | `Q9a80a082870B6632cF0E71494162BFC2AF53F4d8` | superseded |

Backups of prior configs live at `config/testnet-hyperion.v2.{0,1,2}.json.bak`.

Read-back smoke confirmed:
- `stQRL.owner == pool.owner == vm.owner == deployer`
- `stQRL.depositPool == pool` and `pool.stQRL == stQRL` (one-shot links, irreversible)
- `vm.depositPool == pool`
- `minDeposit = 100 QRL`, `VALIDATOR_STAKE = 40000 QRL`, `DEPOSIT_CONTRACT = Q4242…`
- Both user-facing v2.3 contracts are paused and all counters are zero.

---

## Integration test coverage (`scripts/integration-test-v2.js`)

All phases pass green on live testnet. Run any phase independently.

| Phase | What it exercises | Status |
|-------|-------------------|--------|
| `status` | Read-only dump: positions, rewards, pending requests, VM stats | ✓ |
| `smoke` | Deposit 100 QRL → shares minted, totals consistent | ✓ |
| `rewards` | Donate 1 QRL + `syncRewards` → exchange rate 1.00 → 1.01 | ✓ |
| `withdraw` | Request 50 shares → locked, `blocksRemaining=128`, canClaim=false | ✓ |
| `validator` | Deposit to 40k buffer → register → `fundValidatorMVP` → activate | ✓ |
| `errors` | 6 revert paths (below-min, zero, over-balance, one-shot guards, bad pubkey) | ✓ |
| `pause` | `pause()` blocks deposit; `unpause()` restores | ✓ |
| `lifecycle` | VM state machine: Active → Exiting → Exited + idempotency guard | ✓ |
| `claim-prep` | `fundWithdrawalReserve` reclassifies pooled→reserve; claim still blocked on 128-block delay | ✓ (historical v2.2 behavior) |
| `claim` | Actual `claimWithdrawal` after 128-block delay + reserve funded | ✓ (completed end-to-end on v2.0 2026-04-14: 50 shares burned, 50.5 QRL paid out before v2.1 redeploy) |
| `wait-claim` | Polls `getWithdrawalRequest` every 60s, auto-claims when ready | ✓ |
| `cancel` | Create 1-share request → cancel → shares unlock, request zeroed | ✓ |
| `transfer-locked` | `stQRL.transfer(unlocked+1)` reverts; exact-unlocked succeeds | ✓ |
| `batch` | Register 3 validators → `batchActivateValidators` → verify all Active; dup pubkey reverts | ✓ |
| `approve` | `approve` + `transferFrom` (self-spend); infinite-allowance non-decrement | ✓ |
| `all` | Runs every phase sequentially | use with care (adds state each run) |

Historical v2.2 validation: the claim paid the request-time `qrlAmount=50.5` while reserve funding temporarily reduced `currentQRLValue` to 50.436. A later source review found that this reserve carve-out distorted deposits made before the queued shares burned, and the fixed payout let queued holders avoid losses synchronized before claim. The current source retires that behavior: reserve remains inside `totalPooledQRL`, the request value is an estimate, and claim settles at the synchronized share value.

---

## What's blocked / deferred

### 1. ~~`DEPOSIT_CONTRACT = Q4242…` unverified~~ - **verified** (2026-04-14)

Confirmed against `qrysm/config/params/testnet_e2e_config.go:8` and `testdata/e2e_config.yaml:57`. Bytecode is pre-deployed at genesis (`qrysm/runtime/interop/genesis.go`). See `docs/UPSTREAM-FINDINGS.md` for details, including the mainnet address (`Q00000000219ab540356cBB839Cbe05303d7705Fa`).

### 2. ~~Withdrawal-credential prefix byte was wrong~~ - **fixed in v2.1, kept in v2.2**

Qrysm uses `ExecutionAddressWithdrawalPrefixByte = byte(0)` (`mainnet_config.go:74`). Our `DepositPool-v2.sol` originally hardcoded `bytes1(0x01)` from Ethereum-spec muscle memory. Any real `staking-deposit-cli` deposit would have reverted with `InvalidWithdrawalCredentials` and stuck the stake. Locked in by 9 Foundry tests (`test_FundValidator_AcceptsZeroPrefix` / `RejectsEthereumOnePrefix` / `RejectsWrongContractAddress` / etc.).

### 2b. ~~`SIGNATURE_LENGTH` was wrong~~ - **fixed + redeployed as v2.2 2026-04-14**

`DepositPool-v2.sol:78` hardcoded `SIGNATURE_LENGTH = 4595`, but qrysm's `crypto/ml_dsa_87/ml_dsa_87t/signature.go` enforces ML-DSA-87 signatures at exactly **4627 bytes**. Any real `fundValidator()` on v2.1 would have reverted with `InvalidSignatureLength` before reaching the beacon contract. Fix bumped the constant to 4627 and updated the 4 Foundry tests that hardcoded the old length. Full suite still **187 pass**. v2.2 live addresses ship the fixed bytecode and have already executed a real `fundValidator()` end-to-end (see "Real validator deposit executed" above).

### 3. ~~Real validator deployment~~ - **done 2026-04-14**
gqrl + qrysm beacon + qrysm validator running under systemd on the validator host. Beacon fully synced, validator key imported and listening for activation. Runbook is maintainer-internal (not in this public repo).

### 4. ~~Monitoring contract-exporter rewrite~~ - **done 2026-04-14**
Rewritten for v2 ABIs. Running under docker-compose on the validator host. After v2.2 redeploy: `pooled=40000 shares=40000 rate=1.0 validators=1`. Discord webhook wired for critical/warning/info receivers; `monitoring/prometheus/rules/*.yml` tuned this session to suppress false positives (`BeaconChainLowPeers` was matching the always-zero `state="Connecting"` bucket; `NetworkInterfaceDown` was firing on the unplugged secondary NIC).

### 5. Slashing path
Not testable on the testnet (can't force a validator to be slashed externally). Foundry unit tests in `contracts/test/` cover the `markValidatorSlashed` accounting at the Solidity level. Current qrysm slashing constants are **placeholders** per the QRL team (Discord, 2026-01-25) - snapshot captured in `docs/UPSTREAM-FINDINGS.md` §4 for later diffing.

### 6. Validator activation observation
Validator `0xa40ca760bcc4…` is in the activation queue. Once it transitions to `ACTIVE`, the validator client will start signing attestations. Need a follow-up integration test that, after activation, polls `validator_statuses{}` and confirms the pool's `_syncRewards()` picks up beacon-chain rewards routed back via the withdrawal address.

### 7. Off-contract stake accounting (`stakedQRL`) - **deployed in paused v2.3**

**Update 2026-08-03:** the fixed bytecode is deployed in v2.3 and remains paused. The legacy v2.2 pool still has the old bytecode and remains paused during migration planning.

The deployed v2.2 `DepositPoolV2` decrements only `bufferedQRL` when `fundValidator()` forwards the 40k stake to the beacon deposit contract; it never adds the off-contract principal back inside `_syncRewards()`. `_syncRewards()` computes `actualTotalPooled = balance − withdrawalReserve`, so the moment a real `fundValidator()` runs, the contract balance is 40k below `totalPooledQRL`. The next `syncRewards()` call (permissionless, and also triggered inside every `requestWithdrawal`/`claimWithdrawal`) emits `SlashingDetected(40000)` and collapses the exchange rate - after which a dust deposit can mint a near-unbounded share count and capture the pool when the stake/rewards return.

**This remains the legacy v2.2 state:** the real `fundValidator()` executed on 2026-04-14 means a `syncRewards()` against the v2.2 `DepositPoolV2` will report phantom slashing. Keep the legacy pool paused and do not trigger reward sync or withdrawals while planning migration.

**Fix (in `contracts/solidity/DepositPool-v2.sol`):**
- New `stakedQRL` accumulator, incremented by `fundValidator()` when principal leaves for the beacon contract.
- `_syncRewards()` now reconciles `balance + stakedQRL`, so funding a validator is balance-neutral. The current source keeps withdrawal reserve inside pooled assets until the matching shares burn.
- New owner-only `recordValidatorExit(amount)` decrements `stakedQRL` when exit proceeds return, preventing the returned principal from being double-counted as rewards.
- `emergencyWithdraw()` recoverable-amount calc excludes `stakedQRL` (it lives off-contract).
- **Phantom-reward front-run protection:** reward sync is permissionless only while `stakedQRL == 0`. Once principal is off-contract (`stakedQRL > 0`), `syncRewards()` is owner-only and claims reject unsettled on-chain balance deltas. Without this, an exit sweep lands principal in the balance before the owner can call `recordValidatorExit()`; an unrestricted sync in that window would book the principal as a phantom *reward* and spike the exchange rate. Gating sync during that window makes settlement and reward recognition owner-sequenced. The MVP path (`stakedQRL == 0`) stays fully permissionless.
- 13 new Foundry regression tests in `DepositPool-v2.t.sol`: the `OFF-CONTRACT STAKE ACCOUNTING` block (no-phantom-slashing after funding, rewards-while-staked, exit settlement, access control, emergency-withdraw carve-out) plus a `PHANTOM-REWARD FRONT-RUN PROTECTION` block (permissionless-when-unstaked, owner-only-while-staked, front-run blocked during exit, permissionless resumes after settlement, owner still recognizes genuine rewards). Suite now **200 pass**.

`fundValidatorMVP()` is unaffected - it keeps QRL in the contract and never touches `stakedQRL`, so its sync stays permissionless.

**Action:** keep v2.3 paused until the operator has an atomic or independently verifiable settlement procedure for beacon exits and returned rewards. The current owner-sequenced `recordValidatorExit` plus reward sync flow has a privileged timing dependency while `stakedQRL > 0`, so it is unsuitable for mainnet launch as-is.

### 7b. Share and reserve accounting hardening - **deployed in paused v2.3**

The current source includes additional accounting changes found during the v2.3 security review:

- Deposits reconcile rewards or losses that existed before `msg.value`, preventing new shares from capturing unsynced rewards.
- `withdrawalReserve` remains part of `totalPooledQRL` until claim. Reserve funding therefore changes neither side of the share conversion rate.
- Claims price shares after synchronized settlement. Request-time QRL values are informational estimates, so queued holders receive rewards and bear slashing until their shares burn.
- Exit settlement restores observed returned principal to `bufferedQRL`, capped at the nominal stake retired. This preserves restaking liquidity while preventing a slashed exit from creating unsupported buffer credit.
- Real and MVP validator funding require liquid balance net of reserve as well as sufficient `bufferedQRL`. Repeated reserve funding reduces the usable buffer without exposing earmarked funds.
- Cancelled or overfunded requests can be unearmarked with `releaseWithdrawalReserve`; reserve provenance restores only validator buffer that was actually reserved.
- `emergencyWithdraw` rejects unsettled balance deltas. Native inflows after pool initialization are protected as possible validator rewards.
- The Foundry suite is now 226 tests, including deterministic and fuzz regressions for each accounting issue, repeated reserve funding, safe reserve release, and exit-principal provenance.

These changes are present at the v2.3 addresses above. The new pool remains paused and empty while operational migration checks continue. The legacy v2.2 addresses retain the historical behavior.

### 8. Minimum stake lock (anti-griefing) - **deployed in paused v2.3**

Fresh deposits now mature for `minStakeBlocks` (default 1536, ~1 day) before they can be transferred or queued for withdrawal. Closes the deposit/withdraw yo-yo grief that would force the operator to bridge liquidity or exit validators at no cost to the attacker. Design points:

- Two-bucket lazy maturity in `stQRLv2` (`immatureSharesOf` / `matureAtBlockOf`), mirroring the `_lockedShares` pattern. Top-ups fold remaining immature shares into a new bucket and reset its maturity; matured shares are unaffected.
- Immature shares are non-transferable (closes the fresh-address bypass); transfers never write to the recipient's bucket (no dust-grief vector).
- Owner deposits are exempt so operator bridge capital can enter/exit without the wait.
- `setMinStakeBlocks` owner-settable, capped at `MAX_MIN_STAKE_BLOCKS` (46500, ~30 days), `0` disables.
- The complete suite now passes **226 tests**, including the 16 maturity-lock regressions and invariant fuzz cases. The frontend handles missing views defensively against historical v2.2 and shows a maturing notice on the Withdrawals page.
- The v2.3 contracts include the lock. It becomes relevant only after the paused pool is deliberately launched.

---

## Frontend

`frontend/` (React 19 + Vite 7 + MobX, merged via PR #21) serves at **https://quantapool.com** and **https://quantapool.io**, both Cloudflare-proxied with SSL mode Full (strict).

- The app reads chain state through the qrlwallet RPC proxy and the QRL price through the zondscan explorer API; both CORS allowlists must include the quantapool origins or the app shows "Could not reach the QRL network".
- Hosting, deploy steps, cert locations, and the exact CORS allowlist hosts are operational details kept out of this public repo (see the private `CLAUDE.md`).
- Defaults in `frontend/src/config/networks.ts` mirror the paused v2.3 addresses above; override via `VITE_*` env vars.

---

## How to resume

```bash
cd QuantaPool
git status                                    # expect clean on dev
forge test --summary                          # expect 226 pass
node scripts/integration-test-v2.js status    # read-only v2.3 state
# validator-host service health (gqrl/qrysm): see the maintainer-internal runbook
```

Integration test phases run independently, but mutating phases must remain disabled while v2.3 is paused:
```bash
node scripts/integration-test-v2.js <phase>
```
Phase names are listed in the coverage table above.

The `validator` phase locks 40,000 QRL into the pool per run. Recover via the `claim-prep` + `claim` sequence.

---

## Cost so far
- Three historical full deploys (v2.0 through v2.2) used five transactions each.
- The v2.3 safety deployment used eight transactions: three deploys, two pauses, and three one-shot links. One extra zero-supply token creation was abandoned after a proxy body-limit rejection.
- Integration test runs + MVP validator funding orphaned ~120k QRL in v2.0 pool, ~40k in v2.1 pool.
- v2.2: deployer funded one real validator (40k forwarded to beacon `Q4242…`).
- Testnet refills required: 60k + 10k = 70k QRL above the original 50k seed.
- All testnet QRL - no real-money cost.

## Files of interest
- `config/testnet-hyperion.json` - provider URL, chainId, live addresses
- `scripts/deploy-hyperion.js` - fingerprinted deploy, pause, wire, finality, and atomic config update
- `scripts/integration-test-v2.js` - all 16 test phases (works)
- `scripts/sync-hyperion.js` - Solidity → Hyperion dialect translator
- `scripts/lib/loadDeployer.js` - wallet.js v3 loader (34-word mnemonic, registers seed on `web3.qrl.wallet`)
- `contracts/solidity/` - canonical .sol sources
- `contracts/hyperion/` - generated .hyp mirrors (regenerate with `sync-hyperion`)
- `contracts/test/` - Foundry suite (226 tests, all pass)
- `scripts/verify-deposit-data.js` - safety gate; validates a `deposit_data-*.json` against the live pool
- `scripts/fund-validator-real.js` - broadcasts `pool.fundValidator()` (real beacon path)
- `build/hyperion/{stQRLv2,DepositPoolV2,ValidatorManager}.{abi,bin}` - compiled artifacts (gitignored)
- `.env` - `TESTNET_SEED` (gitignored)
- `scripts/v1-deprecated/` - archived v1 scripts (do not run against v2)
- `contracts/hyperion/README.md` - Hyperion dialect + hypc workflow notes
