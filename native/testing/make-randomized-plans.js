'use strict';

// Reproducible state-machine tests. Economics and finality remain synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NativeAccountingModel, BASIS_SCALE, UINT256_MAX } = require('../accounting-model');

const output = path.resolve(process.argv[2] || path.join(__dirname, '../../build/native/fuzz'));
fs.mkdirSync(output, { recursive: true });
const users = [17, 34, 51, 68, 85, 102].map((byte) => 'Q' + byte.toString(16).repeat(64));
const feeRecipient = 'Q' + '77'.repeat(64);
const accounts = [...users, feeRecipient];
const initialBalance = 1n << 240n;
const min = (a, b) => (a < b ? a : b);
const seeds = [0x183d9417, 0x25abe190, 0x37ca6b21, 0x48df123a];
const profiles = ['mixed-drain', 'zero-reward-drain', 'loss-recovery'];
const randomActions = 64;

function makePlan(seed, profile, scale) {
  // Xorshift32 differs from the model-only suite's LCG. No external entropy.
  let state = seed >>> 0;
  function random(bound) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % bound;
  }
  const model = new NativeAccountingModel({ feeRecipient });
  const coverage = {};
  const record = (name) => (coverage[name] = (coverage[name] || 0) + 1);
  const supplied = new Map(accounts.map((id) => [id, 0n]));
  const received = new Map(accounts.map((id) => [id, 0n]));
  let deposits = 0n,
    gifts = 0n,
    rewards = 0n,
    losses = 0n,
    paid = 0n,
    earnedFees = 0n,
    priorConsensus = 0n,
    checkpointId = 0;
  const steps = [
    {
      name: 'deploy synthetic ledger fixture',
      op: 'deploy',
      id: 'ledger',
      artifact: 'LedgerFixture',
      args: [feeRecipient],
    },
  ];
  function call(method, args = [], extra = {}) {
    if (extra.value && !extra.revert) {
      const from = extra.from || users[0];
      supplied.set(from, supplied.get(from) + BigInt(extra.value));
    }
    steps.push({
      name: `${steps.length} ${method}`,
      op: 'call',
      target: '@ledger',
      method,
      args,
      ...extra,
    });
  }
  function advance() {
    model.advance();
    steps.push({
      name: 'advance synthetic block',
      op: 'time',
      time: Number(model.block),
    });
  }
  function payout(id, amount) {
    received.set(id, received.get(id) + amount);
    paid += amount;
  }
  function check() {
    model.audit();
    // These flow totals are maintained by the action driver, independently of
    // model.audit and of the model's contributed/paid/consensus counters.
    assert.equal(
      model.cash + model.validatorAssets + model.inFlight + paid,
      deposits + gifts + rewards - losses
    );
    assert.equal(model.feesPaid + model.feeReserve, earnedFees);
    assert(earnedFees <= rewards / 10n, 'earned fees exceed all positive consensus income');
    if (profile === 'zero-reward-drain')
      assert.equal(earnedFees, 0n, 'principal or exempt cash was charged a fee');
    const positionSum = users.reduce((sum, id) => sum + model.position(id).value, 0n);
    assert(positionSum <= model.riskAssets, 'rounded user positions exceed risk assets');
    for (const field of [
      'riskAssets',
      'totalShares',
      'pendingTotal',
      'claimReserve',
      'feeReserve',
      'orphanCash',
      'eligibleConsensusRewardBudget',
      'consensusLossCarry',
    ]) {
      call(field, [], { want: [String(model[field])] });
    }
    call('recovering', [], { want: [model.recovering] });
    for (const id of users) {
      const view = model.position(id);
      const user = model.user(id);
      const fraction =
        (user.shares * (model.accFeeBasis - user.feeBasisIndex) + user.feeBasisFraction) %
        BASIS_SCALE;
      call('positionValue', [id], { want: [String(view.value)] });
      call('claimable', [id], { want: [String(view.claimable)] });
      call('getPosition', [id], {
        want: [
          {
            shares: String(user.shares),
            principalBasis: String(user.basis),
            feeBasis: String(view.feeBasis),
            feeBasisDebt: String(model.accFeeBasis),
            feeBasisFraction: String(fraction),
            pending: String(user.pending),
            principalClaim: String(user.principalClaim),
            rewardClaim: String(user.rewardClaim),
            feeRemainder: String(user.feeRemainder),
            activeRequestPlusOne: String(user.activeRequest ? user.activeRequestIndex + 1 : 0),
            recoveryClaimed: String(user.recoveryClaimed),
          },
        ],
      });
    }
    steps.push({
      name: 'contract cash equals reconciled physical ledger',
      op: 'balance',
      target: '@ledger',
      value: String(model.cash),
    });
    for (const id of accounts) {
      steps.push({
        name: 'only the fixed beneficiary receives its payment',
        op: 'balance',
        target: id,
        value: String(initialBalance - supplied.get(id) + received.get(id)),
      });
    }
    record('invariantSnapshots');
  }
  function deposit(id, amount) {
    const index = model.deposit(id, amount);
    deposits += amount;
    call('deposit', [], {
      from: id,
      value: String(amount),
      want: [String(index)],
    });
    record('deposits');
  }
  function cancelPending(id, index) {
    const amount = model.pending[index].amount;
    model.cancelPending(id, index);
    payout(id, amount);
    call('cancelPending', [String(index)], { from: id });
    record('pendingRefunds');
  }
  function claim(id) {
    const amount = model.claim(id);
    payout(id, amount);
    call('claim', [], { from: id, want: [String(amount)] });
    // Repeat requests must not pay the same reserve twice.
    call('claim', [], { from: id, revert: '*' });
    record('claims');
  }
  function fees() {
    if (!model.feeReserve) return;
    const amount = model.claimFee(feeRecipient);
    payout(feeRecipient, amount);
    call('claimFees', [], {
      from: users[random(users.length)],
      want: [String(amount)],
    });
    record('feeClaims');
  }
  function request(id, kind, amount = null) {
    const index =
      kind === 'requestRewards'
        ? model.requestRewards(id, amount)
        : model.requestWithdrawal(id, amount);
    call(kind, [String(amount === null ? UINT256_MAX : amount)], {
      from: id,
      want: [String(index)],
    });
    record(kind);
  }
  function cancelRequest(id) {
    model.cancelRequest(id);
    call('cancelRequest', [], { from: id });
    record('requestCancellations');
  }
  function terminal(value) {
    model.fixtureAllValidatorsTerminal = value;
    call('setTerminal', [value]);
  }
  function fund(amount) {
    if (!amount) return;
    model.fixtureFund(amount);
    model.fixtureConsumeFunding(amount);
    call('fixtureCashDebit', [String(amount)]);
    terminal(false);
    record('validatorFunding');
  }
  function returnAssets(amount) {
    if (!amount) return;
    model.fixtureReturnPrincipal(amount);
    call('fixtureCashCredit', [], { value: String(amount) });
    record('principalReturns');
  }
  function gift(amount) {
    model.fixtureExempt(amount);
    gifts += amount;
    call('fixtureCashCredit', [], { value: String(amount) });
    record('feeExemptReceipts');
  }
  function reward(amount) {
    model.fixtureConsensus(amount);
    rewards += amount;
    terminal(false);
    record('consensusRewards');
  }
  function loss(amount) {
    if (!amount) return;
    model.fixtureConsensus(-amount);
    losses += amount;
    record('validatorLosses');
  }
  function batches() {
    let count = 0;
    while (model.stage) {
      assert(++count < 256, 'checkpoint processing did not terminate');
      const bound = 1 + random(4);
      if (model.stage.phase === 'deposits') {
        const n = model.activateDeposits(bound);
        call('activateDeposits', [String(bound)], { want: [String(n)] });
      } else {
        const feeBefore = model.feeReserve;
        const n = model.processQueue(bound);
        earnedFees += model.feeReserve - feeBefore;
        call('processQueue', [String(bound)], { want: [String(n)] });
      }
      // Claims are allowed between batches and must not change later prices.
      const id = users[random(users.length)];
      if (model.position(id).claimable && random(2)) {
        claim(id);
        record('claimsBetweenBatches');
      }
      check();
    }
  }
  function settle({ delayed = false, abort = false, atCutoff = false } = {}) {
    advance();
    if (atCutoff) {
      deposit(users[random(users.length)], 1n + BigInt(random(31)) * scale);
      record('depositsAtCutoff');
    }
    const fixture = model.fixtureCheckpoint();
    advance();
    if (delayed) {
      deposit(users[random(users.length)], 1n + BigInt(random(47)) * scale);
      const id = users[random(users.length)];
      if (model.position(id).claimable) claim(id);
      record('historicalCutoffs');
    }
    model.settleCheckpoint(fixture);
    call('setCheckpoint', [
      String(++checkpointId),
      String(fixture.block),
      String(fixture.cash + fixture.validatorAssets + fixture.inFlight),
      String(fixture.consensusDelta - priorConsensus),
    ]);
    priorConsensus = fixture.consensusDelta;
    call('settleCheckpoint');
    record('checkpoints');
    if (abort) {
      model.fixtureStagingFresh = false;
      call('setFresh', [false]);
      call('activateDeposits', ['1'], { revert: '*' });
      model.abortStaging();
      call('abortStaging');
      model.fixtureStagingFresh = true;
      call('setFresh', [true]);
      record('staleStageAborts');
    } else batches();
    check();
  }

  // Every seed starts with dust alongside large positions and low liquidity.
  users.forEach((id, index) =>
    deposit(id, index === 0 ? 1n : BigInt(300 + random(700)) * scale + BigInt(index))
  );
  settle();
  fund((model.freeCash() * 31n) / 32n);
  request(users[1], 'requestWithdrawal');
  request(users[2], 'requestWithdrawal', 1n);
  settle({ delayed: true, atCutoff: true });
  assert(
    model.user(users[1]).activeRequest && model.user(users[2]).activeRequest,
    'low-liquidity FIFO setup must remain queued'
  );
  record('blockedFifo');
  cancelRequest(users[1]);
  settle({ abort: true });
  settle();

  for (let index = 0; index < randomActions; index++) {
    advance();
    const id = users[random(users.length)];
    const user = model.user(id);
    const amount = 1n + BigInt(random(97)) * scale;
    switch (random(14)) {
      case 0:
        deposit(id, amount);
        break;
      case 1:
        if (profile !== 'zero-reward-drain' && model.totalShares) reward(amount);
        else gift(amount);
        break;
      case 2:
        loss(min(model.validatorAssets / 4n, amount));
        break;
      case 3:
        gift(amount);
        break;
      case 4:
        if (user.shares && !user.activeRequest)
          request(id, 'requestWithdrawal', random(3) ? amount : null);
        break;
      case 5:
        if (user.shares && !user.activeRequest)
          request(id, 'requestRewards', random(2) ? amount : null);
        break;
      case 6:
        if (user.activeRequest) cancelRequest(id);
        break;
      case 7:
        if (model.position(id).claimable) claim(id);
        break;
      case 8:
        fees();
        break;
      case 9:
        returnAssets(min(model.validatorAssets, amount));
        break;
      case 10:
        if (model.queueHead === model.requests.length && model.totalShares && model.riskAssets)
          fund(model.freeCash() / 3n);
        break;
      case 11: {
        const candidates = model.pending
          .map((item, pendingIndex) => ({ ...item, pendingIndex }))
          .filter((item) => item.pendingIndex >= model.pendingHead && !item.cancelled);
        if (candidates.length) {
          const item = candidates[random(candidates.length)];
          cancelPending(item.id, item.pendingIndex);
        }
        break;
      }
      case 12:
        settle({ delayed: true });
        break;
      case 13:
        settle({ abort: random(3) === 0, atCutoff: true });
        break;
    }
    check();
    // Checkpoints do not occur after every action: unsettled histories accumulate.
    if (index % 7 === 6) settle();
  }

  for (const id of users) if (model.user(id).activeRequest) cancelRequest(id);
  settle();
  if (profile === 'loss-recovery') {
    // Half the recovery seeds destroy the entire remaining validator value.
    // The nonterminal cohort must retain rights to later native cash receipts.
    if (seed & 1) {
      fund(model.freeCash());
      loss(model.validatorAssets);
      settle();
      assert.equal(model.riskAssets, 0n);
      record('completeLoss');
    }
    deposit(users[random(users.length)], 13n * scale + 1n);
    const frozen = users.map((id) => model.user(id).shares);
    const feesBeforeRecovery = earnedFees;
    model.fixtureAuthorityStatus = 2;
    call('setStatus', ['2']);
    model.beginRecovery({ verifiedFixtureExpired: true });
    call('beginRecovery');
    record('permanentRecovery');
    call('deposit', [], { from: users[0], value: '1', revert: '*' });
    call('requestWithdrawal', [String(UINT256_MAX)], {
      from: users[1],
      revert: '*',
    });
    const pending = model.pending
      .map((item, index) => ({ ...item, index }))
      .filter((item) => item.index >= model.pendingHead && !item.cancelled);
    for (const item of pending) cancelPending(item.id, item.index);
    for (const id of users) if (model.position(id).claimable) claim(id);
    fees();
    for (let round = 0; round < 4; round++) {
      returnAssets(round === 3 ? model.validatorAssets : model.validatorAssets / 2n);
      gift(BigInt(1 + random(59)) * scale);
      const order = [...users];
      for (let i = order.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const id of order) {
        const cumulative = model.freeCash() + model.recoveryPaid;
        const entitlement = model.frozenShares
          ? (cumulative * model.user(id).shares) / model.frozenShares
          : 0n;
        if (entitlement > model.user(id).recoveryClaimed) {
          const amount = model.claimRecovery(id);
          payout(id, amount);
          call('claimRecovery', [], { from: id, want: [String(amount)] });
          call('claimRecovery', [], { from: id, revert: '*' });
          record('recoveryClaims');
        }
      }
      assert.deepEqual(
        users.map((id) => model.user(id).shares),
        frozen,
        'recovery cohort changed'
      );
      assert.equal(earnedFees, feesBeforeRecovery, 'recovery created operator fees');
      check();
    }
    assert.equal(model.validatorAssets, 0n);
    assert(
      model.freeCash() < BigInt(users.length),
      'recovery dust exceeds per-beneficiary floor bound'
    );
  } else {
    returnAssets(model.validatorAssets);
    terminal(true);
    settle();
    for (const id of users) if (model.user(id).shares) request(id, 'requestWithdrawal');
    settle();
    for (const id of users) if (model.position(id).claimable) claim(id);
    fees();
    assert.equal(model.totalShares, 0n);
    assert.equal(model.riskAssets, 0n);
    assert.equal(model.cash, model.orphanCash);
    record('terminalDrains');
  }
  check();
  const name = `${profile}-${seed.toString(16)}`;
  const plan = `${name}.json`;
  fs.writeFileSync(
    path.join(output, plan),
    JSON.stringify(
      {
        origin: users[0],
        accounts: Object.fromEntries(accounts.map((id) => [id, String(initialBalance)])),
        time: 1,
        steps,
      },
      null,
      2
    ) + '\n'
  );
  return {
    name,
    seed: `0x${seed.toString(16)}`,
    profile,
    scale: String(scale),
    randomActions,
    steps: steps.length,
    plan,
    coverage,
  };
}

const scenarios = profiles.flatMap((profile) =>
  seeds.map((seed, index) =>
    makePlan(seed, profile, [1n, 10n ** 18n, 1n << 120n, 10n ** 9n][index])
  )
);
const coverage = {};
for (const scenario of scenarios)
  for (const [key, count] of Object.entries(scenario.coverage))
    coverage[key] = (coverage[key] || 0) + count;
for (const key of [
  'deposits',
  'pendingRefunds',
  'claims',
  'feeClaims',
  'requestRewards',
  'requestWithdrawal',
  'requestCancellations',
  'validatorFunding',
  'principalReturns',
  'feeExemptReceipts',
  'consensusRewards',
  'validatorLosses',
  'claimsBetweenBatches',
  'depositsAtCutoff',
  'historicalCutoffs',
  'staleStageAborts',
  'blockedFifo',
  'completeLoss',
  'permanentRecovery',
  'recoveryClaims',
  'terminalDrains',
])
  assert(coverage[key] > 0, `missing required coverage: ${key}`);
fs.writeFileSync(
  path.join(output, 'randomized-plans.json'),
  JSON.stringify(
    {
      evidence:
        'actual native QRVM differential tests with synthetic economic checkpoints; bounded seeded state-machine generation without mutation guidance',
      randomActions: randomActions * scenarios.length,
      coverage,
      scenarios,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `Generated ${scenarios.length} seeded plans, ${scenarios.reduce((sum, item) => sum + item.steps, 0)} native QRVM steps, ${randomActions * scenarios.length} randomized action selections`
);
