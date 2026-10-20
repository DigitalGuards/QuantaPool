// Component proof tests execute real QRVM bytecode with explicitly synthetic
// immutable-authority inputs. Actual native finality integration is separate.
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '../..');
const copy = value => structuredClone(value);
const flip = value => `0x${(parseInt(value.slice(2, 4), 16) ^ 1).toString(16).padStart(2, '0')}${value.slice(4)}`;
const base = value => String(BigInt(value) * 1000000000000000000n);
const witness = value => copy(Object.fromEntries(Object.entries(value).filter(([key]) => !['publicKey', 'balanceShor'].includes(key))));
const cash = (state, proof) => ({ ...Object.fromEntries(['executionStateRoot', 'executionBlock', 'executionDepositIndex',
    'executionStateRootBranch', 'executionBlockBranch', 'executionDepositIndexBranch'].map(key => [key, copy(state[key])])), accountProof: copy(proof) });

function build(data, output) {
    const origin = data.pool;
    const other = `Q${'22'.repeat(64)}`;
    const [a, b] = data.updates;
    const steps = [];
    const call = (name, target, method, args = [], extra = {}) => steps.push({ name, op: 'call', target, method, args, ...extra });
    const reject = (name, target, method, args = [], extra = {}) => call(name, target, method, args, { revert: '*', ...extra });
    const deploy = (id, artifact, args) => steps.push({ name: `deploy ${id}`, op: 'deploy', id,
        artifact: path.relative(path.dirname(output), path.join(repo, 'build/native', artifact)), args });
    const clock = slot => steps.push({ name: `synthetic time slot ${slot}`, op: 'time', time: 1000 + slot * 3 });
    deploy('anchor', 'FixtureFinality', ['64', data.initial.stateRoot, data.initialHeaderRoot]);
    for (const id of ['portfolio', 'aborted']) deploy(id, 'NativePortfolioVerifier', ['@anchor', origin, origin]);
    reject('arbitrary caller cannot admit funded identity', '@portfolio', 'registerValidator', [witness(data.initial.validators[0]), data.initial.validators[0].publicKey], { from: other });
    reject('canonical foreign recipient cannot be admitted', '@portfolio', 'registerValidator', [witness(data.initial.validators[2]), data.initial.validators[2].publicKey]);
    const fakeRecipient = witness(data.initial.validators[2]); fakeRecipient.withdrawalRecipient = `0x${origin.slice(1)}`;
    reject('changing canonical recipient breaks proof', '@portfolio', 'registerValidator', [fakeRecipient, data.initial.validators[2].publicKey]);
    reject('wrong full public key rejected', '@portfolio', 'registerValidator', [witness(data.initial.validators[0]), data.initial.validators[1].publicKey]);
    for (const id of ['portfolio', 'aborted']) {
        for (const v of data.initial.validators.slice(0, 2)) call(`admit ${id} validator ${v.index}`, `@${id}`, 'registerValidator', [witness(v), v.publicKey], { want: ['64', base(2000)] });
        call(`${id} complete registry length`, `@${id}`, 'registryCount', [], { want: ['2'] });
        reject(`${id} repeated canonical key rejected`, `@${id}`, 'registerValidator', [witness(data.initial.validators[0]), data.initial.validators[0].publicKey]);
    }
    clock(80);
    call('test authority supplies synthetic native root A', '@anchor', 'set', ['80', a.state.stateRoot, a.headerRoot]);
    const checkpointA = cash(a.state, data.accountProof);
    for (const field of ['executionStateRoot', 'executionBlock', 'executionDepositIndex']) {
        const bad = copy(checkpointA); bad[field] = field === 'executionStateRoot' ? flip(bad[field]) : String(BigInt(bad[field]) + 1n);
        reject(`forged ${field} rejected`, '@portfolio', 'beginCheckpoint', [bad]);
    }
    for (const field of ['executionStateRootBranch', 'executionBlockBranch', 'executionDepositIndexBranch']) {
        const bad = copy(checkpointA); bad[field].pop(); reject(`incomplete ${field}`, '@portfolio', 'beginCheckpoint', [bad]);
    }
    const badAccount = copy(checkpointA); badAccount.accountProof[0] = flip(badAccount.accountProof[0]);
    reject('forged pool MPT proof rejected', '@portfolio', 'beginCheckpoint', [badAccount]);
    for (const id of ['portfolio', 'aborted']) call(`${id} anyone starts authenticated checkpoint`, `@${id}`, 'beginCheckpoint', [checkpointA], { from: other });
    reject('parallel checkpoint blocked', '@portfolio', 'beginCheckpoint', [checkpointA]);
    reject('registry locked during pending complete snapshot', '@portfolio', 'registerValidator', [witness(data.initial.validators[2]), data.initial.validators[2].publicKey]);
    reject('fresh checkpoint cannot be discarded', '@portfolio', 'abortStaleCheckpoint');
    reject('omitted validators/history cannot finalize', '@portfolio', 'finalizeCheckpoint');
    reject('registered validator order deterministic', '@portfolio', 'appendValidators', [[witness(a.state.validators[1])]]);
    const badBalance = witness(a.state.validators[0]); badBalance.balanceChunk = flip(badBalance.balanceChunk);
    reject('forged validator balance rejected', '@portfolio', 'appendValidators', [[badBalance]]);
    const badLength = witness(a.state.validators[0]); badLength.balanceBranch[38] = flip(badLength.balanceBranch[38]);
    reject('inconsistent native list lengths rejected', '@portfolio', 'appendValidators', [[badLength]]);
    call('first validator accepted once', '@portfolio', 'appendValidators', [[witness(a.state.validators[0])]], { from: other });
    reject('duplicate validator rejected', '@portfolio', 'appendValidators', [[witness(a.state.validators[0])]]);
    call('partial stage does not expose new balance', '@portfolio', 'validatorObservation', ['0'], { want: ['0', '0', false, false] });
    call('second validator completes bounded coverage', '@portfolio', 'appendValidators', [[witness(a.state.validators[1])]]);
    reject('extra validator cannot enter registered accounting', '@portfolio', 'appendValidators', [[witness(a.state.validators[2])]]);
    reject('complete validators alone cannot finalize', '@portfolio', 'finalizeCheckpoint');
    reject('skipping newest occupied block rejected', '@portfolio', 'appendBlocks', [[a.blocks[1]]]);
    const badHeader = copy(a.blocks[0]); badHeader.header.parentRoot = flip(badHeader.header.parentRoot);
    reject('forged ancestry rejected', '@portfolio', 'appendBlocks', [[badHeader]]);
    const omittedWithdrawal = copy(a.blocks[0]); omittedWithdrawal.withdrawals.pop();
    reject('omitting unrelated withdrawal still breaks complete list', '@portfolio', 'appendBlocks', [[omittedWithdrawal]]);
    call('newest block authenticates complete withdrawal list', '@portfolio', 'appendBlocks', [[a.blocks[0]]]);
    reject('repeated occupied block rejected', '@portfolio', 'appendBlocks', [[a.blocks[0]]]);
    const omittedDeposit = copy(a.blocks[1]); omittedDeposit.deposits.splice(2, 1);
    reject('omitting external registered-key topup rejected', '@portfolio', 'appendBlocks', [[omittedDeposit]]);
    const wrongAmount = copy(a.blocks[1]); wrongAmount.deposits[2].amountShor = '0';
    reject('editing external topup amount rejected', '@portfolio', 'appendBlocks', [[wrongAmount]]);
    call('all consumed deposits authenticate before prior header', '@portfolio', 'appendBlocks', [[a.blocks[1]]]);
    reject('extra history cannot cross prior checkpoint', '@portfolio', 'appendBlocks', [[a.blocks[1]]]);
    call('anyone commits complete matched portfolio A', '@portfolio', 'finalizeCheckpoint', [], { from: other });
    call('snapshot A reconciles all classified flows', '@portfolio', 'latestSnapshot', [], { want: ['80', '80', '7', data.cashBalance, base(81100), base(500), a.state.stateRoot, a.headerRoot, '2', base(76100), base(4000)] });
    call('complete snapshot exposes validator A balance', '@portfolio', 'validatorObservation', ['0'], { want: ['80', '40100000000000', false, false] });
    reject('same finalized slot cannot settle twice', '@portfolio', 'beginCheckpoint', [checkpointA]);
    call('stalled companion stages validator A', '@aborted', 'appendValidators', [[witness(a.state.validators[0])]]);
    clock(96);
    call('test authority supplies synthetic loss/exit root B', '@anchor', 'set', ['96', b.state.stateRoot, b.headerRoot]);
    call('start loss and terminal-zero snapshot', '@portfolio', 'beginCheckpoint', [cash(b.state, data.accountProof)]);
    call('proportional loss and terminal-zero records authenticate', '@portfolio', 'appendValidators', [b.state.validators.slice(0, 2).map(witness)]);
    call('pending loss does not replace accepted observation', '@portfolio', 'validatorObservation', ['0'], { want: ['80', '40100000000000', false, false] });
    call('complete full withdrawal history authenticates', '@portfolio', 'appendBlocks', [b.blocks]);
    call('commit loss/terminal-zero snapshot', '@portfolio', 'finalizeCheckpoint');
    call('snapshot B reconciles explicit loss and return', '@portfolio', 'latestSnapshot', [], { want: ['96', '96', '7', data.cashBalance, base(36000), base(41500), b.state.stateRoot, b.headerRoot, '2', base(76100), base(4000)] });
    call('terminal zero is actual authenticated zero', '@portfolio', 'validatorObservation', ['1'], { want: ['96', '0', true, false] });
    call('loss slashing flag preserved', '@portfolio', 'validatorObservation', ['0'], { want: ['96', '36000000000000', false, true] });
    call('terminal count complete', '@portfolio', 'terminalValidatorCount', [], { want: ['1'] });
    call('exactly two snapshots committed', '@portfolio', 'snapshotId', [], { want: ['2'] });
    clock(145);
    reject('stale staged checkpoint rejects progress', '@aborted', 'appendValidators', [[witness(a.state.validators[1])]]);
    call('independent caller discards stale locked checkpoint', '@aborted', 'abortStaleCheckpoint', [], { from: other });
    call('aborted partial observation remains hidden', '@aborted', 'validatorObservation', ['0'], { want: ['0', '0', false, false] });
    call('aborted checkpoint produces no snapshot', '@aborted', 'snapshotId', [], { want: ['0'] });
    clock(161);
    reject('stale economic authority blocks new checkpoint', '@aborted', 'beginCheckpoint', [cash(b.state, data.accountProof)]);
    call('test authority expiry', '@anchor', 'expire');
    reject('expired authority cannot create accounting', '@aborted', 'beginCheckpoint', [cash(b.state, data.accountProof)]);
    steps.push({ name: 'proof verifier never holds pool assets', op: 'balance', target: '@portfolio', value: '0' });
    return { origin, accounts: { [origin]: base(1000000), [other]: base(1) }, time: 1192, steps };
}

if (require.main === module) {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('usage: node native/proofs/make-plan.js FIXTURE OUTPUT');
    const plan = build(JSON.parse(fs.readFileSync(input)), path.resolve(output));
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify({ steps: plan.steps.length, output }));
}
module.exports = { build, witness, cash };
