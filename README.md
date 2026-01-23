# QuantaPool

Decentralized liquid staking protocol for QRL Zond. Deposit QRL, receive stQRL, earn validator rewards automatically.

## Overview

QuantaPool enables QRL holders to participate in Proof-of-Stake validation without running their own validator nodes. Users deposit QRL and receive stQRL, a rebasing token whose balance automatically adjusts as validators earn rewards or experience slashing.

### Key Features

- **Liquid Staking**: Receive stQRL tokens that can be transferred while underlying QRL earns rewards
- **Rebasing Token**: Balance increases automatically as validators earn rewards (Lido-style)
- **Slashing-Safe**: Rebasing design handles slashing events by proportionally reducing all holders' balances
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
│  - Rebasing ERC-20 token                                    │
│  - Shares-based accounting (Lido-style)                     │
│  - balanceOf = shares × totalPooledQRL / totalShares        │
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
| `stQRL-v2.sol` | Rebasing liquid staking token |
| `DepositPool-v2.sol` | User entry point, deposits/withdrawals, reward sync |
| `ValidatorManager.sol` | Validator lifecycle tracking |

## How Rebasing Works

1. User deposits 100 QRL when pool has 1000 QRL and 1000 shares
2. User receives 100 shares, balance shows 100 QRL
3. Validators earn 50 QRL rewards (pool now has 1050 QRL)
4. User's balance = 100 × 1050 / 1000 = **105 QRL**
5. User's shares unchanged, but balance "rebased" upward

If slashing occurs (pool drops to 950 QRL):
- User's balance = 100 × 950 / 1000 = **95 QRL**
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

- **46 tests passing** (stQRL-v2 + DepositPool-v2)
- Rebasing math, multi-user rewards, slashing scenarios
- Withdrawal flow with delay enforcement
- Access control and pause functionality
- Fuzz testing for edge cases

## Status

**v2 contracts ready** - awaiting Zond testnet deployment.

### Roadmap

- [ ] Deploy v2 contracts to Zond testnet
- [ ] Integrate staking UI into [qrlwallet.com](https://qrlwallet.com)
- [ ] Add wstQRL wrapper (non-rebasing, for DeFi compatibility)

## Security

- Slither static analysis completed (0 critical/high findings)
- See `slither-report.txt` for full audit results

## License

GPL-3.0
