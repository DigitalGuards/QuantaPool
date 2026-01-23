// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ValidatorManager.sol";

/**
 * @title ValidatorManager Tests
 * @notice Unit tests for validator lifecycle management
 */
contract ValidatorManagerTest is Test {
    ValidatorManager public manager;
    address public owner;
    address public depositPool;
    address public operator;
    address public randomUser;

    // Dilithium pubkey is 2592 bytes
    uint256 constant PUBKEY_LENGTH = 2592;
    uint256 constant VALIDATOR_STAKE = 10_000 ether;

    // Events to test
    event ValidatorRegistered(uint256 indexed validatorId, bytes pubkey, ValidatorManager.ValidatorStatus status);
    event ValidatorActivated(uint256 indexed validatorId, uint256 activatedBlock);
    event ValidatorExitRequested(uint256 indexed validatorId, uint256 requestBlock);
    event ValidatorExited(uint256 indexed validatorId, uint256 exitedBlock);
    event ValidatorSlashed(uint256 indexed validatorId, uint256 slashedBlock);
    event DepositPoolSet(address indexed depositPool);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        owner = address(this);
        depositPool = address(0x1);
        operator = address(0x2);
        randomUser = address(0x3);

        manager = new ValidatorManager();
        manager.setDepositPool(depositPool);
    }

    // =========================================================================
    //                              HELPERS
    // =========================================================================

    function _generatePubkey(uint256 seed) internal pure returns (bytes memory) {
        bytes memory pubkey = new bytes(PUBKEY_LENGTH);
        for (uint256 i = 0; i < PUBKEY_LENGTH; i++) {
            pubkey[i] = bytes1(uint8(uint256(keccak256(abi.encodePacked(seed, i))) % 256));
        }
        return pubkey;
    }

    function _registerValidator(uint256 seed) internal returns (uint256 validatorId, bytes memory pubkey) {
        pubkey = _generatePubkey(seed);
        vm.prank(depositPool);
        validatorId = manager.registerValidator(pubkey);
    }

    function _registerAndActivate(uint256 seed) internal returns (uint256 validatorId, bytes memory pubkey) {
        (validatorId, pubkey) = _registerValidator(seed);
        manager.activateValidator(validatorId);
    }

    // =========================================================================
    //                           INITIALIZATION TESTS
    // =========================================================================

    function test_InitialState() public view {
        assertEq(manager.owner(), owner);
        assertEq(manager.depositPool(), depositPool);
        assertEq(manager.totalValidators(), 0);
        assertEq(manager.activeValidatorCount(), 0);
        assertEq(manager.pendingValidatorCount(), 0);
        assertEq(manager.VALIDATOR_STAKE(), VALIDATOR_STAKE);
    }

    function test_GetStats_Initial() public view {
        (uint256 total, uint256 pending, uint256 active, uint256 totalStaked) = manager.getStats();
        assertEq(total, 0);
        assertEq(pending, 0);
        assertEq(active, 0);
        assertEq(totalStaked, 0);
    }

    // =========================================================================
    //                       VALIDATOR REGISTRATION TESTS
    // =========================================================================

    function test_RegisterValidator() public {
        bytes memory pubkey = _generatePubkey(1);

        vm.prank(depositPool);
        uint256 validatorId = manager.registerValidator(pubkey);

        assertEq(validatorId, 1);
        assertEq(manager.totalValidators(), 1);
        assertEq(manager.pendingValidatorCount(), 1);
        assertEq(manager.activeValidatorCount(), 0);

        (
            bytes memory storedPubkey,
            ValidatorManager.ValidatorStatus status,
            uint256 activatedBlock,
            uint256 exitedBlock
        ) = manager.getValidator(validatorId);

        assertEq(storedPubkey, pubkey);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Pending));
        assertEq(activatedBlock, 0);
        assertEq(exitedBlock, 0);
    }

    function test_RegisterValidator_EmitsEvent() public {
        bytes memory pubkey = _generatePubkey(1);

        vm.expectEmit(true, false, false, true);
        emit ValidatorRegistered(1, pubkey, ValidatorManager.ValidatorStatus.Pending);

        vm.prank(depositPool);
        manager.registerValidator(pubkey);
    }

    function test_RegisterValidator_ByOwner() public {
        bytes memory pubkey = _generatePubkey(1);
        uint256 validatorId = manager.registerValidator(pubkey);
        assertEq(validatorId, 1);
    }

    function test_RegisterValidator_NotAuthorized_Reverts() public {
        bytes memory pubkey = _generatePubkey(1);

        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotAuthorized.selector);
        manager.registerValidator(pubkey);
    }

    function test_RegisterValidator_InvalidPubkeyLength_Reverts() public {
        bytes memory shortPubkey = new bytes(100);

        vm.prank(depositPool);
        vm.expectRevert(ValidatorManager.InvalidPubkeyLength.selector);
        manager.registerValidator(shortPubkey);
    }

    function test_RegisterValidator_EmptyPubkey_Reverts() public {
        bytes memory emptyPubkey = new bytes(0);

        vm.prank(depositPool);
        vm.expectRevert(ValidatorManager.InvalidPubkeyLength.selector);
        manager.registerValidator(emptyPubkey);
    }

    function test_RegisterValidator_Duplicate_Reverts() public {
        bytes memory pubkey = _generatePubkey(1);

        vm.prank(depositPool);
        manager.registerValidator(pubkey);

        vm.prank(depositPool);
        vm.expectRevert(ValidatorManager.ValidatorAlreadyExists.selector);
        manager.registerValidator(pubkey);
    }

    function test_RegisterValidator_MultipleValidators() public {
        for (uint256 i = 1; i <= 5; i++) {
            bytes memory pubkey = _generatePubkey(i);
            vm.prank(depositPool);
            uint256 validatorId = manager.registerValidator(pubkey);
            assertEq(validatorId, i);
        }

        assertEq(manager.totalValidators(), 5);
        assertEq(manager.pendingValidatorCount(), 5);
    }

    // =========================================================================
    //                       VALIDATOR ACTIVATION TESTS
    // =========================================================================

    function test_ActivateValidator() public {
        (uint256 validatorId,) = _registerValidator(1);

        assertEq(manager.pendingValidatorCount(), 1);
        assertEq(manager.activeValidatorCount(), 0);

        manager.activateValidator(validatorId);

        assertEq(manager.pendingValidatorCount(), 0);
        assertEq(manager.activeValidatorCount(), 1);

        (, ValidatorManager.ValidatorStatus status, uint256 activatedBlock,) = manager.getValidator(validatorId);

        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Active));
        assertEq(activatedBlock, block.number);
    }

    function test_ActivateValidator_EmitsEvent() public {
        (uint256 validatorId,) = _registerValidator(1);

        vm.expectEmit(true, false, false, true);
        emit ValidatorActivated(validatorId, block.number);

        manager.activateValidator(validatorId);
    }

    function test_ActivateValidator_NotOwner_Reverts() public {
        (uint256 validatorId,) = _registerValidator(1);

        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotOwner.selector);
        manager.activateValidator(validatorId);
    }

    function test_ActivateValidator_NotPending_Reverts() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        // Already active, cannot activate again
        vm.expectRevert(ValidatorManager.InvalidStatusTransition.selector);
        manager.activateValidator(validatorId);
    }

    function test_ActivateValidator_NonExistent_Reverts() public {
        // Validator 999 doesn't exist (status is None)
        vm.expectRevert(ValidatorManager.InvalidStatusTransition.selector);
        manager.activateValidator(999);
    }

    // =========================================================================
    //                       BATCH ACTIVATION TESTS
    // =========================================================================

    function test_BatchActivateValidators() public {
        // Register 5 validators
        uint256[] memory ids = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            (ids[i],) = _registerValidator(i + 1);
        }

        assertEq(manager.pendingValidatorCount(), 5);
        assertEq(manager.activeValidatorCount(), 0);

        manager.batchActivateValidators(ids);

        assertEq(manager.pendingValidatorCount(), 0);
        assertEq(manager.activeValidatorCount(), 5);
    }

    function test_BatchActivateValidators_SkipsNonPending() public {
        // Register 3 validators
        (uint256 id1,) = _registerValidator(1);
        (uint256 id2,) = _registerValidator(2);
        (uint256 id3,) = _registerValidator(3);

        // Activate id2 individually first
        manager.activateValidator(id2);

        uint256[] memory ids = new uint256[](3);
        ids[0] = id1;
        ids[1] = id2; // Already active, should be skipped
        ids[2] = id3;

        manager.batchActivateValidators(ids);

        // All should be active now
        assertEq(manager.pendingValidatorCount(), 0);
        assertEq(manager.activeValidatorCount(), 3);
    }

    function test_BatchActivateValidators_EmptyArray() public {
        uint256[] memory ids = new uint256[](0);
        manager.batchActivateValidators(ids);
        // Should not revert, just do nothing
    }

    function test_BatchActivateValidators_NotOwner_Reverts() public {
        (uint256 validatorId,) = _registerValidator(1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = validatorId;

        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotOwner.selector);
        manager.batchActivateValidators(ids);
    }

    // =========================================================================
    //                       EXIT REQUEST TESTS
    // =========================================================================

    function test_RequestValidatorExit() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        manager.requestValidatorExit(validatorId);

        (, ValidatorManager.ValidatorStatus status,,) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Exiting));

        // Counter should still show as active (exiting validators count as active until fully exited)
        assertEq(manager.activeValidatorCount(), 1);
    }

    function test_RequestValidatorExit_EmitsEvent() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        vm.expectEmit(true, false, false, true);
        emit ValidatorExitRequested(validatorId, block.number);

        manager.requestValidatorExit(validatorId);
    }

    function test_RequestValidatorExit_NotOwner_Reverts() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotOwner.selector);
        manager.requestValidatorExit(validatorId);
    }

    function test_RequestValidatorExit_NotActive_Reverts() public {
        (uint256 validatorId,) = _registerValidator(1);

        // Still pending, cannot request exit
        vm.expectRevert(ValidatorManager.InvalidStatusTransition.selector);
        manager.requestValidatorExit(validatorId);
    }

    // =========================================================================
    //                       MARK EXITED TESTS
    // =========================================================================

    function test_MarkValidatorExited() public {
        (uint256 validatorId,) = _registerAndActivate(1);
        manager.requestValidatorExit(validatorId);

        assertEq(manager.activeValidatorCount(), 1);

        manager.markValidatorExited(validatorId);

        (, ValidatorManager.ValidatorStatus status,, uint256 exitedBlock) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Exited));
        assertEq(exitedBlock, block.number);
        assertEq(manager.activeValidatorCount(), 0);
    }

    function test_MarkValidatorExited_EmitsEvent() public {
        (uint256 validatorId,) = _registerAndActivate(1);
        manager.requestValidatorExit(validatorId);

        vm.expectEmit(true, false, false, true);
        emit ValidatorExited(validatorId, block.number);

        manager.markValidatorExited(validatorId);
    }

    function test_MarkValidatorExited_NotOwner_Reverts() public {
        (uint256 validatorId,) = _registerAndActivate(1);
        manager.requestValidatorExit(validatorId);

        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotOwner.selector);
        manager.markValidatorExited(validatorId);
    }

    function test_MarkValidatorExited_NotExiting_Reverts() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        // Still active, not exiting
        vm.expectRevert(ValidatorManager.InvalidStatusTransition.selector);
        manager.markValidatorExited(validatorId);
    }

    // =========================================================================
    //                       SLASHING TESTS (M-1 FIX VERIFICATION)
    // =========================================================================

    function test_MarkValidatorSlashed_FromActive() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        assertEq(manager.activeValidatorCount(), 1);

        manager.markValidatorSlashed(validatorId);

        (, ValidatorManager.ValidatorStatus status,, uint256 exitedBlock) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Slashed));
        assertEq(exitedBlock, block.number);

        // M-1 FIX: Counter should decrement when slashing from Active
        assertEq(manager.activeValidatorCount(), 0);
    }

    function test_MarkValidatorSlashed_FromExiting() public {
        (uint256 validatorId,) = _registerAndActivate(1);
        manager.requestValidatorExit(validatorId);

        assertEq(manager.activeValidatorCount(), 1);

        manager.markValidatorSlashed(validatorId);

        (, ValidatorManager.ValidatorStatus status,,) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Slashed));

        // Counter should decrement - Exiting validators still count as active
        assertEq(manager.activeValidatorCount(), 0);
    }

    function test_MarkValidatorSlashed_MultipleActiveValidators() public {
        // Register and activate 3 validators
        (uint256 id1,) = _registerAndActivate(1);
        (uint256 id2,) = _registerAndActivate(2);
        (uint256 id3,) = _registerAndActivate(3);

        assertEq(manager.activeValidatorCount(), 3);

        // Slash the middle one
        manager.markValidatorSlashed(id2);

        // M-1 FIX: Counter should be 2 now
        assertEq(manager.activeValidatorCount(), 2);

        // Slash another
        manager.markValidatorSlashed(id1);
        assertEq(manager.activeValidatorCount(), 1);

        // Slash the last one
        manager.markValidatorSlashed(id3);
        assertEq(manager.activeValidatorCount(), 0);
    }

    function test_MarkValidatorSlashed_EmitsEvent() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        vm.expectEmit(true, false, false, true);
        emit ValidatorSlashed(validatorId, block.number);

        manager.markValidatorSlashed(validatorId);
    }

    function test_MarkValidatorSlashed_NotOwner_Reverts() public {
        (uint256 validatorId,) = _registerAndActivate(1);

        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotOwner.selector);
        manager.markValidatorSlashed(validatorId);
    }

    function test_MarkValidatorSlashed_FromPending_Reverts() public {
        (uint256 validatorId,) = _registerValidator(1);

        vm.expectRevert(ValidatorManager.InvalidStatusTransition.selector);
        manager.markValidatorSlashed(validatorId);
    }

    function test_MarkValidatorSlashed_FromExited_Reverts() public {
        (uint256 validatorId,) = _registerAndActivate(1);
        manager.requestValidatorExit(validatorId);
        manager.markValidatorExited(validatorId);

        vm.expectRevert(ValidatorManager.InvalidStatusTransition.selector);
        manager.markValidatorSlashed(validatorId);
    }

    function test_MarkValidatorSlashed_AlreadySlashed_Reverts() public {
        (uint256 validatorId,) = _registerAndActivate(1);
        manager.markValidatorSlashed(validatorId);

        vm.expectRevert(ValidatorManager.InvalidStatusTransition.selector);
        manager.markValidatorSlashed(validatorId);
    }

    // =========================================================================
    //                       VIEW FUNCTION TESTS
    // =========================================================================

    function test_GetValidatorIdByPubkey() public {
        bytes memory pubkey = _generatePubkey(42);

        vm.prank(depositPool);
        uint256 validatorId = manager.registerValidator(pubkey);

        uint256 lookupId = manager.getValidatorIdByPubkey(pubkey);
        assertEq(lookupId, validatorId);
    }

    function test_GetValidatorIdByPubkey_NotFound() public view {
        bytes memory unknownPubkey = _generatePubkey(999);
        uint256 lookupId = manager.getValidatorIdByPubkey(unknownPubkey);
        assertEq(lookupId, 0);
    }

    function test_GetValidatorStatus() public {
        bytes memory pubkey = _generatePubkey(1);

        vm.prank(depositPool);
        manager.registerValidator(pubkey);

        ValidatorManager.ValidatorStatus status = manager.getValidatorStatus(pubkey);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Pending));
    }

    function test_GetValidatorStatus_NotFound() public view {
        bytes memory unknownPubkey = _generatePubkey(999);
        ValidatorManager.ValidatorStatus status = manager.getValidatorStatus(unknownPubkey);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.None));
    }

    function test_GetStats() public {
        // Register 3 validators
        _registerValidator(1);
        _registerValidator(2);
        (uint256 id3,) = _registerValidator(3);

        // Activate 1
        manager.activateValidator(id3);

        (uint256 total, uint256 pending, uint256 active, uint256 totalStaked) = manager.getStats();

        assertEq(total, 3);
        assertEq(pending, 2);
        assertEq(active, 1);
        assertEq(totalStaked, VALIDATOR_STAKE);
    }

    function test_GetValidatorsByStatus() public {
        // Register 5 validators
        _registerValidator(1);
        (uint256 id2,) = _registerValidator(2);
        _registerValidator(3);
        (uint256 id4,) = _registerValidator(4);
        _registerValidator(5);

        // Activate some
        manager.activateValidator(id2);
        manager.activateValidator(id4);

        // Get pending validators
        uint256[] memory pendingIds = manager.getValidatorsByStatus(ValidatorManager.ValidatorStatus.Pending);
        assertEq(pendingIds.length, 3);

        // Get active validators
        uint256[] memory activeIds = manager.getValidatorsByStatus(ValidatorManager.ValidatorStatus.Active);
        assertEq(activeIds.length, 2);
        assertEq(activeIds[0], id2);
        assertEq(activeIds[1], id4);

        // Request exit for one
        manager.requestValidatorExit(id2);
        uint256[] memory exitingIds = manager.getValidatorsByStatus(ValidatorManager.ValidatorStatus.Exiting);
        assertEq(exitingIds.length, 1);
        assertEq(exitingIds[0], id2);
    }

    function test_GetValidatorsByStatus_None() public view {
        uint256[] memory noneIds = manager.getValidatorsByStatus(ValidatorManager.ValidatorStatus.None);
        assertEq(noneIds.length, 0);
    }

    // =========================================================================
    //                       ADMIN FUNCTION TESTS
    // =========================================================================

    function test_SetDepositPool() public {
        ValidatorManager newManager = new ValidatorManager();
        address newDepositPool = address(0x999);

        newManager.setDepositPool(newDepositPool);

        assertEq(newManager.depositPool(), newDepositPool);
    }

    function test_SetDepositPool_EmitsEvent() public {
        ValidatorManager newManager = new ValidatorManager();
        address newDepositPool = address(0x999);

        vm.expectEmit(true, false, false, false);
        emit DepositPoolSet(newDepositPool);

        newManager.setDepositPool(newDepositPool);
    }

    function test_SetDepositPool_NotOwner_Reverts() public {
        ValidatorManager newManager = new ValidatorManager();

        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotOwner.selector);
        newManager.setDepositPool(address(0x999));
    }

    function test_SetDepositPool_ZeroAddress_Reverts() public {
        ValidatorManager newManager = new ValidatorManager();

        vm.expectRevert(ValidatorManager.ZeroAddress.selector);
        newManager.setDepositPool(address(0));
    }

    function test_TransferOwnership() public {
        address newOwner = address(0x888);

        manager.transferOwnership(newOwner);

        assertEq(manager.owner(), newOwner);
    }

    function test_TransferOwnership_EmitsEvent() public {
        address newOwner = address(0x888);

        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, newOwner);

        manager.transferOwnership(newOwner);
    }

    function test_TransferOwnership_NotOwner_Reverts() public {
        vm.prank(randomUser);
        vm.expectRevert(ValidatorManager.NotOwner.selector);
        manager.transferOwnership(address(0x888));
    }

    function test_TransferOwnership_ZeroAddress_Reverts() public {
        vm.expectRevert(ValidatorManager.ZeroAddress.selector);
        manager.transferOwnership(address(0));
    }

    function test_TransferOwnership_NewOwnerCanOperate() public {
        address newOwner = address(0x888);
        manager.transferOwnership(newOwner);

        (uint256 validatorId,) = _registerValidator(1);

        // New owner can activate
        vm.prank(newOwner);
        manager.activateValidator(validatorId);

        assertEq(manager.activeValidatorCount(), 1);
    }

    // =========================================================================
    //                       FULL LIFECYCLE TEST
    // =========================================================================

    function test_FullValidatorLifecycle() public {
        // 1. Register
        bytes memory pubkey = _generatePubkey(1);
        vm.prank(depositPool);
        uint256 validatorId = manager.registerValidator(pubkey);

        (, ValidatorManager.ValidatorStatus status,,) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Pending));

        // 2. Activate
        manager.activateValidator(validatorId);
        (, status,,) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Active));

        // 3. Request exit
        manager.requestValidatorExit(validatorId);
        (, status,,) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Exiting));

        // 4. Mark exited
        manager.markValidatorExited(validatorId);
        (, status,,) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Exited));
    }

    function test_FullValidatorLifecycle_WithSlashing() public {
        // 1. Register
        bytes memory pubkey = _generatePubkey(1);
        vm.prank(depositPool);
        uint256 validatorId = manager.registerValidator(pubkey);

        // 2. Activate
        manager.activateValidator(validatorId);
        assertEq(manager.activeValidatorCount(), 1);

        // 3. Slashed while active
        manager.markValidatorSlashed(validatorId);

        (, ValidatorManager.ValidatorStatus status,,) = manager.getValidator(validatorId);
        assertEq(uint256(status), uint256(ValidatorManager.ValidatorStatus.Slashed));
        assertEq(manager.activeValidatorCount(), 0);
    }

    // =========================================================================
    //                           FUZZ TESTS
    // =========================================================================

    function testFuzz_RegisterMultipleValidators(uint8 count) public {
        vm.assume(count > 0 && count <= 50);

        for (uint256 i = 1; i <= count; i++) {
            bytes memory pubkey = _generatePubkey(i);
            vm.prank(depositPool);
            uint256 validatorId = manager.registerValidator(pubkey);
            assertEq(validatorId, i);
        }

        assertEq(manager.totalValidators(), count);
        assertEq(manager.pendingValidatorCount(), count);
    }

    function testFuzz_SlashingCounterCorrectness(uint8 activeCount, uint8 slashCount) public {
        vm.assume(activeCount > 0 && activeCount <= 20);
        vm.assume(slashCount <= activeCount);

        // Register and activate validators
        uint256[] memory ids = new uint256[](activeCount);
        for (uint256 i = 0; i < activeCount; i++) {
            (ids[i],) = _registerAndActivate(i + 1);
        }

        assertEq(manager.activeValidatorCount(), activeCount);

        // Slash some validators
        for (uint256 i = 0; i < slashCount; i++) {
            manager.markValidatorSlashed(ids[i]);
        }

        // Verify counter is correct (M-1 fix verification)
        assertEq(manager.activeValidatorCount(), activeCount - slashCount);
    }
}
