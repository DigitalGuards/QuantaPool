# Rocket Pool Reading Guide for QuantaPool MVP

## Philosophy

Keep it simple. Rocket Pool has ~50+ contracts built over years. QuantaPool MVP needs 4.

## Essential Reading (Study These)

### 1. rETH Token → stQRL
**File:** `vendor/rocketpool/contracts/contract/token/RocketTokenRETH.sol`

What to learn:
- Exchange rate calculation (`getEthValue`, `getRethValue`)
- Mint/burn mechanics
- How they track total collateral

Skip:
- Deposit delay logic (lines ~80-120) - overengineered for MVP

### 2. Deposit Pool → DepositPool
**File:** `vendor/rocketpool/contracts/contract/deposit/RocketDepositPool.sol`

What to learn:
- Basic deposit flow
- How they queue funds before validator creation
- Excess deposit handling

Skip:
- `assignDeposits()` complexity - they have elaborate assignment logic
- Variable deposit pool sizes

### 3. Minipool Base
**File:** `vendor/rocketpool/contracts/contract/minipool/RocketMinipoolBase.sol`

What to learn:
- Validator lifecycle states (Initialized → Staking → Withdrawable)
- How operator bond + pool funds combine

Skip:
- Delegate pattern - overkill for MVP
- Upgrade mechanisms

## Reference Only (Skim for Ideas)

| RP Contract | Purpose | QuantaPool Approach |
|-------------|---------|---------------------|
| RocketStorage.sol | Eternal storage | Use simple proxy instead |
| RocketNodeManager.sol | Node registration | Single operator for MVP |
| RocketDAOProtocol*.sol | Governance | Skip entirely |
| RocketRewardsPool.sol | RPL distribution | No governance token |
| RocketNetworkPrices.sol | Oracle feeds | Simple trusted oracle |

## Don't Read (Not Relevant for MVP)

- `contract/dao/*` - Complex governance
- `contract/auction/*` - RPL auctions
- `contract/rewards/*` - RPL staking rewards
- `contract/old/*` - Deprecated code
- Most of `interface/` - 90% is for features you won't build

## QuantaPool MVP Contract Map

```
Rocket Pool (complex)          →  QuantaPool MVP (simple)
─────────────────────────────────────────────────────────
RocketTokenRETH.sol            →  stQRL.sol (ERC-4626)
RocketDepositPool.sol          →  DepositPool.sol
RocketMinipoolBase.sol         →  Minipool.sol (simplified)
RocketNodeStaking.sol          →  OperatorRegistry.sol
RocketNetworkBalances.sol      →  RewardsOracle.sol
RocketStorage.sol              →  (not needed - use proxy)
RocketDAOProtocol*.sol         →  (not needed)
```

## Key Code Snippets to Port

### Exchange Rate (from RocketTokenRETH.sol)

```solidity
// Their version (lines 60-70ish)
function getEthValue(uint256 _rethAmount) public view returns (uint256) {
    uint256 rethSupply = totalSupply();
    if (rethSupply == 0) { return _rethAmount; }
    return _rethAmount * getTotalCollateral() / rethSupply;
}

// Your version (simpler with ERC-4626)
function convertToAssets(uint256 shares) public view returns (uint256) {
    uint256 supply = totalSupply();
    return supply == 0 ? shares : shares * totalAssets() / supply;
}
```

### Deposit (from RocketDepositPool.sol)

```solidity
// Their version has lots of checks, assignments, etc.
// Your version - just the core:
function deposit() external payable {
    uint256 shares = stQRL.convertToShares(msg.value);
    stQRL.mint(msg.sender, shares);
    pendingDeposits += msg.value;
    emit Deposited(msg.sender, msg.value, shares);
}
```

## Wallet Integration Path

After MVP contracts work:

1. Add stQRL as custom token in myqrlwallet
2. Build simple stake/unstake UI
3. Show exchange rate + user's QRL value
4. Display pending queue position

Keep the interface minimal - deposit button, withdraw button, balance display. That's it.
