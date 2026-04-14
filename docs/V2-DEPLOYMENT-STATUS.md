# QuantaPool v2 Testnet Deployment — Status & Handoff

**Last updated:** 2026-04-14
**Branch:** `dev`
**Network:** QRL v2 testnet, chainId `1337`
**Head commit at last update:** `b7f83f5` (directory restructure under `contracts/`)

---

## Live deployment on QRL v2 testnet

| Contract | Address |
|----------|---------|
| **stQRLv2** | `Q09046968aF19E745F4aBa7A9fa5CD946b4E981DB` |
| **DepositPoolV2** | `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` |
| **ValidatorManager** | `Q1b083D7Dc47212DcBc4595249D9384Fa16cE6FC5` |

Persisted in `config/testnet-hyperion.json`. All 3 wired (`setStQRL`, `setDepositPool` ×2). Deployer / sole owner: `Q2E13b52fd3cda0a57f9037856B7Df971074e2489`. Initial fund: 50,000 testnet QRL (user has access to more as needed).

Read-back smoke confirmed:
- `stQRL.owner == pool.owner == vm.owner == deployer`
- `stQRL.depositPool == pool` and `pool.stQRL == stQRL` (one-shot links, irreversible)
- `vm.depositPool == pool`
- `minDeposit = 100 QRL`, `VALIDATOR_STAKE = 40000 QRL`, `DEPOSIT_CONTRACT = Q4242…`
- All three `paused = false`, counters at zero.

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
| `claim-prep` | `fundWithdrawalReserve` reclassifies pooled→reserve; claim still blocked on 128-block delay | ✓ |
| `claim` | Actual `claimWithdrawal` after 128-block delay + reserve funded | ✓ (completed end-to-end 2026-04-13: 50 shares burned, 50.5 QRL paid out) |
| `wait-claim` | Polls `getWithdrawalRequest` every 60s, auto-claims when ready | ✓ |
| `cancel` | Create 1-share request → cancel → shares unlock, request zeroed | ✓ |
| `transfer-locked` | `stQRL.transfer(unlocked+1)` reverts; exact-unlocked succeeds | ✓ |
| `batch` | Register 3 validators → `batchActivateValidators` → verify all Active; dup pubkey reverts | ✓ |
| `approve` | `approve` + `transferFrom` (self-spend); infinite-allowance non-decrement | ✓ |
| `all` | Runs every phase sequentially | use with care (adds state each run) |

Net protocol validation: **the claim paid exactly `qrlAmount=50.5` (the snapshot captured at request time), not the reduced `currentQRLValue=50.436` that the reserve-carve-out briefly implied.** Remaining shareholders kept their rate. The protocol preserves each claimer's original entitlement without diluting the rest — the virtual-offset + request-snapshot design works.

---

## What's blocked / deferred

### 1. `DEPOSIT_CONTRACT` address (`Q4242…`) unverified
QRL team's staking documentation is in QA (per Discord, Jack Matier, 2026-04-13). Until verified, **do not call `pool.fundValidator()`** (the real beacon path). The MVP path `pool.fundValidatorMVP()` does not touch this address and is safe to use.

### 2. Real validator deployment
Not started. Requires (cloud) hardware running `gqrl` execution + `qrysm` beacon + `qrysm` validator. The Ansible/Terraform infra renamed in PR #14 is what provisions it. Out of scope until you're ready to rent hardware.

### 3. Monitoring contract-exporter rewrite
The exporter at `monitoring/contract-exporter/` still calls v1 ABI (`totalAssets()`, `pendingDeposits()`, `liquidReserve()`). `safeCall` swallows the errors and returns `0n` — dashboards will look "fine" but show zeros. Need to rewrite against v2 ABI before any production observability work is useful.

### 4. Slashing path
Not testable on the testnet (can't force a validator to be slashed externally). Foundry unit tests in `contracts/test/` cover the `markValidatorSlashed` accounting at the Solidity level.

---

## How to resume

```bash
cd /home/REDACTED/myqrlwallet/QuantaPool
git status                                    # expect clean on dev
forge test --summary                          # expect 178 pass (all green at b7f83f5)
node scripts/integration-test-v2.js status    # live testnet read-back
```

Integration test phases run independently (idempotent per phase, but each run adds on-chain state):
```bash
node scripts/integration-test-v2.js <phase>
```
Phase names are listed in the coverage table above.

The `validator` phase locks 40,000 QRL into the pool per run. Recover via the `claim-prep` + `claim` sequence.

---

## Cost so far
- Contract deploys + 3 wiring tx: ~0.04 QRL gas
- Integration test runs across all phases (~10 runs, 40k+ in deposits, 1 full claim): deployer down to **~9,898 QRL**, rest held by the pool contract as pooled/staked balance.
- No real money cost — all testnet QRL.

## Files of interest
- `config/testnet-hyperion.json` — provider URL, chainId, live addresses
- `scripts/deploy-hyperion.js` — deploy + wire (works)
- `scripts/integration-test-v2.js` — all 16 test phases (works)
- `scripts/sync-hyperion.js` — Solidity → Hyperion dialect translator
- `scripts/lib/loadDeployer.js` — wallet.js v3 loader (34-word mnemonic, registers seed on `web3.qrl.wallet`)
- `contracts/solidity/` — canonical .sol sources
- `contracts/hyperion/` — generated .hyp mirrors (regenerate with `sync-hyperion`)
- `contracts/test/` — Foundry suite (178 tests, all pass)
- `build/hyperion/{stQRLv2,DepositPoolV2,ValidatorManager}.{abi,bin}` — compiled artifacts (gitignored)
- `.env` — `TESTNET_SEED` (gitignored)
- `scripts/v1-deprecated/` — archived v1 scripts (do not run against v2)
- `contracts/hyperion/README.md` — Hyperion dialect + hypc workflow notes
