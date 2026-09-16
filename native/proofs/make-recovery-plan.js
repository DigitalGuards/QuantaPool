// Actual pool/gate bytecode with explicitly synthetic finality and native state.
const { build: adapter } = require('./make-adapter-plan');
const { witness, cash } = require('./make-plan');
const U = 10n ** 18n;
const SHARES = 10n ** 27n;
const BASIS = 10n ** 54n;
const amount = value => String(BigInt(value) * U);
const ceil = (n, d) => (n + d - 1n) / d;

function build(fixture, output, mode = 'claims') {
    const plan = adapter(fixture, output, { stageRace: false });
    const user = `Q${'22'.repeat(64)}`;
    const pendingUser = `Q${'33'.repeat(64)}`;
    plan.accounts[pendingUser] = amount(1000);
    let steps = plan.steps;
    const call = (name, target, method, args = [], extra = {}) => steps.push({ name, op: 'call', target, method, args, ...extra });
    const pool = (name, method, args = [], extra = {}) => call(name, '@pool', method, args, extra);
    const reject = (name, target, method, args = [], extra = {}) => call(name, target, method, args, { revert: '*', ...extra });
    function time(slot, block) {
        steps.push({ name: `synthetic native slot ${slot}`, op: 'time', time: 1000 + slot * 3 });
        if (block) steps.push({ name: `synthetic execution cutoff available ${block}`, op: 'block', value: String(block) });
    }
    function fresh(slot, point = fixture.productionPoints[3]) {
        call('synthetic finality remains independently healthy', '@anchor', 'set', [String(slot), point.state.stateRoot, point.headerRoot]);
        call('global finality status remains zero', '@anchor', 'status', [], { want: ['0'] });
    }
    function portfolio(point) {
        call('begin complete newer portfolio', '@portfolio', 'beginCheckpoint', [cash(point.state, point.accountProof)]);
        call('authenticate registered validator balance', '@portfolio', 'appendValidators', [[witness(point.state.validators[0])]]);
        call('authenticate complete native interval', '@portfolio', 'appendBlocks', [point.blocks]);
        call('commit complete newer portfolio', '@portfolio', 'finalizeCheckpoint');
    }
    function expired() {
        pool('pool accounting timeout is independently irreversible', 'poolStatus', [], { want: ['2'] });
        reject('expired pool cannot accept user capital', '@pool', 'deposit', [], { from: user, value: amount(1) });
        reject('expired pool cannot settle even a complete fresh snapshot', '@pool', 'settleCheckpoint');
        reject('expired pool cannot accept operator preparation capital', '@gate', 'bootstrapValidator', [fixture.bootstrap], { value: amount(2000) });
    }
    if (mode === 'initial') {
        steps = plan.steps = steps.slice(0, steps.findIndex(step => step.method === 'deposit'));
        pool('initial accounting anchor is constructor checkpoint', 'initialPoolCheckpointSlot', [], { want: ['64'] });
        pool('pool window is immutable finality window', 'poolRecoveryWindowSlots', [], { want: ['4096'] });
        pool('initial deadline before first pool settlement', 'poolRecoveryDeadlineSlot', [], { want: ['4160'] });
        pool('unadmitted user capital remains refundable', 'deposit', [], { from: user, value: amount(17) });
        time(4160); fresh(4160);
        pool('exact deadline still permits normal requests', 'poolStatus', [], { want: ['0'] });
        pool('exact deadline accepts refundable pending capital', 'deposit', [], { from: user, value: amount(1) });
        time(4161); fresh(4161); expired();
        pool('any caller begins recovery without first settlement', 'beginRecovery', [], { from: pendingUser });
        pool('refund first pending principal', 'cancelPending', ['0'], { from: user });
        pool('refund boundary pending principal', 'cancelPending', ['1'], { from: user });
        pool('all unadmitted principal returned', 'pendingTotal', [], { want: ['0'] });
        steps.push({ name: 'initial timeout leaves no pool cash', op: 'balance', target: '@pool', value: '0' });
        time(4200); fresh(4200);
        pool('later healthy finality cannot reopen recovery', 'poolStatus', [], { want: ['2'] });
        reject('recovery cannot be initialized twice', '@pool', 'beginRecovery');
        return plan;
    }
    pool('applied checkpoint renews only pool-specific deadline', 'poolRecoveryDeadlineSlot', [], { want: ['4224'] });
    const [rewardPoint, boundaryPoint] = fixture.productionPoints.slice(4);
    if (mode === 'boundary' || mode === 'portfolio-only') {
        steps.push({ name: 'synthetic native reward withdrawal credit', op: 'withdrawal-credit', target: '@pool', value: amount(1000) });
        time(4224, 4225); fresh(4224, boundaryPoint); portfolio(boundaryPoint);
        pool('complete portfolio alone does not renew pool deadline', 'poolRecoveryDeadlineSlot', [], { want: ['4224'] });
        pool('exact deadline remains eligible before settlement', 'poolStatus', [], { want: ['0'] });
        if (mode === 'boundary') {
            pool('fresh complete snapshot applies at exact deadline', 'settleCheckpoint');
            pool('successful complete application renews deadline', 'poolRecoveryDeadlineSlot', [], { want: ['8320'] });
            pool('complete boundary admission stage', 'activateDeposits', ['32']);
            pool('complete boundary withdrawal stage', 'processQueue', ['32']);
            time(4225);
            pool('renewed deadline supports later normal operation', 'poolStatus', [], { want: ['0'] });
        } else {
            time(4225); expired();
            pool('failed late settlement preserves last applied checkpoint', 'lastCheckpointId', [], { want: ['4'] });
            pool('unapplied complete portfolio cannot postpone recovery', 'beginRecovery');
            pool('recovery does not charge unclassified late income', 'feeReserve', [], { want: ['0'] });
        }
        return plan;
    }
    pool('user requests a liquid partial native withdrawal', 'requestWithdrawal', [amount(1000)], { from: user });
    steps.push({ name: 'synthetic native reward withdrawal credit', op: 'withdrawal-credit', target: '@pool', value: amount(1000) });
    time(144, 145); fresh(144, rewardPoint); portfolio(rewardPoint);
    pool('new pending principal is outside historical cutoff', 'deposit', [], { from: pendingUser, value: amount(17) });
    pool('apply complete reward checkpoint', 'settleCheckpoint');
    pool('newer pending deposit waits beyond cutoff', 'activateDeposits', ['32']);
    if (mode === 'staged') {
        time(4241); fresh(4241); expired();
        reject('expired staging cannot reserve a withdrawal', '@pool', 'processQueue', ['32']);
        pool('expired staging reserved no additional cash', 'claimReserve', [], { want: ['0'] });
        pool('anyone can abandon expired stage', 'abortStaging', [], { from: pendingUser });
        pool('staged pool can enter irreversible recovery', 'beginRecovery', [], { from: pendingUser });
        pool('staged timeout preserves unadmitted principal', 'cancelPending', ['1'], { from: pendingUser });
        return plan;
    }
    pool('reserve native withdrawal and deterministic earned fee', 'processQueue', ['32']);
    const totalShares = 52000n * U * SHARES;
    const userShares = 50000n * U * SHARES;
    const burned = ceil(1000n * U * totalShares, 56000n * U);
    const principalUsed = 50000n * U * burned / userShares;
    const accGift = ceil(3000n * U * BASIS, totalShares);
    const feeBasis = 50000n * U + ceil(userShares * accGift, BASIS);
    const feeBasisUsed = ceil(feeBasis * burned, userShares);
    const taxable = 1000n * U - feeBasisUsed;
    const fee = taxable / 10n;
    if (fee <= 0n || taxable > 1000n * U - principalUsed) throw new Error('invalid independent fee expectation');
    pool('earned fee exists before pool timeout', 'feeReserve', [], { want: [String(fee)] });
    pool('user cash reserve excludes only earned fee', 'claimReserve', [], { want: [String(1000n * U - fee)] });
    time(4241); fresh(4241); expired();
    pool('independent caller begins accounting-timeout recovery', 'beginRecovery', [], { from: pendingUser });
    pool('already reserved user claim survives timeout', 'claim', [], { from: user });
    pool('already earned fee remains payable to immutable beneficiary', 'claimFees', [], { from: pendingUser });
    pool('pending principal refund survives timeout', 'cancelPending', ['1'], { from: pendingUser });
    const frozen = totalShares - burned;
    const remainingUser = userShares - burned;
    const operator = totalShares - userShares;
    const earlyUser = 13000n * U * remainingUser / frozen;
    const earlyOperator = 13000n * U * operator / frozen;
    pool('user recovers its frozen share of initial cash', 'claimRecovery', [], { from: user, want: [String(earlyUser)] });
    pool('operator principal has ordinary frozen recovery weight', 'claimRecovery', [], { want: [String(earlyOperator)] });
    steps.push({ name: 'explicit synthetic late validator withdrawal', op: 'withdrawal-credit', target: '@pool', value: amount(42000) });
    const laterUser = 55000n * U * remainingUser / frozen;
    const laterOperator = 55000n * U * operator / frozen;
    pool('late native cash preserves user recovery rights', 'claimRecovery', [], { from: user, want: [String(laterUser - earlyUser)] });
    pool('late native cash preserves operator principal rights', 'claimRecovery', [], { want: [String(laterOperator - earlyOperator)] });
    pool('late receipts earn no additional fee', 'totalFeesPaid', [], { want: [String(fee)] });
    pool('late receipts create no fee reserve', 'feeReserve', [], { want: ['0'] });
    reject('repeated recovery claim cannot double pay', '@pool', 'claimRecovery', [], { from: user });
    steps.push({ name: 'recovery residue is exact native rounding dust', op: 'balance', target: '@pool', value: String(55000n * U - laterUser - laterOperator) });
    return plan;
}

module.exports = { build };
