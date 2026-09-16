const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');

function runNode(args, label) {
    console.log(`\n${label}`);
    const result = spawnSync(process.execPath, args, {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

const toolingTests = fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => path.join('scripts', file));

if (toolingTests.length === 0) {
    throw new Error('No executable Node tooling tests found.');
}

runNode(['scripts/compile-hyperion.js'], 'Compiling immutable native QRL contracts');
runNode(['--test', 'native/accounting-model.test.js'], 'Checking native accounting histories');
runNode(['native/testing/run.js'], 'Executing ledger bytecode in pinned QRL VM');
runNode(['native/proofs/run.js'], 'Executing native portfolio and funding proofs');
runNode(['native/finality/run.js'], 'Verifying captured current QRL certificates and committee transitions');
runNode(['--test', ...toolingTests], `Running ${toolingTests.length} Node tooling suites`);
