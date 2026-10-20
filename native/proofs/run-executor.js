// Reproducible mechanical batching qualification, preserving primary artifacts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { adapter, captured } = require('./make-executor-plan');
const repo = path.resolve(__dirname, '../..');
const compiler = process.env.HYPERION_COMPILER || process.env.HYPC_BIN ||
  path.join(repo, 'findings/native-network-20260915/sources/hyperion/build/hypc/hypc');
const toolchain = require('../../config/hyperion-toolchain.json');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(digest(compiler), toolchain.compilerSha256, 'Use the reviewed pinned compiler');
const output = path.join(repo, 'findings/native-checkpoint-executor');
const artifacts = path.join(repo, 'build/native-checkpoint-executor');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(artifacts, { recursive: true });
const coreNames = ['NativeFinalityVerifier', 'NativePortfolioVerifier', 'NativeValidatorGate', 'NativeQrlPool'];
const coreHashes = Object.fromEntries(coreNames.map(name => [name, digest(path.join(repo, 'build/native', `${name}.bin`))]));
const sources = ['NativeCheckpointExecutor', 'NativePortfolioVerifier', 'NativeSSZ', 'NativeAccountProof'];
const settings = ['--abi', '--bin', '--bin-runtime', '--optimize', '--optimize-runs=1', '--via-ir'];
const mainArgs = [...settings, '--base-path=native/contracts', '--allow-paths=.', `--output-dir=${artifacts}`, '--overwrite', 'native/contracts/NativeCheckpointExecutor.hyp'];
execFileSync(compiler, mainArgs, { cwd: repo, stdio: 'inherit' });
execFileSync(compiler, [...settings, '--base-path=native/proofs', `--output-dir=${artifacts}`, '--overwrite', 'native/proofs/CheckpointPoolFixture.hyp'], { cwd: repo, stdio: 'inherit' });
for (const [name, hash] of Object.entries(coreHashes)) assert.equal(digest(path.join(repo, 'build/native', `${name}.bin`)), hash, 'Primary artifact changed');
const fixture = path.resolve(process.argv[2] || path.join(repo, 'findings/native-proof-tests/gate-fixture.json'));
const jobs = [['adapter', adapter, fixture]];
if (process.argv[3]) jobs.push(['captured', captured, path.resolve(process.argv[3])]);
const reports = [];
for (const [name, build, input] of jobs) {
  const planPath = path.join(output, `${name}-plan.json`);
  const reportPath = path.join(output, `${name}-report.json`);
  const plan = build(JSON.parse(fs.readFileSync(input)), planPath);
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const result = execFileSync(path.join(repo, 'build/native/execution'), ['-plan', planPath, '-report', reportPath], { cwd: repo, encoding: 'utf8' });
  fs.writeFileSync(path.join(output, `${name}-run.log`), result);
  const report = JSON.parse(fs.readFileSync(reportPath));
  reports.push({ name, steps: report.steps.length, expectedReverts: report.steps.filter(step => step.expectedRevert).length,
    maximumGas: Math.max(...report.steps.map(step => step.gasBeforeRefund)) });
}
const manifest = { compiler: { sha256: toolchain.compilerSha256, version: toolchain.compilerVersion },
  settings: { optimize: true, optimizeRuns: 1, viaIR: true },
  sources: Object.fromEntries(sources.map(name => [`${name}.hyp`, digest(path.join(repo, 'native/contracts', `${name}.hyp`))])),
  artifacts: Object.fromEntries(['abi', 'bin', 'bin-runtime'].map(name => [name, digest(path.join(artifacts, `NativeCheckpointExecutor.${name}`))])),
  runtimeBytes: fs.readFileSync(path.join(artifacts, 'NativeCheckpointExecutor.bin-runtime'), 'utf8').trim().length / 2,
  tests: reports, boundary: 'Actual QRVM calls with synthetic authority. Captured native roots are independently verified by the production proof contract. No network transaction is sent.' };
assert(manifest.runtimeBytes < 24576);
fs.writeFileSync(path.join(artifacts, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ passed: true, ...manifest }, null, 2));
