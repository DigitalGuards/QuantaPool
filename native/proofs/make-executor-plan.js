// Bounded mechanical helper tests. Captured native proofs and synthetic authority
// are labelled separately from the real-pool adapter's synthetic state fixtures.
const fs = require('node:fs');
const path = require('node:path');
const { build: adapterPlan } = require('./make-adapter-plan');
const { cash } = require('./make-plan');
const repo = path.resolve(__dirname, '../..');
const artifact = (output, directory, name) => path.relative(path.dirname(output), path.join(repo, directory, name));
const clone = value => structuredClone(value);

function adapter(fixture, output) {
  const plan = adapterPlan(fixture, output, { stageRace: false });
  const transformed = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const item = plan.steps[i];
    transformed.push(item);
    if (item.op === 'deploy' && item.id === 'pool') {
      transformed.push({ name: 'deploy immutable mechanical executor', op: 'deploy', id: 'executor',
        artifact: artifact(output, 'build/native-checkpoint-executor', 'NativeCheckpointExecutor'), args: ['@portfolio', '@pool'] });
      transformed.push({ name: 'executor rejects funds', op: 'call', target: '@executor', method: 'appendAndSettle', args: [[], true], value: '1', revert: '*' });
      transformed.push({ name: 'executor rejects empty unfinished work', op: 'call', target: '@executor', method: 'appendAndSettle', args: [[], false], revert: '*' });
    }
    if (item.op === 'call' && item.method === 'appendBlocks' && /^prove complete interval/.test(item.name)) {
      transformed.pop();
      transformed.push({ name: `atomic real-pool append and settlement ${item.name}`, op: 'call', target: '@executor', method: 'appendAndSettle', args: [[item.args[0]], true] });
      const following = plan.steps.slice(i + 1, i + 5).map(value => value.method);
      if (following.join(',') !== 'finalizeCheckpoint,settleCheckpoint,activateDeposits,processQueue') throw new Error('Adapter plan settlement shape changed');
      i += 4;
      transformed.push({ name: 'helper finishes bounded deposit and queue staging', op: 'call', target: '@pool', method: 'stage', args: [], want: ['0'] });
    }
  }
  plan.steps = transformed;
  return plan;
}

function captured(inputs, output) {
  const account = JSON.parse(fs.readFileSync(inputs.cashWitness));
  const flow = JSON.parse(fs.readFileSync(inputs.flowWitness));
  const origin = `Q${'11'.repeat(64)}`;
  const amount = String(1000000n * 10n ** 18n);
  const steps = [];
  const deploy = (id, name, args, extra = {}, directory = 'build/native') => steps.push({ name: `deploy ${id}`, op: 'deploy', id, artifact: artifact(output, directory, name), args, ...extra });
  const call = (name, target, method, args = [], extra = {}) => steps.push({ name, op: 'call', target, method, args, ...extra });
  deploy('anchor', 'FixtureFinality', [inputs.previousSlot, `0x${'01'.repeat(32)}`, inputs.previousHeaderRoot]);
  deploy('portfolio', 'NativePortfolioVerifier', ['@anchor', account.account, origin]);
  deploy('poolCopy', 'CheckpointPoolFixture', ['@portfolio'], { captureAllocation: true }, 'build/native-checkpoint-executor');
  steps.push({ name: 'explicit fixture pool allocation at captured native account', op: 'fixture-predeploy', id: 'pool', source: '@poolCopy', target: account.account });
  deploy('executor', 'NativeCheckpointExecutor', ['@portfolio', '@pool'], {}, 'build/native-checkpoint-executor');
  call('immutable portfolio destination', '@executor', 'portfolio', [], { want: ['@portfolio'] });
  call('immutable pool destination', '@executor', 'pool', [], { want: ['@pool'] });
  call('four groups exceed mechanical bound', '@executor', 'appendAndSettle', [[[], [], [], []], false], { revert: 'batch bound' });
  steps.push({ name: 'captured cutoff with explicit synthetic clock', op: 'time', time: 1000 + Number(inputs.slot) * 3 });
  steps.push({ name: 'execution block after captured cutoff', op: 'block', value: String(BigInt(inputs.executionBlock) + 1n) });
  call('synthetic authority supplies captured native state', '@anchor', 'set', [inputs.slot, inputs.stateRoot, inputs.headerRoot]);
  call('captured native account and execution cutoff', '@portfolio', 'beginCheckpoint', [cash(account, account.accountProof)]);
  const head = flow.blocks.slice(0, 4);
  const bad = clone(head); bad[0].header.parentRoot = `0x${'00'.repeat(32)}`;
  call('helper retains canonical ancestry rejection', '@executor', 'appendAndSettle', [[bad], false], { revert: '*' });
  call('premature atomic completion rejects and rolls back append', '@executor', 'appendAndSettle', [[head], true], { revert: '*' });
  call('failed finish preserves full ancestry cursor', '@portfolio', 'checkpointProgress', [], { want: [true, inputs.slot, '0', '0', inputs.headerRoot] });
  const groups = [];
  for (let i = 0; i < flow.blocks.length; i += 4) groups.push(flow.blocks.slice(i, i + 4));
  for (let i = 0; i < groups.length; i += 3) call(`three-group captured native proof batch ${i}`, '@executor', 'appendAndSettle', [groups.slice(i, i + 3), i + 3 >= groups.length]);
  call('complete actual captured history committed once', '@portfolio', 'snapshotId', [], { want: ['1'] });
  call('mechanical fixture settlement happened once', '@pool', 'settlements', [], { want: ['1'] });
  call('atomic bounded stage completed', '@pool', 'stage', [], { want: ['0'] });
  call('repeated finalization rejected', '@executor', 'appendAndSettle', [[], true], { revert: '*' });
  steps.push({ name: 'mechanical executor has no assets', op: 'balance', target: '@executor', value: '0' });
  return { origin, accounts: { [origin]: amount }, time: 1000 + Number(inputs.previousSlot) * 3, steps };
}

if (require.main === module) {
  const [mode, input, output] = process.argv.slice(2);
  if (!['adapter', 'captured'].includes(mode) || !input || !output) throw new Error('usage: node native/proofs/make-executor-plan.js adapter|captured INPUT OUTPUT');
  const plan = ({ adapter, captured })[mode](JSON.parse(fs.readFileSync(input)), path.resolve(output));
  fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({ mode, steps: plan.steps.length, output }));
}
module.exports = { adapter, captured };
