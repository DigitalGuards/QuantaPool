// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

/**
 * @title ValidatorManager - Simplified Validator Tracking for QuantaPool
 * @author QuantaPool
 * @notice Tracks validator pubkeys and status for the liquid staking pool
 *
 * @dev MVP Design:
 *   - Single trusted operator (owner)
 *   - No bonds, collateral, or complex economics
 *   - Simple validator state machine: Pending → Active → Exiting → Exited
 *   - Future: Permissionless operator registration
 *
 * This contract is intentionally minimal. Complex operator economics
 * can be added in v3 after the core staking mechanism is proven.
 */
contract ValidatorManager {
    // =============================================================
    //                          CONSTANTS
    // =============================================================

    /// @notice Zond validator stake amount
    uint256 public constant VALIDATOR_STAKE = 10_000 ether;

    /// @notice Dilithium pubkey length
    uint256 private constant PUBKEY_LENGTH = 2592;

    // =============================================================
    //                           ENUMS
    // =============================================================

    /// @notice Validator lifecycle states
    enum ValidatorStatus {
        None,       // Not registered
        Pending,    // Registered, awaiting activation
        Active,     // Currently validating
        Exiting,    // Exit requested
        Exited,     // Fully exited, funds returned
        Slashed     // Slashed (for record keeping)
    }

    // =============================================================
    //                          STRUCTS
    // =============================================================

    /// @notice Validator data
    struct Validator {
        bytes pubkey;           // Dilithium public key (2592 bytes)
        ValidatorStatus status; // Current status
        uint256 activatedBlock; // Block when activated
        uint256 exitedBlock;    // Block when exited (0 if not exited)
    }

    // =============================================================
    //                          STORAGE
    // =============================================================

    /// @notice Contract owner (operator for MVP)
    address public owner;

    /// @notice DepositPool contract (authorized to register validators)
    address public depositPool;

    /// @notice Validator data by index
    mapping(uint256 => Validator) public validators;

    /// @notice Pubkey hash to validator index
    mapping(bytes32 => uint256) public pubkeyToIndex;

    /// @notice Total validators ever registered
    uint256 public totalValidators;

    /// @notice Count of active validators
    uint256 public activeValidatorCount;

    /// @notice Count of pending validators
    uint256 public pendingValidatorCount;

    // =============================================================
    //                          EVENTS
    // =============================================================

    event ValidatorRegistered(
        uint256 indexed validatorId,
        bytes pubkey,
        ValidatorStatus status
    );

    event ValidatorActivated(
        uint256 indexed validatorId,
        uint256 activatedBlock
    );

    event ValidatorExitRequested(
        uint256 indexed validatorId,
        uint256 requestBlock
    );

    event ValidatorExited(
        uint256 indexed validatorId,
        uint256 exitedBlock
    );

    event ValidatorSlashed(
        uint256 indexed validatorId,
        uint256 slashedBlock
    );

    event DepositPoolSet(address indexed depositPool);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // =============================================================
    //                          ERRORS
    // =============================================================

    error NotOwner();
    error NotDepositPool();
    error NotAuthorized();
    error ZeroAddress();
    error InvalidPubkeyLength();
    error ValidatorAlreadyExists();
    error ValidatorNotFound();
    error InvalidStatusTransition();

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

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != depositPool) revert NotAuthorized();
        _;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor() {
        owner = msg.sender;
    }

    // =============================================================
    //                  VALIDATOR REGISTRATION
    // =============================================================

    /**
     * @notice Register a new validator
     * @dev Called by DepositPool when funding a validator
     * @param pubkey Dilithium public key (2592 bytes)
     * @return validatorId The new validator's index
     */
    function registerValidator(bytes calldata pubkey)
        external
        onlyAuthorized
        returns (uint256 validatorId)
    {
        if (pubkey.length != PUBKEY_LENGTH) revert InvalidPubkeyLength();

        bytes32 pubkeyHash = keccak256(pubkey);
        if (pubkeyToIndex[pubkeyHash] != 0) revert ValidatorAlreadyExists();

        // Validator IDs start at 1 (0 means not found)
        validatorId = ++totalValidators;

        validators[validatorId] = Validator({
            pubkey: pubkey,
            status: ValidatorStatus.Pending,
            activatedBlock: 0,
            exitedBlock: 0
        });

        pubkeyToIndex[pubkeyHash] = validatorId;
        pendingValidatorCount++;

        emit ValidatorRegistered(validatorId, pubkey, ValidatorStatus.Pending);
        return validatorId;
    }

    // =============================================================
    //                    STATUS TRANSITIONS
    // =============================================================

    /**
     * @notice Mark validator as active (confirmed on beacon chain)
     * @param validatorId The validator to activate
     */
    function activateValidator(uint256 validatorId) external onlyOwner {
        Validator storage v = validators[validatorId];
        if (v.status != ValidatorStatus.Pending) revert InvalidStatusTransition();

        v.status = ValidatorStatus.Active;
        v.activatedBlock = block.number;

        pendingValidatorCount--;
        activeValidatorCount++;

        emit ValidatorActivated(validatorId, block.number);
    }

    /**
     * @notice Mark validator as exiting
     * @param validatorId The validator requesting exit
     */
    function requestValidatorExit(uint256 validatorId) external onlyOwner {
        Validator storage v = validators[validatorId];
        if (v.status != ValidatorStatus.Active) revert InvalidStatusTransition();

        v.status = ValidatorStatus.Exiting;

        emit ValidatorExitRequested(validatorId, block.number);
    }

    /**
     * @notice Mark validator as fully exited
     * @param validatorId The validator that has exited
     */
    function markValidatorExited(uint256 validatorId) external onlyOwner {
        Validator storage v = validators[validatorId];
        if (v.status != ValidatorStatus.Exiting) revert InvalidStatusTransition();

        v.status = ValidatorStatus.Exited;
        v.exitedBlock = block.number;

        activeValidatorCount--;

        emit ValidatorExited(validatorId, block.number);
    }

    /**
     * @notice Mark validator as slashed
     * @param validatorId The slashed validator
     */
    function markValidatorSlashed(uint256 validatorId) external onlyOwner {
        Validator storage v = validators[validatorId];
        if (v.status != ValidatorStatus.Active && v.status != ValidatorStatus.Exiting) {
            revert InvalidStatusTransition();
        }

        v.status = ValidatorStatus.Slashed;
        v.exitedBlock = block.number;

        if (v.status == ValidatorStatus.Active) {
            activeValidatorCount--;
        }

        emit ValidatorSlashed(validatorId, block.number);
    }

    /**
     * @notice Batch activate multiple validators
     * @param validatorIds Array of validator IDs to activate
     */
    function batchActivateValidators(uint256[] calldata validatorIds) external onlyOwner {
        for (uint256 i = 0; i < validatorIds.length; i++) {
            Validator storage v = validators[validatorIds[i]];
            if (v.status == ValidatorStatus.Pending) {
                v.status = ValidatorStatus.Active;
                v.activatedBlock = block.number;
                pendingValidatorCount--;
                activeValidatorCount++;
                emit ValidatorActivated(validatorIds[i], block.number);
            }
        }
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get validator details
     * @param validatorId The validator to query
     */
    function getValidator(uint256 validatorId) external view returns (
        bytes memory pubkey,
        ValidatorStatus status,
        uint256 activatedBlock,
        uint256 exitedBlock
    ) {
        Validator storage v = validators[validatorId];
        return (v.pubkey, v.status, v.activatedBlock, v.exitedBlock);
    }

    /**
     * @notice Get validator ID by pubkey
     * @param pubkey The pubkey to look up
     * @return validatorId (0 if not found)
     */
    function getValidatorIdByPubkey(bytes calldata pubkey) external view returns (uint256) {
        return pubkeyToIndex[keccak256(pubkey)];
    }

    /**
     * @notice Get validator status by pubkey
     * @param pubkey The pubkey to look up
     */
    function getValidatorStatus(bytes calldata pubkey) external view returns (ValidatorStatus) {
        uint256 validatorId = pubkeyToIndex[keccak256(pubkey)];
        if (validatorId == 0) return ValidatorStatus.None;
        return validators[validatorId].status;
    }

    /**
     * @notice Get summary statistics
     */
    function getStats() external view returns (
        uint256 total,
        uint256 pending,
        uint256 active,
        uint256 totalStaked
    ) {
        total = totalValidators;
        pending = pendingValidatorCount;
        active = activeValidatorCount;
        totalStaked = activeValidatorCount * VALIDATOR_STAKE;
    }

    /**
     * @notice Get all validators in a specific status
     * @param status The status to filter by
     * @return validatorIds Array of matching validator IDs
     */
    function getValidatorsByStatus(ValidatorStatus status)
        external
        view
        returns (uint256[] memory validatorIds)
    {
        // First pass: count matches
        uint256 count = 0;
        for (uint256 i = 1; i <= totalValidators; i++) {
            if (validators[i].status == status) {
                count++;
            }
        }

        // Second pass: collect IDs
        validatorIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= totalValidators; i++) {
            if (validators[i].status == status) {
                validatorIds[index++] = i;
            }
        }

        return validatorIds;
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Set the DepositPool contract
     * @param _depositPool Address of DepositPool
     */
    function setDepositPool(address _depositPool) external onlyOwner {
        if (_depositPool == address(0)) revert ZeroAddress();
        depositPool = _depositPool;
        emit DepositPoolSet(_depositPool);
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
}
