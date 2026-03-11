// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/solidity/stQRL-v2.sol";
import "../contracts/solidity/DepositPool-v2.sol";

/**
 * @title Medium Finding: bufferedQRL not decremented on withdrawal claims
 *
 * @notice When a user claims a withdrawal, QRL is taken from the contract
 *   balance. The function decrements `withdrawalReserve` and `totalPooledQRL`,
 *   but does NOT decrement `bufferedQRL`. This means `bufferedQRL` can become
 *   greater than the actual contract balance that's available for buffering.
 *
 *   In the normal flow: deposits add to bufferedQRL, fundValidator subtracts.
 *   But withdrawals should also logically reduce buffered QRL since the ETH
 *   is leaving the contract. However, the withdrawal path goes through
 *   withdrawalReserve, not bufferedQRL, so the buffer stays inflated.
 *
 *   This creates a state where canFundValidator() returns true (bufferedQRL
 *   >= VALIDATOR_STAKE) but fundValidator/fundValidatorMVP would succeed
 *   even though the actual ETH backing may have been consumed by withdrawals.
 */
contract BufferedQRLPoC is Test {
    stQRLv2 public token;
    DepositPoolV2 public pool;

    address public owner;
    address public user1;

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");

        token = new stQRLv2();
        pool = new DepositPoolV2();

        pool.setStQRL(address(token));
        token.setDepositPool(address(pool));

        vm.deal(user1, 100000 ether);
    }

    /**
     * @notice Verify that bufferedQRL tracking is independent of withdrawals
     *   and check if this creates any real issue
     */
    function test_BufferedQRLVsWithdrawals() public {
        console.log("=== Check: bufferedQRL vs withdrawal interactions ===");

        // User deposits 40000 QRL (enough for a validator)
        vm.deal(user1, 80000 ether);
        vm.prank(user1);
        pool.deposit{value: 40000 ether}();

        console.log("After deposit:");
        console.log("  bufferedQRL:", pool.bufferedQRL() / 1e18);
        console.log("  balance:", address(pool).balance / 1e18);
        (bool canFund,) = pool.canFundValidator();
        console.log("  canFundValidator:", canFund);

        // Fund withdrawal reserve (reclassify deposited QRL)
        pool.fundWithdrawalReserve(40000 ether);

        // Withdraw half
        vm.prank(user1);
        pool.requestWithdrawal(20000 ether);

        vm.roll(block.number + 129);

        vm.prank(user1);
        uint256 claimed = pool.claimWithdrawal();

        console.log("After claiming 20000 QRL withdrawal:");
        console.log("  claimed:", claimed / 1e18);
        console.log("  bufferedQRL:", pool.bufferedQRL() / 1e18);
        console.log("  balance:", address(pool).balance / 1e18);
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);

        // bufferedQRL is still 40000 even though:
        // - User withdrew 20000
        // - Contract balance may be < 40000 after claim
        // BUT: the claim comes from withdrawalReserve, not bufferedQRL
        // So in practice, the balance is still adequate IF
        // withdrawalReserve was funded from external sources (not from buffered)

        // The actual issue: after phantom rewards kick in,
        // the state gets more confusing but bufferedQRL itself
        // doesn't cause direct fund loss

        // Check: can we still fund a validator?
        (canFund,) = pool.canFundValidator();
        console.log("  canFundValidator:", canFund);
        console.log("  (bufferedQRL=40000 but we need to check actual balance)");

        // The real check is whether balance >= VALIDATOR_STAKE when funding
        // fundValidatorMVP just decrements bufferedQRL and sends nothing (MVP)
        // So this actually works in MVP mode even with insufficient real balance

        if (pool.bufferedQRL() >= 40000 ether && address(pool).balance < 40000 ether) {
            console.log("  WARNING: bufferedQRL > actual balance!");
            console.log("  fundValidatorMVP would 'succeed' with phantom buffer");
        }
    }

    /**
     * @notice Check: After the phantom rewards bug, does bufferedQRL go further out of sync?
     */
    function test_BufferedQRLWithPhantomRewards() public {
        console.log("=== Check: bufferedQRL after phantom rewards ===");

        vm.prank(user1);
        pool.deposit{value: 100 ether}();

        pool.fundWithdrawalReserve(100 ether);

        vm.prank(user1);
        pool.requestWithdrawal(100 ether);

        vm.roll(block.number + 129);

        console.log("Before claim:");
        console.log("  bufferedQRL:", pool.bufferedQRL() / 1e18);

        vm.prank(user1);
        pool.claimWithdrawal();

        console.log("After claim:");
        console.log("  bufferedQRL:", pool.bufferedQRL() / 1e18);
        console.log("  balance:", address(pool).balance / 1e18);
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);

        // Trigger phantom rewards
        pool.syncRewards();

        console.log("After phantom rewards:");
        console.log("  bufferedQRL:", pool.bufferedQRL() / 1e18);
        console.log("  totalPooledQRL:", token.totalPooledQRL() / 1e18);

        // bufferedQRL=100 but totalPooledQRL was inflated by phantom rewards
        // This doesn't directly cause fund loss but it means the accounting
        // for "how much is in the buffer" is wrong
        console.log("  bufferedQRL (100) represents QRL that was already sent to user");
        console.log("  The actual contract holds:", address(pool).balance / 1e18, "QRL");
    }
}
