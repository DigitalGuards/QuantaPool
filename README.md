# QuantaPool

Decentralized liquid staking protocol for QRL. Deposit QRL, receive stQRL, earn validator rewards automatically.

## Overview

QuantaPool enables QRL holders to participate in Proof-of-Stake validation without running their own validator nodes. Users deposit QRL and receive stQRL, a fixed-balance token where `balanceOf()` returns stable shares and `getQRLValue()` returns the current QRL equivalent (which grows with rewards).

### Key Features

- **Liquid Staking**: Receive stQRL tokens that can be transferred while underlying QRL earns rewards
- **Fixed-Balance Token**: Share balance stays constant (tax-friendly), QRL value grows with rewards
- **Slashing-Safe**: Fixed-balance design handles slashing by proportionally reducing all holders' QRL value
- **Trustless Sync**: No oracle needed - rewards detected via EIP-4895 balance increases
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
│                    DepositPool-v2.sol                       │
│  - Accepts deposits, mints stQRL shares                     │
│  - Queues and processes withdrawals                         │
│  - Trustless reward sync via balance checking               │
│  - Funds validators via beacon deposit contract             │
└───────────────────────────┬─────────────────────────────────┘
                            │ mintShares() / burnShares()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      stQRL-v2.sol                           │
│  - Fixed-balance QRC-20 token                               │
│  - Shares-based accounting (wstETH-style)                   │
│  - balanceOf = shares, getQRLValue = QRL equivalent         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  ValidatorManager.sol                       │
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
│   ├── solidity/             #   Solidity sources (source of truth)
│   │   ├── stQRL-v2.sol      #     Fixed-balance liquid staking token
│   │   ├── DepositPool-v2.sol#     Deposits, withdrawals, reward sync
│   │   └── ValidatorManager.sol #  Validator lifecycle tracking
│   ├── hyperion/             #   Auto-synced Hyperion mirrors (.hyp)
│   │   └── README.md         #     Dialect rules and hypc workflow
│   └── test/                 #   Foundry test suite (216 tests)
│       ├── stQRL-v2.t.sol    #     68 core token tests
│       ├── DepositPool-v2.t.sol  # 93 deposit/withdrawal tests
│       ├── ValidatorManager.t.sol # 55 validator lifecycle tests
│       └── hyperion/         #     Generated .t.hyp mirrors (reference only)
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
| `stQRL-v2.sol` | 576 | Fixed-balance liquid staking token (shares-based, min-stake maturity lock) |
| `DepositPool-v2.sol` | 889 | User entry point, deposits/withdrawals, trustless reward sync |
| `ValidatorManager.sol` | 349 | Validator lifecycle: Pending → Active → Exiting → Exited |

All on-chain code lives under `contracts/`. Solidity sources in `contracts/solidity/` are the canonical editing target; Hyperion mirrors in `contracts/hyperion/` are generated from them (never hand-edit). Foundry tests live in `contracts/test/` with a parallel `contracts/test/hyperion/` tree of reference `.t.hyp` mirrors. Compiled Hyperion artifacts land in `build/hyperion/` (gitignored).

## How Fixed-Balance Model Works

1. User deposits 100 QRL when pool has 1000 QRL and 1000 shares
2. User receives 100 shares, `balanceOf()` = 100 shares
3. Validators earn 50 QRL rewards (pool now has 1050 QRL)
4. User's `balanceOf()` still = **100 shares** (unchanged, tax-friendly)
5. User's `getQRLValue()` = 100 × 1050 / 1000 = **105 QRL**

If slashing occurs (pool drops to 950 QRL):
- User's `balanceOf()` still = **100 shares**
- User's `getQRLValue()` = 100 × 950 / 1000 = **95 QRL**
- Loss distributed proportionally to all holders

## How Withdrawals Work

Unstaking is a two-step flow. The QRL is never burned; the stQRL shares are.

1. **Request** (`requestWithdrawal(shares)`): your shares are locked (non-transferable, still on your balance) and the payout is snapshotted at the current exchange rate. A 128-block delay (~2 hours) starts. You can `cancelWithdrawal()` any time before claiming; the shares simply unlock.
2. **Claim** (`claimWithdrawal()`, FIFO per account): after the delay, the locked shares are burned (sent to the zero address, total supply decreases) and you receive exactly the snapshotted QRL amount from the withdrawal reserve. Rate movements between request and claim neither help nor hurt you; rewards earned in that window go to the remaining holders.

**Example:** you hold 1,000 stQRL at rate 1.05. Request locks the shares and snapshots 1,050 QRL. After 128 blocks you claim: 1,000 stQRL burns, you receive 1,050 QRL, even if the rate moved to 1.06 while you waited.

### Where does the claim QRL come from?

The withdrawal reserve never holds the full TVL; it only covers pending claims. Pooled QRL lives in three places (all visible on-chain): validators (40,000 QRL each, staked on the beacon chain), the deposit buffer (accumulating toward the next validator), and the withdrawal reserve. Claims are sourced in this order:

1. **Deposit flow first**: QRL in the buffer is reclassified into the reserve, so withdrawals are netted against incoming stake.
2. **Validator exit if needed**: validator stake is all-or-nothing; you cannot partially withdraw from a validator. If the buffer cannot cover pending claims, one validator exits fully, its 40,000 QRL returns, claims are paid, and the remainder goes back to the buffer.

So if 5 validators are full and someone claims a 5,000 QRL position, that 5,000 comes from the buffer/new deposits if available, otherwise one validator exits and the leftover 35,000 refills the buffer. Same model as Lido and Rocket Pool.

### Is there a cap?

Deposits are uncapped. The limit is on the claim side: you can always *request* a withdrawal, but `claimWithdrawal()` reverts until the reserve covers your amount (worst case, one validator-exit cycle). Fresh deposits also carry a minimum stake lock (default ~1 day) before the shares can transfer or enter a withdrawal request; this is anti-griefing protection, not a withdrawal queue.

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

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- `hypc` for Hyperion compilation/deployment

### Build

```bash
forge build
```

### Test

```bash
forge test
```

### Test with verbosity

```bash
forge test -vvv
```

### Hyperion workflow

```bash
npm run sync:hyperion
npm run compile:hyperion
npm run deploy:hyperion
```

See `contracts/hyperion/README.md` for the dedicated Hyperion layout and deploy config.

### CI

GitHub Actions runs `forge fmt --check`, `forge build --sizes`, and `forge test -vvv` on every push and pull request.

## Test Coverage

- **216 tests passing** (68 stQRL-v2 + 93 DepositPool-v2 + 55 ValidatorManager)
- Share/QRL conversion math, multi-user rewards, slashing scenarios
- Withdrawal flow with 128-block delay enforcement
- Validator lifecycle (registration, activation, exit, slashing)
- Virtual shares to prevent first-depositor attacks
- Access control, pause functionality, and reentrancy protection
- Fuzz testing for edge cases

## Status

**v2.2 live on QRL v2 testnet** with two funded validators, full integration test coverage, and the staking frontend serving at [quantapool.com](https://quantapool.com) and [quantapool.io](https://quantapool.io). A v2.3 redeploy is pending to ship the off-contract stake accounting fix (PR #20); until then the real `fundValidator()` beacon path stays off-limits on the live pool. Addresses and operational detail: `docs/V2-DEPLOYMENT-STATUS.md`.

### Roadmap

- [x] v2 fixed-balance contracts with audit remediations
- [x] Validator infrastructure (Terraform + Ansible)
- [x] Monitoring and alerting stack
- [x] Key management tooling
- [x] Deploy v2 contracts to QRL v2 testnet (v2.2, two validators funded)
- [x] Staking frontend live at quantapool.com and quantapool.io
- [ ] Redeploy as v2.3 with the off-contract stake accounting fix
- [ ] Integrate staking UI into [qrlwallet.com](https://qrlwallet.com)

## Security

- Slither static analysis completed (0 critical/high findings)
- Virtual shares (1e3) to prevent first-depositor/inflation attacks
- See `slither-report.txt` for full analysis results

## Acknowledgments

- [Lido](https://lido.fi/) and [Rocket Pool](https://rocketpool.net/) for pioneering liquid staking designs
- [The QRL Core Team](https://www.theqrl.org/) for building post-quantum secure blockchain infrastructure
- [Robyer](https://github.com/robyer) for community feedback on the fixed-balance token model (tax implications of rebasing)

## License

GPL-3.0
