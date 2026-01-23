# QuantaPool Contract Architecture

## Overview

QuantaPool uses the **ERC-4626 vault pattern** as its foundation, providing a standardized interface for liquid staking. The architecture is inspired by Rocket Pool but simplified for MVP development.

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DepositPool                              │
│  - Accepts QRL deposits                                         │
│  - Mints stQRL tokens                                           │
│  - Queues deposits until 40,000 QRL threshold                   │
│  - Processes withdrawals                                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
┌───────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│      stQRL        │ │  RewardsOracle  │ │  OperatorRegistry   │
│  (ERC-4626 Vault) │ │                 │ │                     │
│                   │ │ - Updates rates │ │ - Tracks validators │
│ - Liquid token    │ │ - Reports       │ │ - Manages minipools │
│ - Exchange rate   │ │   validator     │ │ - Operator bonds    │
│   accumulation    │ │   balances      │ │                     │
└───────────────────┘ └─────────────────┘ └─────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Zond Validators     │
                    │   (go-zond + qrysm)   │
                    │                       │
                    │   40,000 QRL each     │
                    └───────────────────────┘
```

## Core Contracts

### 1. stQRL (Liquid Staking Token)

The stQRL token is an **ERC-4626 compliant vault** that represents staked QRL. Key characteristics:

- **Exchange Rate Model**: Token balance stays constant; underlying QRL value increases
- **Formula**: `stQRL:QRL ratio = total QRL staked / total stQRL supply`
- **ZRC20 Compatible**: Works across Zond DeFi ecosystem

```solidity
contract StakedQRL is ERC4626, Ownable, ReentrancyGuard {
    function totalAssets() public view override returns (uint256) {
        return _asset.balanceOf(address(this)) + pendingRewards;
    }

    function getExchangeRate() external view returns (uint256) {
        return totalAssets() * 1e18 / totalSupply();
    }
}
```

### 2. DepositPool

Entry point for all user interactions:

- Accepts QRL deposits of any amount
- Mints stQRL at current exchange rate
- Accumulates deposits in queue until 40,000 QRL threshold
- Triggers validator creation when threshold met
- Processes withdrawal requests (unlocks at epoch end)

### 3. RewardsOracle

Updates the stQRL exchange rate based on validator performance:

- **MVP**: Single trusted operator submits balances off-chain
- **Future**: Multi-party oracle with 3-of-5 threshold signatures
- Updates approximately every 24 hours
- Reports total validator balances across all minipools

### 4. OperatorRegistry

Manages node operators and their validators:

- Tracks operator bonds (10,000-20,000 QRL)
- Records validator public keys (Dilithium)
- Links validators to minipool contracts
- **MVP**: Single operator (self)
- **Future**: Permissionless operator registration

## Interaction Flows

### Deposit Flow

```
1. User calls DepositPool.deposit(amount)
2. DepositPool calculates stQRL to mint based on exchange rate
3. stQRL.mint(user, shares)
4. QRL added to pending queue
5. When queue >= 40,000 QRL:
   - Operator creates validator via OperatorRegistry
   - Funds moved to validator deposit contract
```

### Withdrawal Flow

```
1. User calls DepositPool.withdraw(shares)
2. Calculate QRL amount from exchange rate
3. stQRL.burn(user, shares)
4. If liquid QRL available: immediate transfer
5. If not: queue withdrawal, process at epoch end (~50-100 min)
```

### Rewards Distribution

```
1. Validators earn consensus rewards (block proposals, attestations)
2. RewardsOracle.submitBalances() called periodically
3. Exchange rate updated: stQRL now worth more QRL
4. No rebasing - user balance unchanged, value increased
```

## Upgrade Path

### MVP (Testnet)
- Single operator
- Centralized oracle
- Basic deposit/withdraw
- OpenZeppelin proxy for upgrades

### V1 (Mainnet Launch)
- TVL caps ($10k-$50k)
- Emergency pause functionality
- Admin multisig (3-of-5)

### V2 (Post-Launch)
- Multi-operator support
- Decentralized oracle network
- Permissionless operator registration
- Potential governance token

## Security Considerations

- **Reentrancy Protection**: All state changes before external calls
- **Access Control**: Role-based permissions for admin functions
- **Upgrade Safety**: Transparent proxy pattern with timelock
- **Slashing Protection**: Operator bonds cover pool losses

## Zond-Specific Adaptations

| Ethereum Pattern | Zond Adaptation |
|------------------|-----------------|
| `ecrecover` | Dilithium signature verification |
| 32 ETH validators | 40,000 QRL validators |
| ~12s blocks | ~60s blocks |
| Fast finality | 4-6 hour finality |
| Small signatures | ~2.5KB Dilithium signatures |
