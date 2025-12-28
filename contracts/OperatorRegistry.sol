// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title OperatorRegistry - Manages node operators and validators
 * @dev Tracks operator bonds, validators, and commission
 *
 * MVP: Single operator (owner)
 * Future: Permissionless operator registration
 */

contract OperatorRegistry {
    // =============================================================
    //                          CONSTANTS
    // =============================================================

    /// @notice Minimum bond for quarter minipool (10,000 QRL)
    uint256 public constant QUARTER_BOND = 10_000 ether;

    /// @notice Minimum bond for half minipool (20,000 QRL)
    uint256 public constant HALF_BOND = 20_000 ether;

    /// @notice Full validator stake
    uint256 public constant VALIDATOR_STAKE = 40_000 ether;

    // =============================================================
    //                          STORAGE
    // =============================================================

    /// @notice Owner address
    address public owner;

    /// @notice Commission rate in basis points (1000 = 10%)
    uint256 public commissionRate;

    /// @notice Minimum collateral per operator
    uint256 public minCollateral;

    /// @notice Operator data
    struct Operator {
        bool registered;
        bool active;
        uint256 bondAmount;
        uint256 collateral;
        uint256 validatorCount;
        uint256 pendingRewards;
    }

    /// @notice Registered operators
    mapping(address => Operator) public operators;

    /// @notice List of operator addresses
    address[] public operatorList;

    /// @notice Validator public keys (Dilithium)
    bytes[] public validatorPubkeys;

    /// @notice Validator to operator mapping
    mapping(bytes32 => address) public validatorOperator;

    /// @notice Total active validators
    uint256 public totalValidators;

    // =============================================================
    //                          EVENTS
    // =============================================================

    event OperatorRegistered(address indexed operator, uint256 bondAmount, uint256 collateral);
    event OperatorDeactivated(address indexed operator, string reason);
    event ValidatorAdded(address indexed operator, bytes pubkey);
    event ValidatorRemoved(address indexed operator, bytes pubkey);
    event CommissionUpdated(uint256 newRate);
    event RewardsDistributed(uint256 totalRewards, uint256 commission);
    event RewardsClaimed(address indexed operator, uint256 amount);

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "OperatorRegistry: not owner");
        _;
    }

    modifier onlyOperator() {
        require(operators[msg.sender].registered, "OperatorRegistry: not operator");
        _;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor() {
        owner = msg.sender;
        commissionRate = 1000; // 10% default
        minCollateral = 5_000 ether; // 5,000 QRL minimum collateral

        // Register owner as initial operator (MVP)
        _registerOperator(msg.sender, 0, 0);
    }

    // =============================================================
    //                   OPERATOR FUNCTIONS
    // =============================================================

    /// @notice Register as a node operator
    /// @param bondType 0 = quarter bond (10k), 1 = half bond (20k)
    function registerOperator(uint256 bondType) external payable {
        require(!operators[msg.sender].registered, "OperatorRegistry: already registered");

        uint256 requiredBond = bondType == 0 ? QUARTER_BOND : HALF_BOND;
        require(msg.value >= requiredBond + minCollateral, "OperatorRegistry: insufficient deposit");

        uint256 collateral = msg.value - requiredBond;

        _registerOperator(msg.sender, requiredBond, collateral);

        emit OperatorRegistered(msg.sender, requiredBond, collateral);
    }

    function _registerOperator(address operator, uint256 bond, uint256 collateral) internal {
        operators[operator] = Operator({
            registered: true,
            active: true,
            bondAmount: bond,
            collateral: collateral,
            validatorCount: 0,
            pendingRewards: 0
        });
        operatorList.push(operator);
    }

    /// @notice Add a validator (MVP: owner only)
    /// @param pubkey Dilithium public key of the validator
    function addValidator(bytes calldata pubkey) external onlyOwner {
        require(pubkey.length > 0, "OperatorRegistry: empty pubkey");

        bytes32 pubkeyHash = keccak256(pubkey);
        require(validatorOperator[pubkeyHash] == address(0), "OperatorRegistry: validator exists");

        Operator storage op = operators[msg.sender];
        require(op.active, "OperatorRegistry: operator not active");

        validatorPubkeys.push(pubkey);
        validatorOperator[pubkeyHash] = msg.sender;
        op.validatorCount++;
        totalValidators++;

        emit ValidatorAdded(msg.sender, pubkey);
    }

    /// @notice Remove a validator (for exits)
    function removeValidator(bytes calldata pubkey) external onlyOwner {
        bytes32 pubkeyHash = keccak256(pubkey);
        address operator = validatorOperator[pubkeyHash];
        require(operator != address(0), "OperatorRegistry: validator not found");

        operators[operator].validatorCount--;
        validatorOperator[pubkeyHash] = address(0);
        totalValidators--;

        emit ValidatorRemoved(operator, pubkey);
    }

    /// @notice Distribute rewards to operators (called by RewardsOracle)
    /// @param totalRewards Total rewards to distribute
    function distributeRewards(uint256 totalRewards) external payable {
        require(msg.value == totalRewards, "OperatorRegistry: incorrect value");
        require(totalValidators > 0, "OperatorRegistry: no validators");

        // Calculate commission
        uint256 totalCommission = (totalRewards * commissionRate) / 10000;
        uint256 rewardsPerValidator = totalCommission / totalValidators;

        // Distribute to operators based on validator count
        for (uint256 i = 0; i < operatorList.length; i++) {
            Operator storage op = operators[operatorList[i]];
            if (op.validatorCount > 0) {
                op.pendingRewards += rewardsPerValidator * op.validatorCount;
            }
        }

        emit RewardsDistributed(totalRewards, totalCommission);
    }

    /// @notice Claim accumulated rewards
    function claimRewards() external onlyOperator {
        Operator storage op = operators[msg.sender];
        uint256 rewards = op.pendingRewards;
        require(rewards > 0, "OperatorRegistry: no rewards");

        op.pendingRewards = 0;

        (bool success, ) = msg.sender.call{value: rewards}("");
        require(success, "OperatorRegistry: transfer failed");

        emit RewardsClaimed(msg.sender, rewards);
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /// @notice Get operator info
    function getOperator(address operator) external view returns (
        bool registered,
        bool active,
        uint256 bondAmount,
        uint256 collateral,
        uint256 validatorCount,
        uint256 pendingRewards
    ) {
        Operator storage op = operators[operator];
        return (
            op.registered,
            op.active,
            op.bondAmount,
            op.collateral,
            op.validatorCount,
            op.pendingRewards
        );
    }

    /// @notice Get all validator pubkeys
    function getValidators() external view returns (bytes[] memory) {
        return validatorPubkeys;
    }

    /// @notice Get operator count
    function getOperatorCount() external view returns (uint256) {
        return operatorList.length;
    }

    /// @notice Calculate pooled amount needed for operator bond
    function getPooledAmount(address operator) external view returns (uint256) {
        return VALIDATOR_STAKE - operators[operator].bondAmount;
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    function setCommissionRate(uint256 _rate) external onlyOwner {
        require(_rate >= 500 && _rate <= 2000, "OperatorRegistry: rate must be 5-20%");
        commissionRate = _rate;
        emit CommissionUpdated(_rate);
    }

    function setMinCollateral(uint256 _minCollateral) external onlyOwner {
        minCollateral = _minCollateral;
    }

    function deactivateOperator(address operator) external onlyOwner {
        require(operators[operator].registered, "OperatorRegistry: not registered");
        operators[operator].active = false;
        emit OperatorDeactivated(operator, "Admin action");
    }

    function activateOperator(address operator) external onlyOwner {
        require(operators[operator].registered, "OperatorRegistry: not registered");
        operators[operator].active = true;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OperatorRegistry: zero address");
        owner = newOwner;
    }

    /// @notice Emergency withdraw (for stuck funds)
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "OperatorRegistry: zero address");
        (bool success, ) = to.call{value: amount}("");
        require(success, "OperatorRegistry: transfer failed");
    }

    // Allow receiving QRL
    receive() external payable {}
}
