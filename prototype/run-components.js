// Build and execute only isolated prototype components against pinned sources.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { verifyCheckout, summarizeGoTests } = require('../scripts/check-qrl-upstream');
const lock = require('./source-lock.json');

const repo = path.resolve(__dirname, '..');
const output = path.join(repo, 'build/prototype');
const environment = {
    ...process.env, GOWORK: 'off', GOFLAGS: '', GOTOOLCHAIN: lock.goVersion, GOMAXPROCS: '2'
};

function run(command, args, { cwd = repo, env = {}, log, quiet = false } = {}) {
    const result = spawnSync(command, args, {
        cwd, env: { ...environment, ...env }, encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000
    });
    if (log) fs.writeFileSync(path.join(output, log), result.stdout || '');
    if (!quiet && result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command} failed with status ${result.status}`);
    return result.stdout;
}

function main(args) {
    const withUpstreamTests = args.includes('--upstream-tests');
    const positional = args.filter(arg => arg !== '--upstream-tests');
    assert.equal(positional.length, 1, 'Usage: node prototype/run-components.js SOURCE_ROOT [--upstream-tests]');
    const sourceRoot = path.resolve(positional[0]);
    fs.mkdirSync(output, { recursive: true });
    const checkSources = () => {
        for (const [name, spec] of Object.entries(lock.repositories)) {
            verifyCheckout(path.join(sourceRoot, name), spec.commit, spec.requiredCommits);
        }
    };
    checkSources();
    const goVersion = run('go', ['version']).trim();
    assert.ok(goVersion.includes(` ${lock.goVersion} `), 'Go toolchain differs from prototype pin');
    const compiler = path.join(sourceRoot, 'hyperion/build/hypc/hypc');
    const compilerVersion = run(compiler, ['--version']).trim();
    assert.ok(compilerVersion.includes(`commit.${lock.repositories.hyperion.commit.slice(0, 8)}`), 'Compiler commit differs from pinned checkout');
    const flags = ['--abi', '--bin', '--bin-runtime', '--optimize', '--optimize-runs=1', '--via-ir', '--output-dir', output, '--overwrite'];
    run(compiler, [...flags, '--base-path=prototype/contracts', 'prototype/contracts/FundingGatePrototype.hyp']);
    run(compiler, [...flags, path.join(sourceRoot, 'qrysm/contracts/deposit/deposit_contract.hyp')]);
    const runner = path.join(repo, 'build/prototype-execution');
    run('go', ['build', '-mod=readonly', '-p=2', '-o', runner, '.'], { cwd: path.join(__dirname, 'execution') });
    const prediction = run(runner, ['-predict', `Q${'11'.repeat(64)}`], { quiet: true });
    const recipient = prediction.split('\n').find(line => line.startsWith('2 ')).split(' ')[1];
    run('go', ['test', '-mod=readonly', '-tags=develop', '-p=2', '-count=1', '-v', './...'], {
        cwd: path.join(__dirname, 'protocol'), log: 'protocol-results.log',
        env: {
            QUANTAPOOL_UPDATE_PUBLIC_FIXTURES: '0',
            QUANTAPOOL_FIXTURE_POOL_RECIPIENT: recipient,
            QUANTAPOOL_FUNDING_FIXTURE_PATH: path.join(output, 'funding-fixture.json')
        }
    });
    run(process.execPath, ['prototype/accounting/make-plan.js']);
    run(process.execPath, ['prototype/make-funding-plan.js']);
    for (const suite of ['accounting', 'funding']) {
        run(runner, ['-plan', path.join(output, `${suite}-plan.json`)], { log: `${suite}-results.log` });
    }
    const upstream = {};
    if (withUpstreamTests) {
        for (const [name, spec] of Object.entries(lock.repositories)) {
            if (!spec.tests) continue;
            const testArgs = ['test', '-mod=readonly', '-p=2', '-count=1', '-json'];
            if (spec.tests.tags) testArgs.push(`-tags=${spec.tests.tags}`);
            testArgs.push(...spec.tests.packages, '-run', spec.tests.pattern);
            const result = run('go', testArgs, {
                cwd: path.join(sourceRoot, name), log: `upstream-${name}-tests.jsonl`, quiet: true
            });
            upstream[name] = summarizeGoTests(result, spec.tests.packages.map(pkg => `github.com/theQRL/${name}/${pkg.slice(2)}`));
        }
        console.log(JSON.stringify({ selectedUpstreamTests: upstream }, null, 2));
    }
    checkSources();
    const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.writeFileSync(path.join(output, 'component-run.json'), `${JSON.stringify({
        checkedAt: new Date().toISOString(), goVersion, compilerVersion,
        compilerSha256: sha256(compiler), executionRunnerSha256: sha256(runner),
        sourceLockSha256: sha256(path.join(__dirname, 'source-lock.json')),
        commits: Object.fromEntries(Object.entries(lock.repositories).map(([name, spec]) => [name, spec.commit])),
        selectedUpstreamTests: upstream,
        trustAnchor: 'Constructor-pinned synthetic Qrysm checkpoints; no live finality verification.',
        execution: 'Actual go-qrl QRVM with intrinsic gas bound and per-action state finalization; synthetic initial balances and time; balances exclude transaction fees.'
    }, null, 2)}\n`);
}

if (require.main === module) {
    try { main(process.argv.slice(2)); } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
