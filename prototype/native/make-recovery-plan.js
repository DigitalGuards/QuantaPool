'use strict';

// Actual QRVM execution plan. Certificate inputs are captured native Qrysm data;
// account balances, time and withdrawal-credit payloads are synthetic fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { buildPlan: validateRecoveryWitness } = require('../recovery/make-plan');
const { proposalId, votes } = require('../finality/make-plan');

const repo = path.resolve(__dirname, '../..');
const alice = `Q${'11'.repeat(64)}`;
const bob = `Q${'22'.repeat(64)}`;
const keeper = `Q${'33'.repeat(64)}`;
const overflowSender = `Q${'44'.repeat(64)}`;
const zeroAddress = `Q${'00'.repeat(64)}`;
const SHOR = 10n ** 9n;
const MAX = (1n << 256n) - 1n;
const copy = value => structuredClone(value);

function buildPlan(witness, network, artifacts, output) {
  const artifact = name => path.relative(path.dirname(output), path.join(artifacts, name));
  const validated = validateRecoveryWitness(witness, network, artifact('RecoverableFinalityVerifier'));
  const constructor = validated.plan.steps.find(step => step.op === 'deploy' && step.id === 'recovery').args;
  const accepted = validated.plan.steps.find(step => step.method === 'beginUpdate' && step.name === 'history[0] begin real captured update').args;
  const identifier = proposalId(accepted);
  const selected = votes(witness.updates[0]).slice(0, 86);
  const genesisTime = BigInt(network.beaconGenesis.genesis_time);
  const time = slot => {
    const result = genesisTime + BigInt(slot) * 6n;
    assert(result <= BigInt(Number.MAX_SAFE_INTEGER));
    return Number(result);
  };
  const steps = [];
  const initial = { [alice]: MAX, [bob]: MAX, [keeper]: 100n * SHOR, [overflowSender]: MAX };
  const wallets = { ...initial };
  let syntheticNativeCredits = 0n;
  const call = (name, target, method, args = [], extra = {}) => steps.push({ name, op: 'call', target, method, args: copy(args), ...extra });
  const value = (name, target, method, expected, args = []) => call(name, target, method, args, { want: [String(expected)] });
  const reject = (name, target, method, args = [], extra = {}) => call(name, target, method, args, { revert: '*', ...extra });
  const balance = (name, target, expected) => steps.push({ name, op: 'balance', target, value: String(expected) });
  const clock = slot => steps.push({ name: `advance synthetic execution clock to slot ${slot}`, op: 'time', time: time(slot) });
  const deploy = (id, name, args, extra = {}) => steps.push({ name: `deploy ${id}`, op: 'deploy', id, artifact: artifact(name), args, ...extra });
  const scenarios = [];
  const pool = id => {
    deploy(id, 'CashRecoveryPool', ['@verifier']);
    const result = { id, target: `@${id}`, weights: {}, paid: {}, total: 0n, gross: 0n, cumulative: 0n, recovering: false };
    scenarios.push(result);
    return result;
  };
  const deposit = (scenario, user, amount, callback = false) => {
    call(`${scenario.id}: exact native deposit creates sender risk shares`, callback ? user : scenario.target, callback ? 'join' : 'deposit', [], {
      from: callback ? alice : user, value: String(amount),
    });
    const sender = callback ? alice : user;
    wallets[sender] -= amount;
    scenario.weights[user] = (scenario.weights[user] || 0n) + amount;
    scenario.paid[user] = 0n;
    scenario.total += amount;
    scenario.gross += amount;
  };
  const credit = (scenario, amount) => {
    assert(amount % SHOR === 0n);
    steps.push({ name: `${scenario.id}: synthetic native withdrawal payload credits ${amount / SHOR} shor through actual go-qrl Finalize`,
      op: 'withdrawal-credit', target: scenario.target, value: String(amount) });
    syntheticNativeCredits += amount;
    scenario.gross += amount;
  };
  const sync = scenario => {
    call(`${scenario.id}: any caller synchronizes actual cash plus historical payments`, scenario.target, 'syncCash', [], {
      from: keeper, want: [String(scenario.gross)],
    });
    scenario.cumulative = scenario.gross;
  };
  const claim = (scenario, user, callback = false) => {
    const entitlement = scenario.total ? scenario.gross * (scenario.weights[user] || 0n) / scenario.total : 0n;
    const amount = entitlement - (scenario.paid[user] || 0n);
    call(`${scenario.id}: ${amount ? 'claim pays immutable caller entitlement' : 'repeated or empty claim rejects'}`,
      callback ? user : scenario.target, 'claim', [], {
        from: callback ? keeper : user, ...(amount ? {} : { revert: 'nothing to claim' }),
      });
    if (amount) {
      scenario.paid[user] = entitlement;
      scenario.cumulative = scenario.gross;
      wallets[user] = (wallets[user] || 0n) + amount;
    }
    return amount;
  };
  const check = (scenario, label) => {
    const paid = Object.values(scenario.paid).reduce((sum, amount) => sum + amount, 0n);
    value(`${label}: total share weights remain fixed`, scenario.target, 'totalShares', scenario.total);
    value(`${label}: frozen denominator`, scenario.target, 'frozenTotalShares', scenario.recovering ? scenario.total : 0n);
    value(`${label}: synchronized cumulative cash`, scenario.target, 'cumulativeRecovered', scenario.cumulative);
    value(`${label}: total paid debt`, scenario.target, 'totalPaid', paid);
    balance(`${label}: actual cash reconciles with payments`, scenario.target, scenario.gross - paid);
    for (const [user, weight] of Object.entries(scenario.weights)) {
      value(`${label}: immutable beneficiary share count`, scenario.target, 'shares', weight, [user]);
      value(`${label}: beneficiary cannot double claim`, scenario.target, 'paidDebt', scenario.paid[user], [user]);
      value(`${label}: exact full-precision entitlement`, scenario.target, 'claimable',
        scenario.recovering ? scenario.cumulative * weight / scenario.total - scenario.paid[user] : 0n, [user]);
    }
  };

  deploy('verifier', 'RecoverableFinalityVerifier', constructor);
  for (const invalid of [zeroAddress, alice]) deploy(`reject verifier ${invalid}`, 'CashRecoveryPool', [invalid], { revert: 'verifier must have code' });
  const main = pool('main');
  const dust = pool('dust');
  const large = pool('large');
  const empty = pool('empty');
  const callback = pool('callbackPool');
  deploy('callback', 'CashRecoveryCallback', [callback.target]);
  wallets['@callback'] = 0n;
  call('pool verifier address is immutable deployment input', main.target, 'verifier', [], { want: ['@verifier'] });
  reject('zero native deposit rejected', main.target, 'deposit');
  reject('Live verifier cannot be forced into recovery', main.target, 'beginRecovery', [], { from: keeper });
  reject('sync is unavailable before permanent recovery', main.target, 'syncCash');
  reject('this isolated experiment has no pre-expiry withdrawal', main.target, 'claim');
  deposit(main, alice, 3n * SHOR);
  deposit(main, bob, 2n * SHOR);
  deposit(dust, alice, 1n);
  deposit(dust, bob, 2n);
  deposit(large, alice, 1n << 200n);
  deposit(large, bob, (1n << 199n) + 3n);
  reject('uint256 total-share overflow atomically rejects deposit', large.target, 'deposit', [], { from: overflowSender, value: String(MAX) });
  balance('overflow sender retains entire synthetic starting balance', overflowSender, MAX);
  deposit(callback, '@callback', 10n * SHOR, true);
  deposit(callback, bob, 2n * SHOR);
  for (const scenario of scenarios) check(scenario, `${scenario.id} before expiry`);

  call('begin genuine native sync-certificate update', '@verifier', 'beginUpdate', accepted, { from: keeper, want: [identifier] });
  reject('unverified certificate cannot finalize', '@verifier', 'finalize', [identifier]);
  for (let index = 0; index < selected.length; index += 12) call(`verify actual native ML-DSA seats ${index}-${Math.min(index + 12, selected.length) - 1}`,
    '@verifier', 'submit', [identifier, selected.slice(index, index + 12)], { from: keeper });
  call('real quorum authenticates finalized checkpoint', '@verifier', 'finalize', [identifier], { from: keeper });
  value('authenticated finalized slot establishes the expiry anchor', '@verifier', 'trustAnchorSlot', 96n);
  value('recovery deadline is derived from authenticated anchor', '@verifier', 'trustDeadlineSlot', 352n);
  clock(161);
  value('economic staleness enters CatchingUp', '@verifier', 'status', 1n);
  reject('CatchingUp blocks new economic deposits', main.target, 'deposit', [], { from: keeper, value: '1' });
  reject('CatchingUp cannot prematurely confiscate membership into recovery', main.target, 'beginRecovery', [], { from: keeper });
  clock(352);
  reject('exact trust deadline remains unexpired', main.target, 'beginRecovery');
  clock(353);
  value('expiry is observable without an operator transaction', '@verifier', 'status', 2n);
  call('expiry latch has not been needed', '@verifier', 'expired', [], { want: [false] });
  reject('implicit expiry rejects deposits before beginRecovery', main.target, 'deposit', [], { from: keeper, value: '1' });
  for (const scenario of scenarios) {
    call(`${scenario.id}: independent caller begins irreversible cash recovery`, scenario.target, 'beginRecovery', [], { from: keeper });
    scenario.recovering = true;
    scenario.cumulative = scenario.gross;
    reject(`${scenario.id}: recovery membership cannot be restarted`, scenario.target, 'beginRecovery');
    reject(`${scenario.id}: deposits cannot dilute frozen claims`, scenario.target, 'deposit', [], { from: keeper, value: '1' });
    check(scenario, `${scenario.id} frozen`);
  }
  reject('unfunded caller cannot redirect Alice or Bob principal', main.target, 'claim', [], { from: keeper, revert: 'nothing to claim' });
  credit(main, 7n * SHOR);
  sync(main);
  claim(main, bob);
  claim(main, bob);
  credit(main, SHOR);
  claim(main, alice);
  check(main, 'interleaved claims retain late-credit entitlements');
  claim(main, bob);
  check(main, 'all presently available main cash claimed');
  credit(main, 13n * SHOR);
  claim(main, alice);
  claim(main, bob);
  check(main, 'full drain does not close future rights');

  credit(dust, SHOR);
  claim(dust, bob);
  claim(dust, alice);
  claim(dust, alice);
  balance('last claimant cannot sweep another holder fractional rights', dust.target, 1n);
  credit(dust, 2n * SHOR);
  claim(dust, alice);
  claim(dust, bob);
  check(dust, 'later credit makes every fractional unit claimable');
  balance('divisible cumulative entitlement drains all dust', dust.target, 0n);

  claim(large, alice);
  credit(large, 7n * SHOR);
  claim(large, bob);
  claim(large, alice);
  check(large, 'native uint512 intermediate preserves overflowing uint256 products');

  claim(empty, alice);
  sync(empty);
  balance('empty pool starts with no synthetic assets', empty.target, 0n);
  credit(empty, 4n * SHOR);
  sync(empty);
  claim(empty, keeper);
  balance('no-holder late cash remains without a sweep beneficiary', empty.target, 4n * SHOR);

  credit(callback, 6n * SHOR);
  call('test recipient rejects its payment', '@callback', 'setRejectPayment', [true]);
  reject('rejected recipient rolls back debt and synchronized-cash mutation', '@callback', 'claim', [], { from: keeper, revert: 'payment failed' });
  check(callback, 'failed callback preserves every holder entitlement');
  claim(callback, bob);
  call('test recipient accepts its own later payment', '@callback', 'setRejectPayment', [false]);
  claim(callback, '@callback', true);
  value('nested claim, sync, begin and deposit all fail at guard', '@callback', 'guardedCalls', 4n);
  credit(callback, 6n * SHOR);
  claim(callback, '@callback', true);
  claim(callback, bob);
  value('late-credit claim remains guarded on all entry points', '@callback', 'guardedCalls', 8n);
  value('callback receives exactly its own lifetime allocation', '@callback', 'received', callback.paid['@callback']);
  check(callback, 'callback cannot steal principal or block another holder');

  for (const scenario of scenarios) check(scenario, `${scenario.id} final invariant`);
  for (const [account, expected] of Object.entries(wallets)) balance('actual recipient balance equals initial funds minus deposits plus own claims', account, expected);
  balance('recovery verifier never receives user funds', '@verifier', 0n);
  return {
    plan: { origin: alice, accounts: Object.fromEntries(Object.entries(initial).map(([user, amount]) => [user, String(amount)])), time: time(113), steps },
    metadata: {
      schemaVersion: 1, qrysmCommit: witness.qrysmCommit, authenticatedAnchorSlot: 96,
      freshnessSlots: 64, recoveryWindowSlots: 256, expiryExecutionSlot: 353,
      genuineCertificateSeats: selected.length, syntheticNativeCredits: String(syntheticNativeCredits),
      maxProductBits: 401,
      boundary: 'Actual pinned QRVM executes a genuine captured native certificate and isolated CashRecoveryPool bytecode. Caller balances/time and native withdrawal payloads are synthetic. This cash-only experiment has no validator funding, pre-expiry withdrawal, senior reserve integration or new fees.',
      incomplete: 'Normal staking entry/reward/loss accounting, pending-deposit and existing-claim reserves, finality bootstrap policy and production integration remain outside this contract.',
    },
  };
}

if (require.main === module) {
  const witnessPath = path.resolve(process.argv[2] || path.join(repo, 'findings/native-qrl-finality/capture/witness.json'));
  const networkPath = path.resolve(process.argv[3] || path.join(repo, 'findings/native-qrl-prototype/network.json'));
  const artifacts = path.resolve(process.argv[4] || path.join(repo, 'build/prototype'));
  const output = path.resolve(process.argv[5] || path.join(repo, 'build/prototype/cash-recovery-plan.json'));
  const bytes = fs.readFileSync(witnessPath);
  const witness = JSON.parse(bytes);
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'prototype/source-lock.json')));
  assert.equal(witness.qrysmCommit, lock.repositories.qrysm.commit);
  const result = buildPlan(witness, JSON.parse(fs.readFileSync(networkPath)), artifacts, output);
  result.metadata.witnessSha256 = createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result.plan, null, 2)}\n`);
  fs.writeFileSync(output.replace(/\.json$/, '.meta.json'), `${JSON.stringify(result.metadata, null, 2)}\n`);
  console.log(`Wrote ${result.plan.steps.length} actual-QRVM cash recovery steps.`);
}

module.exports = { buildPlan };
