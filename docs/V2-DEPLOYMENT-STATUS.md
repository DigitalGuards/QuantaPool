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

### 1. Integration test (`scripts/integration-test-v2.js`)
Written but does not execute. Stops at the first `pool.deposit().send()` with `unknown account` from the proxy.

**Root cause:** Contract instances created via `new web3.qrl.Contract(abi, addr)` (i.e. loaded by address rather than from a `.deploy()` result) do **not** auto-bind to the wallet attached on the parent `web3` instance. `.send({from})` therefore round-trips to the node as `qrl_sendTransaction` instead of being signed locally as `qrl_sendRawTransaction`.

**Tried, did not work:** setting `web3.qrl.defaultAccount`, assigning `contract.wallet = web3.qrl.accounts.wallet`, setting `contract.defaultAccount`.

**Workaround for next session:** sign each tx manually:
```js
const data = pool.methods.deposit().encodeABI();
const signed = await web3.qrl.accounts.signTransaction(
    { to: pool.options.address, value, gas, data, chainId: 1337 },
    process.env.TESTNET_SEED   // or the seed-derived hex private key
);
await web3.qrl.sendSignedTransaction(signed.rawTransaction);
```
Or look for the @theqrl/web3 v0.4 idiomatic way to bind a Wallet to a `new Contract(...)` after construction.

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

The integration test file is at `scripts/integration-test-v2.js`, blocked at line ~85 (the `pool.deposit()` call). Implement the manual-sign workaround in the helper `tx()` function (line ~37) — that function is the single place every state-changing tx flows through.

Phases run independently:
```bash
node scripts/integration-test-v2.js smoke      # 100 QRL deposit
node scripts/integration-test-v2.js rewards    # 1 QRL donate + syncRewards
node scripts/integration-test-v2.js withdraw   # request withdrawal (needs prior deposit)
node scripts/integration-test-v2.js validator  # 40,000 QRL → fundValidatorMVP
node scripts/integration-test-v2.js all        # full sequence
```

The `validator` phase will lock 40,000 QRL in the contract (recoverable only via the 128-block claim flow with reserve funded by owner). User has access to more testnet funds if needed.

---

## Cost so far
- Contract deploys + wiring: ~0.04 QRL gas
- Deployer balance after deploy: **49,999.96 QRL** (read at block 18,113)

## Files of interest
- `config/testnet-hyperion.json` — provider URL, chainId, live addresses
- `scripts/deploy-hyperion.js` — deploy + wire (works)
- `scripts/integration-test-v2.js` — MVP flow (blocked on wallet-binding)
- `scripts/sync-hyperion.js` — Solidity → Hyperion dialect translator
- `hyperion/artifacts/{stQRLv2,DepositPoolV2,ValidatorManager}.{abi,bin}` — compiled artifacts (gitignored)
- `.env` — `TESTNET_SEED` (gitignored)
- `scripts/v1-deprecated/` — archived v1 scripts (do not run against v2)
