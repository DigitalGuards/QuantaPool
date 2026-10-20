const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const lock = require('../config/qrl-upstream-sources.json');

function git(directory, args) {
    const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Git check failed: ${args.join(' ')}\n${result.stderr}`);
    return result.stdout.trim();
}

function verifyCheckout(directory, expected, requiredCommits = [], submodules = {}) {
    assert.equal(
        fs.realpathSync(git(directory, ['rev-parse', '--show-toplevel'])),
        fs.realpathSync(directory),
        'The source directory must be the root of its own repository'
    );
    assert.equal(git(directory, ['rev-parse', 'HEAD']), expected, 'Unexpected upstream commit');
    assert.equal(
        git(directory, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']),
        '',
        'Upstream sources must be clean, including untracked files and submodule changes'
    );
    for (const commit of requiredCommits) {
        git(directory, ['merge-base', '--is-ancestor', commit, expected]);
    }
    for (const [name, commit] of Object.entries(submodules)) {
        verifyCheckout(path.join(directory, name), commit);
    }
    return expected;
}

function requireSource(directory, file, pattern, label) {
    assert.match(fs.readFileSync(path.join(directory, file), 'utf8'), pattern, label);
}

function verifyProtocol(sources) {
    const execution = path.join(sources, 'go-qrl');
    const consensus = path.join(sources, 'qrysm');
    requireSource(execution, 'common/types.go', /AddressLength\s*=\s*64\b/, 'QIP-55 address width');
    requireSource(execution, 'common/types.go', /HashLength\s*=\s*32\b/, 'Consensus hash width');
    requireSource(execution, 'core/vm/common.go', /WordBytes\s*=\s*uint512\.WordBytes/, 'QRVM word width');
    requireSource(
        execution, 'core/vm/contracts.go', /depositRandaoCommitmentLength\s*=\s*common\.HashLength/,
        'Deposit-root precompile must include the RANDAO commitment'
    );
    requireSource(
        consensus, 'config/params/mainnet_config.go', /MaxEffectiveBalance:\s*40000\s*\*\s*1e9/,
        'Validator funding unit'
    );
    requireSource(
        consensus, 'config/params/mainnet_config.go', /MinDepositAmount:\s*2000\s*\*\s*1e9/,
        'Minimum beacon deposit'
    );
    requireSource(
        consensus, 'contracts/deposit/deposit_contract.hyp', /msg\.value\s*>=\s*2000\s+quanta/,
        'Beacon contract must enforce the minimum'
    );
    requireSource(
        consensus, 'contracts/deposit/deposit_contract.hyp', /randao_commitment\.length\s*==\s*32/,
        'Beacon ABI must validate RANDAO commitment width'
    );
    requireSource(
        consensus, 'go.mod',
        /replace github\.com\/theQRL\/go-qrl => github\.com\/cyyber\/go-qrl v0\.3\.2-0\.20260830102207-9b404c38a63b/,
        'Qrysm must use the matching execution revision'
    );
}

function verifySources(sources) {
    const commits = {};
    for (const [name, spec] of Object.entries(lock.repositories)) {
        commits[name] = verifyCheckout(
            path.join(sources, name), spec.commit, spec.requiredCommits, spec.submodules
        );
    }
    verifyProtocol(sources);
    return commits;
}

function qrvmcConstants(header) {
    const constants = {};
    for (const name of ['QRVMC_ABI_VERSION', 'QRVMC_ZOND']) {
        const match = header.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\d+)\\s*[,}]`, 'm'));
        assert.ok(match, `Cannot determine ${name} from the QRVMC header`);
        constants[name] = Number(match[1]);
    }
    return constants;
}

function semanticRuntimeHeaders(sources) {
    const compilerHost = qrvmcConstants(fs.readFileSync(
        path.join(sources, 'hyperion', 'test', 'qrvmc', 'qrvmc.h'), 'utf8'
    ));
    const executionRuntime = qrvmcConstants(fs.readFileSync(
        path.join(sources, 'qrvmone', 'qrvmc', 'include', 'qrvmc', 'qrvmc.h'), 'utf8'
    ));
    return {
        compatible: Object.keys(compilerHost).every((name) => compilerHost[name] === executionRuntime[name]),
        compilerHost,
        executionRuntime,
        scope: 'Header ABI and revision identifiers only; semantic execution is a separate check.',
    };
}

function summarizeGoTests(output, expectedPackages) {
    const packages = new Map(expectedPackages.map((name) => [name, { tests: 0, passed: false }]));
    let failures = 0;
    for (const line of output.split('\n').filter(Boolean)) {
        const event = JSON.parse(line);
        const pkg = packages.get(event.Package);
        if (!pkg) continue;
        if (event.Action === 'fail') failures++;
        if (event.Action === 'pass' && event.Test && !event.Test.includes('/')) pkg.tests++;
        if (event.Action === 'pass' && !event.Test) pkg.passed = true;
    }
    assert.equal(failures, 0, 'Upstream tests reported failures');
    for (const [name, result] of packages) {
        assert.ok(result.passed, `Package did not pass: ${name}`);
        assert.ok(result.tests > 0, `No selected tests executed in ${name}`);
    }
    return Object.fromEntries(packages);
}

function testSources(sources) {
    const reports = {};
    for (const [name, spec] of Object.entries(lock.repositories)) {
        if (!spec.goTests) continue;
        const directory = path.join(sources, name);
        const args = ['test', '-mod=readonly', '-p', '2', '-json', '-count=1'];
        if (spec.goTests.tags.length) args.push('-tags', spec.goTests.tags.join(','));
        args.push(...spec.goTests.packages, '-run', spec.goTests.pattern);
        console.log(`Running selected upstream tests in ${name} at ${spec.commit}`);
        const result = spawnSync('go', args, {
            cwd: directory,
            env: { ...process.env, GOMAXPROCS: '2', GOWORK: 'off', GOFLAGS: '' },
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            timeout: 20 * 60 * 1000,
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `Upstream test failure in ${name}\n${result.stderr}\n${result.stdout}`);
        const moduleName = name === 'go-qrl' ? 'github.com/theQRL/go-qrl' : 'github.com/theQRL/qrysm';
        reports[name] = summarizeGoTests(
            result.stdout,
            spec.goTests.packages.map((pkg) => `${moduleName}/${pkg.slice(2)}`)
        );
    }
    verifySources(sources);
    return reports;
}

function main(args) {
    const test = args.includes('--test');
    const requireSemantic = args.includes('--require-semantic-runtime');
    const positional = args.filter((arg) => !['--test', '--require-semantic-runtime'].includes(arg));
    assert.equal(positional.length, 1,
        'Usage: node scripts/check-qrl-upstream.js SOURCE_ROOT [--test] [--require-semantic-runtime]');
    const sources = path.resolve(positional[0]);
    const commits = verifySources(sources);
    const report = {
        scope: lock.purpose,
        observedAt: lock.observedAt,
        checkedAt: new Date().toISOString(),
        commits,
        semanticRuntimeHeaders: semanticRuntimeHeaders(sources),
        selectedGoTests: test ? testSources(sources) : 'not run',
    };
    console.log(JSON.stringify(report, null, 2));
    if (requireSemantic) {
        assert.ok(report.semanticRuntimeHeaders.compatible,
            'Hyperion host and qrvmone QRVMC identifiers differ; semantic execution is blocked');
    }
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { qrvmcConstants, semanticRuntimeHeaders, summarizeGoTests, verifyCheckout, verifySources };
