// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/stQRL-v2.sol";

/**
 * @title stQRL v2 Tests
 * @notice Unit tests for the rebasing stQRL token
 */
contract stQRLv2Test is Test {
    stQRLv2 public token;
    address public owner;
    address public depositPool;
    address public user1;
    address public user2;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event TransferShares(address indexed from, address indexed to, uint256 sharesValue);
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
    //                           REBASING MATH TESTS
    // =========================================================================

    function test_FirstDeposit_OneToOneRatio() public {
        uint256 amount = 100 ether;

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(amount);
        uint256 shares = token.mintShares(user1, amount);
        vm.stopPrank();

        // First deposit should be 1:1
        assertEq(shares, amount);
        assertEq(token.balanceOf(user1), amount);
        assertEq(token.sharesOf(user1), amount);
        assertEq(token.totalSupply(), amount);
    }

    function test_RewardsIncreaseBalance() public {
        // Initial deposit of 100 QRL
        uint256 initialDeposit = 100 ether;

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(initialDeposit);
        token.mintShares(user1, initialDeposit);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), 100 ether);

        // Simulate 10 QRL rewards (10% increase)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(110 ether);

        // User's balance should now reflect rewards
        assertEq(token.balanceOf(user1), 110 ether);
        // But shares remain the same
        assertEq(token.sharesOf(user1), 100 ether);
    }

    function test_SlashingDecreasesBalance() public {
        // Initial deposit of 100 QRL
        uint256 initialDeposit = 100 ether;

        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(initialDeposit);
        token.mintShares(user1, initialDeposit);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), 100 ether);

        // Simulate 5% slashing (pool drops to 95 QRL)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(95 ether);

        // User's balance should reflect slashing
        assertEq(token.balanceOf(user1), 95 ether);
        // Shares remain the same
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

        // Check balances before rewards
        assertEq(token.balanceOf(user1), 100 ether);
        assertEq(token.balanceOf(user2), 50 ether);

        // Add 30 QRL rewards (20% increase, total now 180 QRL)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(180 ether);

        // Rewards should be distributed proportionally
        // User1 has 100/150 = 66.67% of shares -> gets 66.67% of 180 = 120 QRL
        // User2 has 50/150 = 33.33% of shares -> gets 33.33% of 180 = 60 QRL
        assertEq(token.balanceOf(user1), 120 ether);
        assertEq(token.balanceOf(user2), 60 ether);
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

        assertEq(token.balanceOf(user1), largeAmount);

        // Add 10% rewards
        uint256 newTotal = largeAmount + (largeAmount / 10);
        vm.prank(depositPool);
        token.updateTotalPooledQRL(newTotal);

        assertEq(token.balanceOf(user1), newTotal);
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

    function testFuzz_RebasingMath(uint256 deposit, uint256 rewardPercent) public {
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

        // Balance should equal new total (user owns all shares)
        assertEq(token.balanceOf(user1), newTotal);
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
        // Setup: user1 has 100 QRL
        vm.startPrank(depositPool);
        token.updateTotalPooledQRL(100 ether);
        token.mintShares(user1, 100 ether);
        vm.stopPrank();

        // Add 50% rewards (user1 now has 150 QRL worth)
        vm.prank(depositPool);
        token.updateTotalPooledQRL(150 ether);

        // Transfer 75 QRL (half) to user2
        vm.prank(user1);
        token.transfer(user2, 75 ether);

        assertEq(token.balanceOf(user1), 75 ether);
        assertEq(token.balanceOf(user2), 75 ether);
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
}
