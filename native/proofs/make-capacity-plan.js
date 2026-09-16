const path = require('node:path');
const { witness, cash } = require('./make-plan');
const { build: gatePlan } = require('./make-gate-plan');

function build(fixture, output, mode = 'registry') {
    if (mode === 'gate') {
        const plan = gatePlan(fixture, output);
        plan.steps = plan.steps.slice(0, plan.steps.findIndex(step => step.method === 'bootstrapValidator'));
        const portfolio = plan.steps.find(step => step.id === 'portfolio');
        portfolio.artifact = portfolio.artifact.replace(/NativePortfolioVerifier$/, 'GateCapacityFixture');
        portfolio.name = 'explicit synthetic full-registry input for real gate capacity guard';
        plan.steps.push({ name: 'full lifetime registry rejects new operator preparation before accepting QRL',
            op: 'call', target: '@gate', method: 'bootstrapValidator', args: [fixture.bootstrap],
            value: String(2000n * 10n ** 18n), revert: 'bootstrap unavailable' });
        plan.steps.push({ name: 'capacity rejection leaves native deposit cursor unchanged', op: 'call',
            target: '@deposit', method: 'get_deposit_count', args: [], want: ['0x0000000000000000'] });
        plan.steps.push({ name: 'capacity rejection leaves canonical contract unfunded', op: 'balance', target: '@deposit', value: '0' });
        plan.steps.push({ name: 'capacity rejection retains no operator principal', op: 'balance', target: '@gate', value: '0' });
        return plan;
    }
    const steps = [];
    const call = (name, method, args = [], extra = {}) => steps.push({ name, op: 'call', target: '@portfolio', method, args, ...extra });
    const deploy = (id, artifact, args) => steps.push({ name: `deploy capacity fixture ${id}`, op: 'deploy', id,
        artifact: path.relative(path.dirname(output), path.resolve(__dirname, '../../build/native', artifact)), args });
    deploy('anchor', 'FixtureFinality', ['64', fixture.initial.stateRoot, fixture.initialHeaderRoot]);
    deploy('portfolio', 'NativePortfolioVerifier', ['@anchor', fixture.pool, fixture.origin]);
    for (let index = 0; index < 64; index++) {
        const value = fixture.initial.validators[index];
        call(`authenticate lifetime validator admission ${index + 1}`, 'registerValidator', [witness(value), value.publicKey]);
    }
    call('exactly 64 authenticated lifetime registrations accepted', 'registryCount', [], { want: ['64'] });
    const extra = fixture.initial.validators[64];
    call('65th canonical validator cannot exceed lifetime capacity', 'registerValidator', [witness(extra), extra.publicKey], { revert: 'registry bound' });
    call('rejected admission leaves index unregistered', 'indexPositionPlusOne', ['64'], { want: ['0'] });
    steps.push({ name: 'synthetic terminal checkpoint time', op: 'time', time: 1288 });
    steps.push({ name: 'synthetic terminal execution cutoff', op: 'block', value: '97' });
    steps.push({ name: 'synthetic authority supplies native terminal state root', op: 'call', target: '@anchor', method: 'set',
        args: ['96', fixture.terminal.stateRoot, fixture.terminalHeaderRoot] });
    call('start complete full-capacity terminal portfolio', 'beginCheckpoint', [cash(fixture.terminal, fixture.accountProof)]);
    for (let start = 0; start < 64; start += 4) {
        call(`prove complete capacity portfolio positions ${start} through ${start + 3}`, 'appendValidators',
            [fixture.terminal.validators.slice(start, start + 4).map(witness)]);
    }
    call('prove full native interval for terminal portfolio', 'appendBlocks', [fixture.blocks]);
    call('commit actual capacity portfolio state', 'finalizeCheckpoint');
    call('one canonical terminal-zero record is authenticated', 'terminalValidatorCount', [], { want: ['1'] });
    call('terminal records continue consuming lifetime capacity', 'registryCount', [], { want: ['64'] });
    const terminalExtra = fixture.terminal.validators[64];
    call('terminal-zero observation cannot reopen admission capacity', 'registerValidator',
        [witness(terminalExtra), terminalExtra.publicKey], { revert: 'registry bound' });
    return { origin: fixture.origin, accounts: { [fixture.origin]: '0' }, time: 1192, steps };
}

module.exports = { build };
