const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { qrvmcConstants, semanticRuntimeHeaders, summarizeGoTests, verifyCheckout } = require('./check-qrl-upstream');

function repository(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quantapool-source-check-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull },
    }).trim();
    git('init', '--quiet');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Source gate fixture');
    fs.writeFileSync(path.join(directory, 'source'), 'pinned source\n');
    git('add', 'source');
    git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'source fixture');
    return { directory, git, commit: git('rev-parse', 'HEAD') };
}

test('source qualification accepts a clean pinned repository', (t) => {
    const { directory, commit } = repository(t);
    assert.equal(verifyCheckout(directory, commit, [commit]), commit);
});

test('source qualification rejects a different revision', (t) => {
    const { directory } = repository(t);
    assert.throws(() => verifyCheckout(directory, '0'.repeat(40)), /Unexpected upstream commit/);
});

test('source qualification rejects modified, staged, and untracked source', async (t) => {
    for (const change of ['modified', 'staged', 'untracked']) {
        await t.test(change, (t) => {
            const { directory, commit, git } = repository(t);
            fs.writeFileSync(path.join(directory, change === 'untracked' ? 'extra.go' : 'source'), 'changed\n');
            if (change === 'staged') git('add', 'source');
            assert.throws(() => verifyCheckout(directory, commit), /Upstream sources must be clean/);
        });
    }
});

test('a nested directory cannot masquerade as a pinned source repository', (t) => {
    const { directory, commit } = repository(t);
    const nested = path.join(directory, 'nested');
    fs.mkdirSync(nested);
    assert.throws(() => verifyCheckout(nested, commit), /root of its own repository/);
});

function events(items) {
    return items.map((item) => JSON.stringify({ Package: 'module/pkg', ...item })).join('\n');
}

test('selected test results count executed top-level tests', () => {
    const report = summarizeGoTests(events([
        { Action: 'pass', Test: 'TestOne/case' },
        { Action: 'pass', Test: 'TestOne' },
        { Action: 'skip', Test: 'TestSkipped' },
        { Action: 'pass' },
    ]), ['module/pkg']);
    assert.deepEqual(report, { 'module/pkg': { tests: 1, passed: true } });
});

test('a passing package with no selected tests fails qualification', () => {
    assert.throws(() => summarizeGoTests(events([{ Action: 'pass' }]), ['module/pkg']), /No selected tests/);
});

test('failed or missing packages fail qualification', () => {
    assert.throws(() => summarizeGoTests(events([{ Action: 'fail' }]), ['module/pkg']), /reported failures/);
    assert.throws(() => summarizeGoTests('', ['module/pkg']), /Package did not pass/);
});

test('runtime headers must identify both the ABI and revision', () => {
    assert.throws(() => qrvmcConstants('QRVMC_ABI_VERSION = 2,'), /Cannot determine QRVMC_ZOND/);
    assert.deepEqual(qrvmcConstants(' QRVMC_ABI_VERSION = 2,\n QRVMC_ZOND = 0,'), {
        QRVMC_ABI_VERSION: 2,
        QRVMC_ZOND: 0,
    });
});

test('source qualification reports incompatible semantic runtime revisions', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quantapool-header-check-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const [header, revision] of [
        ['hyperion/test/qrvmc/qrvmc.h', 1],
        ['qrvmone/qrvmc/include/qrvmc/qrvmc.h', 0],
    ]) {
        const file = path.join(directory, header);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, ` QRVMC_ABI_VERSION = 2,\n QRVMC_ZOND = ${revision},\n`);
    }
    assert.equal(semanticRuntimeHeaders(directory).compatible, false);
    fs.writeFileSync(path.join(directory, 'hyperion/test/qrvmc/qrvmc.h'),
        ' QRVMC_ABI_VERSION = 2,\n QRVMC_ZOND = 0,\n');
    assert.equal(semanticRuntimeHeaders(directory).compatible, true);
});
