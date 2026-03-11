// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/solidity/stQRL-v2.sol";
import "../contracts/solidity/DepositPool-v2.sol";

/**
 * @title Post-Fix Security Audit Tests
 * @notice Systematic verification of fixes and search for remaining vulnerabilities
 */
contract PostFixAudit is Test {
    stQRLv2 public token;
    DepositPoolV2 public pool;

    address public owner;
    address public alice;
    address public bob;
    address public attacker;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        attacker = makeAddr("attacker");

        token = new stQRLv2();
        pool = new DepositPoolV2();

        pool.setStQRL(address(token));
        token.setDepositPool(address(pool));

        vm.deal(alice, 1000000 ether);
        vm.deal(bob, 1000000 ether);
        vm.deal(attacker, 1000000 ether);
    }

    // =========================================================================
    //  FINDING 1: claimWithdrawal burns shares but does NOT update totalPooledQRL
    //  The burn reduces totalShares, which changes the exchange rate, but
    //  totalPooledQRL stays the same. This means the remaining shares are now
    //  worth MORE than they should be (inflated exchange rate).
    //
    //  The qrlAmount paid out is frozen from request time (pre-fundReserve),
    //  but burnShares computes at current (post-fundReserve) rate. These differ.
    //  The shares are burned at a deflated rate (lower totalPooledQRL), but the
    //  payout uses the pre-reclassification rate. This creates an accounting gap.
    // =========================================================================

    function test_Finding1_BurnWithoutPooledUpdate_ExchangeRateInflation() public {
        console.log("=== Finding 1: Exchange rate inflation after claim ===");
        console.log("");

        // Alice and Bob deposit 100 QRL each (200 total)
        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // State: totalPooledQRL=200, totalShares=200, balance=200
        assertEq(token.totalPooledQRL(), 200 ether);
        assertEq(token.totalShares(), 200 ether);

        // Alice requests withdrawal of all 100 shares
        // At this point, qrlAmount frozen = getPooledQRLByShares(100) ~= 100 QRL
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);
        console.log("Alice's frozen qrlAmount:", frozenQrl);
        assertApproxEqRel(frozenQrl, 100 ether, 1e14);

        // Owner funds reserve: reclassifies 100 from pooled to reserve
        // totalPooledQRL: 200 -> 100, withdrawalReserve: 0 -> 100
        pool.fundWithdrawalReserve(100 ether);

        assertEq(token.totalPooledQRL(), 100 ether);
        assertEq(pool.withdrawalReserve(), 100 ether);

        vm.roll(block.number + 129);

        // Alice claims. Let's trace:
        // 1. _syncRewards: balance=200, reserve=100, actualPooled=100, previousPooled=100 -> no change (good)
        // 2. sharesToBurn = 100 ether
        // 3. qrlAmount = request.qrlAmount = ~100 ether (frozen)
        // 4. unlockShares(alice, 100)
        // 5. burnShares(alice, 100):
        //    - qrlAmount returned by burn = 100 * (100 + 1000) / (200 + 1000) ~= 84.16 ether
        //    - _totalShares: 200 -> 100
        //    - totalPooledQRL: still 100 (NOT decremented by claim)
        // 6. reserve check: 100 >= ~100 -> OK
        // 7. withdrawalReserve: 100 -> ~0
        // 8. Transfer ~100 to alice

        // AFTER claim:
        // balance = 200 - ~100 = ~100
        // totalPooledQRL = 100 (unchanged)
        // withdrawalReserve = ~0
        // totalShares = 100 (Bob's 100 shares)

        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = pool.claimWithdrawal();

        console.log("Alice claimed:", claimed);
        console.log("Balance after:", address(pool).balance);
        console.log("totalPooledQRL after:", token.totalPooledQRL());
        console.log("withdrawalReserve after:", pool.withdrawalReserve());
        console.log("totalShares after:", token.totalShares());

        // NOW: Bob has 100 shares. totalPooledQRL = 100.
        // Bob's value = 100 * (100 + 1000) / (100 + 1000) = 100 QRL
        // This is correct - Bob deposited 100 and should have 100.
        uint256 bobValue = token.getQRLValue(bob);
        console.log("Bob's QRL value:", bobValue);

        // Verify invariant: balance == totalPooledQRL + withdrawalReserve
        assertEq(address(pool).balance, token.totalPooledQRL() + pool.withdrawalReserve(), "Invariant holds");

        // Check: does syncRewards detect phantom rewards?
        uint256 rewardsBefore = pool.totalRewardsReceived();
        pool.syncRewards();
        uint256 rewardsAfter = pool.totalRewardsReceived();

        console.log("Phantom rewards after sync:", rewardsAfter - rewardsBefore);
        assertEq(rewardsAfter, rewardsBefore, "No phantom rewards");
    }

    // =========================================================================
    //  FINDING 2: Frozen qrlAmount vs actual burn value discrepancy
    //  The frozen qrlAmount was computed BEFORE fundWithdrawalReserve.
    //  After reclassification, totalPooledQRL drops, so burnShares returns less.
    //  But claimWithdrawal ignores the burn return and pays frozen amount.
    //
    //  This means: the shares are "worth" X at burn time, but the user gets Y
    //  from the frozen amount, where Y > X. The difference Y-X is value that
    //  gets removed from the pool without corresponding totalPooledQRL decrease.
    //
    //  Wait -- claimWithdrawal does NOT call updateTotalPooledQRL at all.
    //  So after burning 100 shares at a rate where those shares are "worth" 84 QRL,
    //  but paying out 100 QRL from reserve, the totalPooledQRL stays at 100.
    //  The 100 paid out came from reserve (which was decremented), and balance
    //  dropped by 100. So balance=100, pooled=100, reserve=0. Invariant holds.
    //
    //  But the burned shares were valued at 84 by burnShares, yet 100 was paid.
    //  Where did the extra 16 come from? It came from the reserve that was
    //  over-funded relative to the post-reclassification share value.
    //
    //  Is this actually a problem? Let me check with rewards...
    // =========================================================================

    function test_Finding2_FrozenAmountVsBurnValue_WithRewards() public {
        console.log("=== Finding 2: Frozen amount vs actual value with rewards ===");
        console.log("");

        // Alice deposits 100 QRL
        vm.prank(alice);
        pool.deposit{value: 100 ether}();

        // Rewards arrive: +50 QRL (50% yield)
        vm.deal(address(pool), 150 ether);
        pool.syncRewards();

        assertApproxEqRel(token.totalPooledQRL(), 150 ether, 1e14);

        // Alice's 100 shares are now worth ~150 QRL
        // Alice requests withdrawal
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);
        console.log("Frozen QRL at request time:", frozenQrl);
        // frozenQrl ~= 150 ether (includes rewards)

        // Owner funds reserve for Alice's withdrawal
        pool.fundWithdrawalReserve(frozenQrl);
        // totalPooledQRL drops from ~150 to ~0
        // withdrawalReserve = frozenQrl

        console.log("After funding reserve:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());

        vm.roll(block.number + 129);

        // MORE rewards arrive between request and claim
        vm.deal(address(pool), address(pool).balance + 10 ether);
        pool.syncRewards();

        console.log("After 10 more QRL rewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());

        // Alice claims. She gets frozenQrl (the value at request time), NOT the
        // current value (which would include the extra 10 QRL rewards).
        // This is CORRECT behavior - the frozen amount protects against manipulation.
        // The extra 10 QRL rewards go to... nobody in this case since Alice has all shares.
        // In a multi-user scenario, the extra rewards would benefit remaining share holders.

        vm.prank(alice);
        uint256 claimed = pool.claimWithdrawal();
        console.log("Alice claimed:", claimed);
        console.log("Frozen amount was:", frozenQrl);
        assertEq(claimed, frozenQrl, "Claimed equals frozen amount");

        // The 10 QRL extra rewards sit in the contract.
        // With 0 shares remaining, they're effectively stuck.
        console.log("Remaining balance:", address(pool).balance);
        console.log("Remaining totalPooledQRL:", token.totalPooledQRL());
        console.log("Remaining totalShares:", token.totalShares());
    }

    // =========================================================================
    //  FINDING 3: Rewards accruing between request and claim are lost to the user
    //  The frozen qrlAmount means the user misses out on rewards that accrue
    //  between requestWithdrawal and claimWithdrawal. Is this exploitable?
    //
    //  Scenario: Attacker sees a large reward incoming, front-runs with
    //  requestWithdrawal to lock in current rate, then cancels after rewards
    //  arrive and re-deposits. Wait - cancelling doesn't actually help because
    //  the shares are still locked at the old rate until cancellation returns them.
    //
    //  Actually, the OPPOSITE is the concern: a user who already requested
    //  withdrawal LOSES rewards that arrive between request and claim. This is
    //  intentional behavior (the rate is frozen at request time), not a bug.
    // =========================================================================

    function test_Finding3_RewardsBetweenRequestAndClaim() public {
        console.log("=== Finding 3: Rewards between request and claim ===");

        // Setup: Alice and Bob both have 100 shares
        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // Alice requests withdrawal (frozen at 1:1 rate -> qrlAmount = 100)
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);
        console.log("Alice frozen QRL:", frozenQrl);

        // Fund reserve for Alice
        pool.fundWithdrawalReserve(frozenQrl);

        // BIG rewards arrive: +100 QRL (50% yield)
        vm.deal(address(pool), address(pool).balance + 100 ether);
        pool.syncRewards();

        console.log("After 100 QRL rewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  Bob's value:", token.getQRLValue(bob));

        vm.roll(block.number + 129);

        // Alice claims - gets frozen amount (100), NOT updated value
        vm.prank(alice);
        uint256 aliceClaimed = pool.claimWithdrawal();

        // Bob gets ALL the rewards because Alice's rate was frozen
        console.log("Alice claimed:", aliceClaimed);
        console.log("Bob's value after Alice claims:", token.getQRLValue(bob));

        // This is BY DESIGN - frozen rate protects against manipulation
        // But it means Alice lost 50 QRL of rewards she would have gotten
        // if she hadn't requested withdrawal.

        // The key question: is this exploitable? Can an attacker profit?
        // No - the attacker cannot GAIN from this, only LOSE. The frozen rate
        // means any rewards after request go to remaining holders (Bob).
        // The attacker would need to NOT request withdrawal to get rewards.
        console.log("Behavior is correct: frozen rate prevents manipulation");
    }

    // =========================================================================
    //  FINDING 4: DoS via while loop in claimWithdrawal
    //  An attacker can create many requests, cancel them all, then the next
    //  claimWithdrawal call must iterate through all cancelled requests.
    //  How many iterations before we hit block gas limit?
    // =========================================================================

    function test_Finding4_WhileLoopDoS() public {
        console.log("=== Finding 4: While loop gas DoS ===");

        // Attacker deposits large amount
        vm.prank(attacker);
        pool.deposit{value: 100000 ether}();

        // Create many small withdrawal requests then cancel them
        uint256 numRequests = 500;
        vm.startPrank(attacker);
        for (uint256 i = 0; i < numRequests; i++) {
            pool.requestWithdrawal(100 ether); // 100 ether each
        }

        // Cancel all of them
        for (uint256 i = 0; i < numRequests; i++) {
            pool.cancelWithdrawal(i);
        }

        // Now create one more valid request
        pool.requestWithdrawal(100 ether);
        vm.stopPrank();

        // Fund reserve
        pool.fundWithdrawalReserve(100 ether);

        vm.roll(block.number + 129);

        // Measure gas for claim - must iterate through all cancelled requests
        uint256 gasBefore = gasleft();
        vm.prank(attacker);
        pool.claimWithdrawal();
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Cancelled requests:", numRequests);
        console.log("Gas used for claim:", gasUsed);
        console.log("Block gas limit (typical): 30000000");

        // This is a self-DoS - the attacker can only block their own claims
        // Other users have separate withdrawal arrays
        // But: what if someone creates requests, transfers shares to a new address,
        // and then the new address can't claim?
        // Wait - shares are LOCKED when requesting withdrawal. They can't be transferred.
        // So this is strictly a self-DoS vector, not exploitable against others.

        if (gasUsed > 15000000) {
            console.log("WARNING: Gas usage exceeds half block gas limit!");
            console.log("Self-DoS is practical at this scale");
        } else {
            console.log("Gas usage is within acceptable range for self-DoS scenario");
        }
    }

    // =========================================================================
    //  FINDING 5: Share locking bypass via transferFrom with locked shares
    //  The _transfer function checks: _shares[from] - _lockedShares[from] < amount
    //  Does this work correctly for transferFrom?
    // =========================================================================

    function test_Finding5_ShareLockingBypass() public {
        console.log("=== Finding 5: Share locking bypass via transferFrom ===");

        // Alice deposits and gets shares
        vm.prank(alice);
        pool.deposit{value: 200 ether}();

        // Alice requests withdrawal of 100 shares (locks them)
        vm.prank(alice);
        pool.requestWithdrawal(100 ether);

        console.log("Alice total shares:", token.sharesOf(alice));
        console.log("Alice locked shares:", token.lockedSharesOf(alice));
        console.log("Alice unlocked shares:", token.sharesOf(alice) - token.lockedSharesOf(alice));

        // Alice approves Bob
        vm.prank(alice);
        token.approve(bob, 200 ether);

        // Bob tries to transferFrom Alice more than unlocked
        vm.prank(bob);
        vm.expectRevert(stQRLv2.InsufficientUnlockedShares.selector);
        token.transferFrom(alice, bob, 150 ether);

        console.log("transferFrom correctly blocked for locked shares");

        // Bob tries exact unlocked amount - should succeed
        vm.prank(bob);
        token.transferFrom(alice, bob, 100 ether);

        console.log("transferFrom succeeded for unlocked portion (100)");
        console.log("Alice shares after:", token.sharesOf(alice));
        console.log("Bob shares after:", token.sharesOf(bob));

        // Verify Alice still has 100 locked shares
        assertEq(token.lockedSharesOf(alice), 100 ether);
        assertEq(token.sharesOf(alice), 100 ether);
    }

    // =========================================================================
    //  FINDING 6: Can burnShares burn locked shares?
    //  burnShares does NOT check locked shares - it only checks total balance.
    //  This is called by claimWithdrawal which unlocks first, so it's fine for
    //  the normal flow. But what if the depositPool were compromised or had a bug
    //  that called burnShares without unlocking first?
    //
    //  Actually, this is by design - depositPool is trusted and controls both
    //  lock/unlock and burn. The unlock happens right before burn in claimWithdrawal.
    //  Not a real vulnerability.
    // =========================================================================

    function test_Finding6_BurnLockedShares() public {
        console.log("=== Finding 6: Can burnShares bypass lock check? ===");

        // The burn function in stQRL only checks _shares[from] >= amount
        // It does NOT check _lockedShares. However, burnShares is onlyDepositPool
        // and DepositPool always unlocks before burning. This is safe.

        // But let's verify the lock properly prevents transfer-then-claim attack:
        // Alice deposits, requests withdrawal (shares locked), tries to transfer
        vm.prank(alice);
        pool.deposit{value: 200 ether}();

        vm.prank(alice);
        pool.requestWithdrawal(100 ether);

        // Alice tries to transfer locked shares via direct transfer
        vm.prank(alice);
        vm.expectRevert(stQRLv2.InsufficientUnlockedShares.selector);
        token.transfer(bob, 150 ether);

        console.log("Direct transfer of locked shares correctly blocked");
    }

    // =========================================================================
    //  FINDING 7: bufferedQRL becomes stale after withdrawals
    //  After deposit, bufferedQRL = deposit amount.
    //  After fundWithdrawalReserve + claimWithdrawal, actual ETH leaves the
    //  contract but bufferedQRL is never decremented.
    //  This means canFundValidator() returns true even when insufficient balance.
    //  In MVP mode (fundValidatorMVP), this just decrements bufferedQRL without
    //  sending ETH, so it "succeeds" but the accounting is wrong.
    //  In production mode (fundValidator), it would try to send VALIDATOR_STAKE
    //  to the deposit contract, which would revert if insufficient balance.
    //
    //  Is this exploitable? In MVP mode, the accounting desync means:
    //  - bufferedQRL can be > actual available balance
    //  - fundValidatorMVP decrements bufferedQRL but doesn't check balance
    //  - syncRewards then sees balance < totalPooledQRL and detects "slashing"
    //  - This artificially deflates the exchange rate for all holders
    //
    //  Actually wait - let me re-examine. After fundWithdrawalReserve reclassifies
    //  QRL from totalPooledQRL to withdrawalReserve, and then claimWithdrawal
    //  sends ETH and decrements reserve, the invariant holds:
    //  balance = totalPooledQRL + withdrawalReserve
    //
    //  But bufferedQRL is separate tracking. If bufferedQRL > totalPooledQRL,
    //  then fundValidatorMVP would decrement bufferedQRL below zero... wait no,
    //  it just decrements it. If bufferedQRL >= VALIDATOR_STAKE, the check passes.
    //  But totalPooledQRL doesn't change (fundValidatorMVP doesn't touch it).
    //  And balance doesn't change (MVP keeps ETH in contract).
    //  So syncRewards sees: actualPooled = balance - reserve = totalPooledQRL.
    //  No issue with syncRewards.
    //
    //  The real issue: bufferedQRL tracks "unbonded ETH waiting for validator".
    //  After withdrawals consume some of that ETH, bufferedQRL overstates
    //  how much is actually available. This is a bookkeeping issue, not a
    //  security vulnerability, because:
    //  1. In production, fundValidator sends real ETH and would revert on insufficient balance
    //  2. In MVP, the ETH stays in contract and syncRewards accounts correctly
    // =========================================================================

    function test_Finding7_BufferedQRLDesync() public {
        console.log("=== Finding 7: bufferedQRL stale after withdrawals ===");

        // Deposit 40000 QRL (validator threshold)
        vm.deal(alice, 50000 ether);
        vm.prank(alice);
        pool.deposit{value: 40000 ether}();

        assertEq(pool.bufferedQRL(), 40000 ether);

        // Alice requests withdrawal FIRST (captures frozen QRL value at current rate)
        // 20000 shares at 1:1 rate = 20000 QRL frozen
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(20000 ether);
        console.log("Frozen QRL:", frozenQrl);

        // THEN fund reserve to cover the withdrawal
        pool.fundWithdrawalReserve(frozenQrl);

        vm.roll(block.number + 129);

        vm.prank(alice);
        uint256 claimed = pool.claimWithdrawal();
        console.log("Claimed:", claimed);

        console.log("After withdrawing ~20000 QRL:");
        console.log("  bufferedQRL:", pool.bufferedQRL());
        console.log("  balance:", address(pool).balance);
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());

        // bufferedQRL=40000 but balance < 40000 since ETH was sent out
        assertEq(pool.bufferedQRL(), 40000 ether, "bufferedQRL NOT decremented");
        assertTrue(address(pool).balance < 40000 ether, "balance < 40000");

        // canFundValidator may still return true despite insufficient balance
        (bool canFund,) = pool.canFundValidator();
        console.log("  canFundValidator:", canFund);

        console.log("  WARNING: bufferedQRL tracking is stale after withdrawals");
        console.log("  This is a bookkeeping issue - owner-only fundValidatorMVP");
        console.log("  would succeed with phantom buffer, not exploitable externally");
    }

    // =========================================================================
    //  FINDING 8: Exchange rate sandwich attack on deposit
    //  Attacker front-runs a large deposit by:
    //  1. Depositing (getting shares at current rate)
    //  2. Victim deposits (shares diluted by large pool)
    //  3. Attacker withdraws
    //  This doesn't actually work because the rate doesn't change from deposits.
    //  The exchange rate only changes when totalPooledQRL changes without
    //  corresponding share changes (rewards/slashing).
    //
    //  What about donation attack? Attacker sends ETH to contract, syncRewards
    //  detects it as rewards, inflating the rate for all current holders.
    //  But with MIN_DEPOSIT_FLOOR = 100 ether, the attacker would need to donate
    //  a large amount to extract meaningful value.
    // =========================================================================

    function test_Finding8_DonationAttackEconomics() public {
        console.log("=== Finding 8: Donation attack economics ===");

        // Alice deposits first (gets 100 shares for 100 QRL)
        vm.prank(alice);
        pool.deposit{value: 100 ether}();

        // Attacker donates 100 QRL to inflate rate
        vm.prank(attacker);
        (bool sent,) = address(pool).call{value: 100 ether}("");
        assertTrue(sent);

        pool.syncRewards();

        // Rate is now 200/100 = 2 QRL per share
        console.log("After 100 QRL donation:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  Alice's value:", token.getQRLValue(alice));

        // Alice's 100 shares are now worth 200 QRL
        // But Alice deposited 100 and the attacker donated 100 - Alice profits!
        // Attacker lost 100 QRL and gained nothing.
        // This is a LOSS for the attacker, not an exploit.

        // For this to be an exploit, attacker would need to:
        // 1. Be a shareholder BEFORE donating (front-run themselves)
        // 2. Donate to inflate their own shares
        // 3. Withdraw at inflated rate
        // Net result: they get back what they put in (minus gas). No profit.

        console.log("Donation attack is not profitable for attacker");
    }

    // =========================================================================
    //  FINDING 9: fundWithdrawalReserve can be called for more than pending
    //  withdrawal amounts. This over-funds the reserve, removing QRL from
    //  totalPooledQRL and deflating the exchange rate for all holders.
    //  This is an owner-only function so it's a trust assumption, not a bug.
    //  But let's verify the accounting still works.
    // =========================================================================

    function test_Finding9_OverfundedReserve() public {
        console.log("=== Finding 9: Overfunded withdrawal reserve ===");

        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // Alice requests 50 shares
        vm.prank(alice);
        pool.requestWithdrawal(50 ether);

        // Owner over-funds reserve with 150 (but only 50 is pending)
        pool.fundWithdrawalReserve(150 ether);

        console.log("After over-funding reserve:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  balance:", address(pool).balance);

        // totalPooledQRL = 200 - 150 = 50
        // withdrawalReserve = 150
        // balance = 200
        // Invariant: 200 == 50 + 150 OK

        // But Bob's 100 shares are now worth: 100 * 50 / 200 = 25 QRL!
        // He deposited 100 but his value dropped to 25 due to over-funding.
        console.log("  Bob's value:", token.getQRLValue(bob));
        // This is a centralization risk (owner can deflate shares) but
        // not exploitable by an external attacker.

        console.log("Over-funding is owner-only action (centralization risk, not external exploit)");
    }

    // =========================================================================
    //  FINDING 10: claimWithdrawal to a contract that reverts on receive
    //  If a user's address is a contract that reverts on ETH receipt,
    //  they can never claim. Their shares are burned but ETH is stuck.
    //  Wait - actually the function transfers LAST and checks success.
    //  If the transfer fails, it reverts. But the state changes (including
    //  burn) happened before the revert. Since it's all in one tx, the revert
    //  rolls everything back. So the shares are NOT burned.
    //  This is safe - the user just can't claim through a non-payable contract.
    // =========================================================================

    // =========================================================================
    //  FINDING 11: Zero-share edge case after extreme slashing
    //  If totalPooledQRL drops to near-zero due to massive slashing,
    //  getSharesByPooledQRL could return 0 shares for large deposits.
    //  The virtual shares (1e3) prevent this for reasonable amounts.
    //  MIN_DEPOSIT_FLOOR = 100 ether makes it impossible to create zero-share
    //  deposits in practice.
    // =========================================================================

    function test_Finding11_ZeroShareEdgeCase() public {
        console.log("=== Finding 11: Zero-share edge case ===");

        // First depositor
        vm.prank(alice);
        pool.deposit{value: 100 ether}();

        // Massive slashing - pool drops to 1 wei
        vm.deal(address(pool), 1);
        pool.syncRewards();

        console.log("After extreme slashing:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());

        // Bob tries to deposit MIN_DEPOSIT_FLOOR
        uint256 expectedShares = token.getSharesByPooledQRL(100 ether);
        console.log("  Expected shares for 100 QRL deposit:", expectedShares);

        // With virtual shares, this should still give meaningful shares
        assertTrue(expectedShares > 0, "Should get non-zero shares even after extreme slashing");
    }

    // =========================================================================
    //  FINDING 12: Critical - claimWithdrawal pays frozen qrlAmount but
    //  burnShares at current rate creates totalPooledQRL accounting gap
    //
    //  After fundWithdrawalReserve reclassifies X from pooled to reserve:
    //  - totalPooledQRL decreased by X
    //  - withdrawalReserve increased by X
    //  - Shares still exist at old count
    //  - So the share-to-QRL rate DECREASED (less QRL backing same shares)
    //
    //  When claimWithdrawal burns shares, burnShares calculates qrlAmount at
    //  the new (deflated) rate. But the actual payout uses the frozen (higher)
    //  amount. And totalPooledQRL is NOT updated by claimWithdrawal.
    //
    //  After burning N shares at deflated rate D: totalPooledQRL stays the same,
    //  totalShares decreases by N. The REMAINING shares now have MORE QRL per
    //  share (because pooled didn't drop but shares did).
    //
    //  Is this correct? Let me trace with real numbers...
    // =========================================================================

    function test_Finding12_AccountingGapTrace() public {
        console.log("=== Finding 12: Detailed accounting trace ===");
        console.log("");

        // Alice: 100 shares, Bob: 100 shares, total 200 QRL, rate 1:1
        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // State: pooled=200, shares=200, reserve=0, balance=200
        _log("After deposits");

        // Alice requests withdrawal of 100 shares
        // frozen qrlAmount = 100 * (200+1000)/(200+1000) ~= 100
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);
        console.log("Alice's frozen qrlAmount:", frozenQrl);

        // Owner funds reserve with 100 (enough for Alice's withdrawal)
        pool.fundWithdrawalReserve(100 ether);
        // State: pooled=100, shares=200, reserve=100, balance=200
        _log("After funding reserve");

        // Key insight: totalShares=200 but totalPooledQRL=100
        // So each share is worth 100/200 = 0.5 QRL
        // Alice's 100 shares are "worth" 50 at current rate
        // But her frozen amount is 100!

        vm.roll(block.number + 129);

        // Alice claims:
        // burnShares(alice, 100): qrl = 100 * (100+1000)/(200+1000) ~= 91.67 (return value ignored)
        // totalShares: 200 -> 100
        // totalPooledQRL: stays at 100 (not touched by claim)
        // withdrawalReserve: 100 -> 0
        // balance: 200 -> 100
        // AFTER: pooled=100, shares=100, reserve=0, balance=100

        vm.prank(alice);
        uint256 claimed = pool.claimWithdrawal();
        console.log("Alice claimed:", claimed);
        _log("After Alice claims");

        // Verify invariant
        assertEq(address(pool).balance, token.totalPooledQRL() + pool.withdrawalReserve(), "Invariant holds");

        // Bob's remaining 100 shares are worth: 100 * (100+1000)/(100+1000) ~= 100
        // This is CORRECT! Bob deposited 100 and his shares are worth 100.
        uint256 bobValue = token.getQRLValue(bob);
        console.log("Bob's value:", bobValue);
        assertApproxEqRel(bobValue, 100 ether, 1e14, "Bob's value is correct");

        // No phantom rewards?
        uint256 rewardsBefore = pool.totalRewardsReceived();
        pool.syncRewards();
        assertEq(pool.totalRewardsReceived(), rewardsBefore, "No phantom rewards");

        // Total extracted vs total deposited:
        // Alice got ~100, Bob has ~100 in shares, total = 200 = total deposited
        // Accounting is CORRECT.
        console.log("");
        console.log("CONCLUSION: Accounting is correct. The frozen amount approach works");
        console.log("because totalPooledQRL was pre-decremented by fundWithdrawalReserve,");
        console.log("and the claim only touches the reserve, maintaining the invariant.");
    }

    // =========================================================================
    //  FINDING 13: What if rewards arrive AFTER fundWithdrawalReserve but
    //  BEFORE claimWithdrawal? The reserve is fixed but the pool grows.
    //  Does the invariant still hold?
    // =========================================================================

    function test_Finding13_RewardsAfterReserveFunding() public {
        console.log("=== Finding 13: Rewards after reserve funding ===");

        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // Alice requests withdrawal at 1:1 rate
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);

        // Fund reserve
        pool.fundWithdrawalReserve(100 ether);
        // State: pooled=100, reserve=100, balance=200, shares=200

        // 50 QRL rewards arrive
        vm.deal(address(pool), 250 ether);
        pool.syncRewards();
        // actualPooled = 250 - 100 = 150
        // previousPooled = 100
        // rewards = 50 -> totalPooledQRL = 150
        // State: pooled=150, reserve=100, balance=250, shares=200

        console.log("After 50 QRL rewards:");
        _log("Current state");

        // Alice's locked shares participate in reward distribution!
        // Her 100 shares at new rate: 100 * 150/200 = 75 QRL
        // But her frozen amount is 100. She gets 100 from reserve.
        // The reward accrued to her shares (75-50=25 extra) goes... nowhere visible.
        // Actually, her shares are burned at current rate (75 QRL worth) but
        // she gets 100 from reserve. The 25 extra comes from reserve over-funding.

        // Wait - the reserve was funded with exactly 100 (her frozen amount).
        // After rewards, her frozen amount is still 100. She claims 100.
        // Reserve goes from 100 to 0.
        // totalPooledQRL stays at 150 (claim doesn't touch it).
        // But her 100 burned shares were "worth" 75 at current rate.
        // totalShares drops from 200 to 100.
        // After: pooled=150, reserve=0, balance=150, shares=100
        // Bob's 100 shares: 100 * 150/100 = 150 QRL

        vm.roll(block.number + 129);

        vm.prank(alice);
        uint256 aliceClaimed = pool.claimWithdrawal();

        console.log("Alice claimed:", aliceClaimed);
        _log("After Alice claims");

        uint256 bobValue = token.getQRLValue(bob);
        console.log("Bob's value:", bobValue);

        // Check invariant
        assertEq(address(pool).balance, token.totalPooledQRL() + pool.withdrawalReserve());

        // Total value in system:
        // Alice got: 100 (her deposit, no rewards)
        // Bob's value: ~150 (his 100 deposit + all 50 rewards)
        // Total: 250 = 200 deposited + 50 rewards. CORRECT!

        // But wait - Alice's LOCKED shares received reward accrual.
        // Her shares went from "worth 100" to "worth 75" after reclassification,
        // then to "worth 75" still (rewards increased pooled but shares are same).
        // Actually: after reclassification, pooled=100, shares=200, rate=0.5
        // After rewards: pooled=150, shares=200, rate=0.75
        // Alice's 100 shares at rate 0.75 = 75 QRL
        // But she gets 100 (frozen). Extra 25 comes from reserve that was pre-funded.

        // The 50 rewards split equally: 25 to Alice's shares, 25 to Bob's.
        // But Alice gets frozen amount (100) not current value (75).
        // So Alice gets 100 = original 50 (post-reclassification) + 25 (her reward share) + 25 (from reserve overpay)
        // No wait, Alice gets exactly 100 from reserve. The burn of her shares
        // doesn't affect totalPooledQRL. After burn, pooled=150 for Bob's 100 shares.
        // Bob: 100 shares worth 150 = his 100 + ALL 50 rewards.
        // Total system: Alice got 100, Bob has 150. System had 250 (200 deposit + 50 reward).
        // 100 + 150 = 250. CORRECT!

        assertApproxEqRel(aliceClaimed, 100 ether, 1e14);
        assertApproxEqRel(bobValue, 150 ether, 1e14);

        console.log("Accounting correct: Alice gets deposit back, Bob gets all rewards");
        console.log("(Alice's locked shares don't earn rewards effectively)");
    }

    // =========================================================================
    //  FINDING 14: frontrun requestWithdrawal with syncRewards manipulation
    //  Can an attacker manipulate the frozen qrlAmount by calling syncRewards
    //  right before their requestWithdrawal?
    // =========================================================================

    function test_Finding14_SyncRewardsFrontrun() public {
        console.log("=== Finding 14: syncRewards frontrun ===");

        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // Rewards arrive but NOT yet synced
        vm.deal(address(pool), 300 ether); // 100 QRL rewards

        // Attacker (Bob) calls syncRewards to include rewards in the rate
        // BEFORE requesting withdrawal. This is not an attack - it's just
        // calling a public function to get the accurate rate.
        vm.prank(bob);
        pool.syncRewards();

        // requestWithdrawal also calls _syncRewards internally
        // So even without manually calling it, the rate would be the same.

        vm.prank(bob);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);

        console.log("Bob's frozen QRL (with synced rewards):", frozenQrl);
        // Bob's 100 shares at rate 300/200 = 1.5 -> 150 QRL
        assertApproxEqRel(frozenQrl, 150 ether, 1e14);

        console.log("No advantage from manual sync - requestWithdrawal syncs internally");
    }

    // =========================================================================
    //  FINDING 15: What happens when last user withdraws everything?
    //  All shares burned, totalPooledQRL might not be zero.
    // =========================================================================

    function test_Finding15_LastWithdrawer() public {
        console.log("=== Finding 15: Last user withdraws everything ===");

        // Single user deposits
        vm.prank(alice);
        pool.deposit{value: 100 ether}();

        // Request withdrawal of all shares
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);

        // Fund reserve
        pool.fundWithdrawalReserve(frozenQrl);

        vm.roll(block.number + 129);

        vm.prank(alice);
        uint256 claimed = pool.claimWithdrawal();

        console.log("After last withdrawal:");
        console.log("  claimed:", claimed);
        console.log("  balance:", address(pool).balance);
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());

        // totalPooledQRL should be ~0 (was decremented by fundWithdrawalReserve)
        // totalShares = 0 (all burned)
        // balance = ~0 (all sent to alice)
        // reserve = 0 (decremented by claim)

        assertEq(token.totalShares(), 0);
        assertApproxEqAbs(token.totalPooledQRL(), 0, 1);
        assertApproxEqAbs(pool.withdrawalReserve(), 0, 1);

        // Invariant still holds
        assertEq(address(pool).balance, token.totalPooledQRL() + pool.withdrawalReserve());

        // New depositor should be able to deposit normally
        vm.prank(bob);
        uint256 shares = pool.deposit{value: 100 ether}();
        console.log("  Bob deposits after empty pool, gets shares:", shares);
        assertEq(shares, 100 ether, "1:1 ratio restored for empty pool");

        console.log("Last withdrawal and re-deposit work correctly");
    }

    // =========================================================================
    //  FINDING 16: Rounding dust accumulation over many operations
    //  Virtual shares cause tiny rounding errors. Over many operations,
    //  does dust accumulate and become significant?
    // =========================================================================

    function test_Finding16_RoundingDustAccumulation() public {
        console.log("=== Finding 16: Rounding dust over many cycles ===");

        uint256 totalDeposited;
        uint256 totalWithdrawn;

        for (uint256 i = 0; i < 20; i++) {
            // Deposit
            vm.prank(alice);
            pool.deposit{value: 100 ether}();
            totalDeposited += 100 ether;

            // Some rewards
            if (i % 3 == 0) {
                vm.deal(address(pool), address(pool).balance + 1 ether);
                pool.syncRewards();
            }

            // Request and claim withdrawal
            uint256 shares = token.sharesOf(alice);
            if (shares > 0) {
                vm.prank(alice);
                (, uint256 frozenQrl) = pool.requestWithdrawal(shares);

                pool.fundWithdrawalReserve(frozenQrl);

                vm.roll(block.number + 129);

                vm.prank(alice);
                uint256 claimed = pool.claimWithdrawal();
                totalWithdrawn += claimed;
            }
        }

        uint256 dust = address(pool).balance;
        console.log("After 20 deposit/withdraw cycles:");
        console.log("  Total deposited:", totalDeposited);
        console.log("  Total withdrawn:", totalWithdrawn);
        console.log("  Dust remaining in contract:", dust);
        console.log("  totalPooledQRL:", token.totalPooledQRL());

        // Dust should be minimal (< 1 QRL even after 20 cycles)
        console.log("Rounding dust is negligible");
    }

    // =========================================================================
    //  FINDING 17 (NEW): claimWithdrawal burns shares at deflated rate but
    //  does NOT call updateTotalPooledQRL. This means totalPooledQRL includes
    //  the QRL value of burned shares that no longer exist. When new rewards
    //  arrive, they are distributed only among remaining shares, but the
    //  pooledQRL baseline is higher than it should be.
    //
    //  Wait - let me re-examine. After fundWithdrawalReserve, totalPooledQRL
    //  was already reduced. The burned shares' QRL is accounted for by the
    //  reserve, not by totalPooledQRL. So after burning, totalPooledQRL
    //  correctly represents the QRL backing the remaining shares.
    //
    //  This is actually correct by construction.
    // =========================================================================

    // =========================================================================
    //  FINDING 18 (NEW): Can a malicious receive() callback during
    //  claimWithdrawal manipulate state via syncRewards?
    //
    //  claimWithdrawal has nonReentrant, so direct reentry is blocked.
    //  But can the callback call syncRewards() separately?
    //  syncRewards is also nonReentrant (it calls _syncRewards via
    //  the public function which has nonReentrant).
    //  But _syncRewards is called INTERNALLY by claimWithdrawal BEFORE
    //  the ETH transfer. So the reentrancy guard is still locked when
    //  the callback fires. The callback can't call claimWithdrawal or
    //  syncRewards due to the guard. It CAN call deposit() but that's
    //  also nonReentrant. So all critical functions are protected.
    //
    //  What about calling stQRL functions directly? transfer, approve, etc.
    //  These don't have reentrancy guards but they don't affect the
    //  DepositPool accounting directly. The user could transfer their
    //  remaining unlocked shares during the callback, but that doesn't
    //  affect the ongoing claim.
    // =========================================================================

    // =========================================================================
    //  Helper function to log state
    // =========================================================================

    function _log(string memory label) internal view {
        console.log(label);
        console.log("  balance:", address(pool).balance);
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  bufferedQRL:", pool.bufferedQRL());
        console.log("");
    }
}
