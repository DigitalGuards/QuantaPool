# QuantaPool v2 Testnet Deployment — Status & Handoff

**Last updated:** 2026-04-13
**Branch:** `dev`
**Network:** QRL v2 testnet, chainId `1337`

---

## What's done

### Z→Q migration (3 PRs, all merged)
- [#13](https://github.com/DigitalGuards/QuantaPool/pull/13) — code (contracts, deployer scripts, monitoring/contract-exporter)
- [#14](https://github.com/DigitalGuards/QuantaPool/pull/14) — infrastructure (Ansible, Terraform, monitoring config)
- [#15](https://github.com/DigitalGuards/QuantaPool/pull/15) — documentation sweep (READMEs, runbooks)
- Plus follow-up commits to `dev`: Gemini Ansible-review fixes (`33ebb2a`), v1-script archive + provider URL flip (`3d5f01c`), chainId 1337 + `sync-hyperion` dialect rules (`02ca285`), `deploy-hyperion` web3 v0.4 fixes (`3360ea2`).

### Live deployment on QRL v2 testnet
| Contract | Address |
|----------|---------|
| **stQRLv2** | `Q09046968aF19E745F4aBa7A9fa5CD946b4E981DB` |
| **DepositPoolV2** | `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` |
| **ValidatorManager** | `Q1b083D7Dc47212DcBc4595249D9384Fa16cE6FC5` |

Persisted in `config/testnet-hyperion.json`. All 3 wired (`setStQRL`, `setDepositPool` ×2). Deployer / sole owner: `Q2E13b52fd3cda0a57f9037856B7Df971074e2489`. Initial fund: 50,000 testnet QRL.

### Smoke test passed
Read-back smoke confirmed all 6 wiring asserts and constants:
- `stQRL.owner == pool.owner == vm.owner == deployer`
- `stQRL.depositPool == pool` and `pool.stQRL == stQRL` (one-shot links)
- `vm.depositPool == pool`
- `minDeposit = 100 QRL`, `VALIDATOR_STAKE = 40000 QRL`, `DEPOSIT_CONTRACT = Q4242…`
- All three `paused = false`, all counters at zero.

### Toolchain
- `hypc` (Hyperion compiler) built from source from `github.com/theQRL/hyperion`, installed at `/usr/local/bin/hypc`. Built with `-DUSE_Z3=OFF -DUSE_CVC4=OFF` to dodge a system Z3 version-detection bug. Version: `0.2.0-develop.2026.4.13+commit.d5d1b977.Linux.g++`.
- `scripts/sync-hyperion.js` now translates Solidity-vs-Hyperion dialect differences when generating `.hyp` mirrors (pragma version, unit names, address literal prefix).
- `scripts/deploy-hyperion.js` works end-to-end against the live testnet — produces deployed addresses + the 3 wiring tx in one run.

---

## What's blocked / not done

### 1. ~~Integration test~~ — PASSING as of `83060a7`
All four phases of `scripts/integration-test-v2.js` pass on chainId 1337:

```
[1] smoke      deposit 100 QRL → 100 shares, totals consistent
[2] rewards    donate 1 QRL + syncRewards → rate 1.00 → 1.01
[3] withdraw   request 50 shares → locked, blocksRemaining=128
[4] validator  40k QRL → register → fundValidatorMVP → activate (active=1)
```

Root-cause fix: load-by-address Contract instances don't inherit the wallet on the parent `web3`, so `.send({from})` on them is rejected as `unknown account`. Fixed by porting the frontend's encode-and-send pattern (`method.encodeABI()` → `web3.qrl.sendTransaction(txObj)`), plus registering the hex seed on `web3.qrl.wallet` inside `loadDeployer` so the local signer picks it up.

### 2. `DEPOSIT_CONTRACT` address (`Q4242…`) unverified
QRL team's staking documentation is in QA (per Discord, Jack Matier, 2026-04-13). Until verified, **do not call `pool.fundValidator()`** (the real beacon path). The MVP path `pool.fundValidatorMVP()` does not touch this address and is safe to use.

### 3. Real validator deployment
Not started. Requires (cloud) hardware running `gqrl` execution + `qrysm` beacon + `qrysm` validator. Use the Ansible/Terraform infra renamed in PR #14. Out of scope until the user is ready to provision.

### 4. Monitoring contract-exporter rewrite
The exporter at `monitoring/contract-exporter/` still calls v1 ABI (`totalAssets()`, `pendingDeposits()`, `liquidReserve()`). `safeCall` swallows the errors and returns `0n` — dashboards will look "fine" but show zeros. Deferred until after integration test passes.

---

## How to resume

```bash
cd /home/waterfall/myqrlwallet/QuantaPool
git status                                    # expect clean on dev
node -e "require('dotenv').config({path:'.env'}); \
  const {Web3}=require('@theqrl/web3'); \
  const c=require('./config/testnet-hyperion.json'); \
  const w=new Web3(c.provider); \
  w.qrl.getChainId().then(id => console.log('chainId',id))"     # expect 1337n
```

Integration test phases run independently (idempotent per phase, but each run adds to on-chain state):
```bash
node scripts/integration-test-v2.js smoke      # 100 QRL deposit
node scripts/integration-test-v2.js rewards    # 1 QRL donate + syncRewards
node scripts/integration-test-v2.js withdraw   # request withdrawal (needs prior deposit)
node scripts/integration-test-v2.js validator  # 40,000 QRL → fundValidatorMVP
node scripts/integration-test-v2.js all        # full sequence
```

The `validator` phase locks 40,000 QRL (recoverable only via the 128-block claim flow with reserve funded by owner).

### Next natural step: full claim flow
To exercise claim end-to-end, after `validator` run:
1. `pool.fundWithdrawalReserve(<reqQRL>)` as owner — reclassifies pooled QRL into the reserve.
2. Wait WITHDRAWAL_DELAY (128 blocks, ~2 h).
3. `pool.claimWithdrawal()` burns the locked shares and transfers QRL to user.

Not yet scripted. Candidate for `node scripts/integration-test-v2.js claim` as a phase 5.

---

## Cost so far
- Contract deploys + wiring: ~0.04 QRL gas
- Full 4-phase integration test (including 40,001 QRL deposited into pool): **deployer down to ~9,898 QRL** (rest is in the pool contract as pooled/validator stake)
- Balance at last check: 49,898.96 QRL *before* the `validator` phase; after the 40k deposit, ~9,898 QRL in deployer + 40,001 QRL in pool.

## Files of interest
- `config/testnet-hyperion.json` — provider URL, chainId, live addresses
- `scripts/deploy-hyperion.js` — deploy + wire (works)
- `scripts/integration-test-v2.js` — MVP flow (blocked on wallet-binding)
- `scripts/sync-hyperion.js` — Solidity → Hyperion dialect translator
- `hyperion/artifacts/{stQRLv2,DepositPoolV2,ValidatorManager}.{abi,bin}` — compiled artifacts (gitignored)
- `.env` — `TESTNET_SEED` (gitignored)
- `scripts/v1-deprecated/` — archived v1 scripts (do not run against v2)
