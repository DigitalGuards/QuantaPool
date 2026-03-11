// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/solidity/stQRL-v2.sol";
import "../contracts/solidity/DepositPool-v2.sol";

/**
 * @title Fix Verification: Phantom Rewards Bug (QP-NEW-01) is FIXED
 *
 * @notice PREVIOUSLY: When claimWithdrawal() consumed the withdrawal reserve,
 *   it decremented BOTH withdrawalReserve AND totalPooledQRL. This caused
 *   _syncRewards() to detect phantom rewards on the next call because
 *   actualPooled (balance - reserve) exceeded the decremented totalPooledQRL.
 *
 * @dev THE FIX:
 *   1. fundWithdrawalReserve(amount) is now non-payable - it reclassifies
 *      existing pool balance by decrementing totalPooledQRL and incrementing
 *      withdrawalReserve. The ETH does not move.
 *   2. claimWithdrawal() no longer decrements totalPooledQRL - it only
 *      decrements withdrawalReserve, because the QRL was already removed
 *      from totalPooledQRL when the reserve was funded.
 *
 *   This maintains the invariant:
 *     address(this).balance == totalPooledQRL + withdrawalReserve
 *   at ALL times, preventing phantom rewards.
 */
contract CriticalFindingPoC is Test {
    stQRLv2 public token;
    DepositPoolV2 public pool;

    address public owner;
    address public alice;
    address public bob;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        token = new stQRLv2();
        pool = new DepositPoolV2();

        pool.setStQRL(address(token));
        token.setDepositPool(address(pool));

        vm.deal(alice, 100000 ether);
        vm.deal(bob, 100000 ether);
    }

    /**
     * @notice Verifies the phantom rewards bug is FIXED
     *
     * Scenario (mirrors the original exploit PoC):
     *   1. Alice and Bob each deposit 100 QRL
     *   2. Owner funds withdrawal reserve with 200 QRL by reclassifying from pooled
     *   3. Alice requests withdrawal, waits, claims
     *   4. After claim: the balance accounting invariant holds
     *   5. syncRewards detects ZERO phantom rewards
     *   6. Bob's share value is NOT inflated beyond what's correct
     *
     * The original bug: claimWithdrawal decremented totalPooledQRL AND reserve,
     * which broke the invariant and created phantom rewards equal to the claimed amount.
     * The fix: claimWithdrawal only decrements withdrawalReserve, maintaining the invariant.
     */
    function test_CriticalExploit_PhantomRewards() public {
        console.log("========================================================");
        console.log("  FIX VERIFIED: No Phantom Rewards After Claim");
        console.log("========================================================");
        console.log("");

        // ---- STEP 1: Alice and Bob deposit ----
        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        _logState("After deposits (Alice=100, Bob=100)");

        // ---- STEP 2: Owner reclassifies 200 QRL from pooled to reserve ----
        // This simulates the owner earmarking funds for withdrawals.
        // totalPooledQRL drops from 200 to 0, reserve goes from 0 to 200.
        pool.fundWithdrawalReserve(200 ether);

        _logState("After funding reserve (200 QRL reclassified)");
        assertEq(token.totalPooledQRL(), 0, "totalPooledQRL = 0 after full reclassification");
        assertEq(pool.withdrawalReserve(), 200 ether, "reserve = 200");

        // Verify invariant: balance == pooled + reserve
        assertEq(
            address(pool).balance,
            token.totalPooledQRL() + pool.withdrawalReserve(),
            "Invariant should hold after funding reserve"
        );

        // ---- STEP 3: Alice requests withdrawal of ALL her shares ----
        vm.prank(alice);
        pool.requestWithdrawal(100 ether);

        // ---- STEP 4: Wait for delay and Alice claims ----
        vm.roll(block.number + 129);

        // Record state BEFORE claim for comparison
        uint256 pooledBeforeClaim = token.totalPooledQRL();
        uint256 reserveBeforeClaim = pool.withdrawalReserve();

        vm.prank(alice);
        uint256 aliceClaimed = pool.claimWithdrawal();

        _logState("After Alice claims");
        console.log("  Alice claimed:", aliceClaimed);

        // ---- STEP 5: THE CRITICAL CHECK - no phantom rewards ----
        // After claim, the invariant must hold:
        //   balance == totalPooledQRL + withdrawalReserve
        assertEq(
            address(pool).balance,
            token.totalPooledQRL() + pool.withdrawalReserve(),
            "CRITICAL: Invariant holds after claim - no phantom rewards possible"
        );

        // Additionally verify that actualPooled == totalPooledQRL
        // (this is what _syncRewards checks)
        uint256 actualPooled = address(pool).balance - pool.withdrawalReserve();
        uint256 previousPooled = token.totalPooledQRL();
        console.log("");
        console.log("  Checking for phantom rewards...");
        console.log("  actualPooled (balance - reserve):", actualPooled);
        console.log("  previousPooled (totalPooledQRL):", previousPooled);
        assertEq(actualPooled, previousPooled, "actualPooled == previousPooled -> no phantom rewards");

        // Verify claimWithdrawal did NOT decrement totalPooledQRL (the fix)
        assertEq(token.totalPooledQRL(), pooledBeforeClaim, "totalPooledQRL unchanged by claim (fix working)");

        // Verify claimWithdrawal DID decrement withdrawalReserve
        assertEq(pool.withdrawalReserve(), reserveBeforeClaim - aliceClaimed, "Reserve decremented by claimed amount");

        // ---- STEP 6: Bob calls syncRewards - should detect NOTHING ----
        uint256 rewardsBefore = pool.totalRewardsReceived();
        vm.prank(bob);
        pool.syncRewards();

        assertEq(pool.totalRewardsReceived(), rewardsBefore, "syncRewards detects zero phantom rewards");

        _logState("After Bob calls syncRewards()");

        // ---- STEP 7: Bob withdraws too ----
        vm.prank(bob);
        pool.requestWithdrawal(100 ether);

        vm.roll(block.number + 260);

        vm.prank(bob);
        uint256 bobClaimed = pool.claimWithdrawal();

        // Both get the same amount (symmetric outcome, no exploitation)
        console.log("");
        console.log("========== FIX RESULT ==========");
        console.log("  Alice claimed:", aliceClaimed);
        console.log("  Bob claimed:", bobClaimed);

        // The critical assertion: Bob does NOT get more than he should.
        // With the old bug, Bob would get ~2x what Alice got because phantom
        // rewards would inflate his share value after Alice's claim.
        // With the fix, Bob gets the same as Alice (symmetric outcome).
        assertApproxEqAbs(aliceClaimed, bobClaimed, 1000, "Alice and Bob get symmetric amounts (no exploit)");

        console.log("  Symmetric outcome confirmed - no phantom rewards exploit");
        console.log("=================================");
    }

    /**
     * @notice Verifies fix with real rewards mixed in - accounting stays correct
     */
    function test_CriticalExploit_WithRealRewardsMixed() public {
        console.log("========================================================");
        console.log("  FIX VERIFIED: Real rewards + no phantom rewards");
        console.log("========================================================");
        console.log("");

        // 10 users deposit 100 QRL each
        address[] memory users = new address[](10);
        for (uint256 i = 0; i < 10; i++) {
            users[i] = makeAddr(string(abi.encodePacked("user", vm.toString(i))));
            vm.deal(users[i], 1000 ether);
            vm.prank(users[i]);
            pool.deposit{value: 100 ether}();
        }

        // Real rewards arrive: 100 QRL (10% yield)
        vm.deal(address(pool), address(pool).balance + 100 ether);
        pool.syncRewards();

        uint256 pooledAfterRewards = token.totalPooledQRL();
        console.log("After 100 QRL real rewards (10% yield):");
        console.log("  totalPooledQRL:", pooledAfterRewards / 1e18, "QRL");
        console.log("  Each user's value:", token.getQRLValue(users[0]) / 1e18, "QRL");

        // Fund withdrawal reserve for first 5 users' withdrawals
        // Reclassify 550 QRL (half of the 1100 pool) for the 5 users exiting
        uint256 reserveAmount = 550 ether;
        pool.fundWithdrawalReserve(reserveAmount);

        // First 5 users withdraw
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(users[i]);
            pool.requestWithdrawal(100 ether);
        }
        vm.roll(block.number + 129);

        uint256 totalFirstWave = 0;
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(users[i]);
            uint256 claimed = pool.claimWithdrawal();
            totalFirstWave += claimed;
        }

        console.log("First wave (5 users) total claimed:", totalFirstWave / 1e18, "QRL");

        // Verify invariant holds after claims
        assertEq(
            address(pool).balance,
            token.totalPooledQRL() + pool.withdrawalReserve(),
            "Invariant holds after first wave claims"
        );

        // syncRewards should detect NO phantom rewards
        uint256 rewardsBefore = pool.totalRewardsReceived();
        pool.syncRewards();

        console.log("After syncRewards (should detect no phantom rewards):");
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18, "QRL");
        assertEq(pool.totalRewardsReceived(), rewardsBefore, "No phantom rewards after claims");

        // Remaining 5 users should have fair value (~110 QRL each)
        for (uint256 i = 5; i < 10; i++) {
            uint256 val = token.getQRLValue(users[i]);
            console.log("  User value:", val / 1e18, "QRL");
            assertApproxEqRel(val, 110 ether, 1e16, "Remaining user value ~110 QRL (no inflation)");
        }

        console.log("");
        console.log("FIX CONFIRMED: No phantom rewards, remaining users have fair value");
    }

    function _logState(string memory label) internal view {
        console.log("");
        console.log(label);
        console.log("  balance:", address(pool).balance / 1e18, "QRL");
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18, "QRL");
        console.log("  totalShares:", token.totalShares() / 1e18);
        console.log("  withdrawalReserve:", pool.withdrawalReserve() / 1e18, "QRL");
    }
}
