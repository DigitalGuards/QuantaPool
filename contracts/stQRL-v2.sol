// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

/**
 * @title stQRL v2 - Fixed-Balance Staked QRL Token
 * @author QuantaPool
 * @notice Liquid staking token for QRL Zond. Balance represents shares (fixed),
 *         use getQRLValue() to see current QRL equivalent.
 *
 * @dev Key concepts:
 *   - balanceOf() returns raw shares (stable, tax-friendly)
 *   - getQRLValue() returns QRL equivalent (changes with rewards/slashing)
 *   - Exchange rate: totalPooledQRL / totalShares
 *
 * This is a fixed-balance model (like wstETH) rather than rebasing (like stETH).
 * Chosen for cleaner tax implications - balance only changes on deposit/withdraw.
 *
 * Example:
 *   1. User deposits 100 QRL when pool has 1000 QRL and 1000 shares
 *   2. User receives 100 shares, balanceOf() = 100
 *   3. Validators earn 50 QRL rewards (pool now has 1050 QRL)
 *   4. User's balanceOf() still = 100 shares (unchanged)
 *   5. User's getQRLValue() = 100 * 1050 / 1000 = 105 QRL
 *
 * If slashing occurs (pool drops to 950 QRL):
 *   - User's balanceOf() still = 100 shares
 *   - User's getQRLValue() = 100 * 950 / 1000 = 95 QRL
 */
contract stQRLv2 {
    // =============================================================
    //                          CONSTANTS
    // =============================================================

    string public constant name = "Staked QRL";
    string public constant symbol = "stQRL";
    uint8 public constant decimals = 18;

    /// @notice Initial shares per QRL (1:1 at launch)
    uint256 private constant INITIAL_SHARES_PER_QRL = 1;

    // =============================================================
    //                       SHARE STORAGE
    // =============================================================

    /// @notice Total shares in existence
    uint256 private _totalShares;

    /// @notice Shares held by each account
    mapping(address => uint256) private _shares;

    /// @notice Allowances for transferFrom (in shares)
    /// @dev All amounts in this contract are shares, not QRL
    mapping(address => mapping(address => uint256)) private _allowances;

    // =============================================================
    //                       POOL STORAGE
    // =============================================================

    /// @notice Total QRL controlled by the protocol (staked + rewards - slashing)
    /// @dev Updated by DepositPool via updateTotalPooledQRL()
    uint256 private _totalPooledQRL;

    // =============================================================
    //                      ACCESS CONTROL
    // =============================================================

    /// @notice Contract owner (for initial setup)
    address public owner;

    /// @notice DepositPool contract (only address that can mint/burn/update)
    address public depositPool;

    /// @notice Pause state for emergencies
    bool public paused;

    // =============================================================
    //                          EVENTS
    // =============================================================

    // ERC-20 standard events (values are in shares)
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // Pool events
    event TotalPooledQRLUpdated(uint256 previousAmount, uint256 newAmount);
    event SharesMinted(address indexed to, uint256 sharesAmount, uint256 qrlAmount);
    event SharesBurned(address indexed from, uint256 sharesAmount, uint256 qrlAmount);

    // Admin events
    event DepositPoolSet(address indexed previousPool, address indexed newPool);
    event Paused(address account);
    event Unpaused(address account);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // =============================================================
    //                         ERRORS
    // =============================================================

    error NotOwner();
    error NotDepositPool();
    error ContractPaused();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientAllowance();
    error DepositPoolAlreadySet();

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyDepositPool() {
        if (msg.sender != depositPool) revert NotDepositPool();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor() {
        owner = msg.sender;
    }

    // =============================================================
    //                    ERC-20 VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Returns the total supply of stQRL tokens (in shares)
     * @dev Use totalPooledQRL() for the QRL value
     * @return Total stQRL shares in circulation
     */
    function totalSupply() external view returns (uint256) {
        return _totalShares;
    }

    /**
     * @notice Returns the stQRL balance of an account (in shares)
     * @dev Returns raw shares - stable value that only changes on deposit/withdraw
     *      Use getQRLValue() for the current QRL equivalent
     * @param account The address to query
     * @return The account's share balance
     */
    function balanceOf(address account) public view returns (uint256) {
        return _shares[account];
    }

    /**
     * @notice Returns the allowance for a spender (in shares)
     * @param _owner The token owner
     * @param spender The approved spender
     * @return The allowance in shares
     */
    function allowance(address _owner, address spender) public view returns (uint256) {
        return _allowances[_owner][spender];
    }

    // =============================================================
    //                   ERC-20 WRITE FUNCTIONS
    // =============================================================

    /**
     * @notice Transfer stQRL shares to another address
     * @param to Recipient address
     * @param amount Amount of shares to transfer
     * @return success True if transfer succeeded
     */
    function transfer(address to, uint256 amount) external whenNotPaused returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @notice Approve a spender to transfer stQRL shares on your behalf
     * @param spender The address to approve
     * @param amount The amount of shares to approve
     * @return success True if approval succeeded
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfer stQRL shares from one address to another (with approval)
     * @param from Source address
     * @param to Destination address
     * @param amount Amount of shares to transfer
     * @return success True if transfer succeeded
     */
    function transferFrom(address from, address to, uint256 amount) external whenNotPaused returns (bool) {
        if (amount == 0) revert ZeroAmount();

        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance < amount) revert InsufficientAllowance();

        // Decrease allowance (unless unlimited)
        if (currentAllowance != type(uint256).max) {
            _allowances[from][msg.sender] = currentAllowance - amount;
            emit Approval(from, msg.sender, _allowances[from][msg.sender]);
        }

        _transfer(from, to, amount);
        return true;
    }

    // =============================================================
    //                    SHARE VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Returns the total shares in existence
     * @dev Same as totalSupply() in fixed-balance model
     * @return Total shares
     */
    function totalShares() external view returns (uint256) {
        return _totalShares;
    }

    /**
     * @notice Returns the shares held by an account
     * @dev Same as balanceOf() in fixed-balance model
     * @param account The address to query
     * @return The account's share balance
     */
    function sharesOf(address account) external view returns (uint256) {
        return _shares[account];
    }

    /**
     * @notice Returns the current QRL value of an account's shares
     * @dev This is what would have been balanceOf() in a rebasing model
     *      Value changes as rewards accrue or slashing occurs
     * @param account The address to query
     * @return The account's stQRL value in QRL terms
     */
    function getQRLValue(address account) public view returns (uint256) {
        return getPooledQRLByShares(_shares[account]);
    }

    /**
     * @notice Convert a QRL amount to shares
     * @dev shares = qrlAmount * totalShares / totalPooledQRL
     * @param qrlAmount The QRL amount to convert
     * @return The equivalent number of shares
     */
    function getSharesByPooledQRL(uint256 qrlAmount) public view returns (uint256) {
        // If no shares exist yet, 1:1 ratio
        if (_totalShares == 0) {
            return qrlAmount * INITIAL_SHARES_PER_QRL;
        }
        // If no pooled QRL (shouldn't happen with shares > 0, but be safe)
        if (_totalPooledQRL == 0) {
            return qrlAmount * INITIAL_SHARES_PER_QRL;
        }
        return (qrlAmount * _totalShares) / _totalPooledQRL;
    }

    /**
     * @notice Convert shares to QRL amount
     * @dev qrlAmount = shares * totalPooledQRL / totalShares
     * @param sharesAmount The shares to convert
     * @return The equivalent QRL amount
     */
    function getPooledQRLByShares(uint256 sharesAmount) public view returns (uint256) {
        if (_totalShares == 0) {
            return 0;
        }
        return (sharesAmount * _totalPooledQRL) / _totalShares;
    }

    /**
     * @notice Returns the total QRL controlled by the protocol
     * @dev This is the sum of all staked QRL plus rewards minus slashing
     * @return Total pooled QRL
     */
    function totalPooledQRL() external view returns (uint256) {
        return _totalPooledQRL;
    }

    /**
     * @notice Returns the current exchange rate (QRL per share, scaled by 1e18)
     * @dev Useful for UI display and calculations
     * @return Exchange rate (1e18 = 1:1)
     */
    function getExchangeRate() external view returns (uint256) {
        if (_totalShares == 0) {
            return 1e18;
        }
        return (_totalPooledQRL * 1e18) / _totalShares;
    }

    // =============================================================
    //                  DEPOSIT POOL FUNCTIONS
    // =============================================================

    /**
     * @notice Mint new shares to a recipient
     * @dev Only callable by DepositPool when user deposits QRL
     * @param to Recipient of the new shares
     * @param qrlAmount Amount of QRL being deposited
     * @return shares Number of shares minted
     */
    function mintShares(address to, uint256 qrlAmount) external onlyDepositPool whenNotPaused returns (uint256 shares) {
        if (to == address(0)) revert ZeroAddress();
        if (qrlAmount == 0) revert ZeroAmount();

        shares = getSharesByPooledQRL(qrlAmount);
        if (shares == 0) revert ZeroAmount();

        _totalShares += shares;
        _shares[to] += shares;

        // Note: totalPooledQRL is updated separately via updateTotalPooledQRL
        // This allows DepositPool to batch updates

        emit SharesMinted(to, shares, qrlAmount);
        emit Transfer(address(0), to, shares);

        return shares;
    }

    /**
     * @notice Burn shares from an account
     * @dev Only callable by DepositPool when user withdraws QRL
     * @param from Account to burn shares from
     * @param sharesAmount Number of shares to burn
     * @return qrlAmount Amount of QRL the burned shares were worth
     */
    function burnShares(address from, uint256 sharesAmount)
        external
        onlyDepositPool
        whenNotPaused
        returns (uint256 qrlAmount)
    {
        if (from == address(0)) revert ZeroAddress();
        if (sharesAmount == 0) revert ZeroAmount();
        if (_shares[from] < sharesAmount) revert InsufficientBalance();

        qrlAmount = getPooledQRLByShares(sharesAmount);

        _shares[from] -= sharesAmount;
        _totalShares -= sharesAmount;

        // Note: totalPooledQRL is updated separately via updateTotalPooledQRL

        emit SharesBurned(from, sharesAmount, qrlAmount);
        emit Transfer(from, address(0), sharesAmount);

        return qrlAmount;
    }

    /**
     * @notice Update the total pooled QRL
     * @dev Called by DepositPool after syncing rewards/slashing
     *      This changes the exchange rate (affects getQRLValue, not balanceOf)
     * @param newTotalPooledQRL The new total pooled QRL amount
     */
    function updateTotalPooledQRL(uint256 newTotalPooledQRL) external onlyDepositPool {
        uint256 previousAmount = _totalPooledQRL;
        _totalPooledQRL = newTotalPooledQRL;
        emit TotalPooledQRLUpdated(previousAmount, newTotalPooledQRL);
    }

    // =============================================================
    //                    INTERNAL FUNCTIONS
    // =============================================================

    /**
     * @dev Internal transfer logic - amount is in shares
     */
    function _transfer(address from, address to, uint256 amount) internal {
        if (from == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_shares[from] < amount) revert InsufficientBalance();

        _shares[from] -= amount;
        _shares[to] += amount;

        emit Transfer(from, to, amount);
    }

    /**
     * @dev Internal approve logic - amount is in shares
     */
    function _approve(address _owner, address spender, uint256 amount) internal {
        if (_owner == address(0)) revert ZeroAddress();
        if (spender == address(0)) revert ZeroAddress();

        _allowances[_owner][spender] = amount;
        emit Approval(_owner, spender, amount);
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Set the DepositPool contract address
     * @dev Can only be called once by owner
     * @param _depositPool The DepositPool contract address
     */
    function setDepositPool(address _depositPool) external onlyOwner {
        if (_depositPool == address(0)) revert ZeroAddress();
        if (depositPool != address(0)) revert DepositPoolAlreadySet();

        emit DepositPoolSet(depositPool, _depositPool);
        depositPool = _depositPool;
    }

    /**
     * @notice Pause the contract
     * @dev Blocks transfers, minting, and burning
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
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Renounce ownership (irreversible)
     * @dev Use after DepositPool is set and system is stable
     */
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
