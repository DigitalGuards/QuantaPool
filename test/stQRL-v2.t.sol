// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/stQRL-v2.sol";

/**
 * @title stQRL v2 Tests
 * @notice Unit tests for the fixed-balance stQRL token
 */
contract stQRLv2Test is Test {
    stQRLv2 public token;
    address public owner;
    address public depositPool;
    address public user1;
    address public user2;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event SharesMinted(address indexed to, uint256 sharesAmount, uint256 qrlAmount);
    event SharesBurned(address indexed from, uint256 sharesAmount, uint256 qrlAmount);
    event TotalPooledQRLUpdated(uint256 previousAmount, uint256 newAmount);

    function setUp() public {
        owner = address(this);
        depositPool = address(0x1);
        user1 = address(0x2);
        user2 = address(0x3);

        token = new stQRLv2();
        token.setDepositPool(depositPool);
    }

    // =========================================================================
    //                           INITIALIZATION TESTS
    // =========================================================================

    function test_InitialState() public view {
        assertEq(token.name(), "Staked QRL");
        assertEq(token.symbol(), "stQRL");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 0);
        assertEq(token.totalShares(), 0);
        assertEq(token.totalPooledQRL(), 0);
        assertEq(token.owner(), owner);
        assertEq(token.depositPool(), depositPool);
    }

    function test_InitialExchangeRate() public view {
        // Before any deposits, exchange rate should be 1:1
        assertEq(token.getExchangeRate(), 1e18);
    }

    // =========================================================================
    //                           SHARE & VALUE MATH TESTS
    // =========================================================================

    function test_FirstDeposit_OneToOneRatio() public {
        uint256 amount = 100 ether;

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(amount);
        uint256 shares = token.mintShares(user1, amount);
        vm.stopPrank();

        // First deposit should be 1:1
        assertEq(shares, amount);
        assertEq(token.balanceOf(user1), amount); // balanceOf returns shares
        assertEq(token.sharesOf(user1), amount);
        assertEq(token.totalSupply(), amount); // totalSupply returns total shares
        assertEq(token.getQRLValue(user1), amount); // QRL value equals shares at 1:1
    }

    function test_RewardsIncreaseQRLValue() public {
        // Initial deposit of 100 QRL
        uint256 initialDeposit = 100 ether;

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(initialDeposit);
        token.mintShares(user1, initialDeposit);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), 100 ether); // shares
        assertEq(token.getQRLValue(user1), 100 ether); // QRL value

        // Simulate 10 QRL rewards (10% increase)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(110 ether);

        // User's shares remain the same (fixed-balance)
        assertEq(token.balanceOf(user1), 100 ether);
        // But QRL value increases
        assertEq(token.getQRLValue(user1), 110 ether);
        assertEq(token.sharesOf(user1), 100 ether);
    }

    function test_SlashingDecreasesQRLValue() public {
        // Initial deposit of 100 QRL
        uint256 initialDeposit = 100 ether;

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(initialDeposit);
        token.mintShares(user1, initialDeposit);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), 100 ether); // shares
        assertEq(token.getQRLValue(user1), 100 ether); // QRL value

        // Simulate 5% slashing (pool drops to 95 QRL)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(95 ether);

        // User's shares remain the same (fixed-balance)
        assertEq(token.balanceOf(user1), 100 ether);
        // But QRL value decreases
        assertEq(token.getQRLValue(user1), 95 ether);
        assertEq(token.sharesOf(user1), 100 ether);
    }

    function test_MultipleUsers_RewardDistribution() public {
        // User1 deposits 100 QRL
        // Order: mint shares FIRST (calculates at current rate), THEN update pooled
        vm.startPrank(depositPool);
        token.mintShares(user1, 100 ether);
        token.updateTotalPooledQRL(100 ether);
        vm.stopPrank();

        // User2 deposits 50 QRL (total now 150 QRL)
        // Same order: mint first (at 1:1 rate), then update
        vm.startPrank(depositPool);
        token.mintShares(user2, 50 ether);
        token.updateTotalPooledQRL(150 ether);
        vm.stopPrank();

        // Check shares (fixed-balance: balanceOf returns shares)
        assertEq(token.balanceOf(user1), 100 ether);
        assertEq(token.balanceOf(user2), 50 ether);

        // Check QRL values before rewards
        assertEq(token.getQRLValue(user1), 100 ether);
        assertEq(token.getQRLValue(user2), 50 ether);

        // Add 30 QRL rewards (20% increase, total now 180 QRL)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(180 ether);

        // Shares remain the same (fixed-balance)
        assertEq(token.balanceOf(user1), 100 ether);
        assertEq(token.balanceOf(user2), 50 ether);

        // QRL values should be distributed proportionally
        // User1 has 100/150 = 66.67% of shares -> gets 66.67% of 180 = 120 QRL
        // User2 has 50/150 = 33.33% of shares -> gets 33.33% of 180 = 60 QRL
        assertEq(token.getQRLValue(user1), 120 ether);
        assertEq(token.getQRLValue(user2), 60 ether);
    }

    function test_ShareConversion_AfterRewards() public {
        // Deposit 100 QRL
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Add 50 QRL rewards (now 150 QRL, still 100 shares)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(150 ether);

        // New deposit should get fewer shares
        // 100 QRL should get 100 * 100 / 150 = 66.67 shares
        uint256 expectedShares = token.getSharesByPooledQRL(100 ether);
        // At rate of 1.5 QRL/share, 100 QRL = 66.67 shares
        assertApproxEqRel(expectedShares, 66.67 ether, 1e16); // 1% tolerance

        // And those shares should be worth 100 QRL
        assertApproxEqRel(
            token.getPooledQRLByShares(expectedShares),
            100 ether,
            1e15 // 0.1% tolerance for rounding
        );
    }

    // =========================================================================
    //                           EDGE CASE TESTS
    // =========================================================================

    function test_ZeroShares_ReturnsZeroBalance() public view {
        assertEq(token.balanceOf(user1), 0);
        assertEq(token.getPooledQRLByShares(0), 0);
    }

    function test_ZeroPooled_ZeroTotalShares() public view {
        // Before any deposits
        assertEq(token.getSharesByPooledQRL(100 ether), 100 ether);
        assertEq(token.getPooledQRLByShares(100 ether), 0);
    }

    function test_LargeNumbers() public {
        uint256 largeAmount = 1_000_000_000 ether; // 1 billion QRL

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(largeAmount);
        token.mintShares(user1, largeAmount);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), largeAmount); // shares
        assertEq(token.getQRLValue(user1), largeAmount); // QRL value

        // Add 10% rewards
        uint256 newTotal = largeAmount + (largeAmount / 10);
        vm.prank(depositPool);
        token.updateTotalPooledQRL(newTotal);

        // Shares unchanged (fixed-balance)
        assertEq(token.balanceOf(user1), largeAmount);
        // QRL value reflects rewards
        assertEq(token.getQRLValue(user1), newTotal);
    }

    function test_SmallNumbers() public {
        uint256 smallAmount = 1; // 1 wei

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(smallAmount);
        token.mintShares(user1, smallAmount);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), smallAmount);
        assertEq(token.sharesOf(user1), smallAmount);
    }

    function testFuzz_ExchangeRateMath(uint256 deposit, uint256 rewardPercent) public {
        // Bound inputs to reasonable ranges
        deposit = bound(deposit, 1 ether, 1_000_000_000 ether);
        rewardPercent = bound(rewardPercent, 0, 100); // 0-100% rewards

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(deposit);
        token.mintShares(user1, deposit);
        vm.stopPrank();

        uint256 rewards = (deposit * rewardPercent) / 100;
        uint256 newTotal = deposit + rewards;

        vm.prank(depositPool);
        token.updateTotalPooledQRL(newTotal);

        // Shares unchanged (fixed-balance)
        assertEq(token.balanceOf(user1), deposit);
        // QRL value should equal new total (user owns all shares)
        assertEq(token.getQRLValue(user1), newTotal);
    }

    // =========================================================================
    //                           ERC-20 TRANSFER TESTS
    // =========================================================================

    function test_Transfer() public {
        // Setup: user1 has 100 QRL
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Transfer 30 QRL worth to user2
        vm.prank(user1);
        token.transfer(user2, 30 ether);

        assertEq(token.balanceOf(user1), 70 ether);
        assertEq(token.balanceOf(user2), 30 ether);
    }

    function test_TransferAfterRewards() public {
        // Setup: user1 has 100 shares
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Add 50% rewards (user1's shares now worth 150 QRL)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(150 ether);

        assertEq(token.balanceOf(user1), 100 ether); // still 100 shares
        assertEq(token.getQRLValue(user1), 150 ether); // worth 150 QRL

        // Transfer 50 shares (half) to user2
        vm.prank(user1);
        token.transfer(user2, 50 ether);

        // Each user has 50 shares
        assertEq(token.balanceOf(user1), 50 ether);
        assertEq(token.balanceOf(user2), 50 ether);
        // Each user's shares worth 75 QRL (half of 150 total)
        assertEq(token.getQRLValue(user1), 75 ether);
        assertEq(token.getQRLValue(user2), 75 ether);
    }

    function test_TransferFrom() public {
        // Setup: user1 has 100 QRL
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // user1 approves user2
        vm.prank(user1);
        token.approve(user2, 50 ether);

        // user2 transfers from user1
        vm.prank(user2);
        token.transferFrom(user1, user2, 50 ether);

        assertEq(token.balanceOf(user1), 50 ether);
        assertEq(token.balanceOf(user2), 50 ether);
    }

    // =========================================================================
    //                           ACCESS CONTROL TESTS
    // =========================================================================

    function test_OnlyDepositPoolCanMint() public {
        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotDepositPool.selector);
        token.mintShares(user1, 100 ether);
    }

    function test_OnlyDepositPoolCanBurn() public {
        // First mint some shares
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotDepositPool.selector);
        token.burnShares(user1, 50 ether);
    }

    function test_OnlyDepositPoolCanUpdatePooledQRL() public {
        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotDepositPool.selector);
        token.updateTotalPooledQRL(100 ether);
    }

    function test_OnlyOwnerCanSetDepositPool() public {
        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotOwner.selector);
        token.setDepositPool(address(0x123));
    }

    function test_DepositPoolCanOnlyBeSetOnce() public {
        // Already set in setUp, should revert
        vm.expectRevert(stQRLv2.DepositPoolAlreadySet.selector);
        token.setDepositPool(address(0x123));
    }

    // =========================================================================
    //                           PAUSE TESTS
    // =========================================================================

    function test_PauseBlocksTransfers() public {
        // Setup
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Pause
        token.pause();

        // Transfer should fail
        vm.prank(user1);
        vm.expectRevert(stQRLv2.ContractPaused.selector);
        token.transfer(user2, 50 ether);
    }

    function test_UnpauseAllowsTransfers() public {
        // Setup
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Pause then unpause
        token.pause();
        token.unpause();

        // Transfer should work
        vm.prank(user1);
        token.transfer(user2, 50 ether);
        assertEq(token.balanceOf(user2), 50 ether);
    }

    // =========================================================================
    //                      APPROVE TESTS
    // =========================================================================

    function test_Approve() public {
        // Setup
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Approve
        vm.prank(user1);
        bool success = token.approve(user2, 50 ether);

        assertTrue(success);
        assertEq(token.allowance(user1, user2), 50 ether);
    }

    function test_Approve_ZeroAddress_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(stQRLv2.ZeroAddress.selector);
        token.approve(address(0), 50 ether);
    }

    function test_Approve_EmitsEvent() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectEmit(true, true, false, true);
        emit Approval(user1, user2, 50 ether);
        token.approve(user2, 50 ether);
    }

    // =========================================================================
    //                      TRANSFER ERROR TESTS
    // =========================================================================

    function test_Transfer_ToZeroAddress_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(stQRLv2.ZeroAddress.selector);
        token.transfer(address(0), 50 ether);
    }

    function test_Transfer_ZeroAmount_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(stQRLv2.ZeroAmount.selector);
        token.transfer(user2, 0);
    }

    function test_Transfer_InsufficientBalance_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(stQRLv2.InsufficientBalance.selector);
        token.transfer(user2, 150 ether);
    }

    function test_Transfer_EmitsEvent() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectEmit(true, true, false, true);
        emit Transfer(user1, user2, 50 ether);
        token.transfer(user2, 50 ether);
    }

    // =========================================================================
    //                      TRANSFERFROM ERROR TESTS
    // =========================================================================

    function test_TransferFrom_ZeroAmount_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        token.approve(user2, 50 ether);

        vm.prank(user2);
        vm.expectRevert(stQRLv2.ZeroAmount.selector);
        token.transferFrom(user1, user2, 0);
    }

    function test_TransferFrom_InsufficientAllowance_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        token.approve(user2, 30 ether);

        vm.prank(user2);
        vm.expectRevert(stQRLv2.InsufficientAllowance.selector);
        token.transferFrom(user1, user2, 50 ether);
    }

    function test_TransferFrom_UnlimitedAllowance() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Approve unlimited
        vm.prank(user1);
        token.approve(user2, type(uint256).max);

        // Transfer
        vm.prank(user2);
        token.transferFrom(user1, user2, 50 ether);

        // Allowance should remain unlimited
        assertEq(token.allowance(user1, user2), type(uint256).max);
    }

    function test_TransferFrom_WhenPaused_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(user1);
        token.approve(user2, 50 ether);

        token.pause();

        vm.prank(user2);
        vm.expectRevert(stQRLv2.ContractPaused.selector);
        token.transferFrom(user1, user2, 50 ether);
    }

    // =========================================================================
    //                      MINT/BURN ERROR TESTS
    // =========================================================================

    function test_MintShares_ToZeroAddress_Reverts() public {
        vm.prank(depositPool);
        vm.expectRevert(stQRLv2.ZeroAddress.selector);
        token.mintShares(address(0), 100 ether);
    }

    function test_MintShares_ZeroAmount_Reverts() public {
        vm.prank(depositPool);
        vm.expectRevert(stQRLv2.ZeroAmount.selector);
        token.mintShares(user1, 0);
    }

    function test_MintShares_WhenPaused_Reverts() public {
        token.pause();

        vm.prank(depositPool);
        vm.expectRevert(stQRLv2.ContractPaused.selector);
        token.mintShares(user1, 100 ether);
    }

    function test_MintShares_EmitsEvents() public {
        vm.prank(depositPool);
        token.updateTotalPooledQRL(100 ether);

        vm.prank(depositPool);
        vm.expectEmit(true, false, false, true);
        emit SharesMinted(user1, 100 ether, 100 ether);
        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), user1, 100 ether);
        token.mintShares(user1, 100 ether);
    }

    function test_BurnShares_FromZeroAddress_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(depositPool);
        vm.expectRevert(stQRLv2.ZeroAddress.selector);
        token.burnShares(address(0), 50 ether);
    }

    function test_BurnShares_ZeroAmount_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(depositPool);
        vm.expectRevert(stQRLv2.ZeroAmount.selector);
        token.burnShares(user1, 0);
    }

    function test_BurnShares_InsufficientBalance_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(depositPool);
        vm.expectRevert(stQRLv2.InsufficientBalance.selector);
        token.burnShares(user1, 150 ether);
    }

    function test_BurnShares_WhenPaused_Reverts() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        token.pause();

        vm.prank(depositPool);
        vm.expectRevert(stQRLv2.ContractPaused.selector);
        token.burnShares(user1, 50 ether);
    }

    function test_BurnShares_EmitsEvents() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        vm.prank(depositPool);
        vm.expectEmit(true, false, false, true);
        emit SharesBurned(user1, 50 ether, 50 ether);
        vm.expectEmit(true, true, false, true);
        emit Transfer(user1, address(0), 50 ether);
        token.burnShares(user1, 50 ether);
    }

    function test_BurnShares_ReturnsCorrectQRLAmount() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        // Add 50% rewards
        token.updateTotalPooledQRL(150 ether);
        vm.stopPrank();

        vm.prank(depositPool);
        uint256 qrlAmount = token.burnShares(user1, 50 ether);

        // 50 shares at 1.5 QRL/share = 75 QRL
        assertEq(qrlAmount, 75 ether);
    }

    // =========================================================================
    //                      ADMIN FUNCTION TESTS
    // =========================================================================

    function test_SetDepositPool_ZeroAddress_Reverts() public {
        // Deploy fresh token without depositPool set
        stQRLv2 freshToken = new stQRLv2();

        vm.expectRevert(stQRLv2.ZeroAddress.selector);
        freshToken.setDepositPool(address(0));
    }

    function test_TransferOwnership() public {
        address newOwner = address(0x999);

        token.transferOwnership(newOwner);

        assertEq(token.owner(), newOwner);
    }

    function test_TransferOwnership_ZeroAddress_Reverts() public {
        vm.expectRevert(stQRLv2.ZeroAddress.selector);
        token.transferOwnership(address(0));
    }

    function test_TransferOwnership_NotOwner_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotOwner.selector);
        token.transferOwnership(user1);
    }

    function test_TransferOwnership_EmitsEvent() public {
        address newOwner = address(0x999);

        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, newOwner);
        token.transferOwnership(newOwner);
    }

    function test_RenounceOwnership() public {
        token.renounceOwnership();

        assertEq(token.owner(), address(0));
    }

    function test_RenounceOwnership_NotOwner_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotOwner.selector);
        token.renounceOwnership();
    }

    function test_RenounceOwnership_EmitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, address(0));
        token.renounceOwnership();
    }

    function test_OnlyOwnerCanPause() public {
        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotOwner.selector);
        token.pause();
    }

    function test_OnlyOwnerCanUnpause() public {
        token.pause();

        vm.prank(user1);
        vm.expectRevert(stQRLv2.NotOwner.selector);
        token.unpause();
    }

    // =========================================================================
    //                      GETQRLVALUE TESTS
    // =========================================================================

    function test_GetQRLValue_ReturnsCorrectValue() public {
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        assertEq(token.getQRLValue(user1), 100 ether);

        // Add rewards
        vm.prank(depositPool);
        token.updateTotalPooledQRL(150 ether);

        assertEq(token.getQRLValue(user1), 150 ether);
    }

    function test_GetQRLValue_ZeroShares() public view {
        assertEq(token.getQRLValue(user1), 0);
    }

    // =========================================================================
    //                      EVENT DECLARATIONS
    // =========================================================================

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
}
