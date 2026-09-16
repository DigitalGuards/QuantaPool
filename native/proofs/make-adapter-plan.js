const fs = require('node:fs');
const path = require('node:path');
const { witness, cash } = require('./make-plan');
const base = value => String(BigInt(value) * 1000000000000000000n);

function build(fixture, output, { stageRace = true } = {}) {
    const steps = [];
    const origin = fixture.origin;
    const user = `Q${'22'.repeat(64)}`;
    const call = (name, target, method, args = [], extra = {}) => steps.push({ name, op: 'call', target, method, args, ...extra });
    const reject = (name, target, method, args = [], extra = {}) => call(name, target, method, args, { revert: '*', ...extra });
    const deploy = (id, artifact, args, extra = {}) => steps.push({ name: `deploy real adapter ${id}`, op: 'deploy', id,
        artifact: path.relative(path.dirname(output), path.resolve(__dirname, '../../build/native', artifact)), args, ...extra });
    const [admission, inFlight, consumed, exempt] = fixture.productionPoints;
    deploy('anchor', 'FixtureFinality', ['64', fixture.initial.stateRoot, fixture.initialHeaderRoot]);
    deploy('depositCopy', 'CanonicalDeposit', [], { captureAllocation: true });
    steps.push({ name: 'explicit synthetic canonical predeployment from native constructor state',
        op: 'fixture-predeploy', id: 'deposit', source: '@depositCopy', target: fixture.canonicalDepositAddress });
    deploy('portfolio', 'NativePortfolioVerifier', ['@anchor', fixture.pool, fixture.gate]);
    call('synthetic authority native-domain binding', '@anchor', 'setSyncDomain', [fixture.syncDomain]);
    deploy('gate', 'NativeValidatorGate', ['@anchor', '@portfolio', fixture.pool, '@deposit', fixture.genesisValidatorsRoot, fixture.forkVersion, origin]);
    deploy('pool', 'NativeQrlPool', ['@anchor', '@portfolio', '@gate', origin, base(1)]);
    deploy('wrongAddressGate', 'NativeValidatorGate', ['@anchor', '@portfolio', fixture.pool, '@depositCopy',
        fixture.genesisValidatorsRoot, fixture.forkVersion, origin], { revert: 'configuration' });
    reject('operator cannot call real pool capital-release hook', '@pool', 'adoptAndReleaseBootstrap', [origin]);
    call('real user deposits native QRL before cutoff', '@pool', 'deposit', [], { from: user, value: base(50000), want: ['0'] });
    call('operator separately funds real native bootstrap', '@gate', 'bootstrapValidator', [fixture.bootstrap], { value: base(2000) });
    reject('unpriced user deposits cannot fund validator', '@gate', 'admitAndFundValidator', [witness(admission.state.validators[0]), fixture.topup, fixture.exitSignature]);

    let precommitted = false;
    function settle(point, registered) {
        const slot = Number(point.state.slot);
        const alreadyCommitted = stageRace && precommitted && point === consumed;
        if (!alreadyCommitted) {
        steps.push({ name: `advance synthetic time to finalized slot ${slot}`, op: 'time', time: 1000 + slot * 3 });
        steps.push({ name: `live execution block after cutoff ${slot}`, op: 'block', value: String(slot + 1) });
        call(`synthetic authority supplies canonical root ${slot}`, '@anchor', 'set', [point.state.slot, point.state.stateRoot, point.headerRoot]);
        call(`start matched portfolio ${slot}`, '@portfolio', 'beginCheckpoint', [cash(point.state, point.accountProof)]);
        if (registered) call(`prove complete registered balance ${slot}`, '@portfolio', 'appendValidators', [[witness(point.state.validators[0])]]);
        call(`prove complete interval ${slot}`, '@portfolio', 'appendBlocks', [point.blocks]);
        call(`commit complete portfolio ${slot}`, '@portfolio', 'finalizeCheckpoint');
        }
        call(`real pool settles matched portfolio ${slot}`, '@pool', 'settleCheckpoint');
        if (stageRace && point === inFlight) {
            steps.push({ name: 'new finality arrives during older ledger staging', op: 'time', time: 1000 + Number(consumed.state.slot) * 3 });
            steps.push({ name: 'newer execution cutoff becomes available during staging', op: 'block', value: String(Number(consumed.state.slot) + 1) });
            call('synthetic authority advances while old ledger stage remains open', '@anchor', 'set', [consumed.state.slot, consumed.state.stateRoot, consumed.headerRoot]);
            call('permissionless portfolio begins a newer matched snapshot', '@portfolio', 'beginCheckpoint', [cash(consumed.state, consumed.accountProof)]);
            call('newer complete validator proofs while old ledger stage remains open', '@portfolio', 'appendValidators', [[witness(consumed.state.validators[0])]]);
            call('newer complete native history while old ledger stage remains open', '@portfolio', 'appendBlocks', [consumed.blocks]);
            call('newer portfolio can finalize independently of old ledger stage', '@portfolio', 'finalizeCheckpoint');
            call('portfolio advanced to third checkpoint', '@portfolio', 'snapshotId', [], { want: ['3'] });
            call('old ledger remains explicitly bound to second checkpoint', '@pool', 'lastCheckpointId', [], { want: ['2'] });
            call('old ledger keeps its original applied slot', '@pool', 'appliedSlot', [], { want: ['96'] });
            reject('new snapshot cannot overwrite unfinished ledger staging', '@pool', 'settleCheckpoint');
            precommitted = true;
        }
        call(`real pool activates eligible deposits ${slot}`, '@pool', 'activateDeposits', ['4']);
        call(`real pool completes deterministic queue stage ${slot}`, '@pool', 'processQueue', ['4']);
    }
    settle(admission, false);
    call('real user principal activated at matched cash price', '@pool', 'positionValue', [user], { want: [base(50000)] });
    call('pre-admission classified reward budget zero', '@pool', 'eligibleConsensusRewardBudget', [], { want: ['0'] });
    call('real pool admits prepared operator principal and funds validator', '@gate', 'admitAndFundValidator', [witness(admission.state.validators[0]), fixture.topup, fixture.exitSignature], { from: user });
    call('real operator receives exactly its 2k capital position', '@pool', 'positionValue', [origin], { want: [base(2000)] });
    call('user principal remains 50k after validator funding', '@pool', 'positionValue', [user], { want: [base(50000)] });
    call('native portfolio risk includes both funders exactly once', '@pool', 'riskAssets', [], { want: [base(52000)] });
    steps.push({ name: 'real pool cash fell by exact38k', op: 'balance', target: '@pool', value: base(12000) });
    steps.push({ name: 'canonical native contract holds full 40k', op: 'balance', target: '@deposit', value: base(40000) });
    reject('new registry prevents stale zero-registry settlement', '@pool', 'settleCheckpoint');
    settle(inFlight, true);
    call('in-flight asset bridges execution/beacon cutoffs', '@pool', 'riskAssets', [], { want: [base(52000)] });
    call('paired cursor leaves 38k explicitly in-flight', '@gate', 'inFlightAt', ['96', '1'], { want: [base(38000)] });
    call('operator bootstrap admission produces no fee entitlement', '@pool', 'eligibleConsensusRewardBudget', [], { want: ['0'] });
    settle(consumed, true);
    if (stageRace) {
        call('newer snapshot consumed exactly once after old stage closes', '@pool', 'lastCheckpointId', [], { want: ['3'] });
        reject('same newer snapshot cannot settle twice', '@pool', 'settleCheckpoint');
    }
    call('consumed funding leaves aggregate principal unchanged', '@pool', 'riskAssets', [], { want: [base(52000)] });
    call('consumed funding disappears from in-flight assets', '@gate', 'inFlightAt', ['112', '2'], { want: ['0'] });
    call('native validator funding cannot become operator reward', '@pool', 'eligibleConsensusRewardBudget', [], { want: ['0'] });
    call('third party tops up registered key through native contract', '@deposit', 'deposit', [fixture.bootstrap.publicKey,
        `0x${fixture.pool.slice(1)}`, fixture.bootstrap.randaoCommitment, fixture.bootstrap.signature, fixture.bootstrap.dataRoot], { from: user, value: base(2000) });
    steps.push({ name: 'explicit artificial unrelated native cash credit', op: 'withdrawal-credit', target: '@pool', value: base(1000) });
    settle(exempt, true);
    call('all economically available external value reconciles', '@pool', 'riskAssets', [], { want: [base(55000)] });
    call('third-party validator funding and unrelated cash are fee-exempt', '@pool', 'eligibleConsensusRewardBudget', [], { want: ['0'] });
    call('operator fee reserve contains no user principal', '@pool', 'feeReserve', [], { want: ['0'] });
    call('no unearned operator fees accrued', '@pool', 'claimReserve', [], { want: ['0'] });
    call('external registered deposit count is globally canonical', '@deposit', 'get_deposit_count', [], { want: ['0x0300000000000000'] });
    steps.push({ name: 'gate ends with zero user assets', op: 'balance', target: '@gate', value: '0' });
    steps.push({ name: 'real pool liquid cash matches paired cutoff', op: 'balance', target: '@pool', value: base(13000) });
    return { origin, accounts: { [origin]: base(1000000), [user]: base(1000000) }, time: 1192, steps };
}
if (require.main === module) {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('usage: node native/proofs/make-adapter-plan.js FIXTURE OUTPUT');
    const plan = build(JSON.parse(fs.readFileSync(input)), path.resolve(output));
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify({ steps: plan.steps.length, output }));
}
module.exports = { build };
