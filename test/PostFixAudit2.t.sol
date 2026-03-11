// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/solidity/stQRL-v2.sol";
import "../contracts/solidity/DepositPool-v2.sol";

/**
 * @title Post-Fix Security Audit Tests - Part 2
 * @notice Deeper investigation of locked share reward dilution and timing attacks
 */
contract PostFixAudit2 is Test {
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
    //  INVESTIGATION: Locked shares dilute rewards for active stakers
    //
    //  When Alice requests withdrawal, her shares get LOCKED but remain in
    //  totalShares. When rewards arrive, they're distributed proportionally
    //  to ALL shares (including locked ones). But Alice's payout is frozen
    //  at the pre-reward rate. So the reward that "accrued" to her locked
    //  shares is effectively trapped.
    //
    //  Where does this trapped value go? After Alice claims:
    //  - Her shares are burned (totalShares decreases)
    //  - totalPooledQRL is NOT decreased (claim doesn't touch it)
    //  - So remaining shares now represent MORE QRL each
    //  - The "trapped" reward redistributes to remaining holders
    //
    //  This is actually a windfall for remaining holders who benefit from
    //  the delayed claim. Is this exploitable?
    //
    //  Attack scenario: Bob knows rewards are coming.
    //  1. Bob deposits just before rewards arrive
    //  2. Rewards arrive, split among all shares (including locked ones)
    //  3. Alice claims at frozen rate, trapping her reward share
    //  4. Bob's shares appreciate by more than his pro-rata share
    //  5. Bob withdraws at the inflated rate
    //
    //  For this to be profitable, Bob needs locked shares to exist.
    //  Bob can't create locked shares himself (he'd be locking his own value).
    //  He needs OTHER users to have pending withdrawals.
    // =========================================================================

    function test_LockedShareRewardDilution() public {
        console.log("=== Locked share reward dilution analysis ===");
        console.log("");

        // Alice deposits 100, Bob deposits 100
        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // Alice requests withdrawal of all shares
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);
        console.log("Alice frozen QRL:", frozenQrl);

        // Owner funds reserve BEFORE rewards arrive
        pool.fundWithdrawalReserve(frozenQrl);
        // State: pooled=100, reserve=100, shares=200, balance=200

        console.log("Before rewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  Bob's value:", token.getQRLValue(bob));

        // 100 QRL rewards arrive
        vm.deal(address(pool), address(pool).balance + 100 ether);
        pool.syncRewards();
        // actualPooled = 300 - 100 = 200
        // previousPooled = 100
        // rewards = 100 -> totalPooledQRL = 200
        // State: pooled=200, reserve=100, shares=200, balance=300

        console.log("After 100 QRL rewards:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  Bob's value:", token.getQRLValue(bob));
        console.log("  Alice's locked shares value:", token.getPooledQRLByShares(100 ether));

        // Alice's 100 locked shares are "worth" 100 QRL at current rate (200/200 = 1:1)
        // Bob's 100 shares are also "worth" 100 QRL
        // But Alice will claim at frozen rate = 100 QRL (same as current, coincidentally)

        // Wait - the rewards split equally because shares = 200, pooled went from 100 to 200
        // Each share now "worth" 200/200 = 1 QRL. Both at 100.
        // Alice's frozen amount = 100, current value = 100. No difference!

        // Let me try a scenario where reserve is funded AFTER rewards arrive...
        console.log("");
        console.log("=== Scenario 2: Reserve funded AFTER rewards ===");
    }

    function test_LockedShareRewardDilution_Scenario2() public {
        console.log("=== Scenario 2: Request before rewards, fund reserve after ===");
        console.log("");

        // Alice deposits 100, Bob deposits 100
        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();

        // Alice requests withdrawal at 1:1 rate -> frozen=100
        vm.prank(alice);
        (, uint256 frozenQrl) = pool.requestWithdrawal(100 ether);
        console.log("Alice frozen QRL:", frozenQrl);

        // 100 QRL rewards arrive (before reserve is funded!)
        vm.deal(address(pool), address(pool).balance + 100 ether);
        pool.syncRewards();
        // pooled: 200 + 100 = 300 (all in pooled, no reserve yet)
        // shares = 200
        // rate = 300/200 = 1.5

        console.log("After 100 QRL rewards (no reserve yet):");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  Bob's value:", token.getQRLValue(bob));
        console.log("  Alice's shares value (live):", token.getPooledQRLByShares(100 ether));

        // NOW fund reserve for Alice's frozen amount (100)
        pool.fundWithdrawalReserve(frozenQrl);
        // pooled: 300 - 100 = 200
        // reserve: 100
        // shares = 200

        console.log("After funding reserve with 100:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  withdrawalReserve:", pool.withdrawalReserve());
        console.log("  Bob's value:", token.getQRLValue(bob));

        // Bob's 100 shares at rate 200/200 = 1 -> 100 QRL
        // But wait - Bob's shares SHOULD be worth 150 (his 100 + 50% of rewards)
        // The problem: fundWithdrawalReserve took 100 from pooled, bringing it to 200.
        // But Alice's shares are still in totalShares. Rate = 200/200 = 1.
        // Bob's value = 100 * 1 = 100. That's LESS than his fair share.

        // Where did the reward go? Alice's frozen amount is 100 (pre-reward).
        // If rewards were split fairly: Alice gets 50, Bob gets 50.
        // Alice should have gotten 100+50=150 but her frozen amount is 100.
        // So 50 of rewards are "lost" to Alice but not redistributed to Bob.
        // They're in the system as pooled=200 with 200 shares = rate 1.
        // Alice claims 100 from reserve. Burns 100 shares.
        // After: pooled=200, shares=100 -> Bob's value = 200. WAIT.

        vm.roll(block.number + 129);

        vm.prank(alice);
        uint256 aliceClaimed = pool.claimWithdrawal();
        // Claim burns 100 shares. totalShares: 200 -> 100
        // totalPooledQRL stays at 200 (not touched by claim)
        // reserve: 100 -> 0
        // balance: 300 -> 200

        console.log("After Alice claims:");
        console.log("  Alice claimed:", aliceClaimed);
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  Bob's value:", token.getQRLValue(bob));

        // Bob's 100 shares: 100 * 200/100 = 200 QRL!
        // Bob deposited 100, got ALL 100 rewards (not just 50).
        // Alice deposited 100, got 100 back (missed all rewards).
        // Total: 200 + 100 = 300 = 200 deposited + 100 rewards. CORRECT!

        // But is the distribution FAIR?
        // Alice requested withdrawal at rate 1:1 (before rewards).
        // She froze at 100. She should only get 100. This is intentional.
        // The rewards that "accrued" to her locked shares went to Bob after claim.
        // This is by design: frozen rate means you forfeit future rewards.

        assertApproxEqRel(aliceClaimed, 100 ether, 1e14);
        assertApproxEqRel(token.getQRLValue(bob), 200 ether, 1e14);

        console.log("");
        console.log("RESULT: Locked shares dilute rewards DURING the lock period,");
        console.log("but after claim, remaining holders get the full benefit.");
        console.log("This is by design - frozen rate forfeits future rewards.");
    }

    // =========================================================================
    //  INVESTIGATION: Can an attacker exploit the timing of fundWithdrawalReserve
    //  to extract value?
    //
    //  fundWithdrawalReserve reduces totalPooledQRL, deflating the exchange rate
    //  for ALL share holders. If an attacker sees this tx in the mempool, they
    //  could:
    //  1. Front-run: requestWithdrawal at current (higher) rate
    //  2. fundWithdrawalReserve executes, deflating rate
    //  3. Attacker's frozen amount is at the pre-deflation rate
    //  4. Attacker claims more than their shares are worth post-deflation
    //
    //  But wait - fundWithdrawalReserve is onlyOwner. The attacker can't call it.
    //  They CAN front-run the owner's tx to request withdrawal at the higher rate.
    //  Is this a sandwich attack on the owner's fundWithdrawalReserve call?
    // =========================================================================

    function test_FundReserveSandwich() public {
        console.log("=== Fund reserve sandwich attack ===");
        console.log("");

        // Setup: 3 users, 100 each
        vm.prank(alice);
        pool.deposit{value: 100 ether}();
        vm.prank(bob);
        pool.deposit{value: 100 ether}();
        vm.prank(attacker);
        pool.deposit{value: 100 ether}();

        // State: pooled=300, shares=300, rate=1:1
        console.log("Initial state:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());

        // Attacker front-runs fundWithdrawalReserve with requestWithdrawal
        // This freezes their amount at the current rate BEFORE deflation
        vm.prank(attacker);
        (, uint256 attackerFrozen) = pool.requestWithdrawal(100 ether);
        console.log("Attacker frozen QRL (pre-deflation):", attackerFrozen);

        // Owner funds reserve with 200 (for some other withdrawal reason)
        // This deflates the rate for everyone
        pool.fundWithdrawalReserve(200 ether);

        console.log("After fundWithdrawalReserve(200):");
        console.log("  totalPooledQRL:", token.totalPooledQRL()); // 300-200=100
        console.log("  withdrawalReserve:", pool.withdrawalReserve()); // 200

        // Attacker's frozen amount: 100 QRL (from before deflation)
        // Current value of 100 shares: 100 * (100/300) = 33.33 QRL
        // Attacker gets 100 from reserve but shares are "worth" 33.33
        // The extra 66.67 comes from the reserve (which was over-funded)

        // But wait - the reserve was funded with 200. The attacker's 100 comes from that.
        // Alice and Bob still have 100 shares each valued at 33.33 = 66.67 total.
        // Plus 100 remaining in reserve for them.
        // Total: attacker gets 100, Alice+Bob have 66.67 + 100 = 166.67
        // Grand total: 266.67, but we started with 300. That's a 33.33 gap!

        // Actually let me trace more carefully:
        // After funding reserve: pooled=100, reserve=200, shares=300, balance=300
        // Attacker claims (after delay): burns 100 shares, gets 100 from reserve
        // After: pooled=100, reserve=100, shares=200, balance=200
        // Alice's value: 100 * 100/200 = 50
        // Bob's value: 100 * 100/200 = 50
        // Alice + Bob = 100 + reserve 100 = 200
        // Grand total with attacker: 100 + 200 = 300. CORRECT!

        // The key insight: fundWithdrawalReserve deflates everyone's shares equally.
        // The attacker froze at pre-deflation rate and gets the "right" amount.
        // Alice and Bob's shares are deflated but there's reserve available for their
        // withdrawals too. The owner funded 200 in reserve, which covers:
        // - Attacker's 100 claim
        // - 100 remaining for Alice/Bob

        // Is the attacker extracting MORE than their fair share?
        // Attacker deposited 100, froze at 100. Claimed 100. Net: 0 gain.
        // Without the attack, attacker would wait for reserve funding and request
        // at the deflated rate (33.33). So they DID benefit from timing.
        // But the "extra" 66.67 was funded by the owner explicitly.

        vm.roll(block.number + 129);

        vm.prank(attacker);
        uint256 attackerClaimed = pool.claimWithdrawal();

        console.log("Attacker claimed:", attackerClaimed);
        console.log("Bob's value after attacker claim:", token.getQRLValue(bob));
        console.log("Alice's value:", token.getQRLValue(alice));

        // Verify: attacker got back their deposit (100), no extra
        assertApproxEqRel(attackerClaimed, 100 ether, 1e14);

        console.log("");
        console.log("RESULT: Attacker gets back their deposit (100). No extra value extracted.");
        console.log("The frozen rate just means they get pre-deflation amount,");
        console.log("which equals their original deposit. No sandwich profit possible.");
    }

    // =========================================================================
    //  INVESTIGATION: Can requestWithdrawal + cancelWithdrawal be used to
    //  manipulate the exchange rate?
    //
    //  Request locks shares and records frozen amount.
    //  Cancel unlocks shares.
    //  Neither changes totalPooledQRL or totalShares.
    //  So no exchange rate manipulation is possible.
    //
    //  But what about totalWithdrawalShares? It's incremented on request and
    //  decremented on cancel. This is a counter, not used in rate calculations.
    //  No impact.
    // =========================================================================

    // =========================================================================
    //  INVESTIGATION: Can the while loop in claimWithdrawal be exploited
    //  across users?
    //
    //  Each user has their OWN withdrawal request array and nextWithdrawalIndex.
    //  User A's cancelled requests don't affect User B's claims.
    //  The while loop only iterates over the CALLER's array.
    //  So the DoS is strictly self-inflicted.
    // =========================================================================

    // =========================================================================
    //  INVESTIGATION: Race condition between requestWithdrawal and syncRewards
    //
    //  requestWithdrawal calls _syncRewards() first, then computes qrlAmount.
    //  This means the rate is always up-to-date when the frozen amount is set.
    //  No race condition possible - it's atomic within a single transaction.
    // =========================================================================

    // =========================================================================
    //  INVESTIGATION: What if owner calls fundWithdrawalReserve multiple times
    //  for the same withdrawal?
    //
    //  Each call reclassifies from pooled to reserve. If called twice for the
    //  same 100 QRL withdrawal, 200 goes into reserve. This over-funds and
    //  deflates the rate. But it's onlyOwner and the excess can be reclaimed
    //  by funding more withdrawals from reserve.
    //
    //  Not exploitable externally.
    // =========================================================================

    // =========================================================================
    //  INVESTIGATION: Invariant verification across ALL state transitions
    //
    //  The key invariant: balance == totalPooledQRL + withdrawalReserve
    //
    //  Let's verify this holds across a complex multi-step scenario.
    // =========================================================================

    function test_InvariantAcrossComplexFlow() public {
        console.log("=== Invariant verification across complex flow ===");
        console.log("");

        // Step 1: Multiple deposits
        vm.prank(alice);
        pool.deposit{value: 1000 ether}();
        vm.prank(bob);
        pool.deposit{value: 500 ether}();
        _checkInvariant("After deposits");

        // Step 2: Rewards arrive
        vm.deal(address(pool), address(pool).balance + 150 ether);
        pool.syncRewards();
        _checkInvariant("After rewards");

        // Step 3: Alice requests partial withdrawal
        vm.prank(alice);
        (, uint256 aliceFrozen) = pool.requestWithdrawal(500 ether);
        _checkInvariant("After Alice requests withdrawal");

        // Step 4: Fund reserve
        pool.fundWithdrawalReserve(aliceFrozen);
        _checkInvariant("After funding reserve");

        // Step 5: More rewards arrive
        vm.deal(address(pool), address(pool).balance + 50 ether);
        pool.syncRewards();
        _checkInvariant("After more rewards");

        // Step 6: Bob requests withdrawal
        vm.prank(bob);
        (, uint256 bobFrozen) = pool.requestWithdrawal(250 ether);
        _checkInvariant("After Bob requests withdrawal");

        // Step 7: Fund more reserve
        pool.fundWithdrawalReserve(bobFrozen);
        _checkInvariant("After funding more reserve");

        // Step 8: Alice claims
        vm.roll(block.number + 129);
        vm.prank(alice);
        pool.claimWithdrawal();
        _checkInvariant("After Alice claims");

        // Step 9: Bob claims
        vm.prank(bob);
        pool.claimWithdrawal();
        _checkInvariant("After Bob claims");

        // Step 10: Slashing event
        uint256 currentBal = address(pool).balance;
        if (currentBal > 10 ether) {
            vm.deal(address(pool), currentBal - 10 ether);
            pool.syncRewards();
            _checkInvariant("After slashing");
        }

        // Step 11: New deposits after slashing
        vm.prank(alice);
        pool.deposit{value: 200 ether}();
        _checkInvariant("After new deposit post-slashing");

        // Step 12: Alice withdraws everything
        uint256 aliceShares = token.sharesOf(alice);
        uint256 aliceLocked = token.lockedSharesOf(alice);
        uint256 aliceUnlocked = aliceShares - aliceLocked;
        if (aliceUnlocked > 0) {
            vm.prank(alice);
            (, uint256 frozen) = pool.requestWithdrawal(aliceUnlocked);
            pool.fundWithdrawalReserve(frozen);
            vm.roll(block.number + 260);
            vm.prank(alice);
            pool.claimWithdrawal();
            _checkInvariant("After Alice full withdrawal");
        }

        console.log("");
        console.log("ALL INVARIANT CHECKS PASSED across complex flow");
    }

    function _checkInvariant(string memory label) internal view {
        uint256 balance = address(pool).balance;
        uint256 pooled = token.totalPooledQRL();
        uint256 reserve = pool.withdrawalReserve();

        console.log(label);
        console.log("  balance:", balance);
        console.log("  pooled + reserve:", pooled + reserve);

        if (balance != pooled + reserve) {
            console.log("  INVARIANT VIOLATED!");
            revert("Invariant violated");
        }
        console.log("  OK");
    }

    // =========================================================================
    //  INVESTIGATION: Can a user manipulate the order of FIFO claims by
    //  creating requests from multiple addresses?
    //
    //  Each address has its own queue. There's no global ordering.
    //  A user with multiple addresses just has independent queues.
    //  No cross-user ordering manipulation is possible.
    // =========================================================================

    // =========================================================================
    //  INVESTIGATION: What happens if stQRL is paused during a claim?
    //
    //  claimWithdrawal calls unlockShares and burnShares, both onlyDepositPool.
    //  burnShares has whenNotPaused modifier. If stQRL is paused by its owner,
    //  claimWithdrawal would revert at burnShares. This means:
    //  - stQRL owner can block all claims by pausing stQRL
    //  - This is a centralization concern but not externally exploitable
    //  - DepositPool owner and stQRL owner may be different addresses
    //    (both set independently)
    // =========================================================================

    // =========================================================================
    //  FINAL EDGE CASE: What if someone deposits the exact MIN_DEPOSIT_FLOOR
    //  and the exchange rate is such that they get 0 shares?
    //  This can't happen because:
    //  - MIN_DEPOSIT_FLOOR = 100 ether
    //  - Virtual shares are 1e3
    //  - Even at extreme rates, 100 ether deposit gives meaningful shares
    //  - mintShares reverts on 0 shares
    // =========================================================================

    function test_MinDepositAtExtremeRate() public {
        console.log("=== Min deposit at extreme exchange rate ===");

        // Create extreme rate: deposit small, then massive rewards
        vm.prank(alice);
        pool.deposit{value: 100 ether}();

        // 1M QRL rewards
        vm.deal(address(pool), 1000000 ether);
        pool.syncRewards();

        console.log("Extreme rate:");
        console.log("  totalPooledQRL:", token.totalPooledQRL());
        console.log("  totalShares:", token.totalShares());
        console.log("  Rate:", token.getExchangeRate());

        // Bob deposits minimum amount
        vm.prank(bob);
        uint256 shares = pool.deposit{value: 100 ether}();
        console.log("  Bob deposits 100 QRL, gets shares:", shares);

        // Shares should be non-zero
        assertTrue(shares > 0, "Non-zero shares at extreme rate");
        console.log("Min deposit works even at extreme rate");
    }
}
