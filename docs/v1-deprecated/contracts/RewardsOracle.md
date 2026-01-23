# RewardsOracle Contract Specification

## Overview

RewardsOracle is responsible for reporting validator balances to the stQRL contract, enabling the exchange rate to update based on staking rewards earned. The MVP uses a centralized oracle with a path to decentralization.

## Contract Details

| Property | Value |
|----------|-------|
| Purpose | Report validator rewards, update exchange rate |
| Update Frequency | ~24 hours (configurable) |
| MVP Model | Single trusted operator |
| Future Model | Multi-party threshold (3-of-5) |

## State Variables

```solidity
// Reference to stQRL token
IStakedQRL public stQRL;

// Reference to operator registry
IOperatorRegistry public operatorRegistry;

// Authorized oracle reporters (MVP: single address)
mapping(address => bool) public isOracle;

// Number of active oracles
uint256 public oracleCount;

// Required confirmations for multi-oracle (future)
uint256 public requiredConfirmations;

// Last reported total balance
uint256 public lastReportedBalance;

// Last report timestamp
uint256 public lastReportTimestamp;

// Minimum time between reports
uint256 public reportCooldown;

// Maximum rate change per report (safety limit)
uint256 public maxRateChange; // basis points (e.g., 100 = 1%)

// Pending reports for multi-oracle consensus
mapping(bytes32 => OracleReport) public pendingReports;

struct OracleReport {
    uint256 totalBalance;
    uint256 timestamp;
    uint256 confirmations;
    mapping(address => bool) hasConfirmed;
}
```

## Core Functions

### submitReport(uint256 totalValidatorBalance)

Submit validator balance report (MVP single oracle).

```solidity
function submitReport(uint256 totalValidatorBalance) external onlyOracle {
    require(
        block.timestamp >= lastReportTimestamp + reportCooldown,
        "Report cooldown not elapsed"
    );

    // Calculate rewards since last report
    uint256 rewards = totalValidatorBalance > lastReportedBalance
        ? totalValidatorBalance - lastReportedBalance
        : 0;

    // Apply commission (handled in OperatorRegistry)
    uint256 netRewards = operatorRegistry.applyCommission(rewards);

    // Validate rate change within limits
    _validateRateChange(netRewards);

    // Update stQRL pending rewards
    stQRL.updateRewards(stQRL.pendingRewards() + netRewards);

    // Update state
    lastReportedBalance = totalValidatorBalance;
    lastReportTimestamp = block.timestamp;

    emit ReportSubmitted(msg.sender, totalValidatorBalance, netRewards);
}
```

### submitReportMulti(uint256 totalValidatorBalance) [Future]

Submit report for multi-oracle consensus.

```solidity
function submitReportMulti(uint256 totalValidatorBalance) external onlyOracle {
    bytes32 reportId = keccak256(
        abi.encodePacked(totalValidatorBalance, _currentEpoch())
    );

    OracleReport storage report = pendingReports[reportId];

    require(!report.hasConfirmed[msg.sender], "Already confirmed");

    if (report.confirmations == 0) {
        // First submission
        report.totalBalance = totalValidatorBalance;
        report.timestamp = block.timestamp;
    } else {
        // Verify matching balance
        require(
            report.totalBalance == totalValidatorBalance,
            "Balance mismatch"
        );
    }

    report.hasConfirmed[msg.sender] = true;
    report.confirmations++;

    emit OracleConfirmation(msg.sender, reportId, report.confirmations);

    // Check if threshold reached
    if (report.confirmations >= requiredConfirmations) {
        _finalizeReport(report.totalBalance);
        emit ReportFinalized(reportId, report.totalBalance);
    }
}
```

### _validateRateChange(uint256 rewards)

Ensures rate change is within safety limits.

```solidity
function _validateRateChange(uint256 rewards) internal view {
    uint256 currentAssets = stQRL.totalAssets();

    if (currentAssets == 0) return;

    uint256 changePercent = rewards * 10000 / currentAssets;

    require(
        changePercent <= maxRateChange,
        "Rate change exceeds maximum"
    );
}
```

## View Functions

### getExpectedRewards()

Estimates rewards based on time since last report.

```solidity
function getExpectedRewards(uint256 annualYield) external view returns (uint256) {
    uint256 timeSinceReport = block.timestamp - lastReportTimestamp;
    uint256 totalStaked = stQRL.totalAssets();

    // annualYield in basis points (250 = 2.5%)
    return totalStaked * annualYield * timeSinceReport / (365 days * 10000);
}
```

### getOracleStatus()

Returns current oracle configuration.

```solidity
function getOracleStatus() external view returns (
    uint256 lastReport,
    uint256 cooldownRemaining,
    uint256 activeOracles,
    uint256 requiredSigs
) {
    lastReport = lastReportTimestamp;
    cooldownRemaining = lastReportTimestamp + reportCooldown > block.timestamp
        ? lastReportTimestamp + reportCooldown - block.timestamp
        : 0;
    activeOracles = oracleCount;
    requiredSigs = requiredConfirmations;
}
```

## Admin Functions

### addOracle(address oracle)

Adds authorized oracle reporter.

```solidity
function addOracle(address oracle) external onlyOwner {
    require(!isOracle[oracle], "Already oracle");
    isOracle[oracle] = true;
    oracleCount++;
    emit OracleAdded(oracle);
}
```

### removeOracle(address oracle)

Removes oracle authorization.

```solidity
function removeOracle(address oracle) external onlyOwner {
    require(isOracle[oracle], "Not oracle");
    require(oracleCount > requiredConfirmations, "Would break consensus");
    isOracle[oracle] = false;
    oracleCount--;
    emit OracleRemoved(oracle);
}
```

### setReportCooldown(uint256 _cooldown)

Updates minimum time between reports.

```solidity
function setReportCooldown(uint256 _cooldown) external onlyOwner {
    require(_cooldown >= 1 hours, "Cooldown too short");
    require(_cooldown <= 7 days, "Cooldown too long");
    reportCooldown = _cooldown;
    emit CooldownUpdated(_cooldown);
}
```

### setMaxRateChange(uint256 _maxChange)

Updates maximum allowed rate change per report.

```solidity
function setMaxRateChange(uint256 _maxChange) external onlyOwner {
    require(_maxChange <= 500, "Max 5% per report");
    maxRateChange = _maxChange;
    emit MaxRateChangeUpdated(_maxChange);
}
```

## Events

```solidity
event ReportSubmitted(address indexed oracle, uint256 totalBalance, uint256 rewards);
event OracleConfirmation(address indexed oracle, bytes32 indexed reportId, uint256 confirmations);
event ReportFinalized(bytes32 indexed reportId, uint256 totalBalance);
event OracleAdded(address indexed oracle);
event OracleRemoved(address indexed oracle);
event CooldownUpdated(uint256 newCooldown);
event MaxRateChangeUpdated(uint256 newMaxChange);
```

## Access Control

| Function | Access |
|----------|--------|
| submitReport | oracles only |
| submitReportMulti | oracles only |
| addOracle | owner only |
| removeOracle | owner only |
| setReportCooldown | owner only |
| setMaxRateChange | owner only |

## Security Considerations

### Oracle Manipulation

- **Rate Limits**: Maximum change per report prevents drastic manipulation
- **Cooldown**: Minimum time between reports limits attack frequency
- **Multi-Sig (Future)**: Requires consensus from multiple oracles

### Stale Data

- **Timestamp Tracking**: Users can verify data freshness
- **Expected Rewards**: Estimate function for interpolation
- **Cooldown Bounds**: Max 7 days prevents permanent staleness

### Front-Running

- **Limited Impact**: Rate changes bounded by maxRateChange
- **MEV Resistance**: Consider commit-reveal scheme for large reports

## Decentralization Path

### MVP (Single Oracle)

```
1 trusted operator → submits reports → updates stQRL
```

### V1 (Multi-Oracle)

```
3-of-5 oracles → submit matching reports → consensus → updates stQRL
```

### V2 (Decentralized)

```
Permissionless oracles → stake collateral → report → slash for misbehavior
```

## Off-Chain Oracle Implementation

### Data Collection

```javascript
// Collect validator balances from beacon chain
async function getValidatorBalances() {
    const validators = await operatorRegistry.methods.getActiveValidators().call();

    let totalBalance = BigInt(0);

    for (const pubkey of validators) {
        const balance = await beaconClient.getValidatorBalance(pubkey);
        totalBalance += BigInt(balance);
    }

    return totalBalance.toString();
}
```

### Report Submission

```javascript
async function submitOracleReport() {
    const totalBalance = await getValidatorBalances();

    const oracle = new web3.zond.Contract(oracleAbi, oracleAddress);

    const status = await oracle.methods.getOracleStatus().call();

    if (status.cooldownRemaining > 0) {
        console.log(`Cooldown: ${status.cooldownRemaining}s remaining`);
        return;
    }

    await oracle.methods.submitReport(totalBalance).send({
        from: oracleAddress,
        gas: 150000
    });

    console.log('Report submitted:', totalBalance);
}
```

## Default Configuration

| Parameter | MVP Value | Production Value |
|-----------|-----------|------------------|
| reportCooldown | 24 hours | 24 hours |
| maxRateChange | 100 (1%) | 50 (0.5%) |
| requiredConfirmations | 1 | 3 |
| oracleCount | 1 | 5 |
