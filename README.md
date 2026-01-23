# QuantaPool

Decentralized liquid staking protocol for QRL Zond. Deposit QRL, receive stQRL, earn validator rewards automatically.

## Overview

QuantaPool enables QRL holders to participate in Proof-of-Stake validation without running their own validator nodes. Users deposit QRL and receive stQRL, a fixed-balance token where `balanceOf()` returns stable shares and `getQRLValue()` returns the current QRL equivalent (which grows with rewards).

### Key Features

- **Liquid Staking**: Receive stQRL tokens that can be transferred while underlying QRL earns rewards
- **Fixed-Balance Token**: Share balance stays constant (tax-friendly), QRL value grows with rewards
- **Slashing-Safe**: Fixed-balance design handles slashing by proportionally reducing all holders' QRL value
- **Trustless Sync**: No oracle needed - rewards detected via EIP-4895 balance increases
- **Post-Quantum Secure**: Built on QRL's Dilithium signature scheme

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
│  - Funds validators (MVP: stays in contract)                │
└───────────────────────────┬─────────────────────────────────┘
                            │ mintShares() / burnShares()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      stQRL-v2.sol                           │
│  - Fixed-balance ERC-20 token                               │
│  - Shares-based accounting (wstETH-style)                   │
│  - balanceOf = shares, getQRLValue = QRL equivalent         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  ValidatorManager.sol                       │
│  - Tracks validator states (pending → active → exited)      │
│  - MVP: single trusted operator model                       │
└─────────────────────────────────────────────────────────────┘
```

## Contracts

| Contract | Purpose |
|----------|---------|
| `stQRL-v2.sol` | Fixed-balance liquid staking token |
| `DepositPool-v2.sol` | User entry point, deposits/withdrawals, reward sync |
| `ValidatorManager.sol` | Validator lifecycle tracking |

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

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)

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

## Test Coverage

- **173 tests passing** (55 stQRL-v2 + 63 DepositPool-v2 + 55 ValidatorManager)
- Share/QRL conversion math, multi-user rewards, slashing scenarios
- Withdrawal flow with delay enforcement
- Validator lifecycle (registration, activation, exit, slashing)
- Access control and pause functionality
- All error paths and revert conditions
- Event emission verification
- Admin functions (ownership, pause, emergency)
- Fuzz testing for edge cases

## Status

**v2 contracts ready** - awaiting Zond testnet deployment.

### Roadmap

- [ ] Deploy v2 contracts to Zond testnet
- [ ] Integrate staking UI into [qrlwallet.com](https://qrlwallet.com)

## Security

- Slither static analysis completed (0 critical/high findings)
- See `slither-report.txt` for full audit results

## Acknowledgments

- [Lido](https://lido.fi/) and [Rocket Pool](https://rocketpool.net/) for pioneering liquid staking designs
- [The QRL Core Team](https://www.theqrl.org/) for building post-quantum secure blockchain infrastructure
- [Robyer](https://github.com/robyer) for community feedback on the fixed-balance token model (tax implications of rebasing)

## License

GPL-3.0
