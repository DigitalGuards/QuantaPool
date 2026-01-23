// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

/**
 * @title DepositPool v2 - User Entry Point for QuantaPool
 * @author QuantaPool
 * @notice Accepts QRL deposits, manages withdrawals, and syncs validator rewards
 *
 * @dev Key responsibilities:
 *   1. Accept user deposits → mint stQRL shares
 *   2. Queue and process withdrawals → burn shares, return QRL
 *   3. Trustless reward sync → detect balance changes from validators
 *   4. Fund validators → send QRL to beacon deposit contract
 *
 * Reward Sync (Oracle-Free):
 *   Validator rewards arrive via EIP-4895 as balance increases WITHOUT
 *   triggering contract code. This contract periodically checks its balance
 *   and updates stQRL's totalPooledQRL accordingly.
 *
 *   syncRewards() can be called by anyone - it's trustless. The contract
 *   simply compares its actual balance to expected balance and attributes
 *   the difference to rewards (positive) or slashing (negative).
 *
 * Balance Accounting:
 *   contractBalance = totalPooledQRL + withdrawalReserve
 *
 *   - totalPooledQRL: All QRL under pool management (buffered + rewards)
 *     This is what stQRL token tracks. Includes buffered deposits waiting
 *     to fund validators, plus any rewards that arrive via EIP-4895.
 *   - withdrawalReserve: QRL earmarked for pending withdrawals (not pooled)
 *
 * For MVP (testnet), funded validators keep QRL in this contract.
 * For production, QRL goes to beacon deposit contract and returns
 * when validators exit.
 */

interface IstQRL {
    function mintShares(address to, uint256 qrlAmount) external returns (uint256);
    function burnShares(address from, uint256 sharesAmount) external returns (uint256);
    function updateTotalPooledQRL(uint256 newAmount) external;
    function totalPooledQRL() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function sharesOf(address account) external view returns (uint256);
    function getSharesByPooledQRL(uint256 qrlAmount) external view returns (uint256);
    function getPooledQRLByShares(uint256 sharesAmount) external view returns (uint256);
}

/// @notice Zond beacon chain deposit contract interface
interface IDepositContract {
    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable;
}

contract DepositPoolV2 {
    // =============================================================
    //                          CONSTANTS
    // =============================================================

    /// @notice Minimum stake for a Zond validator
    uint256 public constant VALIDATOR_STAKE = 10_000 ether;

    /// @notice Zond beacon chain deposit contract
    address public constant DEPOSIT_CONTRACT = 0x4242424242424242424242424242424242424242;

    /// @notice Dilithium pubkey length (bytes)
    uint256 private constant PUBKEY_LENGTH = 2592;

    /// @notice Dilithium signature length (bytes)
    uint256 private constant SIGNATURE_LENGTH = 4595;

    /// @notice Withdrawal credentials length
    uint256 private constant CREDENTIALS_LENGTH = 32;

    /// @notice Minimum blocks to wait before claiming withdrawal
    uint256 public constant WITHDRAWAL_DELAY = 128; // ~2 hours on Zond

    // =============================================================
    //                          STORAGE
    // =============================================================

    /// @notice stQRL token contract
    IstQRL public stQRL;

    /// @notice Contract owner
    address public owner;

    /// @notice QRL buffered for next validator (not yet staked)
    uint256 public bufferedQRL;

    /// @notice Number of active validators
    uint256 public validatorCount;

    /// @notice Minimum deposit amount
    uint256 public minDeposit;

    /// @notice Paused state
    bool public paused;

    /// @notice Reentrancy guard
    uint256 private _locked;

    // =============================================================
    //                    WITHDRAWAL STORAGE
    // =============================================================

    /// @notice Withdrawal request data
    struct WithdrawalRequest {
        uint256 shares;          // Shares to burn
        uint256 qrlAmount;       // QRL amount at request time (may change with rebase)
        uint256 requestBlock;    // Block when requested
        bool claimed;            // Whether claimed
    }

    /// @notice Withdrawal requests by user
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    /// @notice Total shares locked in withdrawal queue
    uint256 public totalWithdrawalShares;

    /// @notice QRL reserved for pending withdrawals
    uint256 public withdrawalReserve;

    // =============================================================
    //                       SYNC STORAGE
    // =============================================================

    /// @notice Last block when rewards were synced
    uint256 public lastSyncBlock;

    /// @notice Total rewards received (cumulative, for stats)
    uint256 public totalRewardsReceived;

    /// @notice Total slashing losses (cumulative, for stats)
    uint256 public totalSlashingLosses;

    // =============================================================
    //                          EVENTS
    // =============================================================

    event Deposited(
        address indexed user,
        uint256 qrlAmount,
        uint256 sharesReceived
    );

    event WithdrawalRequested(
        address indexed user,
        uint256 shares,
        uint256 qrlAmount,
        uint256 requestBlock
    );

    event WithdrawalClaimed(
        address indexed user,
        uint256 shares,
        uint256 qrlAmount
    );

    event RewardsSynced(
        uint256 rewardsAmount,
        uint256 newTotalPooled,
        uint256 blockNumber
    );

    event SlashingDetected(
        uint256 lossAmount,
        uint256 newTotalPooled,
        uint256 blockNumber
    );

    event ValidatorFunded(
        uint256 indexed validatorId,
        bytes pubkey,
        uint256 amount
    );

    event WithdrawalReserveFunded(uint256 amount);
    event MinDepositUpdated(uint256 newMinDeposit);
    event Paused(address account);
    event Unpaused(address account);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // =============================================================
    //                          ERRORS
    // =============================================================

    error NotOwner();
    error ContractPaused();
    error ReentrancyGuard();
    error ZeroAddress();
    error ZeroAmount();
    error BelowMinDeposit();
    error InsufficientShares();
    error WithdrawalPending();
    error NoWithdrawalPending();
    error WithdrawalNotReady();
    error InsufficientReserve();
    error InsufficientBuffer();
    error InvalidPubkeyLength();
    error InvalidSignatureLength();
    error InvalidCredentialsLength();
    error TransferFailed();
    error StQRLNotSet();

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 1) revert ReentrancyGuard();
        _locked = 1;
        _;
        _locked = 0;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor() {
        owner = msg.sender;
        minDeposit = 0.1 ether; // 0.1 QRL minimum
        lastSyncBlock = block.number;
    }

    // =============================================================
    //                     DEPOSIT FUNCTIONS
    // =============================================================

    /**
     * @notice Deposit QRL and receive stQRL
     * @dev Mints shares based on current exchange rate, adds deposit to buffer
     *
     * Note: Does NOT call syncRewards() because msg.value is already in
     * address(this).balance when function executes, which would incorrectly
     * be detected as "rewards". Users wanting the latest rate should call
     * syncRewards() before depositing.
     *
     * @return shares Amount of stQRL shares minted
     */
    function deposit() external payable nonReentrant whenNotPaused returns (uint256 shares) {
        if (address(stQRL) == address(0)) revert StQRLNotSet();
        if (msg.value < minDeposit) revert BelowMinDeposit();

        // Mint shares FIRST - this calculates shares at current rate
        // mintShares internally calls getSharesByPooledQRL(qrlAmount)
        // This must happen BEFORE updating totalPooledQRL to ensure fair pricing
        shares = stQRL.mintShares(msg.sender, msg.value);

        // Add to buffer (deposited QRL waiting to fund validators)
        bufferedQRL += msg.value;

        // Update total pooled QRL (deposit is now under protocol management)
        // This must happen AFTER minting to not affect the share calculation
        uint256 newTotalPooled = stQRL.totalPooledQRL() + msg.value;
        stQRL.updateTotalPooledQRL(newTotalPooled);

        emit Deposited(msg.sender, msg.value, shares);
        return shares;
    }

    /**
     * @notice Preview deposit - get expected shares for QRL amount
     * @param qrlAmount Amount of QRL to deposit
     * @return shares Expected shares to receive
     */
    function previewDeposit(uint256 qrlAmount) external view returns (uint256 shares) {
        if (address(stQRL) == address(0)) return qrlAmount;
        return stQRL.getSharesByPooledQRL(qrlAmount);
    }

    // =============================================================
    //                   WITHDRAWAL FUNCTIONS
    // =============================================================

    /**
     * @notice Request withdrawal of stQRL
     * @dev Locks shares until claim is processed
     * @param shares Amount of shares to withdraw
     * @return qrlAmount Current QRL value of shares (may change before claim)
     */
    function requestWithdrawal(uint256 shares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 qrlAmount)
    {
        if (shares == 0) revert ZeroAmount();
        if (stQRL.sharesOf(msg.sender) < shares) revert InsufficientShares();
        if (withdrawalRequests[msg.sender].shares > 0) revert WithdrawalPending();

        // Sync rewards first
        _syncRewards();

        // Calculate current QRL value
        qrlAmount = stQRL.getPooledQRLByShares(shares);

        // Create withdrawal request
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            shares: shares,
            qrlAmount: qrlAmount,
            requestBlock: block.number,
            claimed: false
        });

        totalWithdrawalShares += shares;

        emit WithdrawalRequested(msg.sender, shares, qrlAmount, block.number);
        return qrlAmount;
    }

    /**
     * @notice Claim a pending withdrawal
     * @dev Burns shares and transfers QRL to user
     *      Follows CEI pattern: Checks → Effects → Interactions
     * @return qrlAmount Amount of QRL received
     */
    function claimWithdrawal() external nonReentrant returns (uint256 qrlAmount) {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender];

        // === CHECKS ===
        if (request.shares == 0) revert NoWithdrawalPending();
        if (request.claimed) revert NoWithdrawalPending();
        if (block.number < request.requestBlock + WITHDRAWAL_DELAY) revert WithdrawalNotReady();

        // Sync rewards first (external call, but to trusted stQRL contract)
        _syncRewards();

        // Cache values before state changes
        uint256 sharesToBurn = request.shares;

        // Recalculate QRL amount (may have changed due to rewards/slashing)
        qrlAmount = stQRL.getPooledQRLByShares(sharesToBurn);

        // Check if we have enough in reserve
        if (withdrawalReserve < qrlAmount) revert InsufficientReserve();

        // === EFFECTS (all state changes before external calls) ===
        // Mark as claimed and clean up request
        delete withdrawalRequests[msg.sender];
        totalWithdrawalShares -= sharesToBurn;
        withdrawalReserve -= qrlAmount;

        // === INTERACTIONS ===
        // Burn shares (uses cached sharesToBurn, returns actual QRL value)
        uint256 burnedQRL = stQRL.burnShares(msg.sender, sharesToBurn);

        // Update total pooled QRL using the actual burned amount
        uint256 newTotalPooled = stQRL.totalPooledQRL() - burnedQRL;
        stQRL.updateTotalPooledQRL(newTotalPooled);

        // Transfer QRL to user (last external call)
        (bool success, ) = msg.sender.call{value: qrlAmount}("");
        if (!success) revert TransferFailed();

        emit WithdrawalClaimed(msg.sender, sharesToBurn, qrlAmount);
        return qrlAmount;
    }

    /**
     * @notice Cancel a pending withdrawal request
     * @dev Returns shares to normal circulating state
     */
    function cancelWithdrawal() external nonReentrant {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender];

        if (request.shares == 0) revert NoWithdrawalPending();
        if (request.claimed) revert NoWithdrawalPending();

        totalWithdrawalShares -= request.shares;
        delete withdrawalRequests[msg.sender];
    }

    /**
     * @notice Get withdrawal request details
     * @param user Address to query
     */
    function getWithdrawalRequest(address user) external view returns (
        uint256 shares,
        uint256 currentQRLValue,
        uint256 requestBlock,
        bool canClaim,
        uint256 blocksRemaining
    ) {
        WithdrawalRequest storage request = withdrawalRequests[user];
        shares = request.shares;
        currentQRLValue = stQRL.getPooledQRLByShares(shares);
        requestBlock = request.requestBlock;

        uint256 unlockBlock = request.requestBlock + WITHDRAWAL_DELAY;
        canClaim = !request.claimed &&
                   request.shares > 0 &&
                   block.number >= unlockBlock &&
                   withdrawalReserve >= currentQRLValue;

        blocksRemaining = block.number >= unlockBlock ? 0 : unlockBlock - block.number;
    }

    // =============================================================
    //                    REWARD SYNC FUNCTIONS
    // =============================================================

    /**
     * @notice Sync rewards from validator balance changes
     * @dev Anyone can call this. It's trustless - just compares balances.
     *      Called automatically on deposit/withdraw, but can be called
     *      manually to update balances more frequently.
     */
    function syncRewards() external nonReentrant {
        _syncRewards();
    }

    /**
     * @dev Internal reward sync logic
     *
     * Balance accounting:
     *   The contract holds: bufferedQRL + rewards/staked QRL + withdrawalReserve
     *   withdrawalReserve is earmarked for pending withdrawals (not pooled)
     *   actualTotalPooled = balance - withdrawalReserve
     *
     * If actualTotalPooled > previousPooled → rewards arrived
     * If actualTotalPooled < previousPooled → slashing occurred
     *
     * Note: For MVP (fundValidatorMVP), staked QRL stays in contract.
     * For production (fundValidator), staked QRL goes to beacon deposit contract
     * and returns via EIP-4895 withdrawals when validators exit.
     */
    function _syncRewards() internal {
        if (address(stQRL) == address(0)) return;

        uint256 currentBalance = address(this).balance;

        // Total pooled = everything except withdrawal reserve
        // This includes: bufferedQRL + any rewards that arrived via EIP-4895
        uint256 actualTotalPooled;
        if (currentBalance > withdrawalReserve) {
            actualTotalPooled = currentBalance - withdrawalReserve;
        } else {
            actualTotalPooled = 0;
        }

        // What we previously tracked as pooled
        uint256 previousPooled = stQRL.totalPooledQRL();

        // Compare and attribute difference
        if (actualTotalPooled > previousPooled) {
            // Rewards arrived (via EIP-4895 or direct transfer)
            uint256 rewards = actualTotalPooled - previousPooled;
            totalRewardsReceived += rewards;
            stQRL.updateTotalPooledQRL(actualTotalPooled);
            lastSyncBlock = block.number;

            emit RewardsSynced(rewards, actualTotalPooled, block.number);

        } else if (actualTotalPooled < previousPooled) {
            // Slashing detected (or funds removed somehow)
            uint256 loss = previousPooled - actualTotalPooled;
            totalSlashingLosses += loss;
            stQRL.updateTotalPooledQRL(actualTotalPooled);
            lastSyncBlock = block.number;

            emit SlashingDetected(loss, actualTotalPooled, block.number);
        }
        // If equal, no change needed
    }

    // =============================================================
    //                   VALIDATOR FUNCTIONS
    // =============================================================

    /**
     * @notice Fund a validator with beacon chain deposit
     * @dev Only owner can call. Sends VALIDATOR_STAKE to beacon deposit contract.
     * @param pubkey Dilithium public key (2592 bytes)
     * @param withdrawal_credentials Must point to this contract (0x01 prefix)
     * @param signature Dilithium signature (4595 bytes)
     * @param deposit_data_root SSZ hash of deposit data
     * @return validatorId The new validator's ID
     */
    function fundValidator(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external onlyOwner nonReentrant returns (uint256 validatorId) {
        if (bufferedQRL < VALIDATOR_STAKE) revert InsufficientBuffer();
        if (pubkey.length != PUBKEY_LENGTH) revert InvalidPubkeyLength();
        if (signature.length != SIGNATURE_LENGTH) revert InvalidSignatureLength();
        if (withdrawal_credentials.length != CREDENTIALS_LENGTH) revert InvalidCredentialsLength();

        // Verify withdrawal credentials point to this contract (0x01 prefix)
        // First byte should be 0x01, remaining 31 bytes should be this contract's address
        require(
            withdrawal_credentials[0] == 0x01,
            "DepositPool: must use 0x01 credentials"
        );

        bufferedQRL -= VALIDATOR_STAKE;
        validatorId = validatorCount++;

        // Call beacon deposit contract
        IDepositContract(DEPOSIT_CONTRACT).deposit{value: VALIDATOR_STAKE}(
            pubkey,
            withdrawal_credentials,
            signature,
            deposit_data_root
        );

        emit ValidatorFunded(validatorId, pubkey, VALIDATOR_STAKE);
        return validatorId;
    }

    /**
     * @notice Fund a validator (MVP testing - no actual beacon deposit)
     * @dev Moves QRL from buffer to simulated stake. For testnet only.
     * @return validatorId The new validator's ID
     */
    function fundValidatorMVP() external onlyOwner nonReentrant returns (uint256 validatorId) {
        if (bufferedQRL < VALIDATOR_STAKE) revert InsufficientBuffer();

        bufferedQRL -= VALIDATOR_STAKE;
        validatorId = validatorCount++;

        // QRL stays in contract, simulating staked funds
        emit ValidatorFunded(validatorId, "", VALIDATOR_STAKE);
        return validatorId;
    }

    /**
     * @notice Add QRL to withdrawal reserve (from validator exits)
     * @dev Called when validators exit and funds return to contract
     */
    function fundWithdrawalReserve() external payable {
        withdrawalReserve += msg.value;
        emit WithdrawalReserveFunded(msg.value);
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get pool status
     */
    function getPoolStatus() external view returns (
        uint256 totalPooled,
        uint256 totalShares,
        uint256 buffered,
        uint256 validators,
        uint256 pendingWithdrawalShares,
        uint256 reserveBalance,
        uint256 exchangeRate
    ) {
        totalPooled = address(stQRL) != address(0) ? stQRL.totalPooledQRL() : 0;
        totalShares = address(stQRL) != address(0) ? stQRL.totalShares() : 0;
        buffered = bufferedQRL;
        validators = validatorCount;
        pendingWithdrawalShares = totalWithdrawalShares;
        reserveBalance = withdrawalReserve;
        exchangeRate = totalShares > 0 ? (totalPooled * 1e18) / totalShares : 1e18;
    }

    /**
     * @notice Get reward/slashing stats
     */
    function getRewardStats() external view returns (
        uint256 totalRewards,
        uint256 totalSlashing,
        uint256 netRewards,
        uint256 lastSync
    ) {
        totalRewards = totalRewardsReceived;
        totalSlashing = totalSlashingLosses;
        netRewards = totalRewardsReceived > totalSlashingLosses
            ? totalRewardsReceived - totalSlashingLosses
            : 0;
        lastSync = lastSyncBlock;
    }

    /**
     * @notice Check if validator funding is possible
     */
    function canFundValidator() external view returns (bool possible, uint256 bufferedAmount) {
        possible = bufferedQRL >= VALIDATOR_STAKE;
        bufferedAmount = bufferedQRL;
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Set the stQRL token contract
     * @param _stQRL Address of stQRL contract
     */
    function setStQRL(address _stQRL) external onlyOwner {
        if (_stQRL == address(0)) revert ZeroAddress();
        stQRL = IstQRL(_stQRL);
    }

    /**
     * @notice Set minimum deposit amount
     * @param _minDeposit New minimum deposit
     */
    function setMinDeposit(uint256 _minDeposit) external onlyOwner {
        minDeposit = _minDeposit;
        emit MinDepositUpdated(_minDeposit);
    }

    /**
     * @notice Pause the contract
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Emergency withdrawal of stuck funds
     * @dev Only for recovery of accidentally sent tokens, not pool funds
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // =============================================================
    //                       RECEIVE FUNCTION
    // =============================================================

    /**
     * @notice Receive QRL (from validator exits, rewards, or direct sends)
     * @dev Rewards arrive via EIP-4895 WITHOUT triggering this function.
     *      This is only triggered by explicit transfers. We add to reserve
     *      assuming these are validator exit proceeds.
     */
    receive() external payable {
        // Funds received here are assumed to be from validator exits
        // They go to withdrawal reserve
        withdrawalReserve += msg.value;
        emit WithdrawalReserveFunded(msg.value);
    }
}
