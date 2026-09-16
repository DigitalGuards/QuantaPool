// Reproducible offline native-proof and validator-gate component qualification.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compileSources } = require('../../scripts/compile-hyperion');
const { build: portfolioPlan } = require('./make-plan');
const { build: gatePlan } = require('./make-gate-plan');
const { build: adapterPlan } = require('./make-adapter-plan');
const { build: recoveryPlan } = require('./make-recovery-plan');
const { build: capacityPlan } = require('./make-capacity-plan');

const repo = path.resolve(__dirname, '../..');
const output = path.join(repo, 'findings/native-proof-tests');
const artifacts = path.join(repo, 'build/native');
const compiler = process.env.HYPERION_COMPILER || process.env.HYPC_BIN ||
    path.join(repo, 'findings/native-network-20260915/sources/hyperion/build/hypc/hypc');
fs.mkdirSync(output, { recursive: true });
// This checks the compiler binary hash and enforces the real runtime size limit.
compileSources();
execFileSync(compiler, ['--abi', '--bin', '--bin-runtime', '--optimize', '--optimize-runs=1', '--via-ir',
    '--base-path', __dirname, '--output-dir', artifacts, '--overwrite',
    path.join(__dirname, 'FixtureFinality.hyp'), path.join(__dirname, 'GatePoolFixture.hyp'),
    path.join(__dirname, 'GateCapacityFixture.hyp')], { stdio: 'inherit' });
const environment = { ...process.env, GOWORK: 'off', GOMAXPROCS: '2' };
execFileSync('go', ['build', '-mod=readonly', '-p=2', '-o', path.join(artifacts, 'execution'), '.'], {
    cwd: path.join(repo, 'native/testing/execution'), env: environment, stdio: 'inherit' });
execFileSync('go', ['test', '-mod=readonly', '-p=2', '-count=1', './...'], {
    cwd: __dirname,
    env: { ...environment, QUANTAPOOL_PORTFOLIO_FIXTURE: path.join(output, 'portfolio-fixtures.json'),
        QUANTAPOOL_GATE_FIXTURE: path.join(output, 'gate-fixture.json'),
        QUANTAPOOL_CAPACITY_FIXTURE: path.join(output, 'capacity-fixture.json'), QUANTAPOOL_NATIVE_DEPOSIT_ARTIFACT: artifacts },
    stdio: 'inherit'
});
const reports = [];
for (const [name, fixtureName, build] of [['portfolio', 'portfolio-fixtures', portfolioPlan],
    ['gate', 'gate-fixture', gatePlan], ['adapter', 'gate-fixture', adapterPlan],
    ['capacity-registry', 'capacity-fixture', capacityPlan],
    ['capacity-gate', 'gate-fixture', (fixture, destination) => capacityPlan(fixture, destination, 'gate')],
    ...['initial', 'boundary', 'portfolio-only', 'staged', 'claims'].map(mode =>
        [`recovery-${mode}`, 'gate-fixture', (fixture, destination) => recoveryPlan(fixture, destination, mode)])]) {
    const planPath = path.join(output, `${name}-plan.json`);
    const reportPath = path.join(output, `${name}-report.json`);
    const plan = build(JSON.parse(fs.readFileSync(path.join(output, `${fixtureName}.json`))), planPath);
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const result = execFileSync(path.join(artifacts, 'execution'), ['-plan', planPath, '-report', reportPath], { encoding: 'utf8' });
    fs.writeFileSync(path.join(output, `${name}-run.log`), result);
    const report = JSON.parse(fs.readFileSync(reportPath));
    reports.push({ name, steps: report.steps.length, expectedReverts: report.steps.filter(step => step.expectedRevert).length,
        maximumGasBeforeRefund: Math.max(...report.steps.map(step => step.gasBeforeRefund)) });
}
const executorResult = execFileSync(process.execPath, [path.join(__dirname, 'run-executor.js'),
    path.join(output, 'gate-fixture.json')], { cwd: repo, encoding: 'utf8' });
fs.writeFileSync(path.join(output, 'executor-run.log'), executorResult);
reports.push(...JSON.parse(executorResult).tests.map(report => ({ ...report, name: `executor-${report.name}` })));
console.log(JSON.stringify({ passed: true, reports,
    boundary: 'Actual pinned native QRVM, canonical deposit runtime and ML-DSA verification; synthetic checkpoint authority and component state. This command sends no network transactions.' }, null, 2));
