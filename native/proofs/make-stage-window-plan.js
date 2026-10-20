'use strict';

// Reuse the reviewed pricing-window histories with production pool, gate,
// portfolio, SSZ and account-proof bytecode. Finality and states are synthetic.
const path = require('node:path');
const { build: adapter } = require('./make-adapter-plan');
const { cash, witness } = require('./make-plan');
const U = 10n ** 18n;
const S = 10n ** 27n;
const base = n => String(BigInt(n) * U);
const max = String((1n << 256n) - 1n);
const user = `Q${'22'.repeat(64)}`;
const newcomer = `Q${'33'.repeat(64)}`;
const otherHolder = `Q${'55'.repeat(64)}`;

function build(fixture, output, mode) {
    const loss = mode.startsWith('loss');
    const churn = mode === 'churn';
    const executor = mode === 'loss-executor';
    const plan = adapter(fixture, output, { stageRace: false });
    const end = plan.steps.findIndex(s => s.name === 'real pool activates eligible deposits 112');
    if (end < 0) throw new Error('Adapter admission boundary changed');
    plan.steps = plan.steps.slice(0, end);
    if (loss) {
        const at = plan.steps.findIndex(s => s.name === 'real user deposits native QRL before cutoff');
        plan.steps[at].value = base(20000);
        plan.steps.splice(at + 1, 0, {
            name: 'second holder supplies remaining 30k before initial cutoff',
            op: 'call', target: '@pool', method: 'deposit', args: [],
            from: otherHolder, value: base(30000), want: ['1'],
        });
        plan.accounts[otherHolder] = base(1000000);
        for (const step of plan.steps)
            if (step.method === 'positionValue' && step.args[0] === user && step.want)
                step.want = [base(20000)];
    }
    plan.accounts[newcomer] = base(1000000);
    const before = plan.steps.findIndex(s => s.name === 'advance synthetic time to finalized slot 112');
    const queued = loss
        ? [{ name: 'holder queues full 20k position before cutoff 112', op: 'call', target: '@pool',
            method: 'requestWithdrawal', args: [max], from: user, want: ['0'] }]
        : Array.from({ length: churn ? 65 : 1 }, (_, i) => ({
            name: `newcomer queues pending principal ${i} before cutoff 112`, op: 'call',
            target: '@pool', method: 'deposit', args: [], from: newcomer,
            value: base(churn ? 800 : 52000), want: [String(i + 1)],
        }));
    if (churn) {
        queued.push(...[user, fixture.origin].map((from, i) => ({
            name: `holder queues bounded reward withdrawal ${i}`, op: 'call', target: '@pool',
            method: 'requestRewards', args: [base(100)], from, want: [String(i)],
        })));
    }
    if (mode === 'reward-cutoff') {
        queued.unshift({ name: 'requests land exactly at original cutoff', op: 'block', value: '112' });
        queued.push({ name: 'operator reward request lands exactly at cutoff', op: 'call',
            target: '@pool', method: 'requestRewards', args: [base(100)], want: ['0'] });
        // The clock operation also advances the runner's execution block.
        plan.steps.find(s => s.name === 'live execution block after cutoff 112').value = '114';
    }
    plan.steps.splice(before, 0, ...queued);
    if (executor) {
        const at = plan.steps.findIndex(s => s.id === 'pool');
        plan.steps.splice(at + 1, 0, {
            name: 'deploy executor for superseded withdrawal phase', op: 'deploy', id: 'executor',
            artifact: path.relative(path.dirname(output),
                path.resolve(__dirname, '../../build/native-stage-window/NativeCheckpointExecutor')),
            args: ['@portfolio', '@pool'],
        });
    }
    const call = (name, target, method, args = [], extra = {}) =>
        plan.steps.push({ name, op: 'call', target, method, args, ...extra });
    const pool = (name, method, args = [], extra = {}) => call(name, '@pool', method, args, extra);
    const read = (method, want, args = []) =>
        pool(`${mode}: ${method} equals ${want.join(', ')}`, method, args, { want });
    const reject = (method, args = [], reason = '*') =>
        pool(`${mode}: reject ${method}`, method, args, { revert: reason });
    function time(slot) {
        plan.steps.push({ name: `synthetic clock advances to ${slot}`, op: 'time', time: 1000 + slot * 3 });
    }
    function commit(point, atomic = false) {
        const slot = Number(point.state.slot);
        time(slot);
        if (loss && slot === 128) {
            plan.steps.push({ name: 'execution block containing native exit receipt', op: 'block', value: '128' });
            plan.steps.push({ name: 'synthetic exit credit after 520 QRL validator loss',
                op: 'withdrawal-credit', target: '@pool', value: base(39480) });
        }
        plan.steps.push({ name: `execution block after ${slot}`, op: 'block', value: String(slot + 1) });
        call('synthetic authority supplies newer complete economics', '@anchor', 'set',
            [point.state.slot, point.state.stateRoot, point.headerRoot]);
        call('begin matched cash and state proof', '@portfolio', 'beginCheckpoint',
            [cash(point.state, point.accountProof)]);
        call('authenticate entire registered portfolio', '@portfolio', 'appendValidators',
            [[witness(point.state.validators[0])]]);
        call('authenticate complete parent-linked cash-flow interval', '@portfolio', 'appendBlocks', [point.blocks]);
        if (atomic)
            call('executor reprices and processes the existing withdrawal phase',
                '@executor', 'appendAndSettle', [[], true]);
        else call('commit newer portfolio before staged processing', '@portfolio', 'finalizeCheckpoint');
    }
    if (loss) {
        pool('advance old stage to withdrawals', 'activateDeposits', ['32']);
        read('freeCash', [base(12000)]);
        read('claimable', ['0'], [user]);
    }
    commit(fixture.productionPoints[3], executor);
    call('newer complete economics are public', '@portfolio', 'snapshotId', [], { want: ['4'] });
    if (!executor) {
        read('lastCheckpointId', ['3']);
        read('appliedSlot', ['112']);
        read('poolRecoveryDeadlineSlot', ['4208']);
        // Supersession cannot reset bounded progress through a fresh-stage abort.
        reject('abortStaging', [], 'staging remains fresh');
    }
    if (mode === 'reward-stale' || mode === 'reward-fresh-boundary') {
        const slot = mode === 'reward-stale' ? 193 : 192;
        time(slot);
        call('global finality stays healthy while snapshot ages', '@anchor', 'set',
            [String(slot), fixture.productionPoints[3].state.stateRoot, fixture.productionPoints[3].headerRoot]);
        if (mode === 'reward-stale') {
            reject('activateDeposits', ['32'], 'portfolio stale');
            reject('settleCheckpoint', [], 'portfolio stale');
            read('lastCheckpointId', ['3']);
            read('pendingTotal', [base(52000)]);
            read('poolRecoveryDeadlineSlot', ['4208']);
            pool('stale superseded stage remains abortable', 'abortStaging');
            pool('owner refunds unchanged pending principal', 'cancelPending', ['1'], { from: newcomer });
            read('pendingTotal', ['0']);
            return plan;
        }
    }
    if (churn) {
        reject('activateDeposits', ['33'], 'invalid admission batch');
        read('lastCheckpointId', ['3']);
        for (const [index, count, head] of [[3, 32, 33], [4, 32, 65], [5, 1, 66]]) {
            if (index > 3) commit(fixture.productionPoints[index]);
            pool('bounded admission progresses despite portfolio churn', 'activateDeposits',
                ['32'], { want: [String(count)] });
            read('pendingHead', [String(head)]);
            read('stageCutoff', ['112']);
            read('lastCheckpointId', [String(index + 1)]);
            read('stage', [index === 5 ? '2' : '1']);
            reject('settleCheckpoint', [], 'checkpoint must advance');
        }
        for (const index of [6, 7]) {
            commit(fixture.productionPoints[index]);
            reject('processQueue', ['33'], 'invalid withdrawal batch');
            // Explicit repricing also preserves the withdrawal phase.
            if (index === 6) pool('keeper explicitly refreshes withdrawal economics', 'settleCheckpoint');
            read('stage', ['2']);
            pool('FIFO progresses despite another newer portfolio', 'processQueue', ['1'], { want: ['1'] });
            read('queueHead', [String(index - 5)]);
            read('stageCutoff', ['112']);
            read('lastCheckpointId', [String(index + 1)]);
        }
        read('stage', ['0']);
        read('pendingTotal', ['0']);
        read('claimReserve', [base(180)]);
        read('feeReserve', [base(20)]);
        read('riskAssets', [base(109000)]);
        return plan;
    }
    if (!loss) pool('admit only original eligible entries after atomic repricing',
        'activateDeposits', ['32'], { want: [mode === 'reward-cutoff' ? '0' : '1'] });
    if (mode === 'reward-same-cutoff') {
        commit(fixture.productionPoints[4]);
        pool('newer slot at the same execution cutoff refreshes and completes', 'processQueue',
            ['32'], { want: ['0'] });
        read('lastCheckpointId', ['5']);
        read('lastCheckpointBlock', ['128']);
        read('appliedSlot', ['144']);
        read('stageCutoff', ['112']);
        read('stage', ['0']);
        read('rewardValue', ['0'], [newcomer]);
        reject('settleCheckpoint', [], 'checkpoint must advance');
        return plan;
    }
    if (mode === 'reward-cutoff') {
        pool('request at original cutoff still waits after repricing', 'processQueue', ['32'], { want: ['0'] });
        read('pendingTotal', [base(52000)]);
        read('queueHead', ['0']);
        read('claimReserve', ['0']);
        read('stageCutoff', ['112']);
        read('lastCheckpointId', ['4']);
        commit(fixture.productionPoints[4]);
        pool('next stage uses its own later eligibility cutoff', 'settleCheckpoint');
        read('stageCutoff', ['144']);
        pool('deferred deposit remains at the newer economic price', 'activateDeposits', ['32'], { want: ['1'] });
        pool('deferred reward request now reserves in FIFO order', 'processQueue', ['32'], { want: ['1'] });
        read('claimable', [base(90)], [fixture.origin]);
        read('feeReserve', [base(10)]);
        read('rewardValue', ['0'], [newcomer]);
        read('pendingTotal', ['0']);
        read('queueHead', ['1']);
        return plan;
    }
    if (mode === 'reward-recovery-boundary' || mode === 'reward-recovery-expired') {
        read('stage', ['2']);
        read('poolRecoveryDeadlineSlot', ['4224']);
        commit(fixture.productionPoints[4]);
        read('poolRecoveryDeadlineSlot', ['4224']);
        const boundary = fixture.productionPoints[5];
        commit({ ...boundary, blocks: boundary.blocks.slice(0, 1) });
        read('poolRecoveryDeadlineSlot', ['4224']);
        read('poolStatus', ['0']);
        if (mode === 'reward-recovery-expired') {
            time(4225);
            read('poolStatus', ['2']);
            reject('processQueue', ['32'], 'normal actions unavailable');
            reject('settleCheckpoint', [], 'normal actions unavailable');
            read('lastCheckpointId', ['4']);
            pool('recovery is available directly from the superseded stage', 'beginRecovery', [], { from: newcomer });
            read('stage', ['0']);
            read('recovering', [true]);
            read('feeReserve', ['0']);
            reject('activateDeposits', ['32']);
            return plan;
        }
        pool('exact deadline refresh and queue completion are atomic', 'processQueue', ['32'], { want: ['0'] });
        read('poolRecoveryDeadlineSlot', ['8320']);
        read('lastCheckpointId', ['6']);
        read('stage', ['0']);
        return plan;
    }
    if (!executor) pool('remaining queue uses newest completed economics', 'processQueue', ['32']);
    read('lastCheckpointId', ['4']);
    read('stageCutoff', ['112']);
    read('stage', ['0']);
    reject('settleCheckpoint', [], 'checkpoint must advance');
    if (loss) {
        read('riskAssets', [base(31680)]);
        read('claimable', [base(19800)], [user]);
        read('positionValue', [base(29700)], [otherHolder]);
        read('positionValue', [base(1980)], [fixture.origin]);
        read('feeReserve', ['0']);
        pool('withdrawer bears exactly 200 QRL of proven loss', 'claim', [],
            { from: user, want: [base(19800)] });
        pool('reserved claim pays once', 'claim', [], { from: user, revert: '*' });
        plan.steps.push({ name: 'remaining cash belongs to remaining holders',
            op: 'balance', target: '@pool', value: base(31680) });
    } else {
        const oldShares = 52000n * U * S;
        const newShares = 52000n * U * oldShares / (57200n * U);
        const value = 109200n * U * newShares / (oldShares + newShares);
        read('positionValue', [String(value)], [newcomer]);
        read('rewardValue', ['0'], [newcomer]);
        read('positionValue', [base(55000)], [user]);
        read('positionValue', [base(2200)], [fixture.origin]);
        read('eligibleConsensusRewardBudget', [base(5200)]);
        // The boundary-only case has deliberately advanced beyond slot 144.
        if (mode === 'reward-fresh-boundary') return plan;
        pool('newcomer requests its admitted principal', 'requestWithdrawal', [max], { from: newcomer });
        commit(fixture.productionPoints[4]);
        pool('apply next cutoff after newcomer request', 'settleCheckpoint');
        pool('complete admission phase', 'activateDeposits', ['32']);
        pool('reserve newcomer at the unchanged price', 'processQueue', ['32']);
        read('claimable', [String(value)], [newcomer]);
        read('feeReserve', ['0']);
        pool('newcomer receives its principal with admission rounding', 'claim', [],
            { from: newcomer, want: [String(value)] });
        plan.steps.push({ name: 'newcomer captures zero pre-admission income', op: 'balance',
            target: newcomer, value: String(1000000n * U - 52000n * U + value) });
    }
    return plan;
}

module.exports = { build };
