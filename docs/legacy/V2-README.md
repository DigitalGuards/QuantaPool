# Archived v2 testnet README

Retired on 2026-09-15. This document preserves the previous testnet design and its historical claims. It supplies no current launch instructions or migration requirements. See the [native-QRL architecture](../architecture.md) and [testnet retirement decision](../TESTNET-RETIREMENT.md).

# QuantaPool

Decentralized liquid staking protocol for QRL. Deposit QRL, receive stQRL, earn validator rewards automatically.

## Overview

QuantaPool enables QRL holders to participate in Proof-of-Stake validation without running their own validator nodes. Users deposit QRL and receive stQRL, a fixed-balance token where `balanceOf()` returns stable shares and `getQRLValue()` returns the current QRL equivalent (which grows with rewards).

### Key Features

- **Liquid Staking**: Receive stQRL tokens that can be transferred while underlying QRL earns rewards
- **Fixed-Balance Token**: Share balance stays constant (tax-friendly), QRL value grows with rewards
- **Slashing-Safe**: Fixed-balance design handles slashing by proportionally reducing all holders' QRL value
- **Bounded Reward Accounting**: Zero-principal sync is permissionless; active-validator rewards use amount-bound owner recognition after finalized Qrysm checks
- **Loss-Aware Performance Fee**: Fee-enabled deployments mint shares worth 10% of finalized-evidence validator rewards only after complete cohort settlement, a later finalized accounting pass, and prior loss recovery
- **Griefing-Resistant**: Fresh deposits mature for ~1 day (owner-tunable) before they can be transferred or withdrawn, blocking deposit/withdraw yo-yo attacks on pool liquidity
- **Post-Quantum Secure**: Built on QRL's Dilithium ML-DSA-87 signature scheme
- **Production Infrastructure**: Terraform + Ansible for automated validator deployment
- **Monitoring Stack**: Prometheus, Grafana dashboards, and Alertmanager with Discord/Telegram alerts
- **Web Frontend**: React staking app live at [quantapool.com](https://quantapool.com) and [quantapool.io](https://quantapool.io)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         User                                │
└───────────────────────────┬─────────────────────────────────┘
                            │ deposit() / requestWithdrawal()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    DepositPool-v2.hyp                       │
│  - Accepts deposits, mints stQRL shares                     │
│  - Queues and processes withdrawals                         │
│  - Fail-closed validator reward and exit accounting          │
│  - Cohort-level performance fee accounting                  │
│  - Funds validators via beacon deposit contract             │
└───────────────────────────┬─────────────────────────────────┘
                            │ mintShares() / burnShares()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      stQRL-v2.hyp                           │
│  - Fixed-balance QRC-20 token                               │
│  - Shares-based accounting (wstETH-style)                   │
│  - balanceOf = shares, getQRLValue = QRL equivalent         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  ValidatorManager.hyp                       │
│  - Tracks validator states (pending → active → exited)      │
│  - Stores Dilithium pubkeys (2,592 bytes)                   │
│  - MVP: single trusted operator model                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│   Infrastructure     │    │       Monitoring             │
│  Terraform + Ansible │    │  Prometheus + Grafana        │
│  gqrl, qrysm nodes │    │  Contract exporter + alerts  │
└──────────────────────┘    └──────────────────────────────┘
```

## Project Structure

```
QuantaPool/
├── contracts/                # All on-chain code lives here
│   ├── hyperion/             #   Canonical Hyperion sources
│   │   ├── stQRL-v2.hyp      #     Fixed-balance liquid staking token
│   │   ├── DepositPool-v2.hyp#     Deposits, withdrawals, reward sync
│   │   ├── ValidatorManager.hyp # Validator lifecycle tracking
│   │   └── README.md         #     hypc workflow and validation status
│   └── test/hyperion/        #   Hyperion behavioral test sources
│       ├── stQRL-v2.t.hyp
│       ├── DepositPool-v2.t.hyp
│       └── ValidatorManager.t.hyp
├── build/hyperion/           # hypc output (ABI, bin, manifest.json) - gitignored
├── frontend/                 # React staking app (quantapool.com / quantapool.io)
├── infrastructure/           # Production validator deployment
│   ├── terraform/            #   Hetzner Cloud provisioning
│   ├── ansible/              #   Node configuration (gqrl, qrysm)
│   ├── scripts/              #   deploy.sh, failover.sh, health-check.sh
│   └── docs/                 #   Runbooks and deployment guides
├── monitoring/               # Observability stack
│   ├── prometheus/           #   Scrape config + alert rules
│   ├── grafana/              #   Dashboards (validator, contract, system)
│   ├── alertmanager/         #   Discord/Telegram routing by severity
│   └── contract-exporter/    #   Custom Node.js exporter for on-chain metrics
├── key-management/           # Validator key lifecycle scripts
├── scripts/                  # Build & deployment automation
├── config/                   # Network deployment configs
└── docs/                     # Architecture docs
```

## Contracts

| Contract | LOC | Purpose |
|----------|-----|---------|
| `stQRL-v2.hyp` | 577 | Fixed-balance liquid staking token (shares-based, min-stake maturity lock) |
| `DepositPool-v2.hyp` | 1,145 | User entry point, deposits/withdrawals, bounded reward accounting |
| `ValidatorManager.hyp` | 335 | Validator lifecycle: Pending → Active → Exiting → Exited |

All on-chain code lives under `contracts/`. Files in `contracts/hyperion/` are the canonical, hand-edited contract sources. `scripts/compile-hyperion.js` compiles them directly with `hypc`; there is no Solidity regeneration step. The targeted release-blocker suite under `contracts/test/hyperion/semantic/` executes against the canonical contracts with the pinned Hyperion runner and qrvmone. The broader root `.t.hyp` files are historical pre-v2.4 archives, include retired API cases, and remain parse-only. Compiled artifacts land in `build/hyperion/` (gitignored).

## How Fixed-Balance Model Works

1. The pool has 1000 QRL and 1000 shares; a user owns 100 shares
2. Validators earn gross rewards and the protocol fee settles as new fee-recipient shares
3. The user's `balanceOf()` remains **100 shares** (unchanged, tax-friendly)
4. The user's `getQRLValue()` rises at the final, fee-adjusted exchange rate

If slashing occurs (pool drops to 950 QRL):
- User's `balanceOf()` still = **100 shares**
- User's `getQRLValue()` = 100 × 950 / 1000 = **95 QRL**
- Loss distributed proportionally to all holders

## How Withdrawals Work

Unstaking is a two-step flow. The QRL is never burned; the stQRL shares are.

1. **Request** (`requestWithdrawal(shares)`): your shares are locked (non-transferable, still on your balance) and the contract returns a current QRL estimate. A 128-block delay (~2 hours) starts. You can `cancelWithdrawal()` any time before claiming; the shares simply unlock.
2. **Claim** (`claimWithdrawal()`, FIFO per account): after the delay, after all validator principal is retired, and after complete accounting settlement, the locked shares are valued at the current exchange rate and burned. You receive that settled QRL amount from the withdrawal reserve. Queued shares continue receiving rewards and bearing slashing losses until claim.

Deposits and claims remain closed while any validator principal is outstanding.
An equal execution-balance equation cannot reveal a zero-return loss or a
correlated return from another validator. The operator can recognize a bounded
reward for accounting, but priced user flows reopen only after every principal
record is retired and the complete balance is reconciled.

This safety mode is cohort-based: one Pending or otherwise nonterminal validator
keeps deposits, claims, reserve funding, and emergency recovery closed. The
operator remains a trusted lifecycle reporter until QRL exposes authenticated
per-validator terminal-withdrawal receipts. External protocols should treat the
displayed stQRL rate as provisional while principal is outstanding.

## How the Protocol Fee Works

Fee-enabled deployments charge 10% of fee-eligible validator rewards. The
rate is a contract constant. Deposits, withdrawals, and zero-principal
donations carry no fee.

The contract opens one fee epoch when the first validator is funded. Finalized
Qrysm evidence can classify exact reward amounts while principal is
outstanding, but no fee shares mint during that interval. The last validator
settlement retires principal and schedules a separate fee finalization. A fresh,
later finalized Qrysm checkpoint gives late principal and rewards time to reach
the execution layer before `finalizeProtocolFeeEpoch(...)` fixes the epoch's
complete accounting. The finalizer caps the fee base by net gain, recovers prior
epoch loss first, and mints dilution-priced stQRL shares to the immutable fee
recipient. All QRL remains in the pool, and fee shares bear later slashing and
exit through the same withdrawal queue as other shares.

When a closed epoch retains loss or fee dust, the contract checkpoints that
carry against the closing share supply. A later burn reduces it only when total
shares reach a new historical minimum. This makes split burns path independent,
prevents departed supply from leaving its full loss shelter behind, and prevents
temporary new deposits from washing the checkpoint.

Retired principal that has not reached the pool is represented as a temporary
receivable during this close window. Late recovery replaces that receivable and
restores the validator buffer. Any amount still missing at finalization becomes
the epoch loss once. Deposits, claims, reserve funding, ordinary reward sync,
emergency recovery, and new validator funding stay locked until finalization.
Accounting and share-supply changes remain locked for the rest of the
finalization block so receipt-block verification observes one stable close.
They reopen from the next block.

The current operator checks finalized Qrysm evidence off-chain. The contract's
whole-epoch gain cap protects principal, while trustless continuous accounting
requires the consensus receipt interface specified in
[`docs/TERMINAL-WITHDRAWAL-RECEIPTS.md`](../../docs/TERMINAL-WITHDRAWAL-RECEIPTS.md).
The standard finalization tool treats residual positive close-window surplus as
fee-exempt because a finalized balance proves only an upper bound, not whether
the source was validator reward or an arbitrary donation. Rewards recognized
from exact evidence before settlement still enter the 10% fee base. The
finalized execution balance is enforced as a floor. A later positive balance
change is synchronized as fee-exempt, so a direct donation cannot keep the
close transaction reverting and leave priced pool operations locked.

**Example:** you hold 1,000 stQRL at rate 1.05. Request locks the shares and estimates 1,050 QRL. If the settled rate is 1.06 at claim, 1,000 stQRL burns and you receive 1,060 QRL. If slashing reduces the settled rate, the claim decreases proportionally.

### Where does the claim QRL come from?

The withdrawal reserve never holds the full TVL; it only covers pending claims. Pooled QRL lives in three places (all visible on-chain): validators (40,000 QRL each, staked on the beacon chain), the deposit buffer (accumulating toward the next validator), and the withdrawal reserve. Claims are sourced in this order:

1. **Pre-funding buffer**: with zero outstanding principal, QRL in the buffer can be earmarked in the reserve. Reserved QRL remains in pooled accounting until claim burns the matching shares.
2. **Complete validator settlement**: funded validator stake is all-or-nothing. The complete outstanding cohort exits, a later finalized checkpoint closes its accounting epoch, and only then can reserve funding or a claim proceed. Returned principal refills the buffer.

If a funded request is cancelled or its settled payout falls, the operator can
call `releaseWithdrawalReserve(amount)`. The contract restores only liquidity
that originally came from `bufferedQRL`, so simulated stake and unbuffered
rewards cannot be counted again as fresh validator principal.

If validators are funded when a 5,000 QRL withdrawal is queued, the operator must retire the complete outstanding validator cohort before the claim can execute. Returned principal refills the buffer, complete settlement fixes the share rate, and the claim then consumes its earmarked liquidity.

### Is there a cap?

Deposits are uncapped while no validator principal is outstanding. A deposit reverts after validator funding until the complete outstanding cohort is retired. You can always *request* a withdrawal, while `claimWithdrawal()` waits for the reserve, the 128-block delay, and zero outstanding principal. Fresh deposits also carry a minimum stake lock (default ~1 day) before the shares can transfer or enter a withdrawal request; this is anti-griefing protection.

## Infrastructure

Production-ready validator infrastructure using Terraform and Ansible.

**Components provisioned:**
- **Primary validator node** - gqrl (execution) + qrysm-beacon + qrysm-validator
- **Backup validator node** - hot standby with failover script
- **Monitoring server** - Prometheus, Grafana, Alertmanager

**Key management scripts** handle the full Dilithium key lifecycle: generation, encryption, backup, restore, and import to the validator client.

See `infrastructure/docs/DEPLOYMENT.md` for the step-by-step deployment guide and `infrastructure/docs/runbooks/` for operational procedures.

## Monitoring

Docker Compose stack providing full observability:

- **Prometheus**: Scrapes metrics from gqrl, qrysm-beacon, qrysm-validator, and the custom contract exporter
- **Grafana**: Three dashboards - Validator Overview, Contract State, System Resources
- **Alertmanager**: Routes alerts by severity (Critical/Warning/Info) to Discord and Telegram
- **Contract Exporter**: Custom Node.js service exposing on-chain metrics (stQRL exchange rate, TVL, deposit queue, validator count)

See `monitoring/README.md` for setup and configuration.

## Development

### Prerequisites

- Node.js 22 and npm
- `hypc` for Hyperion compilation/deployment

### Build

```bash
npm run compile:hyperion
```

This compiles the canonical files in `contracts/hyperion/` directly. It does not regenerate them from another language.

### Local validation

```bash
npm test
```

This compiles the three canonical `.hyp` contracts with the reviewed compiler, checks generated artifacts and critical ABI entries, executes the targeted native semantic suite with default and optimized code generation, parses the broader retained `.t.hyp` specifications, and runs the executable Node tooling tests.

### Hyperion workflow

```bash
npm run compile:hyperion
npm run deploy:hyperion
```

See `contracts/hyperion/README.md` for the dedicated Hyperion layout and deploy config.

### Validation gates

The full local gate is `npm test`. Hosted CI runs `npm run test:tooling` because hosted runners do not currently have a reviewed `hypc` distribution. Historical Solidity and Foundry workflow results are not current Hyperion validation.

## Validation Evidence

- **Current executable semantics:** `npm test` runs the targeted Hyperion release-blocker suites with default and optimized code generation. They cover 12 unequal small stakers, atomic real funding rollback, canonical validator identity, bounded reward recognition, pause enforcement, unexpected terminal returns, cross-validator return masking, the outstanding-principal safety lock, reward and slashing algebra, zero-return loss, pre-arrived recovery, and replay guards.
- **Current tooling and source gates:** the same command compiles all canonical contracts with the pinned compiler, verifies the manifest and production ABI, parses the broader retained `.t.hyp` specifications, and runs the Node deployment and lifecycle tooling tests.
- **Historical pre-removal evidence:** the former Solidity and Foundry suite was observed passing 226 tests before the project `.sol` contracts and `.t.sol` tests were removed. That result covered share/QRL conversion math, multi-user rewards, slashing, withdrawals, validator lifecycle, virtual shares, access control, pause behavior, reentrancy protection, and fuzz cases. It is not a current executable result for the `.hyp` sources.
- **Historical broad specifications:** `contracts/test/hyperion/*.t.hyp` preserve pre-v2.4 cases, including retired APIs. The current gate parses those files as archival evidence only.

## Status

**v2.3 is deployed and paused on QRL v2 testnet** with the reviewed accounting and launch-safety fixes. The legacy v2.2 pool is also paused while its historical validator stake is migration-bound. The staking frontend serves at [quantapool.com](https://quantapool.com) and [quantapool.io](https://quantapool.io). Keep v2.3 paused until beacon exit and reward settlement can be independently verified. Addresses and operational detail: `docs/V2-DEPLOYMENT-STATUS.md`.

### Roadmap

- [x] v2 fixed-balance contracts with audit remediations
- [x] Validator infrastructure (Terraform + Ansible)
- [x] Monitoring and alerting stack
- [x] Key management tooling
- [x] Deploy v2 contracts to QRL v2 testnet (v2.2, two validators funded)
- [x] Staking frontend live at quantapool.com and quantapool.io
- [x] Redeploy paused v2.3 with off-contract stake accounting and security fixes
- [ ] Complete legacy migration and independently verified settlement procedures
- [ ] Implement and activate authenticated terminal withdrawal receipts across Qrysm and go-qrl
- [ ] Integrate staking UI into [qrlwallet.com](https://qrlwallet.com)

## Security

- Historical Solidity-era Slither analysis completed with 0 critical/high findings before the `.sol` sources were removed
- Virtual shares (1e3) to prevent first-depositor/inflation attacks
- See `slither-report.txt` for that historical analysis

## Acknowledgments

- [Lido](https://lido.fi/) and [Rocket Pool](https://rocketpool.net/) for pioneering liquid staking designs
- [The QRL Core Team](https://www.theqrl.org/) for building post-quantum secure blockchain infrastructure
- [Robyer](https://github.com/robyer) for community feedback on the fixed-balance token model (tax implications of rebasing)

## License

GPL-3.0
