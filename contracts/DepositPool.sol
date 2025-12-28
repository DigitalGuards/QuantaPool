// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title DepositPool - User entry point for QuantaPool
 * @dev Accepts QRL deposits, mints stQRL, manages withdrawal queue
 *
 * Deposits accumulate until 40,000 QRL threshold is reached,
 * then a validator can be created.
 */

interface IstQRL {
    function mint(address to, uint256 assets) external returns (uint256);
    function burn(address from, uint256 shares) external returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function totalAssets() external view returns (uint256);
}

contract DepositPool {
    // =============================================================
    //                          CONSTANTS
    // =============================================================

    /// @notice Amount of QRL needed to create one validator
    uint256 public constant VALIDATOR_THRESHOLD = 40_000 ether;

    // =============================================================
    //                          STORAGE
    // =============================================================

    /// @notice stQRL token contract
    IstQRL public stQRL;

    /// @notice Owner address
    address public owner;

    /// @notice QRL waiting in queue (not yet staked)
    uint256 public pendingDeposits;

    /// @notice QRL available for immediate withdrawals
    uint256 public liquidReserve;

    /// @notice Minimum deposit amount
    uint256 public minDeposit;

    /// @notice Number of validators created
    uint256 public validatorCount;

    /// @notice Paused state
    bool public paused;

    /// @notice Reentrancy guard
    bool private locked;

    /// @notice Withdrawal request struct
    struct WithdrawalRequest {
        uint256 shares;
        uint256 requestBlock;
        bool processed;
    }

    /// @notice Pending withdrawal requests
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    /// @notice Total pending withdrawal amount (in QRL)
    uint256 public pendingWithdrawals;

    // =============================================================
    //                          EVENTS
    // =============================================================

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalRequested(address indexed user, uint256 shares, uint256 assets);
    event WithdrawalClaimed(address indexed user, uint256 assets);
    event ValidatorFunded(uint256 indexed validatorId, uint256 amount);
    event LiquidityAdded(uint256 amount);
    event MinDepositUpdated(uint256 newMinDeposit);
    event Paused(address account);
    event Unpaused(address account);

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "DepositPool: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "DepositPool: paused");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "DepositPool: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor(address _stQRL) {
        require(_stQRL != address(0), "DepositPool: zero address");
        stQRL = IstQRL(_stQRL);
        owner = msg.sender;
        minDeposit = 1 ether; // 1 QRL minimum
    }

    // =============================================================
    //                     DEPOSIT FUNCTIONS
    // =============================================================

    /// @notice Deposit QRL and receive stQRL
    /// @return shares Amount of stQRL minted
    function deposit() external payable nonReentrant whenNotPaused returns (uint256 shares) {
        require(msg.value >= minDeposit, "DepositPool: below minimum");

        // Mint stQRL to depositor
        shares = stQRL.mint(msg.sender, msg.value);

        // Add to pending deposits
        pendingDeposits += msg.value;

        emit Deposited(msg.sender, msg.value, shares);

        return shares;
    }

    /// @notice Preview deposit - get expected shares for amount
    function previewDeposit(uint256 assets) external view returns (uint256) {
        return stQRL.convertToShares(assets);
    }

    // =============================================================
    //                    WITHDRAWAL FUNCTIONS
    // =============================================================

    /// @notice Request withdrawal by specifying shares
    /// @param shares Amount of stQRL to withdraw
    /// @return assets Expected QRL amount
    function requestWithdrawal(uint256 shares) external nonReentrant whenNotPaused returns (uint256 assets) {
        require(shares > 0, "DepositPool: zero shares");
        require(stQRL.balanceOf(msg.sender) >= shares, "DepositPool: insufficient balance");
        require(withdrawalRequests[msg.sender].shares == 0, "DepositPool: pending withdrawal exists");

        assets = stQRL.convertToAssets(shares);

        // Check if immediate withdrawal possible
        if (liquidReserve >= assets) {
            // Immediate withdrawal
            liquidReserve -= assets;

            // Burn shares
            stQRL.burn(msg.sender, shares);

            // Transfer QRL
            (bool success, ) = msg.sender.call{value: assets}("");
            require(success, "DepositPool: transfer failed");

            emit WithdrawalClaimed(msg.sender, assets);
        } else {
            // Queue for later
            withdrawalRequests[msg.sender] = WithdrawalRequest({
                shares: shares,
                requestBlock: block.number,
                processed: false
            });
            pendingWithdrawals += assets;

            emit WithdrawalRequested(msg.sender, shares, assets);
        }

        return assets;
    }

    /// @notice Claim a queued withdrawal
    function claimWithdrawal() external nonReentrant {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender];

        require(request.shares > 0, "DepositPool: no pending withdrawal");
        require(!request.processed, "DepositPool: already processed");
        // Wait at least 128 blocks (~128 minutes on Zond = ~1 epoch)
        require(block.number >= request.requestBlock + 128, "DepositPool: too early");

        uint256 assets = stQRL.convertToAssets(request.shares);
        require(liquidReserve >= assets, "DepositPool: insufficient liquidity");

        request.processed = true;
        liquidReserve -= assets;
        pendingWithdrawals -= assets;

        // Burn shares
        stQRL.burn(msg.sender, request.shares);

        // Transfer QRL
        (bool success, ) = msg.sender.call{value: assets}("");
        require(success, "DepositPool: transfer failed");

        // Clean up
        delete withdrawalRequests[msg.sender];

        emit WithdrawalClaimed(msg.sender, assets);
    }

    /// @notice Preview withdrawal - get expected assets for shares
    function previewWithdrawal(uint256 shares) external view returns (uint256) {
        return stQRL.convertToAssets(shares);
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /// @notice Get deposit queue status
    function getQueueStatus() external view returns (
        uint256 pending,
        uint256 threshold,
        uint256 remaining,
        uint256 validatorsReady
    ) {
        pending = pendingDeposits;
        threshold = VALIDATOR_THRESHOLD;
        remaining = pending >= threshold ? 0 : threshold - pending;
        validatorsReady = pending / threshold;
    }

    /// @notice Get user's withdrawal request
    function getWithdrawalRequest(address user) external view returns (
        uint256 shares,
        uint256 assets,
        uint256 requestBlock,
        bool canClaim
    ) {
        WithdrawalRequest storage request = withdrawalRequests[user];
        shares = request.shares;
        assets = stQRL.convertToAssets(shares);
        requestBlock = request.requestBlock;
        canClaim = !request.processed &&
                   request.shares > 0 &&
                   block.number >= request.requestBlock + 128 &&
                   liquidReserve >= assets;
    }

    /// @notice Get total value locked
    function getTVL() external view returns (uint256) {
        return stQRL.totalAssets();
    }

    // =============================================================
    //                     OPERATOR FUNCTIONS
    // =============================================================

    /// @notice Fund a validator (called when threshold reached)
    /// @dev In MVP, this is called manually by owner. Later, automated.
    function fundValidator() external onlyOwner nonReentrant returns (uint256 validatorId) {
        require(pendingDeposits >= VALIDATOR_THRESHOLD, "DepositPool: below threshold");

        pendingDeposits -= VALIDATOR_THRESHOLD;
        validatorId = validatorCount++;

        // In production, this would transfer to validator deposit contract
        // For MVP, funds stay in this contract

        emit ValidatorFunded(validatorId, VALIDATOR_THRESHOLD);

        return validatorId;
    }

    /// @notice Add liquidity for withdrawals (from validator exits)
    function addLiquidity() external payable {
        liquidReserve += msg.value;
        emit LiquidityAdded(msg.value);
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    function setMinDeposit(uint256 _minDeposit) external onlyOwner {
        minDeposit = _minDeposit;
        emit MinDepositUpdated(_minDeposit);
    }

    function setStQRL(address _stQRL) external onlyOwner {
        require(_stQRL != address(0), "DepositPool: zero address");
        stQRL = IstQRL(_stQRL);
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
        require(newOwner != address(0), "DepositPool: zero address");
        owner = newOwner;
    }

    /// @notice Emergency withdrawal of stuck funds
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "DepositPool: zero address");
        (bool success, ) = to.call{value: amount}("");
        require(success, "DepositPool: transfer failed");
    }

    // Allow receiving QRL
    receive() external payable {
        liquidReserve += msg.value;
    }
}
