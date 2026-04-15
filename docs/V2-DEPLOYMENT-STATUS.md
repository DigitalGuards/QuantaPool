# QuantaPool v2 Testnet Deployment — Status & Handoff

**Last updated:** 2026-04-14
**Branch:** `dev`
**Network:** QRL v2 testnet, chainId `1337`
**Deployment revision:** v2.2 (ML-DSA-87 signature length fix; supersedes v2.1 + v2.0, see `REDEPLOY-PLAN.md`)

---

## Live deployment on QRL v2 testnet (v2.2)

| Contract | Address |
|----------|---------|
| **stQRLv2** | `QA2f23388d1e3986416A36d2Ef113850D6900b69C` |
| **DepositPoolV2** | `Q109d7C528a67b80eb638D4C85e7C4545ef9Bb9aC` |
| **ValidatorManager** | `QA5b6e85B7713670589e4eAf2F039380Ec2792c8C` |

Persisted in `config/testnet-hyperion.json`. All 3 wired (`setStQRL`, `setDepositPool` ×2). Deployer / sole owner: `Q2E13b52fd3cda0a57f9037856B7Df971074e2489`.

**Real validator deposit executed 2026-04-14:**
- Buffer top-up `pool.deposit(40000)` — tx `0x12e2b96b8f4ac2e80b8246a32af92d047dfdf6dcc3416e52a1dce5751c3fc8c6`
- `pool.fundValidator(pubkey, creds, sig, root)` — tx `0x61d6f48c7b17187abc3527577f65e6f100eda4ab50161d382e370321fbbd81c0`
- 40 000 QRL forwarded to beacon deposit contract `Q4242…`
- Local beacon (running on `46.28.70.102`) confirmed `beacon_processed_deposits_total = 1`
- Validator `0xa40ca760bcc4…` is in the activation queue (`UNKNOWN_STATUS` → eventually `ACTIVE` after several epochs)

**Scenario 2 — end-to-end test of terraform + ansible + user-driven pool + second validator (2026-04-15):**
- Terraform provisioned 2 Hetzner VPS: primary `138.201.152.117`, backup `159.69.125.89` (fsn1, cpx32 / cpx22). Monitoring module disabled (Hetzner 2-primary-IP quota on new project; reusing node #1 monitoring).
- Ansible deployed full stack on both (gqrl + qrysm-beacon + qrysm-validator). Drift fixes landed in commits `251e1db`, `ba18717`.
- Funded 8 throwaway user wallets (mnemonics in `.env.scenario2`, gitignored) via `scripts/fanout-test-wallets.js` — 40100 QRL total.
- 8 `pool.deposit()` calls (`scripts/scenario2-deposit.js`) → buffer 0 → 40092 QRL, shares 1:1 (8 txs, all green). Confirmed **overfund is benign**: 92 QRL sat safely alongside the 40k stake.
- Keystore generated on primary `138.201.152.117` via rebuilt `staking-deposit-cli`. Mnemonic + seed persisted to `/etc/quantapool/validator-mnemonic.txt` (0600) on the host. `verify-deposit-data.js` passed all checks.
- `pool.fundValidator(pubkey, creds, sig, root)` — tx `0x8fe035435c620faac48ea719d386d2b4b4b77741b576ee7b2274d5ad6d6b2b61`. On-chain: `validatorCount: 1 → 2`, `bufferedQRL: 40092 → 92 QRL`.
- Keystore imported, `qrysm-validator.service` active. Validator `0xb86185d4fcf4…` now in `UNKNOWN_STATUS`, same ~24h eth1 voting window ahead as validator #1.

### Deprecated (v2.0 + v2.1) — DO NOT interact

| Rev | Contract | Address | Why orphaned |
|-----|----------|---------|--------------|
| v2.0 | stQRLv2 | `Q09046968aF19E745F4aBa7A9fa5CD946b4E981DB` | wrong withdrawal-credentials prefix (`bytes1(0x01)`) |
| v2.0 | DepositPoolV2 | `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` | holds ~120k QRL MVP stake; `fundValidator()` would revert |
| v2.0 | ValidatorManager | `Q1b083D7Dc47212DcBc4595249D9384Fa16cE6FC5` | superseded |
| v2.1 | stQRLv2 | `Qd4EC1BEBdD86A9Aa387295d82d0B3Ef3E84f955e` | wrong `SIGNATURE_LENGTH = 4595` (qrysm enforces 4627) |
| v2.1 | DepositPoolV2 | `QD4B89C98727a9C149fDaCf9DcE46E0E7846BaDC5` | holds ~40k QRL MVP stake; `fundValidator()` would revert |
| v2.1 | ValidatorManager | `Q9a80a082870B6632cF0E71494162BFC2AF53F4d8` | superseded |

Backups of prior configs live at `config/testnet-hyperion.v2.{0,1}.json.bak`.

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

### 2. ~~Withdrawal-credential prefix byte was wrong~~ — **fixed in v2.1, kept in v2.2**

Qrysm uses `ExecutionAddressWithdrawalPrefixByte = byte(0)` (`mainnet_config.go:74`). Our `DepositPool-v2.sol` originally hardcoded `bytes1(0x01)` from Ethereum-spec muscle memory. Any real `staking-deposit-cli` deposit would have reverted with `InvalidWithdrawalCredentials` and stuck the stake. Locked in by 9 Foundry tests (`test_FundValidator_AcceptsZeroPrefix` / `RejectsEthereumOnePrefix` / `RejectsWrongContractAddress` / etc.).

### 2b. ~~`SIGNATURE_LENGTH` was wrong~~ — **fixed + redeployed as v2.2 2026-04-14**

`DepositPool-v2.sol:78` hardcoded `SIGNATURE_LENGTH = 4595`, but qrysm's `crypto/ml_dsa_87/ml_dsa_87t/signature.go` enforces ML-DSA-87 signatures at exactly **4627 bytes**. Any real `fundValidator()` on v2.1 would have reverted with `InvalidSignatureLength` before reaching the beacon contract. Fix bumped the constant to 4627 and updated the 4 Foundry tests that hardcoded the old length. Full suite still **187 pass**. v2.2 live addresses ship the fixed bytecode and have already executed a real `fundValidator()` end-to-end (see "Real validator deposit executed" above).

### 3. ~~Real validator deployment~~ — **done 2026-04-14**
gqrl + qrysm beacon + qrysm validator running on `46.28.70.102` under systemd as user `qrlnode`. Beacon fully synced, validator key imported and listening for activation. See `docs/NODE-SETUP.md` for the runbook.

### 4. ~~Monitoring contract-exporter rewrite~~ — **done 2026-04-14**
Rewritten for v2 ABIs. Running on `46.28.70.102` (docker-compose under `/opt/quantapool/monitoring`). Dashboards live at `https://grafana.46-28-70-102.nip.io`. After v2.2 redeploy: `pooled=40000 shares=40000 rate=1.0 validators=1`. Discord webhook wired for critical/warning/info receivers; `monitoring/prometheus/rules/*.yml` tuned this session to suppress false positives (`BeaconChainLowPeers` was matching the always-zero `state="Connecting"` bucket; `NetworkInterfaceDown` was firing on the unplugged secondary NIC).

### 5. Slashing path
Not testable on the testnet (can't force a validator to be slashed externally). Foundry unit tests in `contracts/test/` cover the `markValidatorSlashed` accounting at the Solidity level. Current qrysm slashing constants are **placeholders** per the QRL team (Discord, 2026-01-25) — snapshot captured in `docs/UPSTREAM-FINDINGS.md` §4 for later diffing.

### 6. Validator activation observation
Validator `0xa40ca760bcc4…` is in the activation queue. Once it transitions to `ACTIVE`, the validator client will start signing attestations. Need a follow-up integration test that, after activation, polls `validator_statuses{}` and confirms the pool's `_syncRewards()` picks up beacon-chain rewards routed back via the withdrawal address.

---

## How to resume

```bash
cd /home/waterfall/myqrlwallet/QuantaPool
git status                                    # expect clean on dev
forge test --summary                          # expect 187 pass
node scripts/integration-test-v2.js status    # live testnet read-back (v2.2 addresses)
ssh root@46.28.70.102 'systemctl is-active gqrl qrysm-beacon qrysm-validator'  # all should be active
```

Integration test phases run independently (idempotent per phase, but each run adds on-chain state):
```bash
node scripts/integration-test-v2.js <phase>
```
Phase names are listed in the coverage table above.

The `validator` phase locks 40,000 QRL into the pool per run. Recover via the `claim-prep` + `claim` sequence.

---

## Cost so far
- Three full deploys (v2.0 → v2.1 → v2.2), each 5 tx (3 deploys + 2 wires): ~0.12 QRL gas total.
- Integration test runs + MVP validator funding orphaned ~120k QRL in v2.0 pool, ~40k in v2.1 pool.
- v2.2: deployer funded one real validator (40k forwarded to beacon `Q4242…`).
- Testnet refills required: 60k + 10k = 70k QRL above the original 50k seed.
- All testnet QRL — no real-money cost.

## Files of interest
- `config/testnet-hyperion.json` — provider URL, chainId, live addresses
- `scripts/deploy-hyperion.js` — deploy + wire (works)
- `scripts/integration-test-v2.js` — all 16 test phases (works)
- `scripts/sync-hyperion.js` — Solidity → Hyperion dialect translator
- `scripts/lib/loadDeployer.js` — wallet.js v3 loader (34-word mnemonic, registers seed on `web3.qrl.wallet`)
- `contracts/solidity/` — canonical .sol sources
- `contracts/hyperion/` — generated .hyp mirrors (regenerate with `sync-hyperion`)
- `contracts/test/` — Foundry suite (187 tests, all pass)
- `scripts/verify-deposit-data.js` — safety gate; validates a `deposit_data-*.json` against the live pool
- `scripts/fund-validator-real.js` — broadcasts `pool.fundValidator()` (real beacon path)
- `docs/NODE-SETUP.md` — gqrl + qrysm runbook for the validator host
- `build/hyperion/{stQRLv2,DepositPoolV2,ValidatorManager}.{abi,bin}` — compiled artifacts (gitignored)
- `.env` — `TESTNET_SEED` (gitignored)
- `scripts/v1-deprecated/` — archived v1 scripts (do not run against v2)
- `contracts/hyperion/README.md` — Hyperion dialect + hypc workflow notes
