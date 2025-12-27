# DepositPool Contract Specification

## Overview

DepositPool is the primary entry point for users interacting with QuantaPool. It handles QRL deposits, stQRL minting, withdrawal processing, and manages the queue for validator creation.

## Contract Details

| Property | Value |
|----------|-------|
| Purpose | User deposits and withdrawals |
| Validator Threshold | 40,000 QRL |
| Dependencies | stQRL, RewardsOracle, OperatorRegistry |

## State Variables

```solidity
// Reference to stQRL token contract
IStakedQRL public stQRL;

// Reference to rewards oracle
IRewardsOracle public rewardsOracle;

// Reference to operator registry
IOperatorRegistry public operatorRegistry;

// QRL waiting to be staked (below threshold)
uint256 public pendingDeposits;

// QRL available for immediate withdrawals
uint256 public liquidReserve;

// Minimum deposit amount (prevents dust)
uint256 public minDeposit;

// Withdrawal requests queue
mapping(address => WithdrawalRequest) public withdrawalRequests;

// Total pending withdrawal amount
uint256 public pendingWithdrawals;

struct WithdrawalRequest {
    uint256 shares;          // stQRL to burn
    uint256 requestEpoch;    // Epoch when requested
    bool processed;          // Whether fulfilled
}
```

## Core Functions

### deposit()

Accepts QRL and mints stQRL to depositor.

```solidity
function deposit() external payable nonReentrant whenNotPaused returns (uint256 shares) {
    require(msg.value >= minDeposit, "Below minimum deposit");

    // Calculate shares at current exchange rate
    shares = stQRL.convertToShares(msg.value);

    // Mint stQRL to depositor
    stQRL.mint(msg.sender, shares);

    // Add to pending deposits
    pendingDeposits += msg.value;

    // Check if threshold reached
    _checkThreshold();

    emit Deposited(msg.sender, msg.value, shares);
    return shares;
}
```

### withdraw(uint256 shares)

Initiates withdrawal by queueing request.

```solidity
function withdraw(uint256 shares) external nonReentrant whenNotPaused returns (uint256 assets) {
    require(shares > 0, "Zero shares");
    require(stQRL.balanceOf(msg.sender) >= shares, "Insufficient balance");

    assets = stQRL.convertToAssets(shares);

    // Check if immediate withdrawal possible
    if (liquidReserve >= assets) {
        // Immediate withdrawal
        liquidReserve -= assets;
        stQRL.burn(msg.sender, shares);
        payable(msg.sender).transfer(assets);
        emit Withdrawn(msg.sender, assets, shares, true);
    } else {
        // Queue for next epoch
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            shares: shares,
            requestEpoch: _currentEpoch(),
            processed: false
        });
        pendingWithdrawals += assets;
        emit WithdrawalQueued(msg.sender, assets, shares, _currentEpoch());
    }

    return assets;
}
```

### claimWithdrawal()

Claims queued withdrawal after epoch ends.

```solidity
function claimWithdrawal() external nonReentrant {
    WithdrawalRequest storage request = withdrawalRequests[msg.sender];

    require(request.shares > 0, "No pending withdrawal");
    require(!request.processed, "Already processed");
    require(_currentEpoch() > request.requestEpoch, "Epoch not ended");

    uint256 assets = stQRL.convertToAssets(request.shares);

    request.processed = true;
    pendingWithdrawals -= assets;

    stQRL.burn(msg.sender, request.shares);
    payable(msg.sender).transfer(assets);

    emit Withdrawn(msg.sender, assets, request.shares, false);
}
```

### _checkThreshold()

Internal function to trigger validator creation.

```solidity
function _checkThreshold() internal {
    uint256 VALIDATOR_AMOUNT = 40_000 ether; // 40,000 QRL

    while (pendingDeposits >= VALIDATOR_AMOUNT) {
        // Request operator to create validator
        address operator = operatorRegistry.getNextOperator();

        if (operator == address(0)) {
            // No available operators
            break;
        }

        // Transfer to operator's minipool
        uint256 pooledAmount = VALIDATOR_AMOUNT - operatorRegistry.getOperatorBond(operator);
        pendingDeposits -= pooledAmount;

        operatorRegistry.createMinipool{value: pooledAmount}(operator);

        emit ValidatorQueued(operator, pooledAmount);
    }
}
```

## View Functions

### getDepositQueue()

Returns current queue status.

```solidity
function getDepositQueue() external view returns (
    uint256 pending,
    uint256 threshold,
    uint256 remaining
) {
    pending = pendingDeposits;
    threshold = 40_000 ether;
    remaining = threshold > pending ? threshold - pending : 0;
}
```

### previewDeposit(uint256 assets)

Preview shares received for deposit amount.

```solidity
function previewDeposit(uint256 assets) external view returns (uint256 shares) {
    return stQRL.convertToShares(assets);
}
```

### previewWithdraw(uint256 shares)

Preview QRL received for share amount.

```solidity
function previewWithdraw(uint256 shares) external view returns (uint256 assets) {
    return stQRL.convertToAssets(shares);
}
```

## Admin Functions

### setMinDeposit(uint256 _minDeposit)

Updates minimum deposit amount.

```solidity
function setMinDeposit(uint256 _minDeposit) external onlyOwner {
    minDeposit = _minDeposit;
    emit MinDepositUpdated(_minDeposit);
}
```

### addLiquidity()

Adds QRL to liquid reserve (from validator exits).

```solidity
function addLiquidity() external payable onlyOperatorRegistry {
    liquidReserve += msg.value;
    emit LiquidityAdded(msg.value);
}
```

## Events

```solidity
event Deposited(address indexed user, uint256 assets, uint256 shares);
event Withdrawn(address indexed user, uint256 assets, uint256 shares, bool immediate);
event WithdrawalQueued(address indexed user, uint256 assets, uint256 shares, uint256 epoch);
event ValidatorQueued(address indexed operator, uint256 pooledAmount);
event MinDepositUpdated(uint256 newMinDeposit);
event LiquidityAdded(uint256 amount);
```

## Access Control

| Function | Access |
|----------|--------|
| deposit | public |
| withdraw | public |
| claimWithdrawal | public |
| setMinDeposit | owner only |
| addLiquidity | operatorRegistry only |
| pause/unpause | owner only |

## Security Considerations

### Reentrancy

- All state changes before external calls
- `nonReentrant` modifier on all public functions
- Transfer QRL last in function execution

### Front-Running

- Exchange rate based on block state
- No significant advantage to front-running deposits

### Withdrawal Delays

- Epoch-based withdrawal protects against bank runs
- Matches Zond's native withdrawal unlock timing

### Minimum Deposit

- Prevents dust attacks
- Reduces gas cost for small depositors
- Recommended: 1 QRL minimum

## Example Usage

### Making a Deposit

```javascript
const depositPool = new web3.zond.Contract(depositPoolAbi, depositPoolAddress);

// Deposit 100 QRL
const tx = await depositPool.methods.deposit().send({
    from: userAddress,
    value: web3.utils.toWei('100', 'ether'),
    gas: 200000
});

console.log('Received stQRL shares:', tx.events.Deposited.returnValues.shares);
```

### Checking Queue Position

```javascript
const queue = await depositPool.methods.getDepositQueue().call();
console.log(`Pending: ${queue.pending / 1e18} QRL`);
console.log(`Remaining to threshold: ${queue.remaining / 1e18} QRL`);
```

### Withdrawing

```javascript
// Get stQRL balance
const shares = await stQRL.methods.balanceOf(userAddress).call();

// Initiate withdrawal
await depositPool.methods.withdraw(shares).send({
    from: userAddress,
    gas: 200000
});

// Wait for epoch to end, then claim
await depositPool.methods.claimWithdrawal().send({
    from: userAddress,
    gas: 150000
});
```
