# OperatorRegistry Contract Specification

## Overview

OperatorRegistry manages node operators, their bonds, validators, and minipool contracts. It handles operator registration, validator creation, commission distribution, and slashing protection.

## Contract Details

| Property | Value |
|----------|-------|
| Purpose | Operator and validator management |
| Validator Size | 40,000 QRL |
| Bond Options | 10,000 QRL (Quarter) or 20,000 QRL (Half) |
| Commission Range | 10-15% |
| MVP Model | Single operator (self) |

## State Variables

```solidity
// Reference to deposit pool
IDepositPool public depositPool;

// Reference to stQRL
IStakedQRL public stQRL;

// Registered operators
mapping(address => Operator) public operators;

// Active operator addresses
address[] public operatorList;

// Minipools by operator
mapping(address => address[]) public operatorMinipools;

// All active validators
bytes[] public activeValidators;

// Validator to minipool mapping
mapping(bytes => address) public validatorMinipool;

// Commission rate (basis points, e.g., 1000 = 10%)
uint256 public commissionRate;

// Minimum collateral required per minipool
uint256 public minCollateral;

// Operator queue index
uint256 public nextOperatorIndex;

struct Operator {
    bool registered;
    bool active;
    uint256 bondAmount;         // Quarter (10k) or Half (20k)
    uint256 collateral;         // Slashing protection
    uint256 validatorCount;     // Active validators
    uint256 pendingRewards;     // Unclaimed commission
}
```

## Core Functions

### registerOperator(uint256 bondType)

Register as node operator with bond.

```solidity
function registerOperator(uint256 bondType) external payable nonReentrant {
    require(!operators[msg.sender].registered, "Already registered");

    uint256 requiredBond;
    if (bondType == 0) {
        requiredBond = 10_000 ether; // Quarter bond
    } else if (bondType == 1) {
        requiredBond = 20_000 ether; // Half bond
    } else {
        revert("Invalid bond type");
    }

    require(msg.value >= requiredBond + minCollateral, "Insufficient bond + collateral");

    operators[msg.sender] = Operator({
        registered: true,
        active: true,
        bondAmount: requiredBond,
        collateral: msg.value - requiredBond,
        validatorCount: 0,
        pendingRewards: 0
    });

    operatorList.push(msg.sender);

    emit OperatorRegistered(msg.sender, requiredBond, msg.value - requiredBond);
}
```

### createMinipool(address operator)

Creates validator minipool. Called by DepositPool when threshold reached.

```solidity
function createMinipool(address operator) external payable onlyDepositPool returns (address) {
    Operator storage op = operators[operator];
    require(op.active, "Operator not active");

    uint256 pooledAmount = msg.value;
    uint256 totalStake = op.bondAmount + pooledAmount;
    require(totalStake == 40_000 ether, "Invalid stake amount");

    // Deploy minipool contract
    Minipool minipool = new Minipool{value: op.bondAmount}(
        operator,
        pooledAmount,
        commissionRate
    );

    // Transfer pooled funds to minipool
    payable(address(minipool)).transfer(pooledAmount);

    // Record minipool
    operatorMinipools[operator].push(address(minipool));
    op.validatorCount++;

    emit MinipoolCreated(operator, address(minipool), op.bondAmount, pooledAmount);

    return address(minipool);
}
```

### registerValidator(bytes calldata pubkey, address minipool)

Associates validator public key with minipool.

```solidity
function registerValidator(
    bytes calldata pubkey,
    address minipool
) external onlyMinipool(minipool) {
    require(validatorMinipool[pubkey] == address(0), "Validator already registered");

    validatorMinipool[pubkey] = minipool;
    activeValidators.push(pubkey);

    emit ValidatorRegistered(pubkey, minipool);
}
```

### applyCommission(uint256 rewards)

Calculates and distributes commission. Called by RewardsOracle.

```solidity
function applyCommission(uint256 rewards) external onlyOracle returns (uint256 netRewards) {
    uint256 totalCommission = rewards * commissionRate / 10000;

    // Distribute commission proportionally to operators
    uint256 totalValidators = activeValidators.length;
    if (totalValidators == 0) return rewards;

    uint256 commissionPerValidator = totalCommission / totalValidators;

    for (uint256 i = 0; i < operatorList.length; i++) {
        Operator storage op = operators[operatorList[i]];
        if (op.validatorCount > 0) {
            op.pendingRewards += commissionPerValidator * op.validatorCount;
        }
    }

    netRewards = rewards - totalCommission;
    emit CommissionApplied(totalCommission, netRewards);
}
```

### claimRewards()

Operator claims accumulated commission.

```solidity
function claimRewards() external nonReentrant {
    Operator storage op = operators[msg.sender];
    require(op.registered, "Not an operator");

    uint256 rewards = op.pendingRewards;
    require(rewards > 0, "No rewards to claim");

    op.pendingRewards = 0;
    payable(msg.sender).transfer(rewards);

    emit RewardsClaimed(msg.sender, rewards);
}
```

### slashOperator(address operator, uint256 amount)

Slash operator collateral for misbehavior.

```solidity
function slashOperator(address operator, uint256 amount) external onlyOwner {
    Operator storage op = operators[operator];
    require(op.registered, "Not an operator");

    uint256 slashAmount = amount > op.collateral ? op.collateral : amount;
    op.collateral -= slashAmount;

    // Transfer slashed funds to deposit pool (compensate users)
    depositPool.addLiquidity{value: slashAmount}();

    // Deactivate if collateral depleted
    if (op.collateral < minCollateral) {
        op.active = false;
        emit OperatorDeactivated(operator, "Insufficient collateral");
    }

    emit OperatorSlashed(operator, slashAmount);
}
```

## View Functions

### getNextOperator()

Returns next operator in queue for validator creation.

```solidity
function getNextOperator() external view returns (address) {
    if (operatorList.length == 0) return address(0);

    // Round-robin through active operators
    uint256 startIndex = nextOperatorIndex;
    uint256 i = startIndex;

    do {
        address op = operatorList[i];
        if (operators[op].active) {
            return op;
        }
        i = (i + 1) % operatorList.length;
    } while (i != startIndex);

    return address(0); // No active operators
}
```

### getOperatorBond(address operator)

Returns operator's bond amount.

```solidity
function getOperatorBond(address operator) external view returns (uint256) {
    return operators[operator].bondAmount;
}
```

### getActiveValidators()

Returns all active validator public keys.

```solidity
function getActiveValidators() external view returns (bytes[] memory) {
    return activeValidators;
}
```

### getOperatorStats(address operator)

Returns operator statistics.

```solidity
function getOperatorStats(address operator) external view returns (
    bool active,
    uint256 bondAmount,
    uint256 collateral,
    uint256 validatorCount,
    uint256 pendingRewards
) {
    Operator storage op = operators[operator];
    return (
        op.active,
        op.bondAmount,
        op.collateral,
        op.validatorCount,
        op.pendingRewards
    );
}
```

## Admin Functions

### setCommissionRate(uint256 _rate)

Updates commission rate.

```solidity
function setCommissionRate(uint256 _rate) external onlyOwner {
    require(_rate >= 500 && _rate <= 2000, "Rate must be 5-20%");
    commissionRate = _rate;
    emit CommissionRateUpdated(_rate);
}
```

### setMinCollateral(uint256 _minCollateral)

Updates minimum collateral requirement.

```solidity
function setMinCollateral(uint256 _minCollateral) external onlyOwner {
    minCollateral = _minCollateral;
    emit MinCollateralUpdated(_minCollateral);
}
```

### deactivateOperator(address operator)

Admin deactivation of operator.

```solidity
function deactivateOperator(address operator) external onlyOwner {
    operators[operator].active = false;
    emit OperatorDeactivated(operator, "Admin action");
}
```

## Events

```solidity
event OperatorRegistered(address indexed operator, uint256 bond, uint256 collateral);
event OperatorDeactivated(address indexed operator, string reason);
event MinipoolCreated(address indexed operator, address minipool, uint256 bond, uint256 pooled);
event ValidatorRegistered(bytes pubkey, address indexed minipool);
event CommissionApplied(uint256 totalCommission, uint256 netRewards);
event RewardsClaimed(address indexed operator, uint256 amount);
event OperatorSlashed(address indexed operator, uint256 amount);
event CommissionRateUpdated(uint256 newRate);
event MinCollateralUpdated(uint256 newMinCollateral);
```

## Access Control

| Function | Access |
|----------|--------|
| registerOperator | public (with payment) |
| createMinipool | depositPool only |
| registerValidator | minipool only |
| applyCommission | oracle only |
| claimRewards | registered operators |
| slashOperator | owner only |
| setCommissionRate | owner only |
| deactivateOperator | owner only |

## Minipool Contract

Each operator's validator runs through a Minipool contract:

```solidity
contract Minipool {
    address public operator;
    uint256 public operatorBond;
    uint256 public pooledAmount;
    uint256 public commissionRate;
    bytes public validatorPubkey;

    enum Status { Pending, Active, Exiting, Exited }
    Status public status;

    constructor(
        address _operator,
        uint256 _pooledAmount,
        uint256 _commissionRate
    ) payable {
        operator = _operator;
        operatorBond = msg.value;
        pooledAmount = _pooledAmount;
        commissionRate = _commissionRate;
        status = Status.Pending;
    }

    function activateValidator(bytes calldata pubkey) external {
        // Called after validator deposit confirmed on beacon chain
        validatorPubkey = pubkey;
        status = Status.Active;
    }

    function initiateExit() external {
        // Begin validator exit process
        status = Status.Exiting;
    }

    function finalizeExit() external {
        // Called when validator fully exited
        // Distribute funds back to operator and pool
        status = Status.Exited;
    }
}
```

## Security Considerations

### Operator Sybil Attacks

- Minimum bond requirement limits fake operators
- Collateral at risk disincentivizes misbehavior
- Rate limiting on operator registration (optional)

### Collateral Adequacy

- Minimum collateral covers expected slashing losses
- Automatic deactivation if collateral falls below minimum
- Regular collateral health checks

### Commission Manipulation

- Commission rate bounded (5-20%)
- Rate changes require owner action
- Consider timelock for rate changes

## Default Configuration

| Parameter | MVP Value | Production Value |
|-----------|-----------|------------------|
| commissionRate | 1000 (10%) | 1000-1500 (10-15%) |
| minCollateral | 5,000 QRL | 5,000 QRL |
| Quarter Bond | 10,000 QRL | 10,000 QRL |
| Half Bond | 20,000 QRL | 20,000 QRL |

## MVP Simplification

For initial testnet deployment, simplify to single operator:

```solidity
// Simplified MVP - single operator
contract OperatorRegistryMVP {
    address public operator;
    uint256 public operatorBond;
    bytes[] public validators;

    constructor(address _operator) {
        operator = _operator;
    }

    function addValidator(bytes calldata pubkey) external onlyOperator {
        validators.push(pubkey);
    }
}
```
