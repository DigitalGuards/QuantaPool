# QuantaPool v2 Testnet Deployment — Status & Handoff

**Last updated:** 2026-04-14
**Branch:** `dev`
**Network:** QRL v2 testnet, chainId `1337`
**Deployment revision:** v2.1 (withdrawal-credentials prefix fix, `REDEPLOY-PLAN.md`)

---

## Live deployment on QRL v2 testnet (v2.1)

| Contract | Address |
|----------|---------|
| **stQRLv2** | `Qd4EC1BEBdD86A9Aa387295d82d0B3Ef3E84f955e` |
| **DepositPoolV2** | `QD4B89C98727a9C149fDaCf9DcE46E0E7846BaDC5` |
| **ValidatorManager** | `Q9a80a082870B6632cF0E71494162BFC2AF53F4d8` |

Persisted in `config/testnet-hyperion.json`. All 3 wired (`setStQRL`, `setDepositPool` ×2). Deployer / sole owner: `Q2E13b52fd3cda0a57f9037856B7Df971074e2489`. Initial fund: 50,000 testnet QRL; after v2.0 orphan + v2.1 gas, deployer holds ~9,999 QRL (need top-up to fund a validator on v2.1).

### Deprecated (v2.0) — DO NOT interact

| Contract | Address | Status |
|----------|---------|--------|
| stQRLv2 | `Q09046968aF19E745F4aBa7A9fa5CD946b4E981DB` | orphaned 2026-04-14 |
| DepositPoolV2 | `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` | holds ~120k QRL stake, shipped with the wrong `bytes1(0x01)` withdrawal-prefix; `fundValidator()` would revert |
| ValidatorManager | `Q1b083D7Dc47212DcBc4595249D9384Fa16cE6FC5` | orphaned 2026-04-14 |

Backup of v2.0 config lives at `config/testnet-hyperion.v2.0.json.bak`.

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
| `claim` | Actual `claimWithdrawal` after 128-block delay + reserve funded | ✓ (completed end-to-end on v2.0 2026-04-14: 50 shares burned, 50.5 QRL paid out before v2.1 redeploy) |
| `wait-claim` | Polls `getWithdrawalRequest` every 60s, auto-claims when ready | ✓ |
| `cancel` | Create 1-share request → cancel → shares unlock, request zeroed | ✓ |
| `transfer-locked` | `stQRL.transfer(unlocked+1)` reverts; exact-unlocked succeeds | ✓ |
| `batch` | Register 3 validators → `batchActivateValidators` → verify all Active; dup pubkey reverts | ✓ |
| `approve` | `approve` + `transferFrom` (self-spend); infinite-allowance non-decrement | ✓ |
| `all` | Runs every phase sequentially | use with care (adds state each run) |

Net protocol validation: **the claim paid exactly `qrlAmount=50.5` (the snapshot captured at request time), not the reduced `currentQRLValue=50.436` that the reserve-carve-out briefly implied.** Remaining shareholders kept their rate. The protocol preserves each claimer's original entitlement without diluting the rest — the virtual-offset + request-snapshot design works.

---

## What's blocked / deferred

### 1. ~~`DEPOSIT_CONTRACT = Q4242…` unverified~~ — **verified** (2026-04-14)

Confirmed against `qrysm/config/params/testnet_e2e_config.go:8` and `testdata/e2e_config.yaml:57`. Bytecode is pre-deployed at genesis (`qrysm/runtime/interop/genesis.go`). See `docs/UPSTREAM-FINDINGS.md` for details, including the mainnet address (`Q00000000219ab540356cBB839Cbe05303d7705Fa`).

### 2. ~~Withdrawal-credential prefix byte was wrong~~ — **fixed + redeployed 2026-04-14**

Qrysm uses `ExecutionAddressWithdrawalPrefixByte = byte(0)` (`mainnet_config.go:74`). Our `DepositPool-v2.sol` originally hardcoded `bytes1(0x01)` from Ethereum-spec muscle memory. Any real `staking-deposit-cli` deposit would have reverted with `InvalidWithdrawalCredentials` and stuck the stake. Fix confirmed at `DepositPool-v2.sol:565`, locked in by 9 new Foundry tests (`test_FundValidator_AcceptsZeroPrefix` / `RejectsEthereumOnePrefix` / `RejectsWrongContractAddress` / etc.). Full suite now **187 pass** (was 178). v2.1 live addresses ship the fixed bytecode.

### 3. Real validator deployment
Not started. Requires (cloud) hardware running `gqrl` execution + `qrysm` beacon + `qrysm` validator. The Ansible/Terraform infra renamed in PR #14 is what provisions it. Out of scope until you're ready to rent hardware.

### 4. ~~Monitoring contract-exporter rewrite~~ — **done 2026-04-14**
Rewritten for v2 ABIs. Running on `REDACTED` (docker-compose under `/opt/quantapool/monitoring`). Dashboards live at `https://grafana.REDACTED.nip.io`. As of v2.1 redeploy: `pooled=101 shares=100 rate=1.01 validators=0`. Discord webhook wired for critical/warning/info receivers.

### 5. Slashing path
Not testable on the testnet (can't force a validator to be slashed externally). Foundry unit tests in `contracts/test/` cover the `markValidatorSlashed` accounting at the Solidity level. Current qrysm slashing constants are **placeholders** per the QRL team (Discord, 2026-01-25) — snapshot captured in `docs/UPSTREAM-FINDINGS.md` §4 for later diffing.

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
