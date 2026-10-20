// Executable admission checks in the actual go-qrl QRVM, using a synthetic
// Qrysm bootstrap checkpoint and real public ML-DSA deposit/exit signatures.
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const origin = `Q${'11'.repeat(64)}`;
const independent = `Q${'22'.repeat(64)}`;
const operator = `Q${'33'.repeat(64)}`;
const contributor = `Q${'44'.repeat(64)}`;
const qrl = value => (BigInt(value) * 10n ** 18n).toString();
const address = value => value.startsWith('0x') ? `Q${value.slice(2)}` : value;
const copy = value => structuredClone(value);
const fields = [
    'index', 'publicKeyRoot', 'withdrawalRecipient', 'effectiveBalance', 'slashed',
    'activationEligibilityEpoch', 'activationEpoch', 'exitEpoch', 'withdrawableEpoch',
    'randaoCommitment', 'validatorBranch', 'balanceChunk', 'balanceBranch'
];
const witness = value => Object.fromEntries(fields.map(field => [field, copy(value[field])]));
const flip = value => {
    const bytes = Buffer.from(value.slice(2), 'hex');
    bytes[0] ^= 1;
    return `0x${bytes.toString('hex')}`;
};

function buildPlan(fixture, artifactDirectory, output) {
    if (fixture.schemaVersion !== 1 || fixture.candidates.length !== 2) {
        throw new Error('Unexpected funding fixture schema');
    }
    const checkpoint = fixture.checkpoint;
    const good = fixture.candidates[0];
    const foreign = fixture.candidates[1];
    const artifact = name => path.relative(path.dirname(output), path.join(artifactDirectory, name));
    const steps = [];
    const call = (name, target, method, args, extra = {}) => steps.push({
        name, op: 'call', target, method, args, ...extra
    });
    const balance = (name, target, amount) => steps.push({ name, op: 'balance', target, value: qrl(amount) });
    const funding = candidate => ({
        publicKey: candidate.topUp.publicKey,
        randaoCommitment: candidate.topUp.randaoCommitment,
        depositSignature: candidate.topUp.signature,
        depositDataRoot: candidate.topUp.dataRoot,
        exitEpoch: candidate.exitEpoch,
        exitSignature: candidate.exitSignature
    });
    const args = (candidate = good) => [
        '0', copy(checkpoint.slotBranch),
        witness(checkpoint.validators.find(value => value.index === candidate.index)),
        funding(candidate)
    ];
    const rejects = (name, change = value => value, extra = {}) => {
        call(name, '@gate', 'fund', change(args()), { from: contributor, value: qrl(38000), revert: '*', ...extra });
    };

    steps.push({ name: 'deploy unmodified current Qrysm deposit contract', op: 'deploy', id: 'beacon', artifact: artifact('DepositContract'), args: [] });
    steps.push({
        name: 'deploy immutable synthetic bootstrap checkpoint harness', op: 'deploy', id: 'proof', artifact: artifact('CheckpointProofHarness'),
        args: [[checkpoint.stateRoot], [checkpoint.slot], '0', '6', '128', '128', address(fixture.poolRecipient), [good.index], [checkpoint.validators[0].publicKeyRoot]]
    });
    steps.push({
        name: 'deploy atomic funding and public-exit gate at precommitted recipient', op: 'deploy', id: 'gate', artifact: artifact('FundingGatePrototype'),
        args: ['@proof', '@beacon', fixture.exitDomain, fixture.depositDomain]
    });
    call('pool recipient equals actual predicted gate address', '@proof', 'poolRecipient', [], { want: ['@gate'] });

    for (const candidate of fixture.candidates) {
        const d = candidate.bootstrap;
        call(`operator pays 2000 QRL bootstrap for ${candidate.name}`, '@beacon', 'deposit', [
            d.publicKey, d.withdrawalRecipient, d.randaoCommitment, d.signature, d.dataRoot
        ], { from: operator, value: qrl(2000) });
    }
    balance('bootstrap consumed operator fixture capital', operator, 0);
    balance('both bootstrap deposits reached current deposit contract', '@beacon', 4000);
    call('five-field RANDAO deposits increment count', '@beacon', 'get_deposit_count', [], { want: ['0x0200000000000000'] });
    call('empty exit storage before pooled funding', '@gate', 'storedExit', [good.index], { want: [false, '0', '0x'] });
    call('existing other-recipient candidate cannot release pooled QRL', '@gate', 'fund', args(foreign), { from: contributor, value: qrl(38000), revert: '*' });
    rejects('changing submitted recipient cannot replace canonical recipient', () => {
        const value = args(foreign);
        value[2].withdrawalRecipient = fixture.poolRecipient;
        return value;
    });
    rejects('wrong pooled amount cannot fund', value => value, { value: qrl(37999) });
    rejects('missing public exit cannot fund', value => { value[3].exitSignature = '0x'; return value; });
    rejects('wrong exit signature cannot fund', value => { value[3].exitSignature = flip(value[3].exitSignature); return value; });
    rejects('another validator exit cannot fund', value => { value[3].exitSignature = foreign.exitSignature; return value; });
    rejects('genuinely signed far-future exit cannot postpone release indefinitely', value => {
        value[3].exitEpoch = good.futureExitEpoch;
        value[3].exitSignature = good.futureExitSignature;
        return value;
    });
    rejects('wrong public key fails canonical identity binding', value => { value[3].publicKey = foreign.topUp.publicKey; return value; });
    rejects('changed canonical index fails proof', value => { value[2].index = foreign.index; return value; });
    rejects('RANDAO commitment must match proven validator', value => { value[3].randaoCommitment = flip(value[3].randaoCommitment); return value; });
    rejects('invalid deposit signature cannot release pooled QRL', value => { value[3].depositSignature = flip(value[3].depositSignature); return value; });
    rejects('unmodified deposit contract rejects incorrect five-field data root', value => { value[3].depositDataRoot = flip(value[3].depositDataRoot); return value; });
    call('failed external deposit rolls back public exit storage', '@gate', 'storedExit', [good.index], { want: [false, '0', '0x'] });
    balance('all failed admission calls preserve pooled contributor funds', contributor, 76000);
    balance('failed admission calls leave only operator bootstrap at beacon', '@beacon', 4000);
    balance('failed admission calls leave no QRL at gate', '@gate', 0);

    call('verified canonical recipient and public exit release exactly 38000 QRL', '@gate', 'fund', args(), { from: contributor, value: qrl(38000) });
    call('independent caller retrieves complete public exit authorization', '@gate', 'storedExit', [good.index], { from: independent, want: [true, good.exitEpoch, good.exitSignature] });
    call('top-up used current five-argument deposit ABI', '@beacon', 'get_deposit_count', [], { want: ['0x0300000000000000'] });
    balance('actual beacon contract holds 40000 for selected key plus unrelated bootstrap', '@beacon', 42000);
    balance('contributor paid exactly the approved top-up', contributor, 38000);
    balance('funding gate retains no pooled QRL', '@gate', 0);
    rejects('reusing old bootstrap proof cannot fund validator twice');
    balance('duplicate admission preserves contributor remainder', contributor, 38000);
    balance('duplicate admission preserves deposit contract balance', '@beacon', 42000);
    call('duplicate admission preserves available public exit', '@gate', 'storedExit', [good.index], { from: independent, want: [true, good.exitEpoch, good.exitSignature] });

    return {
        origin,
        accounts: { [origin]: qrl(1), [operator]: qrl(4000), [contributor]: qrl(76000), [independent]: qrl(1) },
        time: Number(BigInt(checkpoint.slot) * 6n),
        steps
    };
}

if (require.main === module) {
    const fixturePath = path.resolve(process.argv[2] || path.join(repo, 'build/prototype/funding-fixture.json'));
    const artifacts = path.resolve(process.argv[3] || path.join(repo, 'build/prototype'));
    const output = path.resolve(process.argv[4] || path.join(repo, 'build/prototype/funding-plan.json'));
    const plan = buildPlan(JSON.parse(fs.readFileSync(fixturePath, 'utf8')), artifacts, output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`Wrote ${plan.steps.length} funding checks for actual go-qrl QRVM and synthetic checkpoint trust anchor.`);
}

module.exports = { buildPlan };
