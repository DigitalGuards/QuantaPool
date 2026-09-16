'use strict';

// Component execution uses synthetic checkpoint data and the pinned native QRVM.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'build/native');
const toolchain = JSON.parse(fs.readFileSync(path.join(root, 'config/hyperion-toolchain.json')));
const sourceLock = JSON.parse(fs.readFileSync(path.join(root, 'native/network/source-lock.json')));
const compiler =
  process.env.HYPERION_COMPILER ||
  process.env.HYPC_BIN ||
  path.join(root, 'findings/native-network-20260915/sources/hyperion/build/hypc/hypc');
fs.mkdirSync(output, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} exited ${result.status}\n${result.stdout || ''}${result.stderr || ''}`
    );
  return result;
}

const version = run(compiler, ['--version']);
if (!(version.stdout + version.stderr).includes(toolchain.compilerVersion))
  throw new Error(
    'Native tests require the reviewed Hyperion version from config/hyperion-toolchain.json'
  );
const compilerHash = createHash('sha256').update(fs.readFileSync(compiler)).digest('hex');
if (compilerHash !== toolchain.compilerSha256)
  throw new Error(
    'Native tests require the reviewed Hyperion binary hash from config/hyperion-toolchain.json'
  );
const fixtureCompile = run(compiler, [
  '--abi',
  '--bin',
  '--bin-runtime',
  '--optimize',
  '--optimize-runs=1',
  '--via-ir',
  '--output-dir',
  output,
  '--overwrite',
  path.join(__dirname, 'LedgerFixture.hyp'),
  path.join(__dirname, 'ClaimReceiverFixture.hyp'),
]);
fs.writeFileSync(
  path.join(output, 'ledger-compile.log'),
  fixtureCompile.stdout + fixtureCompile.stderr
);
const runtime = fs.readFileSync(path.join(output, 'LedgerFixture.bin-runtime'), 'utf8').trim();
if (!/^[0-9a-f]+$/i.test(runtime) || runtime.length % 2 || runtime.length / 2 > 24576)
  throw new Error('Ledger fixture bytecode is invalid or exceeds the native deployment limit');

const moduleDir = path.join(__dirname, 'execution');
const moduleText = fs.readFileSync(path.join(moduleDir, 'go.mod'), 'utf8');
if (!moduleText.includes(sourceLock['go-qrl'].slice(0, 12)))
  throw new Error('QRVM runner module does not match the reviewed go-qrl source lock');
const env = {
  ...process.env,
  GOWORK: 'off',
  GOMAXPROCS: '2',
  GOTOOLCHAIN: sourceLock.goBuildToolchain,
};
const binary = path.join(output, 'execution');
run('go', ['test', '-mod=readonly', '-p', '2', '.'], { cwd: moduleDir, env });
run('go', ['build', '-mod=readonly', '-p', '2', '-o', binary, '.'], {
  cwd: moduleDir,
  env,
});
const generated = run(process.execPath, [path.join(__dirname, 'make-ledger-plan.js'), output]);
process.stdout.write(generated.stdout);
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'ledger-plans.json')));
const results = [];
for (const scenario of manifest.scenarios) {
  const reportPath = path.join(output, `ledger-${scenario.name}-execution.json`);
  const result = run(binary, ['-plan', path.join(output, scenario.plan), '-report', reportPath]);
  fs.writeFileSync(
    path.join(output, `ledger-${scenario.name}-execution.log`),
    result.stdout + result.stderr
  );
  const report = JSON.parse(fs.readFileSync(reportPath));
  if (report.steps.length !== scenario.steps) throw new Error('Incomplete QRVM execution report');
  const item = {
    scenario: scenario.name,
    steps: report.steps.length,
    expectedReverts: report.steps.filter((step) => step.expectedRevert).length,
    maxGasBeforeRefund: Math.max(...report.steps.map((step) => step.gasBeforeRefund || 0)),
  };
  results.push(item);
  console.log(
    `PASS ${item.scenario}: ${item.steps} QRVM steps, ${item.expectedReverts} expected reverts`
  );
}
fs.writeFileSync(
  path.join(output, 'ledger-results.json'),
  JSON.stringify(
    {
      evidence: manifest.evidence,
      compilerHash,
      source: sourceLock['go-qrl'],
      runtimeBytes: runtime.length / 2,
      results,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `PASS ${results.reduce((sum, item) => sum + item.steps, 0)} actual QRVM steps; economic inputs are synthetic fixtures`
);

// Keep randomized plans isolated while executing the same freshly compiled
// ledger and source-pinned runner as the deterministic component suite.
const fuzzStart = process.hrtime.bigint();
const fuzzOutput = path.join(output, 'fuzz');
fs.mkdirSync(fuzzOutput, { recursive: true });
for (const suffix of ['abi', 'bin'])
  fs.copyFileSync(
    path.join(output, `LedgerFixture.${suffix}`),
    path.join(fuzzOutput, `LedgerFixture.${suffix}`)
  );
const randomized = run(process.execPath, [
  path.join(__dirname, 'make-randomized-plans.js'),
  fuzzOutput,
]);
process.stdout.write(randomized.stdout);
const fuzzManifest = JSON.parse(fs.readFileSync(path.join(fuzzOutput, 'randomized-plans.json')));
const fuzzResults = [];
for (const scenario of fuzzManifest.scenarios) {
  const reportPath = path.join(fuzzOutput, `${scenario.name}-execution.json`);
  const result = run(binary, [
    '-plan',
    path.join(fuzzOutput, scenario.plan),
    '-report',
    reportPath,
  ]);
  fs.writeFileSync(path.join(fuzzOutput, `${scenario.name}.log`), result.stdout + result.stderr);
  const report = JSON.parse(fs.readFileSync(reportPath));
  if (report.steps.length !== scenario.steps)
    throw new Error(`Incomplete randomized QRVM execution report: ${scenario.name}`);
  const item = {
    ...scenario,
    expectedReverts: report.steps.filter((step) => step.expectedRevert).length,
    maxGasBeforeRefund: Math.max(...report.steps.map((step) => step.gasBeforeRefund || 0)),
  };
  fuzzResults.push(item);
  console.log(
    `PASS seeded ${item.name}: ${item.steps} QRVM steps, ${item.expectedReverts} expected reverts`
  );
}
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(
  path.join(fuzzOutput, 'randomized-results.json'),
  JSON.stringify(
    {
      evidence: fuzzManifest.evidence,
      compilerHash,
      source: sourceLock['go-qrl'],
      ledgerSourceSha256: digest(path.join(__dirname, '../contracts/NativeLedger.hyp')),
      modelSha256: digest(path.join(__dirname, '../accounting-model.js')),
      generatorSha256: digest(path.join(__dirname, 'make-randomized-plans.js')),
      fixtureBytecodeSha256: digest(path.join(fuzzOutput, 'LedgerFixture.bin')),
      runnerSha256: digest(binary),
      runtimeBytes: runtime.length / 2,
      elapsedSeconds: Number(process.hrtime.bigint() - fuzzStart) / 1e9,
      randomActions: fuzzManifest.randomActions,
      coverage: fuzzManifest.coverage,
      results: fuzzResults,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `PASS ${fuzzResults.reduce((sum, item) => sum + item.steps, 0)} additional seeded QRVM steps; ${fuzzManifest.randomActions} randomized action selections`
);
