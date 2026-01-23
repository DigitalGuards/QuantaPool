# QuantaPool v2 Architecture

## Overview

QuantaPool is a decentralized liquid staking protocol for QRL Zond. Users deposit QRL and receive stQRL tokens representing their stake. The protocol uses a **fixed-balance token model** (like Lido's wstETH) where share balances remain constant and QRL value grows with rewards.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         User                                │
└───────────────────────────┬─────────────────────────────────┘
                            │ deposit() / requestWithdrawal()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    DepositPool-v2.sol                       │
│  - Accepts QRL deposits, mints stQRL shares                 │
│  - Manages withdrawal queue (128-block delay)               │
│  - Trustless reward sync via balance checking               │
│  - Funds validators via beacon deposit contract             │
└───────────────────────────┬─────────────────────────────────┘
                            │ mintShares() / burnShares()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      stQRL-v2.sol                           │
│  - Fixed-balance ERC-20 token (shares-based)                │
│  - balanceOf() = shares (stable, tax-friendly)              │
│  - getQRLValue() = QRL equivalent (grows with rewards)      │
│  - Virtual shares prevent first-depositor attacks           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  ValidatorManager.sol                       │
│  - Tracks validator lifecycle (Pending → Active → Exited)   │
│  - Stores Dilithium pubkeys (2592 bytes)                    │
│  - MVP: single trusted operator model                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               Zond Beacon Deposit Contract                  │
│  - 40,000 QRL per validator                                 │
│  - Withdrawal credentials → DepositPool                     │
└─────────────────────────────────────────────────────────────┘
```

## Core Contracts

### stQRL-v2.sol - Liquid Staking Token

**Fixed-balance model** where `balanceOf()` returns shares (stable) and `getQRLValue()` returns QRL equivalent (fluctuates with rewards/slashing).

| Function | Returns | Changes When |
|----------|---------|--------------|
| `balanceOf(user)` | Shares | Only on deposit/withdraw/transfer |
| `getQRLValue(user)` | QRL equivalent | Rewards accrue or slashing occurs |
| `getExchangeRate()` | QRL per share (1e18 scaled) | Rewards/slashing |

**Key Features:**
- Virtual shares/assets (1e3) prevent first-depositor inflation attacks
- All ERC-20 operations work with shares, not QRL amounts
- Tax-friendly: balance only changes on explicit user actions

**Example:**
```
1. User deposits 100 QRL when pool has 1000 QRL / 1000 shares
2. User receives 100 shares, balanceOf() = 100
3. Validators earn 50 QRL rewards (pool now 1050 QRL)
4. User's balanceOf() still = 100 shares (unchanged)
5. User's getQRLValue() = 100 × 1050 / 1000 = 105 QRL
```

### DepositPool-v2.sol - User Entry Point

Handles deposits, withdrawals, and reward synchronization.

**Deposit Flow:**
1. User calls `deposit()` with QRL
2. Contract syncs rewards via `_syncRewards()` (trustless balance check)
3. Shares calculated at current exchange rate
4. `stQRL.mintShares()` called, shares minted to user
5. `totalPooledQRL` updated

**Withdrawal Flow:**
1. User calls `requestWithdrawal(shares)`
2. Shares burned, QRL amount calculated
3. Request queued with 128-block delay (~2 hours)
4. User calls `claimWithdrawal(requestId)` after delay
5. QRL transferred from withdrawal reserve

**Trustless Reward Sync:**
- No oracle needed for reward detection
- `_syncRewards()` compares contract balance to expected
- Balance increase = rewards, decrease = slashing
- EIP-4895 withdrawals automatically credit the contract

**Key Parameters:**
- `WITHDRAWAL_DELAY`: 128 blocks (~2 hours)
- `MIN_DEPOSIT`: 1 ether (configurable)
- `VALIDATOR_STAKE`: 10,000 ether

### ValidatorManager.sol - Validator Lifecycle

Tracks validators through their lifecycle:

```
None → Pending → Active → Exiting → Exited
                    ↓
                 Slashed
```

**State Transitions:**
- `registerValidator(pubkey)` → Pending
- `activateValidator(id)` → Active (confirmed on beacon chain)
- `requestValidatorExit(id)` → Exiting
- `markValidatorExited(id)` → Exited
- `markValidatorSlashed(id)` → Slashed (from Active or Exiting)

**Access Control:**
- Owner can perform all operations (trusted operator MVP)
- DepositPool can register validators

## Security Model

### Access Control

| Contract | Role | Capabilities |
|----------|------|--------------|
| stQRL | Owner | Set depositPool (once), pause/unpause |
| stQRL | DepositPool | Mint/burn shares, update totalPooledQRL |
| DepositPool | Owner | Pause, set parameters, emergency withdraw excess |
| ValidatorManager | Owner | All validator state transitions |

### Attack Mitigations

| Attack | Mitigation |
|--------|------------|
| First depositor inflation | Virtual shares/assets (1e3 offset) |
| Reentrancy | CEI pattern, no external calls before state changes |
| Withdrawal front-running | 128-block delay, FIFO queue |
| Emergency fund drain | emergencyWithdraw limited to excess balance only |

### Slashing Protection

When slashing occurs:
1. `_syncRewards()` detects balance decrease
2. `totalPooledQRL` reduced proportionally
3. All stQRL holders share the loss via reduced `getQRLValue()`
4. Share balances unchanged (loss is implicit)

## Zond-Specific Adaptations

| Parameter | Ethereum | QRL Zond |
|-----------|----------|----------|
| Validator stake | 32 ETH | 40,000 QRL |
| Block time | ~12s | ~60s |
| Signature scheme | ECDSA | Dilithium (ML-DSA-87) |
| Pubkey size | 48 bytes | 2,592 bytes |
| Signature size | 96 bytes | ~2,420 bytes |

## Test Coverage

- **173 tests** across 3 test suites
- stQRL-v2: 55 tests (shares, conversions, rewards, slashing)
- DepositPool-v2: 63 tests (deposits, withdrawals, sync, access control)
- ValidatorManager: 55 tests (lifecycle, slashing, batch operations)

## Deployment Checklist

1. Deploy stQRL-v2
2. Deploy ValidatorManager
3. Deploy DepositPool-v2
4. Call `stQRL.setDepositPool(depositPool)` (one-time)
5. Call `depositPool.setStQRL(stQRL)` (one-time)
6. Call `validatorManager.setDepositPool(depositPool)`
7. Transfer ownership to multisig (optional for mainnet)

## Future Improvements

- [ ] Multi-operator support (permissionless registration)
- [ ] Two-step ownership transfer pattern
- [ ] Pagination for `getValidatorsByStatus()`
- [ ] On-chain integration between DepositPool and ValidatorManager
