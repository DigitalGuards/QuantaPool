// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/solidity/stQRL-v2.sol";
import "../contracts/solidity/DepositPool-v2.sol";

/**
 * @title Fix Verification: FIFO Queue Blocking Bug is FIXED
 *
 * @notice PREVIOUSLY: cancelWithdrawal() marked a request as claimed and set
 *   shares to 0, but did NOT advance nextWithdrawalIndex. claimWithdrawal()
 *   enforced strict FIFO ordering and reverted with NoWithdrawalPending when
 *   it encountered a cancelled request (shares=0) at the head of the queue.
 *
 * @dev THE FIX: claimWithdrawal() now has a while loop that skips cancelled
 *   requests (shares==0) before processing. This means:
 *   - Cancelled requests at the head of the queue are automatically skipped
 *   - Subsequent valid requests can still be claimed
 *   - The queue never gets permanently blocked
 */
contract FIFOBlockingPoC is Test {
    stQRLv2 public token;
    DepositPoolV2 public pool;

    address public owner;
    address public victim;

    function setUp() public {
        owner = address(this);
        victim = makeAddr("victim");

        token = new stQRLv2();
        pool = new DepositPoolV2();

        pool.setStQRL(address(token));
        token.setDepositPool(address(pool));

        vm.deal(victim, 100000 ether);
    }

    /**
     * @notice Verifies that cancelling the head request does NOT block the queue
     *
     * Scenario:
     *   1. User creates requests [0, 1, 2] for 10, 20, 30 shares
     *   2. User cancels request 0
     *   3. User can still claim requests 1 and 2 (skips cancelled request 0)
     */
    function test_FIFOBlocking_PermanentFreeze() public {
        console.log("========================================================");
        console.log("  FIX VERIFIED: Cancelled Request Does Not Block Queue");
        console.log("========================================================");
        console.log("");

        // ---- STEP 1: Victim deposits 100 QRL ----
        vm.prank(victim);
        pool.deposit{value: 100 ether}();
        pool.fundWithdrawalReserve(100 ether);

        console.log("Initial state:");
        console.log("  victim shares:", token.sharesOf(victim) / 1e18);
        console.log("  victim locked:", token.lockedSharesOf(victim) / 1e18);

        // ---- STEP 2: Create 3 withdrawal requests ----
        vm.startPrank(victim);
        pool.requestWithdrawal(10 ether); // request 0: 10 shares
        pool.requestWithdrawal(20 ether); // request 1: 20 shares
        pool.requestWithdrawal(30 ether); // request 2: 30 shares
        vm.stopPrank();

        console.log("After 3 requests (10 + 20 + 30 = 60 shares locked):");
        console.log("  victim shares:", token.sharesOf(victim) / 1e18);
        console.log("  victim locked:", token.lockedSharesOf(victim) / 1e18);
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(victim));
        (uint256 total, uint256 pending) = pool.getWithdrawalRequestCount(victim);
        console.log("  total requests:", total);
        console.log("  pending requests:", pending);

        // ---- STEP 3: Cancel request 0 ----
        vm.prank(victim);
        pool.cancelWithdrawal(0);

        console.log("");
        console.log("After cancelling request 0:");
        console.log("  victim locked:", token.lockedSharesOf(victim) / 1e18, "(10 unlocked)");
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(victim), "(still 0)");
        console.log("  totalWithdrawalShares:", pool.totalWithdrawalShares() / 1e18);

        // ---- STEP 4: Wait for delay ----
        vm.roll(block.number + 129);

        // ---- STEP 5: Claim should SUCCEED by skipping cancelled request 0 ----
        console.log("");
        console.log("Claiming (should skip cancelled request 0, process request 1)...");

        vm.prank(victim);
        uint256 claimed1 = pool.claimWithdrawal();

        console.log("  SUCCESS: Claimed request 1, got:", claimed1 / 1e18, "QRL");
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(victim));

        // nextWithdrawalIndex should have advanced past both request 0 (skipped) and request 1 (claimed)
        assertEq(pool.nextWithdrawalIndex(victim), 2, "Index should advance past cancelled + claimed");

        // ---- STEP 6: Claim request 2 as well ----
        vm.prank(victim);
        uint256 claimed2 = pool.claimWithdrawal();

        console.log("  SUCCESS: Claimed request 2, got:", claimed2 / 1e18, "QRL");
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(victim));
        assertEq(pool.nextWithdrawalIndex(victim), 3, "Index should advance to 3");

        // ---- STEP 7: Verify new requests also work ----
        vm.prank(victim);
        pool.requestWithdrawal(10 ether); // request 3

        vm.roll(block.number + 260);

        vm.prank(victim);
        uint256 claimed3 = pool.claimWithdrawal();

        console.log("  SUCCESS: Claimed new request 3, got:", claimed3 / 1e18, "QRL");

        console.log("");
        console.log("========== FIX RESULT ==========");
        console.log("  Queue is NOT blocked by cancelled requests");
        console.log("  All subsequent claims succeed normally");
        console.log("  New requests after cancellation also work");
        console.log("=================================");
    }

    /**
     * @notice Verifies that cancelling the FIFO head and creating a new request
     *   does not block the queue (the fix skips cancelled entries)
     */
    function test_FIFOBlocking_HeadCancel() public {
        console.log("========================================================");
        console.log("  FIX VERIFIED: Cancel Head Then Re-request Works");
        console.log("========================================================");
        console.log("");

        vm.prank(victim);
        pool.deposit{value: 100 ether}();
        pool.fundWithdrawalReserve(100 ether);

        // Create single request then cancel it
        vm.prank(victim);
        pool.requestWithdrawal(50 ether);

        vm.prank(victim);
        pool.cancelWithdrawal(0);

        // Create new request
        vm.prank(victim);
        pool.requestWithdrawal(50 ether); // index 1

        vm.roll(block.number + 129);

        // Claim should succeed - skips cancelled request 0, processes request 1
        vm.prank(victim);
        uint256 claimed = pool.claimWithdrawal();

        console.log("FIX CONFIRMED: Cancel-then-rerequest works");
        console.log("  Claimed:", claimed / 1e18, "QRL");
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(victim));

        assertGt(claimed, 0, "Claim should succeed and return QRL");
        assertEq(pool.nextWithdrawalIndex(victim), 2, "Index should be 2 (skipped 0, claimed 1)");

        // Verify user can continue using withdrawal system
        vm.prank(victim);
        pool.requestWithdrawal(10 ether); // index 2

        vm.roll(block.number + 260);

        vm.prank(victim);
        uint256 claimed2 = pool.claimWithdrawal();

        console.log("  Second claim also works:", claimed2 / 1e18, "QRL");
        assertGt(claimed2, 0, "Second claim should also succeed");

        console.log("");
        console.log("========== FIX RESULT ==========");
        console.log("  Queue handles cancelled head entries gracefully");
        console.log("  User can claim and re-request without issues");
        console.log("=================================");
    }
}
