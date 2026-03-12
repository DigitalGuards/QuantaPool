// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title RewardsOracle - Reports validator rewards to stQRL
 * @dev Updates exchange rate based on validator performance
 *
 * MVP: Single trusted operator submits reports
 * Future: Multi-party oracle with threshold signatures
 */

interface IstQRL {
    function updateRewards(uint256 newTotalAssets) external;
    function totalAssets() external view returns (uint256);
}

contract RewardsOracle {
    // =============================================================
    //                          STORAGE
    // =============================================================

    /// @notice stQRL token contract
    IstQRL public stQRL;

    /// @notice Owner address
    address public owner;

    /// @notice Authorized oracle addresses
    mapping(address => bool) public isOracle;

    /// @notice Number of active oracles
    uint256 public oracleCount;

    /// @notice Last reported total balance
    uint256 public lastReportedBalance;

    /// @notice Last report timestamp
    uint256 public lastReportTimestamp;

    /// @notice Minimum time between reports (seconds)
    uint256 public reportCooldown;

    /// @notice Maximum rate change per report (basis points, 100 = 1%)
    uint256 public maxRateChange;

    // =============================================================
    //                          EVENTS
    // =============================================================

    event ReportSubmitted(address indexed oracle, uint256 previousBalance, uint256 newBalance, uint256 rewards);
    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);
    event CooldownUpdated(uint256 newCooldown);
    event MaxRateChangeUpdated(uint256 newMaxChange);

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "RewardsOracle: not owner");
        _;
    }

    modifier onlyOracle() {
        require(isOracle[msg.sender], "RewardsOracle: not oracle");
        _;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor(address _stQRL) {
        require(_stQRL != address(0), "RewardsOracle: zero address");
        stQRL = IstQRL(_stQRL);
        owner = msg.sender;

        // Add owner as initial oracle
        isOracle[msg.sender] = true;
        oracleCount = 1;

        // Default settings
        reportCooldown = 24 hours;
        maxRateChange = 100; // 1% max change per report

        emit OracleAdded(msg.sender);
    }

    // =============================================================
    //                     ORACLE FUNCTIONS
    // =============================================================

    /// @notice Submit validator balance report
    /// @param newTotalBalance Total QRL across all validators
    function submitReport(uint256 newTotalBalance) external onlyOracle {
        require(block.timestamp >= lastReportTimestamp + reportCooldown, "RewardsOracle: cooldown not elapsed");

        uint256 previousBalance = lastReportedBalance;

        // First report - just set baseline
        if (previousBalance == 0) {
            lastReportedBalance = newTotalBalance;
            lastReportTimestamp = block.timestamp;

            emit ReportSubmitted(msg.sender, 0, newTotalBalance, 0);
            return;
        }

        // Calculate rewards (balance increase)
        require(newTotalBalance >= previousBalance, "RewardsOracle: balance cannot decrease");
        uint256 rewards = newTotalBalance - previousBalance;

        // Validate rate change is within limits
        if (rewards > 0) {
            uint256 changePercent = (rewards * 10000) / previousBalance;
            require(changePercent <= maxRateChange, "RewardsOracle: rate change exceeds max");
        }

        // Update stQRL with new total assets
        uint256 currentAssets = stQRL.totalAssets();
        uint256 newAssets = currentAssets + rewards;
        stQRL.updateRewards(newAssets);

        // Update state
        lastReportedBalance = newTotalBalance;
        lastReportTimestamp = block.timestamp;

        emit ReportSubmitted(msg.sender, previousBalance, newTotalBalance, rewards);
    }

    /// @notice Force update in case of emergency (e.g., slashing)
    /// @dev Only owner, bypasses rate change limit
    function emergencyUpdate(uint256 newTotalBalance) external onlyOwner {
        require(block.timestamp >= lastReportTimestamp + 1 hours, "RewardsOracle: min 1 hour between updates");

        uint256 previousBalance = lastReportedBalance;
        uint256 currentAssets = stQRL.totalAssets();

        // Handle both increases and decreases
        if (newTotalBalance >= previousBalance) {
            uint256 rewards = newTotalBalance - previousBalance;
            stQRL.updateRewards(currentAssets + rewards);
        } else {
            // Slashing scenario - this would need special handling in stQRL
            // For MVP, we don't support decreasing balance
            revert("RewardsOracle: slashing not supported in MVP");
        }

        lastReportedBalance = newTotalBalance;
        lastReportTimestamp = block.timestamp;

        emit ReportSubmitted(msg.sender, previousBalance, newTotalBalance, 0);
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /// @notice Get oracle status
    function getStatus()
        external
        view
        returns (uint256 lastReport, uint256 cooldownRemaining, uint256 lastBalance, bool canReport)
    {
        lastReport = lastReportTimestamp;

        if (block.timestamp < lastReportTimestamp + reportCooldown) {
            cooldownRemaining = (lastReportTimestamp + reportCooldown) - block.timestamp;
        } else {
            cooldownRemaining = 0;
        }

        lastBalance = lastReportedBalance;
        canReport = cooldownRemaining == 0;
    }

    /// @notice Estimate expected rewards based on APY
    /// @param annualYieldBps Annual yield in basis points (e.g., 250 = 2.5%)
    function estimateRewards(uint256 annualYieldBps) external view returns (uint256) {
        if (lastReportTimestamp == 0) return 0;

        uint256 timeSinceReport = block.timestamp - lastReportTimestamp;
        uint256 currentAssets = stQRL.totalAssets();

        // rewards = assets * yield * time / year
        return (currentAssets * annualYieldBps * timeSinceReport) / (365 days * 10000);
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    function addOracle(address oracle) external onlyOwner {
        require(!isOracle[oracle], "RewardsOracle: already oracle");
        require(oracle != address(0), "RewardsOracle: zero address");

        isOracle[oracle] = true;
        oracleCount++;

        emit OracleAdded(oracle);
    }

    function removeOracle(address oracle) external onlyOwner {
        require(isOracle[oracle], "RewardsOracle: not oracle");
        require(oracleCount > 1, "RewardsOracle: cannot remove last oracle");

        isOracle[oracle] = false;
        oracleCount--;

        emit OracleRemoved(oracle);
    }

    function setReportCooldown(uint256 _cooldown) external onlyOwner {
        require(_cooldown >= 1 hours, "RewardsOracle: cooldown too short");
        require(_cooldown <= 7 days, "RewardsOracle: cooldown too long");

        reportCooldown = _cooldown;
        emit CooldownUpdated(_cooldown);
    }

    function setMaxRateChange(uint256 _maxChange) external onlyOwner {
        require(_maxChange <= 500, "RewardsOracle: max 5% per report");

        maxRateChange = _maxChange;
        emit MaxRateChangeUpdated(_maxChange);
    }

    function setStQRL(address _stQRL) external onlyOwner {
        require(_stQRL != address(0), "RewardsOracle: zero address");
        stQRL = IstQRL(_stQRL);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "RewardsOracle: zero address");
        owner = newOwner;
    }
}
