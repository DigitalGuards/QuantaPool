'use strict';
// Differential QRVM tests. Economic checkpoints are synthetic fixture inputs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { NativeAccountingModel, BASIS_SCALE } = require('../accounting-model');
const outputDirectory = path.resolve(process.argv[2] || path.join(__dirname, '../../build/native'));
fs.mkdirSync(outputDirectory, { recursive: true });
const A = 'Q' + '11'.repeat(64),
  B = 'Q' + '22'.repeat(64),
  C = 'Q' + '33'.repeat(64),
  F = 'Q' + '44'.repeat(64);
function makePlan(kind) {
  const model = new NativeAccountingModel({ feeRecipient: F });
  const initialBalance = 10n ** 37n;
  const suppliedCash = new Map([A, B, C, F].map((address) => [address, 0n]));
  const steps = [
    {
      name: 'deploy synthetic economic-fixture ledger',
      op: 'deploy',
      id: 'ledger',
      artifact: 'LedgerFixture',
      args: [F],
    },
  ];
  let checkpointId = 0,
    priorConsensus = 0n,
    labels = 0;
  function call(method, args = [], extra = {}) {
    if (extra.value && !extra.revert) {
      const sender = extra.from || A;
      suppliedCash.set(sender, suppliedCash.get(sender) + BigInt(extra.value));
    }
    steps.push({
      name: `${++labels} ${method}`,
      op: 'call',
      target: '@ledger',
      method,
      args,
      ...extra,
    });
  }
  function time() {
    model.advance();
    steps.push({
      name: 'advance synthetic execution block',
      op: 'time',
      time: Number(model.block),
    });
  }
  function check() {
    model.audit();
    for (const field of [
      'riskAssets',
      'totalShares',
      'pendingTotal',
      'claimReserve',
      'feeReserve',
      'orphanCash',
      'eligibleConsensusRewardBudget',
      'consensusLossCarry',
    ])
      call(field, [], { want: [String(model[field])] });
    for (const id of [A, B, C]) {
      const view = model.position(id),
        u = model.user(id);
      call('positionValue', [id], { want: [String(view.value)] });
      call('claimable', [id], { want: [String(view.claimable)] });
      const fraction =
        (u.shares * (model.accFeeBasis - u.feeBasisIndex) + u.feeBasisFraction) % BASIS_SCALE;
      const request = u.activeRequest ? u.activeRequestIndex + 1 : 0;
      call('getPosition', [id], {
        want: [
          {
            shares: String(u.shares),
            principalBasis: String(u.basis),
            feeBasis: String(view.feeBasis),
            feeBasisDebt: String(model.accFeeBasis),
            feeBasisFraction: String(fraction),
            pending: String(u.pending),
            principalClaim: String(u.principalClaim),
            rewardClaim: String(u.rewardClaim),
            feeRemainder: String(u.feeRemainder),
            activeRequestPlusOne: String(request),
            recoveryClaimed: String(u.recoveryClaimed),
          },
        ],
      });
    }
    steps.push({
      name: 'physical pool cash agrees with independent reference',
      op: 'balance',
      target: '@ledger',
      value: String(model.cash),
    });
    for (const address of [A, B, C, F]) {
      steps.push({
        name: 'fixed beneficiary receives only its own native payments',
        op: 'balance',
        target: address,
        value: String(initialBalance - suppliedCash.get(address) + model.user(address).paid),
      });
    }
  }
  function finish() {
    while (model.stage) {
      if (model.stage.phase === 'deposits') {
        const n = model.activateDeposits(16);
        call('activateDeposits', ['16'], { want: [String(n)] });
      } else {
        const n = model.processQueue(16);
        call('processQueue', ['16'], { want: [String(n)] });
      }
    }
    check();
  }
  function settle() {
    time();
    const f = model.fixtureCheckpoint();
    time();
    model.settleCheckpoint(f);
    call('setCheckpoint', [
      String(++checkpointId),
      String(f.block),
      String(f.cash + f.validatorAssets + f.inFlight),
      String(f.consensusDelta - priorConsensus),
    ]);
    priorConsensus = f.consensusDelta;
    call('settleCheckpoint');
    finish();
  }
  function deposit(id, n) {
    const index = model.deposit(id, n);
    call('deposit', [], { from: id, value: String(n), want: [String(index)] });
    return index;
  }
  function gain(n, exempt = false) {
    if (exempt) model.fixtureExempt(n);
    else model.fixtureConsensus(n, { liquid: true });
    call('fixtureCashCredit', [], { value: String(n) });
  }
  function loss(n) {
    model.fixtureConsensus(-n, { liquid: true });
    call('fixtureCashDebit', [String(n)]);
  }
  function request(id, kind, amount = null) {
    const index =
      kind === 'requestRewards'
        ? model.requestRewards(id, amount)
        : model.requestWithdrawal(id, amount);
    call(kind, [amount === null ? String((1n << 256n) - 1n) : String(amount)], {
      from: id,
      want: [String(index)],
    });
  }
  function claim(id) {
    const amount = model.claim(id);
    call('claim', [], { from: id, want: [String(amount)] });
  }
  function fund(n) {
    model.fixtureFund(n);
    model.fixtureConsumeFunding(n);
    call('fixtureCashDebit', [String(n)]);
  }
  function returnAssets(n) {
    model.fixtureReturnPrincipal(n);
    call('fixtureCashCredit', [], { value: String(n) });
  }
  function terminal(value) {
    model.fixtureAllValidatorsTerminal = value;
    call('setTerminal', [value]);
  }
  function recover() {
    model.fixtureAuthorityStatus = 2;
    call('setStatus', ['2']);
    model.beginRecovery({ verifiedFixtureExpired: true });
    call('beginRecovery');
  }
  function recoverClaim(id) {
    const amount = model.claimRecovery(id);
    call('claimRecovery', [], { from: id, want: [String(amount)] });
  }
  function fees() {
    if (model.feeReserve > 0n) {
      const amount = model.claimFee(F);
      call('claimFees', [], { from: C, want: [String(amount)] });
    }
  }
  function drain() {
    for (const id of [A, B, C]) if (model.user(id).shares > 0n) request(id, 'requestWithdrawal');
    settle();
    for (const id of [C, A, B]) if (model.position(id).claimable > 0n) claim(id);
    fees();
    check();
    assert.equal(model.totalShares, 0n);
    assert.equal(model.riskAssets, 0n);
    assert.equal(model.cash, 0n);
  }

  if (kind === 'mixed') {
    deposit(A, 1000n);
    deposit(B, 2000n);
    settle();
    gain(333n);
    deposit(C, 333n);
    settle();
    request(A, 'requestRewards');
    request(B, 'requestWithdrawal', 700n);
    settle();
    claim(A);
    claim(B);
    check();
    call('claim', [], { from: A, revert: '*' });
    gain(77n, true);
    settle();
    request(C, 'requestRewards');
    settle();
    if (model.position(C).claimable > 0n) claim(C);
    check();
    loss(101n);
    request(A, 'requestRewards');
    settle();
    if (model.position(A).claimable > 0n) claim(A);
    check();
    request(B, 'requestWithdrawal', 200n);
    model.cancelRequest(B);
    call('cancelRequest', [], { from: B });
    settle();
    deposit(C, 99n);
    time();
    const p = model.fixtureCheckpoint();
    time();
    model.settleCheckpoint(p);
    call('setCheckpoint', [
      String(++checkpointId),
      String(p.block),
      String(p.cash + p.validatorAssets + p.inFlight),
      String(p.consensusDelta - priorConsensus),
    ]);
    priorConsensus = p.consensusDelta;
    call('settleCheckpoint');
    call('abortStaging', [], { revert: '*' });
    model.fixtureStagingFresh = false;
    call('setFresh', [false]);
    call('activateDeposits', ['16'], { revert: '*' });
    model.abortStaging();
    call('abortStaging');
    model.fixtureStagingFresh = true;
    call('setFresh', [true]);
    settle();
    request(A, 'requestWithdrawal', 100n);
    settle();
    model.fixtureAuthorityStatus = 2;
    call('setStatus', ['2']);
    model.beginRecovery({ verifiedFixtureExpired: true });
    call('beginRecovery');
    call('deposit', [], { from: A, value: '1', revert: '*' });
    for (const id of [A, B, C]) {
      if (model.position(id).claimable > 0n) claim(id);
      const n = model.claimRecovery(id);
      call('claimRecovery', [], { from: id, want: [String(n)] });
    }
    gain(100n);
    for (const id of [C, B, A]) {
      try {
        const n = model.claimRecovery(id);
        call('claimRecovery', [], { from: id, want: [String(n)] });
      } catch (e) {
        assert.match(e.message, /no recovered/);
      }
    }
    if (model.feeReserve > 0n) {
      const n = model.claimFee(F);
      call('claimFees', [], { from: C, want: [String(n)] });
    }
    check();
  } else if (kind === 'zero-consensus') {
    deposit(A, 3n);
    settle();
    gain(1n, true);
    settle();
    for (let i = 0; i < 12; i++) {
      deposit(B, 7n);
      settle();
      request(B, 'requestWithdrawal');
      settle();
      claim(B);
      assert.equal(model.feeReserve, 0n);
      assert.equal(model.eligibleConsensusRewardBudget, 0n);
    }
    call('claimFees', [], { from: F, revert: '*' });
    drain();
    call('claim', [], { from: A, revert: '*' });
  } else if (kind === 'gift-plus-loss') {
    deposit(A, 100n);
    settle();
    fund(100n);
    terminal(false);
    model.fixtureExempt(100n, { liquid: false });
    model.fixtureConsensus(-150n);
    settle();
    assert.equal(model.position(A).value, 50n);
    assert.equal(model.position(A).feeBasis, 200n);
    request(A, 'requestWithdrawal');
    settle();
    assert(model.user(A).activeRequest);
    call('claim', [], { from: A, revert: '*' });
    recover();
    returnAssets(20n);
    recoverClaim(A);
    returnAssets(30n);
    recoverClaim(A);
    assert.equal(model.user(A).paid, 50n);
    assert.equal(model.feeReserve, 0n);
    call('claimRecovery', [], { from: A, revert: '*' });
    check();
  } else if (kind === 'full-loss-recovery') {
    deposit(A, 100n);
    deposit(B, 200n);
    settle();
    fund(300n);
    terminal(false);
    request(A, 'requestWithdrawal');
    model.fixtureConsensus(-300n);
    deposit(C, 17n);
    request(B, 'requestWithdrawal');
    settle();
    assert.equal(model.totalShares, 300n * 10n ** 27n);
    assert.equal(model.user(A).activeRequest, false);
    assert.equal(model.user(B).activeRequest, false);
    assert.equal(model.queueHead, model.requests.length);
    assert.equal(model.user(C).pending, 17n);
    call('claim', [], { from: A, revert: '*' });
    call('claimFees', [], { from: F, revert: '*' });
    recover();
    model.cancelPending(C, 2);
    call('cancelPending', ['2'], { from: C });
    // Fixture late receipts stand for cash which was absent at the accepted loss cutoff.
    gain(90n, true);
    recoverClaim(B);
    recoverClaim(A);
    gain(60n, true);
    recoverClaim(A);
    recoverClaim(B);
    assert.equal(model.user(A).paid, 50n);
    assert.equal(model.user(B).paid, 100n);
    assert.equal(model.cash, 0n);
    assert.equal(model.feeReserve, 0n);
    check();
  } else if (kind === 'zero-rounded-head') {
    deposit(A, 10n);
    settle();
    gain(9n);
    request(A, 'requestRewards', 9n);
    settle();
    claim(A);
    assert.equal(model.user(A).feeRemainder, 9n);
    deposit(B, 990n);
    settle();
    request(A, 'requestWithdrawal', 9n);
    settle();
    claim(A);
    fund(900n);
    terminal(false);
    model.fixtureConsensus(-1n);
    settle();
    assert.equal(model.position(A).value, 0n);
    assert.equal(model.riskAssets, 990n);
    assert.equal(model.freeCash(), 91n);
    const before = { ...model.user(A) };
    request(A, 'requestWithdrawal');
    request(B, 'requestWithdrawal', 10n);
    settle();
    assert.deepEqual(model.user(A), before);
    assert.equal(model.queueHead, model.requests.length);
    assert.equal(model.position(B).claimable, 10n);
    claim(B);
    recover();
    call('claimRecovery', [], { from: A, revert: '*' });
    returnAssets(899n);
    call('claimRecovery', [], { from: A, revert: '*' });
    gain(2n);
    recoverClaim(A);
    assert.equal(model.user(A).recoveryClaimed, 1n);
    assert.equal(model.user(A).shares, before.shares);
    assert.equal(model.user(A).feeRemainder, 9n);
    assert.equal(model.feeReserve, 0n);
    call('claimRecovery', [], { from: A, revert: '*' });
    check();
  } else if (kind === 'multi-user-drain') {
    deposit(A, 10000n);
    deposit(B, 20000n);
    settle();
    fund(28000n);
    terminal(false);
    model.fixtureConsensus(3254n);
    deposit(C, 10000n);
    settle();
    request(A, 'requestRewards');
    request(B, 'requestWithdrawal', 8000n);
    settle();
    if (model.position(A).claimable > 0n) claim(A);
    model.fixtureConsensus(-5000n);
    settle();
    returnAssets(12000n);
    settle();
    if (model.position(B).claimable > 0n) claim(B);
    returnAssets(model.validatorAssets);
    terminal(true);
    settle();
    drain();
    call('claimFees', [], { from: F, revert: '*' });
    call('claim', [], { from: B, revert: '*' });
  } else if (kind === 'flow-cutoff') {
    deposit(A, 100n);
    settle();
    request(A, 'requestWithdrawal', 20n);
    settle();
    time();
    const snapshot = model.fixtureCheckpoint();
    time();
    deposit(B, 50n);
    claim(A);
    model.settleCheckpoint(snapshot);
    call('setCheckpoint', [
      String(++checkpointId),
      String(snapshot.block),
      String(snapshot.cash + snapshot.validatorAssets + snapshot.inFlight),
      String(snapshot.consensusDelta - priorConsensus),
    ]);
    priorConsensus = snapshot.consensusDelta;
    call('settleCheckpoint');
    finish();
    assert.equal(model.user(B).pending, 50n);
    settle();
    drain();
  } else throw new Error('unknown scenario ' + kind);
  const plan = {
    origin: A,
    accounts: Object.fromEntries([A, B, C, F].map((a) => [a, String(initialBalance)])),
    time: 1,
    steps,
  };
  fs.writeFileSync(
    path.join(outputDirectory, `ledger-${kind}-plan.json`),
    JSON.stringify(plan, null, 2) + '\n'
  );
  return { name: kind, plan: `ledger-${kind}-plan.json`, steps: steps.length };
}
const scenarios = [
  'mixed',
  'zero-consensus',
  'gift-plus-loss',
  'full-loss-recovery',
  'zero-rounded-head',
  'multi-user-drain',
  'flow-cutoff',
].map(makePlan);
const callbackSteps = [
  { op: 'deploy', id: 'ledger', artifact: 'LedgerFixture', args: [F] },
  { op: 'deploy', id: 'receiver', artifact: 'ClaimReceiverFixture', args: ['@ledger'] },
  { op: 'call', target: '@receiver', method: 'deposit', value: '100', want: ['0'] },
  { op: 'time', time: 2 },
  { op: 'time', time: 3 },
  { op: 'call', target: '@ledger', method: 'setCheckpoint', args: ['1', '2', '100', '0'] },
  { op: 'call', target: '@ledger', method: 'settleCheckpoint' },
  { op: 'call', target: '@ledger', method: 'activateDeposits', args: ['16'], want: ['1'] },
  { op: 'call', target: '@ledger', method: 'processQueue', args: ['16'], want: ['0'] },
  { op: 'call', target: '@receiver', method: 'requestAll', want: ['0'] },
  { op: 'time', time: 4 },
  { op: 'time', time: 5 },
  { op: 'call', target: '@ledger', method: 'setCheckpoint', args: ['2', '4', '100', '0'] },
  { op: 'call', target: '@ledger', method: 'settleCheckpoint' },
  { op: 'call', target: '@ledger', method: 'activateDeposits', args: ['16'], want: ['0'] },
  { op: 'call', target: '@ledger', method: 'processQueue', args: ['16'], want: ['1'] },
  { op: 'call', target: '@receiver', method: 'configure', args: [true, false] },
  { op: 'call', target: '@receiver', method: 'claim', revert: '*' },
  { op: 'call', target: '@ledger', method: 'claimable', args: ['@receiver'], want: ['100'] },
  { op: 'call', target: '@ledger', method: 'claimReserve', want: ['100'] },
  { op: 'balance', target: '@ledger', value: '100' },
  { op: 'call', target: '@receiver', method: 'received', want: ['0'] },
  { op: 'call', target: '@receiver', method: 'configure', args: [false, true] },
  { op: 'call', target: '@receiver', method: 'claim', want: ['100'] },
  { op: 'call', target: '@receiver', method: 'callbackBlocked', want: [true] },
  { op: 'call', target: '@receiver', method: 'received', want: ['100'] },
  { op: 'call', target: '@ledger', method: 'claimReserve', want: ['0'] },
  { op: 'call', target: '@ledger', method: 'totalShares', want: ['0'] },
  { op: 'balance', target: '@ledger', value: '0' },
  { op: 'balance', target: '@receiver', value: '100' },
  { op: 'call', target: '@receiver', method: 'claim', revert: '*' },
].map((step, index) => ({ name: `callback ${index + 1} ${step.method || step.op}`, ...step }));
fs.writeFileSync(
  path.join(outputDirectory, 'ledger-callback-plan.json'),
  JSON.stringify({ origin: A, accounts: { [A]: '1000' }, time: 1, steps: callbackSteps }, null, 2) +
    '\n'
);
scenarios.push({
  name: 'callback',
  plan: 'ledger-callback-plan.json',
  steps: callbackSteps.length,
});
fs.writeFileSync(
  path.join(outputDirectory, 'ledger-plans.json'),
  JSON.stringify(
    { evidence: 'actual QRVM; synthetic economic checkpoints; no finality claim', scenarios },
    null,
    2
  ) + '\n'
);
console.log(scenarios.map((s) => `${s.name}: ${s.steps} steps`).join('\n'));
