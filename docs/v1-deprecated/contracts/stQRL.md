# stQRL Contract Specification

## Overview

stQRL is the liquid staking token for QuantaPool. It implements the ERC-4626 tokenized vault standard, providing a standardized interface for deposit/withdrawal while automatically handling share accounting.

## Contract Details

| Property | Value |
|----------|-------|
| Name | Staked QRL |
| Symbol | stQRL |
| Decimals | 18 |
| Standard | ERC-4626 (extends ERC-20) |
| Underlying Asset | QRL (native token) |

## Inheritance

```
ERC4626
  └── ERC20
       └── IERC20
            └── IERC20Metadata

Additional:
  ├── Ownable
  ├── ReentrancyGuard
  └── Pausable
```

## State Variables

```solidity
// Total rewards pending distribution (updated by oracle)
uint256 public pendingRewards;

// Last exchange rate update timestamp
uint256 public lastUpdateTimestamp;

// Authorized oracle address
address public rewardsOracle;

// Authorized deposit pool address
address public depositPool;

// Emergency pause state
bool public paused;
```

## Core Functions

### ERC-4626 Implementation

#### totalAssets()

Returns total QRL controlled by the vault (deposits + rewards).

```solidity
function totalAssets() public view override returns (uint256) {
    return address(this).balance + pendingRewards;
}
```

#### convertToShares(uint256 assets)

Converts QRL amount to stQRL shares.

```solidity
function convertToShares(uint256 assets) public view override returns (uint256) {
    uint256 supply = totalSupply();
    return supply == 0 ? assets : assets * supply / totalAssets();
}
```

#### convertToAssets(uint256 shares)

Converts stQRL shares to QRL amount.

```solidity
function convertToAssets(uint256 shares) public view override returns (uint256) {
    uint256 supply = totalSupply();
    return supply == 0 ? shares : shares * totalAssets() / supply;
}
```

### Custom Functions

#### getExchangeRate()

Returns current QRL per stQRL ratio (scaled by 1e18).

```solidity
function getExchangeRate() external view returns (uint256) {
    uint256 supply = totalSupply();
    if (supply == 0) return 1e18;
    return totalAssets() * 1e18 / supply;
}
```

#### updateRewards(uint256 newRewards)

Called by oracle to update pending rewards.

```solidity
function updateRewards(uint256 newRewards) external onlyOracle {
    pendingRewards = newRewards;
    lastUpdateTimestamp = block.timestamp;
    emit RewardsUpdated(newRewards, block.timestamp);
}
```

#### mint(address to, uint256 shares)

Mints stQRL to depositor. Only callable by DepositPool.

```solidity
function mint(address to, uint256 shares) external onlyDepositPool returns (uint256) {
    _mint(to, shares);
    return shares;
}
```

#### burn(address from, uint256 shares)

Burns stQRL on withdrawal. Only callable by DepositPool.

```solidity
function burn(address from, uint256 shares) external onlyDepositPool returns (uint256) {
    _burn(from, shares);
    return convertToAssets(shares);
}
```

## Access Control

| Function | Access |
|----------|--------|
| updateRewards | rewardsOracle only |
| mint | depositPool only |
| burn | depositPool only |
| setOracle | owner only |
| setDepositPool | owner only |
| pause/unpause | owner only |

## Events

```solidity
event RewardsUpdated(uint256 newRewards, uint256 timestamp);
event OracleUpdated(address indexed oldOracle, address indexed newOracle);
event DepositPoolUpdated(address indexed oldPool, address indexed newPool);
event Paused(address account);
event Unpaused(address account);
```

## Security Considerations

### Reentrancy Protection

All external functions that modify state use `nonReentrant` modifier.

### Pausability

Emergency pause halts:
- mint()
- burn()
- transfer()
- transferFrom()

### Exchange Rate Manipulation

- Only authorized oracle can update rewards
- Rate changes capped per update (optional)
- Timestamp validation prevents stale updates

### Rounding

- Deposits: round down (favor protocol)
- Withdrawals: round down (favor protocol)
- This prevents share inflation attacks

## Example Usage

### Checking Value of Holdings

```javascript
const stQRL = new web3.zond.Contract(stQRLAbi, stQRLAddress);

// Get user's stQRL balance
const shares = await stQRL.methods.balanceOf(userAddress).call();

// Convert to underlying QRL value
const qrlValue = await stQRL.methods.convertToAssets(shares).call();

// Get current exchange rate
const rate = await stQRL.methods.getExchangeRate().call();
console.log(`1 stQRL = ${rate / 1e18} QRL`);
```

## Hyperion Implementation Notes

```solidity
// SPDX-License-Identifier: MIT
pragma hyperion ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract StakedQRL is ERC4626, Ownable, ReentrancyGuard, Pausable {
    // Implementation
}
```

**Note**: OpenZeppelin contracts must be verified for Hyperion compatibility. Some imports may require adaptation.
