'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WindDownModel, UINT256_MAX } = require('./wind-down-model');

function fixture(users, cash = 0n, options = {}) {
  return new WindDownModel({
    users, cash, feeRecipient: 'operator', lastVerifiedSlot: 100n, maxStaleSlots: 64n,
    ...options,
  });
}

function start(model) {
  model.triggerWindDown('independent keeper', 165n);
  return model;
}

test('expiry is strict, permissionless and permanent; identities and weights are immutable', () => {
  const input = [{ beneficiary: 'alice', activeShares: 7n, queuedShares: 3n, principalBasis: 10n }];
  const model = fixture(input, 10n);
  assert.throws(() => model.triggerWindDown('operator', 164n), /not expired/);
  assert.throws(() => model.claimFrozen('alice', 'alice'), /not started/);
  input[0].activeShares = 10_000n;
  assert.equal(model.triggerWindDown('stranger', 165n), true);
  assert.equal(model.totalShares, 10n);
  assert.equal(model.triggerWindDown('operator', 1_000n), false);
  assert.equal(model.audit().trigger.caller, 'stranger');
  assert.throws(() => { model.position('alice').beneficiary = 'operator'; }, TypeError);
  assert.deepEqual(model.claimFrozen('operator', 'alice'), { recipient: 'alice', amount: 10n });
  assert.throws(() => model.claimFrozen('operator', 'operator'), /Unknown beneficiary/);
  assert.equal(model.cash, 0n);
  assert.equal(model.totalShares, 10n, 'A full claim preserves every future-return share');
  for (const missing of ['setBalance', 'setBeneficiary', 'transfer', 'sweep', 'resume', 'setFeeRate']) {
    assert.equal(model[missing], undefined);
  }
  model.audit();
});

test('pending deposits, cash-backed principal/rewards and earned fees remain segregated', () => {
  const model = fixture([
    { beneficiary: 'pending', pendingDeposit: 11n },
    { beneficiary: 'backed', cashPrincipal: 13n, cashRewards: 5n },
    { beneficiary: 'active', activeShares: 10n, principalBasis: 100n },
  ], 37n, { operatorFeeReserve: 3n, operatorFeesPaidBefore: 7n });
  assert.deepEqual(model.claimReserved('keeper', 'pending', 4n), { recipient: 'pending', amount: 4n });
  assert.deepEqual(model.claimEarnedFees('anyone'), { recipient: 'operator', amount: 3n });
  start(model);
  assert.equal(model.claimFrozen('operator', 'active').amount, 5n);
  assert.equal(model.claimReserved('keeper', 'backed').amount, 18n);
  assert.equal(model.claimReserved('keeper', 'pending').amount, 7n);
  assert.equal(model.cash, 0n);
  assert.equal(model.position('active').principalNotYetCovered, 95n);
  model.receiveNative(95n);
  assert.equal(model.claimFrozen('keeper', 'active').amount, 95n);
  assert.equal(model.claimEarnedFees('operator').amount, 0n);
  assert.equal(model.audit().operatorFeesPaidBefore, 7n);
  assert.equal(model.audit().newFeesEarned, 0n);
  assert.equal(model.cash, 0n);
});

test('a previously unfunded queue shares every partial loss and every later return', () => {
  const model = start(fixture([
    { beneficiary: 'queued', queuedShares: 5n, principalBasis: 5n },
    { beneficiary: 'active', activeShares: 5n, principalBasis: 5n },
    { beneficiary: 'already backed', cashPrincipal: 7n },
  ], 12n));
  assert.equal(model.claimFrozen('queued', 'queued').amount, 2n);
  assert.equal(model.claimFrozen('active', 'active').amount, 2n);
  assert.equal(model.claimReserved('keeper', 'already backed').amount, 7n);
  assert.equal(model.cash, 1n, 'Fractional rights stay reserved without rewarding the last caller');
  assert.equal(model.claimFrozen('queued', 'queued').amount, 0n);
  model.receiveNative(5n);
  assert.equal(model.claimFrozen('keeper', 'active').amount, 3n);
  assert.equal(model.claimFrozen('keeper', 'queued').amount, 3n);
  assert.equal(model.cash, 0n);
  model.audit();
});

test('prior rewards, fees, losses and unequal entry bases create no new fee entitlement', () => {
  const model = start(fixture([
    {
      beneficiary: 'older', activeShares: 5n, principalBasis: 10n,
      rewardsPaidBefore: 9n, principalPaidBefore: 3n, feeAssessedRewardCarry: 2n,
    },
    { beneficiary: 'newer', activeShares: 10n, principalBasis: 10n, cashRewards: 4n },
  ], 10n, { operatorFeesPaidBefore: 2n }));
  assert.equal(model.claimFrozen('older', 'older').amount, 2n);
  model.receiveNative(9n);
  assert.equal(model.position('older').cumulativeAllocation, 5n);
  assert.equal(model.position('newer').cumulativeAllocation, 10n);
  assert.equal(model.position('older').principalNotYetCovered, 5n);
  assert.equal(model.position('newer').principalNotYetCovered, 0n);
  model.claimReserved('keeper', 'newer');
  model.receiveNative(1_000_000n);
  model.claimFrozen('keeper', 'newer');
  model.claimFrozen('keeper', 'older');
  assert.equal(model.claimEarnedFees('operator').amount, 0n);
  assert.equal(model.audit().newFeesEarned, 0n);
  assert.equal(model.position('older').rewardsPaidBefore, 9n);
  assert.equal(model.position('older').feeAssessedRewardCarry, 2n);
  model.audit();
});

test('zero returns create no accounting QRL and late recovery needs no balance report', () => {
  const model = start(fixture([
    { beneficiary: 'alice', activeShares: 3n, principalBasis: 300n },
    { beneficiary: 'bob', queuedShares: 2n, principalBasis: 200n },
  ]));
  for (let index = 0; index < 20; index++) {
    assert.equal(model.claimFrozen('keeper', 'alice').amount, 0n);
    assert.equal(model.claimFrozen('keeper', 'bob').amount, 0n);
    assert.equal(model.claimEarnedFees('operator').amount, 0n);
  }
  assert.equal(model.cash, 0n);
  model.receiveNative(100n);
  assert.equal(model.claimFrozen('keeper', 'bob').amount, 40n);
  assert.equal(model.claimFrozen('keeper', 'alice').amount, 60n);
  model.receiveNative(400n);
  assert.equal(model.claimFrozen('keeper', 'alice').amount, 240n);
  assert.equal(model.claimFrozen('keeper', 'bob').amount, 160n);
  assert.equal(model.cash, 0n);
  model.audit();
});

test('partial claims preserve debt, dust, final-user rights and future credits', () => {
  const model = start(fixture([
    { beneficiary: 'a', activeShares: 1n },
    { beneficiary: 'b', activeShares: 1n },
    { beneficiary: 'c', activeShares: 1n },
  ], 11n));
  assert.equal(model.claimFrozen('anyone', 'a', 1n).amount, 1n);
  assert.equal(model.claimFrozen('anyone', 'b').amount, 3n);
  assert.equal(model.claimFrozen('anyone', 'c').amount, 3n);
  assert.equal(model.claimFrozen('anyone', 'a').amount, 2n);
  assert.equal(model.cash, 2n);
  assert.equal(model.claimFrozen('last caller', 'a').amount, 0n);
  model.receiveNative(1n);
  for (const user of ['c', 'b', 'a']) assert.equal(model.claimFrozen('keeper', user).amount, 1n);
  assert.equal(model.cash, 0n);
  model.receiveNative(3n);
  for (const user of ['a', 'b', 'c']) assert.equal(model.claimFrozen('keeper', user).amount, 1n);
  assert.equal(model.cash, 0n);
  model.audit();
});

test('one holder drains all returned cash; no-holder stray cash has no sweep recipient', () => {
  const single = start(fixture([{ beneficiary: 'only', queuedShares: 19n }], 1n));
  assert.equal(single.claimFrozen('stranger', 'only').amount, 1n);
  single.receiveNative(17n);
  assert.equal(single.claimFrozen('stranger', 'only').amount, 17n);
  assert.equal(single.audit().remainder, 0n);
  const none = start(fixture([{ beneficiary: 'pending', pendingDeposit: 3n }], 5n, { operatorFeeReserve: 2n }));
  none.claimReserved('keeper', 'pending');
  none.claimEarnedFees('keeper');
  assert.equal(none.cash, 0n);
  none.receiveNative(7n);
  assert.equal(none.claimFrozen('keeper', 'pending').amount, 0n);
  assert.equal(none.claimEarnedFees('keeper').amount, 0n);
  assert.equal(none.audit().remainderKind, 'unowned cash');
  assert.equal(none.cash, 7n);
});

test('invalid snapshots/actions reject without creating balances; full-width multiplication is exact', () => {
  assert.throws(() => fixture([{ beneficiary: 'x', pendingDeposit: 2n }], 1n), /cash backed/);
  assert.throws(() => fixture([], 1n, { operatorFeeReserve: 2n }), /cash backed/);
  assert.throws(() => fixture([{ beneficiary: 'x', principalBasis: 1n }]), /requires residual shares/);
  assert.throws(() => fixture([{ beneficiary: 'x' }, { beneficiary: 'x' }]), /Duplicate/);
  assert.throws(() => fixture([{ beneficiary: 'x', activeShares: -1n }]), /outside uint256/);
  assert.throws(() => fixture([{ beneficiary: 'x', activeShares: 1 }]), /must be bigint/);
  assert.throws(() => fixture([
    { beneficiary: 'a', activeShares: UINT256_MAX }, { beneficiary: 'b', activeShares: 1n },
  ]), /outside uint256/);
  const model = start(fixture([
    { beneficiary: 'a', activeShares: UINT256_MAX - 1n }, { beneficiary: 'b', activeShares: 1n },
  ], UINT256_MAX));
  const before = model.audit();
  assert.throws(() => model.receiveNative(1n), /outside uint256/);
  assert.throws(() => model.claimFrozen('keeper', 'a', -1n), /outside uint256/);
  assert.deepEqual(model.audit(), before);
  assert.equal(model.claimFrozen('keeper', 'a').amount, UINT256_MAX - 1n);
  assert.equal(model.claimFrozen('keeper', 'b').amount, 1n);
  assert.equal(model.cash, 0n);
  assert.throws(() => model.receiveNative(1n), /cumulative native returns/);
  model.audit();
});

test('exhaustive small weights: receipt partition and all claim orders preserve entitlements', (context) => {
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let histories = 0;
  for (let a = 1n; a <= 3n; a++) for (let b = 1n; b <= 3n; b++) for (let c = 1n; c <= 3n; c++) {
    const weights = [a, b, c];
    const totalShares = a + b + c;
    for (let total = 0n; total <= 8n; total++) {
      for (let first = 0n; first <= total; first++) for (let second = 0n; second <= total - first; second++) {
        for (const order of orders) {
          const model = start(fixture(weights.map((weight, index) => ({
            beneficiary: String(index), activeShares: index === 1 ? 0n : weight,
            queuedShares: index === 1 ? weight : 0n,
          }))));
          const paid = [0n, 0n, 0n];
          for (const credit of [first, second, total - first - second]) {
            model.receiveNative(credit);
            for (const index of order) paid[index] += model.claimFrozen('keeper', String(index)).amount;
            model.audit();
          }
          for (let index = 0; index < 3; index++) assert.equal(paid[index], total * weights[index] / totalShares);
          assert.equal(model.cash + paid.reduce((sum, value) => sum + value, 0n), total);
          assert(model.cash < 3n);
          histories++;
        }
      }
    }
  }
  context.diagnostic(`${histories} exhaustive receipt/claim histories`);
});

function randomGenerator(seed) {
  let state = seed >>> 0;
  return (bound) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % bound;
  };
}

test('deterministic randomized histories reconcile every reserve, claim and late credit', (context) => {
  let actions = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const random = randomGenerator(seed);
    const users = Array.from({ length: 1 + random(8) }, (_, index) => {
      const shares = BigInt(random(21));
      const queued = BigInt(random(Number(shares) + 1));
      return {
        beneficiary: `user${index}`, activeShares: shares - queued, queuedShares: queued,
        pendingDeposit: BigInt(random(7)), cashPrincipal: BigInt(random(7)), cashRewards: BigInt(random(7)),
        principalBasis: shares ? BigInt(random(100)) : 0n,
        feeAssessedRewardCarry: shares ? BigInt(random(20)) : 0n,
        principalPaidBefore: BigInt(random(100)), rewardsPaidBefore: BigInt(random(100)),
      };
    });
    const reserves = users.reduce((sum, user) => sum + user.pendingDeposit + user.cashPrincipal + user.cashRewards, 0n);
    const shares = users.reduce((sum, user) => sum + user.activeShares + user.queuedShares, 0n);
    const free = BigInt(random(30));
    const earnedFee = BigInt(random(10));
    const initial = reserves + earnedFee + free;
    const model = fixture(users, initial, { operatorFeeReserve: earnedFee, operatorFeesPaidBefore: 31n });
    const wallets = new Map(users.map((user) => [user.beneficiary, 0n]));
    const reservePaid = new Map(users.map((user) => [user.beneficiary, 0n]));
    let credited = 0n;
    let operatorPaid = 0n;
    // Refund and receipt can precede expiry without changing residual share rights.
    model.receiveNative(3n);
    credited += 3n;
    const early = model.claimReserved('keeper', users[0].beneficiary, 2n);
    wallets.set(early.recipient, early.amount);
    reservePaid.set(early.recipient, early.amount);
    start(model);
    for (let step = 0; step < 100; step++) {
      const user = users[random(users.length)];
      const choice = random(5);
      if (choice === 0) {
        const value = BigInt(random(40));
        model.receiveNative(value);
        credited += value;
      } else if (choice === 1) {
        const paid = model.claimReserved('operator', user.beneficiary, BigInt(random(15)));
        assert.equal(paid.recipient, user.beneficiary);
        wallets.set(paid.recipient, wallets.get(paid.recipient) + paid.amount);
        reservePaid.set(paid.recipient, reservePaid.get(paid.recipient) + paid.amount);
      } else if (choice === 2) {
        const paid = model.claimFrozen('operator', user.beneficiary, BigInt(random(30)));
        assert.equal(paid.recipient, user.beneficiary);
        wallets.set(paid.recipient, wallets.get(paid.recipient) + paid.amount);
      } else if (choice === 3) {
        const paid = model.claimEarnedFees('stranger');
        assert.equal(paid.recipient, 'operator');
        operatorPaid += paid.amount;
        assert(operatorPaid <= earnedFee);
      } else {
        assert.equal(model.triggerWindDown('operator', 1_000n + BigInt(step)), false);
      }
      const paidTotal = [...wallets.values()].reduce((sum, value) => sum + value, 0n);
      assert.equal(model.cash + paidTotal + operatorPaid, initial + credited);
      model.audit();
      actions++;
    }
    for (const user of users.reverse()) {
      const reserved = model.claimReserved('keeper', user.beneficiary);
      const residual = model.claimFrozen('keeper', user.beneficiary);
      wallets.set(user.beneficiary, wallets.get(user.beneficiary) + reserved.amount + residual.amount);
      const expectedReserved = user.pendingDeposit + user.cashPrincipal + user.cashRewards;
      const expectedResidual = shares ? (free + credited) * (user.activeShares + user.queuedShares) / shares : 0n;
      assert.equal(wallets.get(user.beneficiary), expectedReserved + expectedResidual);
      assert.equal(model.position(user.beneficiary).frozenClaimable, 0n);
      assert.equal(model.position(user.beneficiary).reservedRemaining, 0n);
    }
    operatorPaid += model.claimEarnedFees('keeper').amount;
    assert.equal(operatorPaid, earnedFee);
    assert.equal(model.audit().newFeesEarned, 0n);
    const holderCount = BigInt(users.filter((user) => user.activeShares + user.queuedShares > 0n).length);
    if (holderCount > 0n) assert(model.cash < holderCount);
  }
  context.diagnostic(`500 seeded snapshots, ${actions} randomized actions`);
});
