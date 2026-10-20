const fs = require('node:fs');
const path = require('node:path');
const { witness, cash } = require('./make-plan');
const copy = value => structuredClone(value);
const flip = value => `0x${(parseInt(value.slice(2, 4), 16) ^ 1).toString(16).padStart(2, '0')}${value.slice(4)}`;
const base = value => String(BigInt(value) * 1000000000000000000n);

function build(fixture, output) {
    const steps = [];
    const origin = fixture.origin;
    const other = `Q${'22'.repeat(64)}`;
    const call = (name, target, method, args = [], extra = {}) => steps.push({ name, op: 'call', target, method, args, ...extra });
    const reject = (name, target, method, args = [], extra = {}) => call(name, target, method, args, { revert: '*', ...extra });
    const deploy = (id, artifact, args, extra = {}) => steps.push({ name: `deploy ${id}`, op: 'deploy', id,
        artifact: path.relative(path.dirname(output), path.resolve(__dirname, '../../build/native', artifact)), args, ...extra });
    deploy('anchor', 'FixtureFinality', ['64', fixture.initial.stateRoot, fixture.initialHeaderRoot]);
    deploy('depositCopy', 'CanonicalDeposit', [], { captureAllocation: true });
    steps.push({ name: 'explicit synthetic canonical predeployment from native constructor state',
        op: 'fixture-predeploy', id: 'deposit', source: '@depositCopy', target: fixture.canonicalDepositAddress });
    deploy('portfolio', 'NativePortfolioVerifier', ['@anchor', fixture.pool, fixture.gate]);
    call('test authority binds native fork domain', '@anchor', 'setSyncDomain', [fixture.syncDomain]);
    deploy('gate', 'NativeValidatorGate', ['@anchor', '@portfolio', fixture.pool, '@deposit', fixture.genesisValidatorsRoot, fixture.forkVersion, origin]);
    deploy('pool', 'GatePoolFixture', ['@gate', fixture.current.stateRoot], { value: base(40000) });
    deploy('wrongAddressGate', 'NativeValidatorGate', ['@anchor', '@portfolio', fixture.pool, '@depositCopy',
        fixture.genesisValidatorsRoot, fixture.forkVersion, origin], { revert: 'configuration' });
    deploy('zeroOperatorGate', 'NativeValidatorGate', ['@anchor', '@portfolio', fixture.pool, '@deposit',
        fixture.genesisValidatorsRoot, fixture.forkVersion, `Q${'00'.repeat(64)}`], { revert: 'configuration' });
    call('predicted immutable pool correct', '@gate', 'pool', [], { want: [fixture.pool] });
    call('exact native deposit domain', '@gate', 'depositDomain', [], { want: [fixture.depositDomain] });
    call('exact native exit domain', '@gate', 'exitDomain', [], { want: [fixture.exitDomain] });
    call('enrollment operator is immutable original fixture operator', '@gate', 'validatorOperator', [], { want: [origin] });
    reject('unrelated caller cannot enroll consensus keys using pooled exposure', '@gate', 'bootstrapValidator',
        [fixture.bootstrap], { from: other, value: base(2000), revert: 'bootstrap unavailable' });
    call('unauthorized enrollment leaves native deposit cursor unchanged', '@deposit', 'get_deposit_count', [], { want: ['0x0000000000000000'] });
    steps.push({ name: 'unauthorized enrollment leaves canonical contract unfunded', op: 'balance', target: '@deposit', value: '0' });
    steps.push({ name: 'unauthorized enrollment leaves no caller capital in gate', op: 'balance', target: '@gate', value: '0' });
    reject('bootstrap exact native minimum required', '@gate', 'bootstrapValidator', [fixture.bootstrap], { value: base(1999) });
    const badSignature = copy(fixture.bootstrap); badSignature.signature = flip(badSignature.signature);
    reject('bootstrap genuine native signature required', '@gate', 'bootstrapValidator', [badSignature], { value: base(2000) });
    call('operator funds canonical 2k bootstrap', '@gate', 'bootstrapValidator', [fixture.bootstrap], { value: base(2000) });
    call('native deposit cursor advances once', '@deposit', 'get_deposit_count', [], { want: ['0x0100000000000000'] });
    steps.push({ name: 'bootstrap is in canonical deposit contract', op: 'balance', target: '@deposit', value: base(2000) });
    steps.push({ name: 'gate keeps no bootstrap cash', op: 'balance', target: '@gate', value: '0' });
    reject('duplicate preparation cannot reassign original funder', '@gate', 'bootstrapValidator', [fixture.bootstrap], { from: other, value: base(2000) });
    reject('unsettled bootstrap cannot release user capital', '@gate', 'admitAndFundValidator', [witness(fixture.current.validators[0]), fixture.topup, fixture.exitSignature]);
    steps.push({ name: 'synthetic finalized admission slot 80', op: 'time', time: 1240 });
    call('test authority advances native bootstrap root', '@anchor', 'set', ['80', fixture.current.stateRoot, fixture.headerRoot]);
    call('authenticate pre-admission complete zero-registry portfolio', '@portfolio', 'beginCheckpoint', [cash(fixture.current, fixture.accountProof)]);
    call('authenticate complete pre-admission history', '@portfolio', 'appendBlocks', [fixture.blocks]);
    call('commit matched pre-admission root', '@portfolio', 'finalizeCheckpoint');
    reject('EOA cannot bypass immutable admission gate', '@portfolio', 'registerValidator', [witness(fixture.current.validators[0]), fixture.topup.publicKey]);
    reject('wrong public exit signature cannot authorize funding', '@gate', 'admitAndFundValidator', [witness(fixture.current.validators[0]), fixture.topup, flip(fixture.exitSignature)]);
    const wrongCommitment = copy(fixture.topup); wrongCommitment.randaoCommitment = flip(wrongCommitment.randaoCommitment);
    reject('changing RANDAO breaks prepared-key binding', '@gate', 'admitAndFundValidator', [witness(fixture.current.validators[0]), wrongCommitment, fixture.exitSignature]);
    const wrongDataRoot = copy(fixture.topup); wrongDataRoot.dataRoot = flip(wrongDataRoot.dataRoot);
    reject('native deposit rejection rolls back registration and funds', '@gate', 'admitAndFundValidator', [witness(fixture.current.validators[0]), wrongDataRoot, fixture.exitSignature]);
    call('failed native deposit leaves registry empty', '@portfolio', 'registryCount', [], { want: ['0'] });
    call('failed native deposit stores no public exit', '@gate', 'storedExit', ['0'], { want: [false, false, '0', '0x'] });
    steps.push({ name: 'failed funding preserves all pool capital', op: 'balance', target: '@pool', value: base(40000) });
    call('pool can reject unavailable liquidity atomically', '@pool', 'setRelease', [false]);
    reject('unavailable pool liquidity aborts whole admission', '@gate', 'admitAndFundValidator', [witness(fixture.current.validators[0]), fixture.topup, fixture.exitSignature]);
    call('restore fixture liquidity release', '@pool', 'setRelease', [true]);
    call('independent caller publishes exit and funds native validator', '@gate', 'admitAndFundValidator', [witness(fixture.current.validators[0]), fixture.topup, fixture.exitSignature], { from: other });
    call('bootstrap original payer receives accounting adoption', '@pool', 'adoptedBeneficiary', [], { want: [origin] });
    call('canonical recipient registered exactly once', '@portfolio', 'registryCount', [], { want: ['1'] });
    call('public exit remains available without signing key', '@gate', 'storedExit', ['0'], { want: [true, false, '0', fixture.exitSignature] });
    call('both real native deposits consumed by deposit contract', '@deposit', 'get_deposit_count', [], { want: ['0x0200000000000000'] });
    steps.push({ name: 'native deposit contract holds exact validator principal', op: 'balance', target: '@deposit', value: base(40000) });
    steps.push({ name: 'atomic gate retains no principal', op: 'balance', target: '@gate', value: '0' });
    steps.push({ name: 'pool released only exact 38000', op: 'balance', target: '@pool', value: base(2000) });
    call('one pool-funded deposit recorded', '@gate', 'fundingCount', [], { want: ['1'] });
    call('native global deposit index recorded separately from validator index', '@gate', 'fundingRecord', ['0'], { want: ['2', '1'] });
    call('funding absent before its execution cutoff', '@gate', 'inFlightAt', ['1', '0'], { want: ['0'] });
    call('unconsumed deposit accounted as in-flight once', '@gate', 'inFlightAt', ['2', '1'], { want: [base(38000)] });
    call('consumed deposit excluded from in-flight assets', '@gate', 'inFlightAt', ['2', '2'], { want: ['0'] });
    reject('already admitted principal cannot be released again', '@gate', 'admitAndFundValidator', [witness(fixture.current.validators[0]), fixture.topup, fixture.exitSignature]);
    reject('exit work requires withdrawal or recovery demand', '@gate', 'requestNextExit');
    call('fixture creates user exit demand', '@pool', 'addExitWork');
    call('independent caller requests first deterministic exit', '@gate', 'requestNextExit', [], { from: other, want: ['0'] });
    call('exit request leaves public signature unchanged', '@gate', 'storedExit', ['0'], { want: [true, true, '0', fixture.exitSignature] });
    reject('same validator cannot occupy two exit work positions', '@gate', 'requestNextExit');
    return { origin, accounts: { [origin]: base(1000000), [other]: base(10000) }, time: 1192, steps };
}
if (require.main === module) {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('usage: node native/proofs/make-gate-plan.js FIXTURE OUTPUT');
    const plan = build(JSON.parse(fs.readFileSync(input)), path.resolve(output));
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify({ steps: plan.steps.length, output }));
}
module.exports = { build };
