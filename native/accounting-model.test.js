'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NativeAccountingModel, mulDiv, SHARE_SCALE, UINT256_MAX } = require('./accounting-model');

function finish(model, batch = 16) {
  let calls = 0;
  while (model.stage) {
    assert(++calls < 1000, 'bounded queue did not finish');
    if (model.stage.phase === 'deposits') model.activateDeposits(batch);
    else model.processQueue(batch);
  }
  return model.audit();
}

function settle(model, batch = 16) {
  model.advance();
  const checkpoint = model.fixtureCheckpoint();
  model.advance();
  model.settleCheckpoint(checkpoint);
  return finish(model, batch);
}

function pool(deposits = { alice: 100n }, options) {
  const model = new NativeAccountingModel(options);
  for (const [id, amount] of Object.entries(deposits)) model.deposit(id, amount);
  settle(model);
  return model;
}

function takeReward(model, id, amount = null) {
  model.requestRewards(id, amount);
  settle(model);
  return model.user(id).rewardClaim > 0n ? model.claim(id) : 0n;
}

test('first and multiple depositors receive internal positions after a future cutoff', () => {
  const model = new NativeAccountingModel();
  model.deposit('alice', 100n);
  model.deposit('bob', 250n);
  assert.equal(model.totalShares, 0n);
  settle(model, 1);
  assert.equal(model.position('alice').value, 100n);
  assert.equal(model.position('bob').value, 250n);
  assert.equal(model.totalShares, 350n * SHARE_SCALE);
  assert.equal(model.feeReserve, 0n);
});

test('minimum, huge deposits and native validator-size boundaries retain precision', () => {
  const model = new NativeAccountingModel({ minDeposit: 100n });
  assert.throws(() => model.deposit('alice', 99n), /minimum/);
  model.deposit('alice', 40_000n * 10n ** 18n);
  model.deposit('bob', 1n << 160n);
  settle(model);
  assert.equal(model.position('alice').value, 40_000n * 10n ** 18n);
  assert.equal(model.position('bob').value, 1n << 160n);
  assert.throws(() => model.deposit('alice', UINT256_MAX), /uint256/);
  model.audit();
});

test('pending deposits earn no earlier rewards and buy only at settled asset value', () => {
  const model = pool();
  model.fixtureConsensus(100n, { liquid: true });
  model.deposit('bob', 100n);
  settle(model);
  assert.equal(model.position('alice').value, 200n);
  assert.equal(model.position('bob').value, 100n);
  assert.equal(model.position('bob').rewards, 0n);
  assert.equal(takeReward(model, 'alice'), 90n);
  assert.equal(takeReward(model, 'bob'), 0n);
  assert.equal(model.claimFee('operator'), 10n);
  model.audit();
});

test('loss before admission reduces existing principal and leaves pending principal whole', () => {
  const model = pool();
  model.fixtureFund(100n);
  model.fixtureConsumeFunding(100n);
  model.fixtureConsensus(-50n);
  model.deposit('bob', 100n);
  settle(model);
  assert.equal(model.position('alice').value, 50n);
  assert.equal(model.position('alice').loss, 50n);
  assert.equal(model.position('bob').value, 100n);
  assert.equal(model.position('bob').loss, 0n);
  assert.equal(model.user('bob').shares, 2n * model.user('alice').shares);
});

test('same-block deposits and requests wait beyond their execution block', () => {
  const model = pool();
  model.deposit('bob', 50n);
  model.requestWithdrawal('alice', 25n);
  const sameBlock = model.fixtureCheckpoint();
  model.advance();
  model.settleCheckpoint(sameBlock);
  finish(model);
  assert.equal(model.user('bob').shares, 0n);
  assert.equal(model.user('alice').principalClaim, 0n);
  settle(model);
  assert.equal(model.position('bob').value, 50n);
  assert.equal(model.user('alice').principalClaim, 25n);
});

test('matched historical cash normalizes later deposits and payments exactly once', () => {
  const model = pool();
  model.requestWithdrawal('alice', 10n);
  settle(model);
  model.advance();
  const checkpoint = model.fixtureCheckpoint();
  model.advance();
  model.claim('alice');
  model.deposit('bob', 25n);
  model.settleCheckpoint(checkpoint);
  finish(model);
  assert.equal(model.riskAssets, 90n);
  assert.equal(model.pendingTotal, 25n);
  assert.equal(model.cash, 115n);
  settle(model);
  assert.equal(model.position('bob').value, 25n);
});

test('checkpoint replay, future cutoff and unverified model inputs reject', () => {
  const model = pool();
  const checkpoint = model.fixtureCheckpoint();
  assert.throws(() => model.settleCheckpoint(checkpoint), /earlier/);
  assert.throws(
    () => model.settleCheckpoint({ ...checkpoint, [Symbol('fake')]: true, block: 0n }),
    /cutoff/
  );
  assert.throws(() => model.settleCheckpoint({ block: 1n }), /verified fixture/);
  model.advance();
  model.settleCheckpoint(checkpoint);
  finish(model);
  assert.throws(() => model.settleCheckpoint(checkpoint), /increasing/);
});

test('membership changes are locked while bounded admission and FIFO processing run', () => {
  const model = pool();
  model.deposit('bob', 20n);
  model.requestWithdrawal('alice', 10n);
  model.advance();
  const checkpoint = model.fixtureCheckpoint();
  model.advance();
  model.settleCheckpoint(checkpoint);
  assert.throws(() => model.deposit('carol', 1n), /unavailable/);
  assert.throws(() => model.requestRewards('alice'), /unavailable/);
  assert.throws(() => model.processQueue(), /not processing/);
  finish(model, 1);
  assert.equal(model.claim('alice'), 10n);
});

test('liquid partial and full exits preserve basis and drain the final pool exactly', () => {
  const model = pool({ alice: 3n, bob: 7n });
  model.fixtureConsensus(1n, { liquid: true });
  model.requestWithdrawal('alice');
  settle(model);
  assert.equal(model.claim('alice'), 3n);
  model.requestWithdrawal('bob');
  settle(model);
  assert.equal(model.claim('bob'), 8n);
  assert.equal(model.cash, 0n);
  assert.equal(model.totalShares, 0n);
  assert.equal(model.riskAssets, 0n);
  model.audit();
});

test('global FIFO never skips an illiquid earlier withdrawal for a later smaller one', () => {
  const model = pool({ alice: 100n, bob: 100n });
  model.fixtureFund(190n);
  model.fixtureConsumeFunding(190n);
  model.requestWithdrawal('alice');
  model.requestWithdrawal('bob', 5n);
  settle(model);
  assert.equal(model.queueHead, 0);
  assert.equal(model.claimReserve, 0n);
  model.fixtureReturnPrincipal(100n);
  settle(model, 1);
  assert.equal(model.queueHead, 2);
  assert.equal(model.claim('alice'), 100n);
  assert.equal(model.claim('bob'), 5n);
});

test('multiple validator returns fund queued users in deterministic order', () => {
  const model = pool({ alice: 40_000n, bob: 40_000n, carol: 40_000n });
  model.fixtureFund(120_000n);
  model.fixtureConsumeFunding(120_000n);
  for (const id of ['alice', 'bob', 'carol']) model.requestWithdrawal(id);
  settle(model);
  for (const id of ['alice', 'bob', 'carol']) {
    model.fixtureReturnPrincipal(40_000n);
    settle(model, 1);
    assert.equal(model.claim(id), 40_000n);
  }
  assert.equal(model.cash + model.validatorAssets, 0n);
  assert.equal(model.totalShares, 0n);
});

test('unfunded exits and reward requests remain exposed to a loss before cutoff', () => {
  const model = pool({ alice: 100n, bob: 100n });
  model.fixtureFund(200n);
  model.fixtureConsumeFunding(200n);
  model.fixtureConsensus(20n);
  settle(model);
  model.requestRewards('alice');
  model.requestWithdrawal('bob');
  model.fixtureConsensus(-60n);
  model.fixtureReturnPrincipal(160n);
  settle(model);
  assert.equal(model.user('alice').rewardClaim, 0n);
  assert.equal(model.claim('bob'), 80n);
  assert.equal(model.position('alice').value, 80n);
  assert.equal(model.feeReserve, 0n);
});

test('repeated proportional losses and recovery do not earn fees below remaining basis', () => {
  const model = pool({ alice: 100n, bob: 300n });
  model.fixtureFund(400n);
  model.fixtureConsumeFunding(400n);
  for (const loss of [40n, 80n]) {
    model.fixtureConsensus(-loss);
    settle(model);
  }
  assert.equal(model.position('alice').value, 70n);
  assert.equal(model.position('bob').value, 210n);
  model.fixtureConsensus(120n);
  model.fixtureReturnPrincipal(400n);
  settle(model);
  assert.equal(takeReward(model, 'alice'), 0n);
  assert.equal(takeReward(model, 'bob'), 0n);
  assert.equal(model.feeReserve, 0n);
});

test('a fully lost cohort prevents new capital from diluting its unsettled shares', () => {
  const model = pool();
  model.fixtureFund(100n);
  model.fixtureConsumeFunding(100n);
  model.fixtureConsensus(-100n);
  model.deposit('bob', 10n);
  settle(model);
  assert.equal(model.riskAssets, 0n);
  assert.equal(model.position('bob').shares, 0n);
  assert.equal(model.pendingTotal, 10n);
  model.cancelPending('bob', 1);
  assert.equal(model.user('bob').paid, 10n);
  model.audit();
});

test('earned reserved rewards survive a later validator loss and cannot double claim', () => {
  const model = pool();
  model.fixtureFund(80n);
  model.fixtureConsumeFunding(80n);
  model.fixtureConsensus(20n, { liquid: true });
  model.requestRewards('alice');
  settle(model);
  assert.equal(model.user('alice').rewardClaim, 18n);
  model.fixtureConsensus(-80n);
  settle(model);
  assert.equal(model.position('alice').value, 20n);
  assert.equal(model.claim('alice', 8n), 8n);
  assert.equal(model.claim('alice'), 10n);
  assert.throws(() => model.claim('alice'), /no reserved/);
  assert.equal(model.claimFee('operator'), 2n);
  assert.throws(() => model.claimFee('operator'), /no earned/);
});

test('per-user fee carry makes split one-unit gains equal one aggregate fee', () => {
  const model = pool();
  let received = 0n;
  for (let i = 0; i < 10; i++) {
    model.fixtureConsensus(1n, { liquid: true });
    received += takeReward(model, 'alice', 1n);
  }
  assert.equal(received, 9n);
  assert.equal(model.claimFee('operator'), 1n);
  assert.equal(model.user('alice').basis, 100n);
  assert.equal(model.position('alice').value, 100n);
  model.audit();
});

test('ordinary partial exit charges only its proportional verified gain', () => {
  const model = pool();
  model.fixtureConsensus(100n, { liquid: true });
  model.requestWithdrawal('alice', 100n);
  settle(model);
  assert.equal(model.claim('alice'), 95n);
  assert.equal(model.user('alice').basis, 50n);
  assert.equal(model.position('alice').value, 100n);
  model.requestWithdrawal('alice');
  settle(model);
  assert.equal(model.claim('alice'), 95n);
  assert.equal(model.claimFee('operator'), 10n);
  assert.equal(model.cash, 0n);
});

test('liquid gifts are risk-bearing and entirely fee-exempt', () => {
  const model = pool();
  model.fixtureExempt(30n);
  settle(model);
  assert.equal(model.position('alice').value, 130n);
  assert.equal(model.position('alice').feeBasis, 130n);
  assert.equal(takeReward(model, 'alice'), 30n);
  assert.equal(model.feeReserve, 0n);
  assert.equal(model.user('alice').feeBasis, 100n);
});

test('third-party validator top-up adds gift basis without inventing liquid reserves', () => {
  const model = pool();
  model.fixtureFund(100n);
  model.fixtureConsumeFunding(100n);
  model.fixtureExempt(30n, { liquid: false });
  settle(model);
  model.requestRewards('alice');
  settle(model);
  assert.equal(model.claimReserve, 0n);
  assert.equal(model.queueHead, 0);
  model.fixtureReturnPrincipal(30n);
  settle(model);
  assert.equal(model.claim('alice'), 30n);
  assert.equal(model.feeReserve, 0n);
});

test('gifts settled before new deposits cannot become the new depositor reward', () => {
  const model = pool();
  model.fixtureExempt(100n);
  model.deposit('bob', 100n);
  settle(model);
  assert.equal(model.position('alice').feeBasis, 200n);
  assert.equal(model.position('bob').feeBasis, 100n);
  assert.equal(takeReward(model, 'alice'), 100n);
  assert.equal(takeReward(model, 'bob'), 0n);
  assert.equal(model.feeReserve, 0n);
});

test('mixed gift and consensus gain charges ten percent only on consensus gain', () => {
  const model = pool();
  model.fixtureExempt(30n);
  model.fixtureConsensus(20n, { liquid: true });
  assert.equal(takeReward(model, 'alice'), 48n);
  assert.equal(model.claimFee('operator'), 2n);
  assert.equal(model.user('alice').feeBasis, 100n);
  assert.equal(model.position('alice').value, 100n);
});

test('gift value lost then recovered retains exemption without guaranteeing its principal', () => {
  const model = pool();
  model.fixtureFund(100n);
  model.fixtureConsumeFunding(100n);
  model.fixtureExempt(30n, { liquid: false });
  settle(model);
  model.fixtureConsensus(-40n);
  settle(model);
  assert.equal(model.position('alice').value, 90n);
  assert.equal(model.position('alice').feeBasis, 130n);
  model.fixtureConsensus(40n);
  model.fixtureReturnPrincipal(130n);
  assert.equal(takeReward(model, 'alice'), 30n);
  assert.equal(model.feeReserve, 0n);
});

test('one interval can lose more than its opening assets after an exempt validator top-up', () => {
  const model = pool();
  model.fixtureFund(100n);
  model.fixtureConsumeFunding(100n);
  model.fixtureExempt(100n, { liquid: false });
  model.fixtureConsensus(-150n);
  settle(model);
  assert.equal(model.riskAssets, 50n);
  assert.equal(model.position('alice').feeBasis, 200n);
  assert.equal(model.consensusLossCarry, 150n);
  model.fixtureReturnPrincipal(50n);
  model.requestWithdrawal('alice');
  settle(model);
  assert.equal(model.claim('alice'), 50n);
  assert.equal(model.feeReserve, 0n);
});

test('ownerless cash cannot be captured by the first depositor or charged a fee', () => {
  const model = new NativeAccountingModel();
  model.fixtureExempt(17n);
  model.deposit('alice', 100n);
  settle(model);
  assert.equal(model.orphanCash, 17n);
  assert.equal(model.position('alice').value, 100n);
  model.requestWithdrawal('alice');
  settle(model);
  assert.equal(model.claim('alice'), 100n);
  assert.equal(model.cash, 17n);
  assert.equal(model.freeCash(), 0n);
  assert.throws(() => model.claimFee('operator'), /no earned/);
});

test('beneficiaries, pending refunds and fee reserves cannot be seized by other users', () => {
  const model = pool();
  const pending = model.deposit('bob', 20n);
  assert.throws(() => model.cancelPending('alice', pending), /owned/);
  model.fixtureConsensus(20n, { liquid: true });
  model.requestRewards('alice');
  settle(model);
  assert.throws(() => model.claim('bob'), /no reserved/);
  assert.throws(() => model.claimFee('alice'), /operator fee/);
  assert.equal(model.claimFee('operator'), 2n);
  assert.equal(model.claim('alice'), 18n);
  assert.equal(model.user('bob').basis, 20n);
  assert(
    model.position('bob').value >= 19n && model.position('bob').value <= 20n,
    'floor share admission may lose at most one native base unit in this fixture'
  );
});

test('recovery freezes actual shares, preserves reserves and pays late native cash without new fees', () => {
  const model = pool();
  model.fixtureFund(80n);
  model.fixtureConsumeFunding(80n);
  model.fixtureConsensus(30n, { liquid: true });
  model.requestRewards('alice');
  settle(model);
  const pending = model.deposit('bob', 10n);
  assert.throws(() => model.beginRecovery(), /expired/);
  model.beginRecovery({ verifiedFixtureExpired: true });
  assert.equal(model.claimRecovery('alice'), 20n);
  assert.equal(model.claim('alice'), 27n);
  assert.equal(model.claimFee('operator'), 3n);
  model.cancelPending('bob', pending);
  assert.throws(() => model.deposit('carol', 1n), /unavailable/);
  assert.throws(() => model.beginRecovery({ verifiedFixtureExpired: true }), /expired/);
  model.fixtureReturnPrincipal(80n);
  assert.equal(model.claimRecovery('alice'), 80n);
  model.fixtureConsensus(5n, { liquid: true });
  assert.equal(model.claimRecovery('alice'), 5n);
  assert.equal(model.feeReserve, 0n);
  assert.equal(model.cash, 0n);
  assert.throws(() => model.claimRecovery('alice'), /no recovered/);
  model.audit();
});

test('recovery cash sharing is independent of receipt partition and claim order', () => {
  for (const order of [
    ['alice', 'bob'],
    ['bob', 'alice'],
  ]) {
    const model = pool({ alice: 3n, bob: 7n });
    model.fixtureFund(10n);
    model.fixtureConsumeFunding(10n);
    model.beginRecovery({ verifiedFixtureExpired: true });
    for (const amount of [1n, 2n, 3n, 4n]) {
      model.fixtureReturnPrincipal(amount);
      for (const id of order) {
        try {
          model.claimRecovery(id);
        } catch (error) {
          assert.match(error.message, /no recovered/);
        }
      }
      model.audit();
    }
    assert.equal(model.user('alice').paid, 3n);
    assert.equal(model.user('bob').paid, 7n);
    assert.equal(model.cash, 0n);
  }
});

test('full-width multiplication is exact and zero denominators or oversized results reject', () => {
  assert.equal(mulDiv(1n << 200n, 1n << 200n, 1n << 160n), 1n << 240n);
  assert.equal(mulDiv(3n, 10n, 7n), 4n);
  assert.equal(mulDiv(3n, 10n, 7n, true), 5n);
  assert.throws(() => mulDiv(1n, 1n, 0n), /denominator/);
  assert.throws(() => mulDiv(UINT256_MAX, UINT256_MAX, 1n), /uint256/);
});

test('zero consensus income cannot earn fees from gifts or repeated share-rounding residue', () => {
  const model = pool({ alice: 3n });
  model.fixtureExempt(1n);
  settle(model);
  for (let cycle = 0; cycle < 200; cycle++) {
    model.deposit('bob', 7n);
    settle(model);
    model.requestWithdrawal('bob');
    settle(model);
    if (model.position('bob').claimable > 0n) model.claim('bob');
    if (cycle % 10 === 0) takeReward(model, 'alice');
    assert.equal(model.feeReserve + model.feesPaid, 0n);
    assert.equal(model.eligibleConsensusRewardBudget, 0n);
    model.audit();
  }
});

test('global reward budget consumes unearned income before carrying an additional loss', () => {
  const model = pool();
  model.fixtureFund(100n);
  model.fixtureConsumeFunding(100n);
  model.fixtureConsensus(20n);
  settle(model);
  assert.equal(model.eligibleConsensusRewardBudget, 20n);
  model.fixtureConsensus(-30n);
  settle(model);
  assert.equal(model.eligibleConsensusRewardBudget, 0n);
  assert.equal(model.consensusLossCarry, 10n);
  model.fixtureConsensus(9n);
  settle(model);
  assert.equal(model.consensusLossCarry, 1n);
  model.fixtureConsensus(11n);
  settle(model);
  assert.equal(model.consensusLossCarry, 0n);
  assert.equal(model.eligibleConsensusRewardBudget, 10n);
  model.fixtureReturnPrincipal(110n);
  assert.equal(takeReward(model, 'alice'), 9n);
  assert.equal(model.claimFee('operator'), 1n);
  assert.equal(model.eligibleConsensusRewardBudget, 0n);
});

test('stale staged batches abort permissionlessly while preserving already admitted balances', () => {
  const model = pool();
  model.deposit('bob', 10n);
  model.deposit('carol', 20n);
  model.advance();
  const point = model.fixtureCheckpoint();
  model.advance();
  model.settleCheckpoint(point);
  model.activateDeposits(1);
  assert.equal(model.position('bob').value, 10n);
  assert.equal(model.user('carol').pending, 20n);
  assert.throws(() => model.abortStaging(), /remains fresh/);
  model.fixtureStagingFresh = false;
  assert.throws(() => model.activateDeposits(1), /stale/);
  model.abortStaging();
  model.cancelPending('carol', 2);
  model.fixtureStagingFresh = true;
  settle(model);
  assert.equal(model.position('bob').value, 10n);
  assert.equal(model.user('carol').paid, 20n);
  model.audit();
});

test('operator preparation adoption adds principal once and cannot subsidize losses or fees', () => {
  const model = pool({ alice: 38_000n });
  model.fixtureAdmitCapital('operator', 2_000n);
  assert.equal(model.position('operator').value, 2_000n);
  assert.equal(model.position('alice').value, 38_000n);
  assert.equal(model.deposited, 40_000n);
  assert.equal(model.cash, 38_000n);
  assert.equal(model.validatorAssets, 2_000n);
  model.fixtureFund(38_000n);
  model.fixtureConsumeFunding(38_000n);
  settle(model);
  assert.equal(model.riskAssets, 40_000n);
  assert.equal(model.eligibleConsensusRewardBudget, 0n);
  model.fixtureConsensus(-4_000n);
  settle(model);
  assert.equal(model.position('operator').value, 1_800n);
  assert.equal(model.position('alice').value, 34_200n);
  assert.equal(model.feeReserve, 0n);
});

test('the final member retains rights until every owned validator is terminal', () => {
  const model = pool();
  model.fixtureAllValidatorsTerminal = false;
  model.requestWithdrawal('alice');
  settle(model);
  assert.equal(model.claimReserve, 0n);
  assert.equal(model.position('alice').value, 100n);
  model.fixtureAllValidatorsTerminal = true;
  settle(model);
  assert.equal(model.claim('alice'), 100n);
});

test('cancelled requests retain stake and cannot obstruct later FIFO entries', () => {
  const model = pool({ alice: 100n, bob: 100n });
  model.requestWithdrawal('alice');
  model.requestWithdrawal('bob');
  model.cancelRequest('alice');
  settle(model);
  assert.equal(model.position('alice').value, 100n);
  assert.equal(model.claim('bob'), 100n);
  assert.equal(model.queueHead, 2);
});

test('unrepresentable deposit precision finishes staging and permits the owner refund', () => {
  const model = new NativeAccountingModel();
  const amount = UINT256_MAX / SHARE_SCALE + 1n;
  const id = model.deposit('alice', amount);
  settle(model);
  assert.equal(model.stage, null);
  assert.equal(model.totalShares, 0n);
  model.cancelPending('alice', id);
  assert.equal(model.cash, 0n);
});

test('seeded mixed histories preserve assets, user reserves and fee bounds', (context) => {
  let seed = 0x529e174bn;
  const random = (max) => {
    seed = (seed * 1664525n + 1013904223n) & 0xffffffffn;
    return Number(seed % BigInt(max));
  };
  let actions = 0;
  for (let history = 0; history < 100; history++) {
    const model = pool({ alice: 1000n, bob: 1300n, carol: 1700n });
    const users = ['alice', 'bob', 'carol'];
    let positiveConsensus = 0n;
    for (let step = 0; step < 200; step++) {
      const id = users[random(users.length)];
      const user = model.user(id);
      const action = random(9);
      if (action === 0) model.deposit(id, BigInt(1 + random(80)));
      else if (action === 1) {
        const reward = BigInt(random(50));
        positiveConsensus += reward;
        model.fixtureConsensus(reward, { liquid: true });
      } else if (action === 2) model.fixtureExempt(BigInt(random(50)));
      else if (action === 3 && model.validatorAssets > 0n)
        model.fixtureConsensus(-minBig(model.validatorAssets, BigInt(random(30))));
      else if (action === 4 && user.shares > 0n && !user.activeRequest)
        model.requestWithdrawal(id, BigInt(1 + random(100)));
      else if (action === 5 && user.shares > 0n && !user.activeRequest)
        model.requestRewards(id, BigInt(1 + random(30)));
      else if (
        action === 6 &&
        model.queueHead === model.requests.length &&
        model.freeCash() > 10n
      ) {
        const amount = minBig(model.freeCash() / 2n, 100n);
        model.fixtureFund(amount);
        model.fixtureConsumeFunding(amount);
      } else if (action === 7 && model.validatorAssets > 0n)
        model.fixtureReturnPrincipal(minBig(model.validatorAssets, BigInt(1 + random(80))));
      else if (action === 8 && model.feeReserve > 0n) model.claimFee('operator');
      settle(model, 1 + random(3));
      for (const beneficiary of users) {
        if (model.position(beneficiary).claimable > 0n && random(2)) model.claim(beneficiary);
      }
      model.audit();
      assert(
        model.feeReserve + model.feesPaid <= positiveConsensus / 10n,
        'operator fees exceed all independently classified positive consensus income'
      );
      actions++;
    }
    if (model.feeReserve > 0n) model.claimFee('operator');
    model.audit();
  }
  context.diagnostic(
    `100 seeded histories, ${actions} economic actions, conservation checked after every step`
  );
});

function minBig(a, b) {
  return a < b ? a : b;
}

test('zero-value requests complete while retaining every member for terminal proof or recovery', () => {
  const model = pool({ alice: 100n, bob: 200n });
  model.fixtureFund(300n);
  model.fixtureConsumeFunding(300n);
  model.fixtureAllValidatorsTerminal = false;
  model.requestWithdrawal('alice');
  model.fixtureConsensus(-300n);
  model.requestWithdrawal('bob');
  settle(model);
  assert.equal(model.totalShares, 300n * SHARE_SCALE);
  assert.equal(model.user('alice').activeRequest, false);
  assert.equal(model.user('bob').activeRequest, false);
  assert.equal(model.queueHead, model.requests.length);
  model.beginRecovery({ verifiedFixtureExpired: true });
  model.fixtureExempt(90n);
  assert.equal(model.claimRecovery('bob'), 60n);
  assert.equal(model.claimRecovery('alice'), 30n);
  assert.equal(model.feeReserve, 0n);
  assert.equal(model.cash, 0n);
  model.audit();
});

test('a zero-rounded FIFO head preserves its position and allows a later cash-backed withdrawal', () => {
  const model = pool({ alice: 10n });
  model.fixtureConsensus(9n, { liquid: true });
  assert.equal(takeReward(model, 'alice', 9n), 9n);
  assert.equal(model.user('alice').feeRemainder, 9n);
  model.deposit('bob', 990n);
  settle(model);
  model.requestWithdrawal('alice', 9n);
  settle(model);
  model.claim('alice');
  model.fixtureFund(900n);
  model.fixtureConsumeFunding(900n);
  model.fixtureAllValidatorsTerminal = false;
  model.fixtureConsensus(-1n);
  settle(model);
  assert.equal(model.position('alice').value, 0n);
  assert.equal(model.riskAssets, 990n);
  assert.equal(model.freeCash(), 91n);
  const before = { ...model.user('alice') };
  model.requestWithdrawal('alice');
  model.requestWithdrawal('bob', 10n);
  model.advance();
  const checkpoint = model.fixtureCheckpoint();
  model.advance();
  model.settleCheckpoint(checkpoint);
  model.activateDeposits(16);
  const unchanged = [
    'riskAssets',
    'totalShares',
    'claimReserve',
    'feeReserve',
    'eligibleConsensusRewardBudget',
    'consensusLossCarry',
    'cash',
  ];
  const accounting = Object.fromEntries(unchanged.map((key) => [key, model[key]]));
  assert.equal(model.processQueue(1), 1);
  assert.deepEqual(model.user('alice'), before);
  assert.deepEqual(Object.fromEntries(unchanged.map((key) => [key, model[key]])), accounting);
  assert.equal(model.processQueue(1), 1);
  assert.equal(model.queueHead, model.requests.length);
  assert.equal(model.claim('bob'), 10n);
  assert.equal(model.feeReserve, 0n);
  model.beginRecovery({ verifiedFixtureExpired: true });
  assert.throws(() => model.claimRecovery('alice'), /no recovered/);
  model.fixtureReturnPrincipal(899n);
  assert.throws(() => model.claimRecovery('alice'), /no recovered/);
  model.fixtureConsensus(2n, { liquid: true });
  assert.equal(model.claimRecovery('alice'), 1n);
  assert.throws(() => model.claimRecovery('alice'), /no recovered/);
  assert.equal(model.user('alice').shares, before.shares);
  assert.equal(model.user('alice').feeRemainder, 9n);
  assert.equal(model.feeReserve, 0n);
  model.audit();
});
