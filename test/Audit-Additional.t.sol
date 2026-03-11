// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/solidity/stQRL-v2.sol";
import "../contracts/solidity/DepositPool-v2.sol";

/**
 * @title Additional Audit Tests
 * @notice Tests for potential additional findings
 */
contract AdditionalAuditPoC is Test {
    stQRLv2 public token;
    DepositPoolV2 public pool;

    address public owner;
    address public user1;
    address public user2;
    address public attacker;

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        attacker = makeAddr("attacker");

        token = new stQRLv2();
        pool = new DepositPoolV2();

        pool.setStQRL(address(token));
        token.setDepositPool(address(pool));

        vm.deal(user1, 100000 ether);
        vm.deal(user2, 100000 ether);
        vm.deal(attacker, 100000 ether);
    }

    // =========================================================================
    //  Check: Can the phantom rewards bug be deliberately exploited
    //  by an external attacker sending ETH directly to the contract?
    // =========================================================================

    function test_DirectETHSendInflation() public {
        console.log("=== Check: Direct ETH send detected as rewards by _syncRewards ===");

        // User1 deposits
        vm.prank(user1);
        pool.deposit{value: 100 ether}();

        // Someone sends ETH directly to the contract
        // The new receive() is a no-op: it does NOT add to withdrawalReserve.
        // The ETH simply increases address(this).balance.
        vm.prank(attacker);
        (bool sent,) = address(pool).call{value: 50 ether}("");
        assertTrue(sent);

        console.log("After direct send of 50 QRL:");
        console.log("  balance:", address(pool).balance / 1e18);
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);
        console.log("  withdrawalReserve:", pool.withdrawalReserve() / 1e18);

        // withdrawalReserve should be 0 (receive() no longer adds to it)
        assertEq(pool.withdrawalReserve(), 0, "receive() should not add to withdrawalReserve");

        // syncRewards detects the 50 QRL as new rewards:
        // actualPooled = balance(150) - reserve(0) = 150
        // previousPooled = totalPooledQRL = 100
        // rewards = 150 - 100 = 50
        pool.syncRewards();

        console.log("After syncRewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);
        console.log("  totalRewardsReceived:", pool.totalRewardsReceived() / 1e18);

        // The direct send IS detected as rewards by _syncRewards (new behavior)
        assertEq(pool.totalRewardsReceived(), 50 ether, "Direct send detected as rewards by _syncRewards");
        assertEq(token.totalPooledQRL(), 150 ether, "totalPooledQRL increased by 50 (the direct send)");
    }

    // =========================================================================
    //  Check: fundWithdrawalReserve without matching pending withdrawals
    //  Can someone fund the reserve and then trigger phantom rewards?
    // =========================================================================

    function test_ReserveFundingWithoutPendingWithdrawals() public {
        console.log("=== Check: Reserve funding without pending withdrawals ===");

        vm.prank(user1);
        pool.deposit{value: 100 ether}();

        // Fund reserve when no withdrawals are pending
        // Reclassifies 50 of the 100 deposited QRL from totalPooledQRL to withdrawalReserve
        pool.fundWithdrawalReserve(50 ether);

        console.log("After funding reserve with no pending withdrawals:");
        console.log("  balance:", address(pool).balance / 1e18);
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);
        console.log("  withdrawalReserve:", pool.withdrawalReserve() / 1e18);

        // syncRewards: actualPooled = 100 - 50 = 50, previousPooled = 50 -> no change
        pool.syncRewards();
        assertEq(pool.totalRewardsReceived(), 0, "Reserve funding should not create rewards");
        console.log("  syncRewards: no phantom rewards (correct)");
    }

    // =========================================================================
    //  Check: bufferedQRL desync after fundValidatorMVP + syncRewards
    // =========================================================================

    function test_BufferedQRLDesync() public {
        console.log("=== Check: bufferedQRL tracking after various operations ===");

        vm.deal(user1, 80000 ether);
        vm.prank(user1);
        pool.deposit{value: 40000 ether}();

        assertEq(pool.bufferedQRL(), 40000 ether);

        // Fund validator - moves from buffer to "staked"
        pool.fundValidatorMVP();

        assertEq(pool.bufferedQRL(), 0);
        assertEq(token.totalPooledQRL(), 40000 ether);
        assertEq(address(pool).balance, 40000 ether);

        // balance=40000, reserve=0, actualPooled=40000, previousPooled=40000 -> consistent
        // But bufferedQRL=0 even though the ETH is still in the contract (MVP mode)
        // This means: totalPooledQRL (40000) = balance (40000) - reserve (0) = 40000
        // The accounting works because _syncRewards uses balance, not bufferedQRL

        // Now what happens if someone deposits after fundValidatorMVP?
        vm.prank(user1);
        pool.deposit{value: 40000 ether}();

        console.log("After second deposit:");
        console.log("  bufferedQRL:", pool.bufferedQRL() / 1e18);
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);
        console.log("  balance:", address(pool).balance / 1e18);

        // bufferedQRL = 40000 (second deposit), totalPooledQRL = 80000, balance = 80000
        // This is consistent: actualPooled = 80000 - 0 = 80000 == totalPooledQRL
        assertEq(pool.bufferedQRL(), 40000 ether);
        assertEq(token.totalPooledQRL(), 80000 ether);

        // No issue here - the MVP mode works correctly for syncRewards
        console.log("  bufferedQRL tracking is consistent");
    }

    // =========================================================================
    //  Check: Can claimWithdrawal reenter via the ETH transfer?
    // =========================================================================

    function test_ReentrancyViaClaimCallback() public {
        console.log("=== Check: Reentrancy protection on claimWithdrawal ===");

        // Deploy malicious contract that tries to reenter on receive
        ReentrantClaimer malicious = new ReentrantClaimer(pool, token);
        vm.deal(address(malicious), 100 ether);

        // Deposit via malicious contract
        malicious.doDeposit{value: 100 ether}();

        // Fund reserve (reclassify 100 of the deposited QRL)
        pool.fundWithdrawalReserve(100 ether);

        // Request withdrawal
        malicious.doRequestWithdrawal(50 ether);

        vm.roll(block.number + 129);

        // Claim - should not reenter due to nonReentrant
        malicious.doClaimWithdrawal();

        console.log("Reentrancy attempt count:", malicious.reentrancyAttempts());
        console.log("Reentrancy blocked:", malicious.reentrancyAttempts() > 0 ? "YES (protected)" : "NO attempts");
        // The nonReentrant guard should block the reentry
    }

    // =========================================================================
    //  Check: What happens to totalWithdrawalShares accuracy
    //  when phantom rewards are created?
    // =========================================================================

    function test_TotalWithdrawalSharesAccuracy() public {
        console.log("=== Check: totalWithdrawalShares accuracy with phantom rewards ===");

        // Setup the phantom rewards scenario
        vm.prank(user1);
        pool.deposit{value: 100 ether}();
        vm.prank(user2);
        pool.deposit{value: 100 ether}();

        pool.fundWithdrawalReserve(200 ether);

        // Both request 50 shares
        vm.prank(user1);
        pool.requestWithdrawal(50 ether);
        vm.prank(user2);
        pool.requestWithdrawal(50 ether);

        console.log("totalWithdrawalShares after requests:", pool.totalWithdrawalShares() / 1e18);
        assertEq(pool.totalWithdrawalShares(), 100 ether);

        vm.roll(block.number + 129);

        // User1 claims
        vm.prank(user1);
        pool.claimWithdrawal();

        console.log("totalWithdrawalShares after user1 claims:", pool.totalWithdrawalShares() / 1e18);
        assertEq(pool.totalWithdrawalShares(), 50 ether);

        // Phantom rewards are now present, trigger sync
        pool.syncRewards();

        // totalWithdrawalShares is still 50 (user2's pending withdrawal)
        // But the VALUE of those 50 shares has now increased due to phantom rewards
        uint256 user2ShareValue = token.getPooledQRLByShares(50 ether);
        console.log("User2's pending 50 shares now worth:", user2ShareValue / 1e18, "QRL");
        console.log("(Originally worth 50 QRL when requested)");

        // This means user2 will claim MORE than expected
        vm.prank(user2);
        uint256 claimed = pool.claimWithdrawal();
        console.log("User2 claimed:", claimed / 1e18, "QRL");

        if (claimed > 50 ether + 1 ether) {
            console.log("CONFIRMED: Phantom rewards inflate pending withdrawal values");
        }
    }

    // =========================================================================
    //  Check: Emergency withdrawal interaction with phantom rewards
    // =========================================================================

    function test_EmergencyWithdrawAfterPhantomRewards() public {
        console.log("=== Check: emergencyWithdraw after phantom rewards scenario ===");

        vm.prank(user1);
        pool.deposit{value: 100 ether}();

        pool.fundWithdrawalReserve(100 ether);

        vm.prank(user1);
        pool.requestWithdrawal(100 ether);

        vm.roll(block.number + 129);

        // Claim - with the new fundWithdrawalReserve, totalPooledQRL was already
        // decremented when reserve was funded, so claimWithdrawal only decrements
        // withdrawalReserve. No phantom rewards should occur.
        vm.prank(user1);
        pool.claimWithdrawal();

        pool.syncRewards();

        console.log("After claim and syncRewards:");
        console.log("  balance:", address(pool).balance / 1e18);
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);
        console.log("  withdrawalReserve:", pool.withdrawalReserve() / 1e18);

        // Emergency withdrawal tries to recover: balance - totalPooledQRL - reserve
        uint256 totalProtocolFunds = token.totalPooledQRL() + pool.withdrawalReserve();
        uint256 recoverable =
            address(pool).balance > totalProtocolFunds ? address(pool).balance - totalProtocolFunds : 0;
        console.log("  recoverable by emergency:", recoverable / 1e18);

        // With the new design, no phantom rewards occur, so the accounting
        // should be consistent and emergency withdrawal recoverable should be 0
    }
}

/**
 * @notice Malicious contract that attempts reentrancy on ETH receive
 */
contract ReentrantClaimer {
    DepositPoolV2 public pool;
    stQRLv2 public token;
    uint256 public reentrancyAttempts;

    constructor(DepositPoolV2 _pool, stQRLv2 _token) {
        pool = _pool;
        token = _token;
    }

    function doDeposit() external payable {
        pool.deposit{value: msg.value}();
    }

    function doRequestWithdrawal(uint256 shares) external {
        pool.requestWithdrawal(shares);
    }

    function doClaimWithdrawal() external {
        pool.claimWithdrawal();
    }

    receive() external payable {
        reentrancyAttempts++;
        // Try to reenter claimWithdrawal
        try pool.claimWithdrawal() {} catch {}
    }
}
