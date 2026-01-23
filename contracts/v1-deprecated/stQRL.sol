// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title stQRL - Staked QRL Liquid Staking Token
 * @dev ERC-4626 compliant tokenized vault for QRL liquid staking
 *
 * Users deposit QRL, receive stQRL shares. Exchange rate increases
 * as validators earn rewards, so stQRL appreciates in QRL value.
 */
contract stQRL {
    // =============================================================
    //                        ERC-20 STORAGE
    // =============================================================

    string public constant name = "Staked QRL";
    string public constant symbol = "stQRL";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // =============================================================
    //                        VAULT STORAGE
    // =============================================================

    /// @notice Total QRL assets under management (deposits + rewards)
    uint256 public totalAssets;

    /// @notice Pending rewards from validators (updated by oracle)
    uint256 public pendingRewards;

    /// @notice Last time rewards were updated
    uint256 public lastRewardUpdate;

    // =============================================================
    //                       ACCESS CONTROL
    // =============================================================

    address public owner;
    address public depositPool;
    address public rewardsOracle;

    bool public paused;

    // =============================================================
    //                          EVENTS
    // =============================================================

    // ERC-20 events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ERC-4626 events
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    // Admin events
    event DepositPoolUpdated(address indexed oldPool, address indexed newPool);
    event RewardsOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event RewardsUpdated(uint256 newTotalAssets, uint256 timestamp);
    event Paused(address account);
    event Unpaused(address account);

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "stQRL: not owner");
        _;
    }

    modifier onlyDepositPool() {
        require(msg.sender == depositPool, "stQRL: not deposit pool");
        _;
    }

    modifier onlyRewardsOracle() {
        require(msg.sender == rewardsOracle, "stQRL: not oracle");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "stQRL: paused");
        _;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor() {
        owner = msg.sender;
        lastRewardUpdate = block.timestamp;
    }

    // =============================================================
    //                     ERC-20 FUNCTIONS
    // =============================================================

    function transfer(address to, uint256 amount) public whenNotPaused returns (bool) {
        require(balanceOf[msg.sender] >= amount, "stQRL: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public whenNotPaused returns (bool) {
        require(balanceOf[from] >= amount, "stQRL: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "stQRL: insufficient allowance");

        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
        return true;
    }

    // =============================================================
    //                    ERC-4626 VIEW FUNCTIONS
    // =============================================================

    /// @notice Returns the underlying asset (QRL/native token)
    /// @dev Returns address(0) to indicate native token
    function asset() public pure returns (address) {
        return address(0); // Native QRL
    }

    /// @notice Returns total assets under management
    function totalAssetsManaaged() public view returns (uint256) {
        return totalAssets;
    }

    /// @notice Convert assets (QRL) to shares (stQRL)
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0 || totalAssets == 0) {
            return assets; // 1:1 initially
        }
        return (assets * supply) / totalAssets;
    }

    /// @notice Convert shares (stQRL) to assets (QRL)
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0) {
            return shares; // 1:1 initially
        }
        return (shares * totalAssets) / supply;
    }

    /// @notice Get current exchange rate (QRL per stQRL, scaled by 1e18)
    function getExchangeRate() public view returns (uint256) {
        if (totalSupply == 0) {
            return 1e18; // 1:1 initially
        }
        return (totalAssets * 1e18) / totalSupply;
    }

    /// @notice Maximum deposit allowed
    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Maximum mint allowed
    function maxMint(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Maximum withdrawal allowed
    function maxWithdraw(address owner_) public view returns (uint256) {
        return convertToAssets(balanceOf[owner_]);
    }

    /// @notice Maximum redeem allowed
    function maxRedeem(address owner_) public view returns (uint256) {
        return balanceOf[owner_];
    }

    /// @notice Preview shares for deposit amount
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    /// @notice Preview assets needed for mint amount
    function previewMint(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0 || totalAssets == 0) {
            return shares;
        }
        // Round up
        return (shares * totalAssets + supply - 1) / supply;
    }

    /// @notice Preview shares needed for withdraw amount
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0 || totalAssets == 0) {
            return assets;
        }
        // Round up
        return (assets * supply + totalAssets - 1) / totalAssets;
    }

    /// @notice Preview assets for redeem amount
    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    // =============================================================
    //                   DEPOSIT POOL FUNCTIONS
    // =============================================================

    /// @notice Mint shares to user (called by DepositPool)
    /// @param to Address to mint shares to
    /// @param assets Amount of QRL deposited
    /// @return shares Amount of stQRL minted
    function mint(address to, uint256 assets) external onlyDepositPool whenNotPaused returns (uint256 shares) {
        shares = convertToShares(assets);
        require(shares > 0, "stQRL: zero shares");

        totalSupply += shares;
        balanceOf[to] += shares;
        totalAssets += assets;

        emit Transfer(address(0), to, shares);
        emit Deposit(msg.sender, to, assets, shares);

        return shares;
    }

    /// @notice Burn shares from user (called by DepositPool)
    /// @param from Address to burn shares from
    /// @param shares Amount of stQRL to burn
    /// @return assets Amount of QRL to return
    function burn(address from, uint256 shares) external onlyDepositPool whenNotPaused returns (uint256 assets) {
        require(balanceOf[from] >= shares, "stQRL: insufficient balance");

        assets = convertToAssets(shares);
        require(assets > 0, "stQRL: zero assets");

        balanceOf[from] -= shares;
        totalSupply -= shares;
        totalAssets -= assets;

        emit Transfer(from, address(0), shares);
        emit Withdraw(msg.sender, from, from, assets, shares);

        return assets;
    }

    // =============================================================
    //                     ORACLE FUNCTIONS
    // =============================================================

    /// @notice Update total assets with new rewards (called by Oracle)
    /// @param newTotalAssets New total assets value
    function updateRewards(uint256 newTotalAssets) external onlyRewardsOracle {
        require(newTotalAssets >= totalAssets, "stQRL: assets cannot decrease");

        uint256 rewards = newTotalAssets - totalAssets;
        pendingRewards = rewards;
        totalAssets = newTotalAssets;
        lastRewardUpdate = block.timestamp;

        emit RewardsUpdated(newTotalAssets, block.timestamp);
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    function setDepositPool(address _depositPool) external onlyOwner {
        emit DepositPoolUpdated(depositPool, _depositPool);
        depositPool = _depositPool;
    }

    function setRewardsOracle(address _oracle) external onlyOwner {
        emit RewardsOracleUpdated(rewardsOracle, _oracle);
        rewardsOracle = _oracle;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "stQRL: zero address");
        owner = newOwner;
    }
}
