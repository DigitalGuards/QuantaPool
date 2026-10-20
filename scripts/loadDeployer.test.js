const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
    isLoopbackRpcUrl,
    loadDeployer,
    loadDeployerFromEnvironment,
    parseExpectedPublicDevChainId,
    parsePublicDevSeeds
} = require('./lib/loadDeployer');

function fakeWeb3() {
    const added = [];
    return {
        added,
        qrl: {
            accounts: {
                seedToAccount: (seed) => ({ address: 'Q' + '11'.repeat(64), seed }),
                wallet: { add: (value) => added.push(['accounts', value]) }
            },
            wallet: { add: (value) => added.push(['qrl', value]) }
        }
    };
}

test('loads a 51-byte extended seed into both QRL wallet registries', () => {
    const web3 = fakeWeb3();
    const seed = 'ab'.repeat(51);
    const account = loadDeployer(web3, seed);
    assert.equal(account.seed, `0x${seed}`);
    assert.deepEqual(web3.added, [
        ['accounts', account],
        ['qrl', `0x${seed}`]
    ]);
});

test('parses only full QIP-55 public development account fixtures', () => {
    const seed = 'cd'.repeat(51);
    const valid = `new_prefunded_account("Q${'12'.repeat(64)}", "${seed}")`;
    const legacy = `new_prefunded_account("Q${'34'.repeat(20)}", "${'ef'.repeat(51)}")`;
    assert.deepEqual(parsePublicDevSeeds(`${valid}\n${legacy}`), [seed]);
});

test('accepts loopback RPC URLs and rejects other hosts', () => {
    assert.equal(isLoopbackRpcUrl('http://127.0.0.1:32012'), true);
    assert.equal(isLoopbackRpcUrl('http://localhost:8545'), true);
    assert.equal(isLoopbackRpcUrl('http://[::1]:8545'), true);
    assert.equal(isLoopbackRpcUrl('https://rpc.example'), false);
});

test('requires an explicit exact public development chain ID', () => {
    assert.equal(
        parseExpectedPublicDevChainId({ QUANTAPOOL_PUBLIC_DEV_CHAIN_ID: '3151911' }),
        3151911
    );
    assert.throws(() => parseExpectedPublicDevChainId({}), /explicit positive decimal/);
    assert.throws(
        () => parseExpectedPublicDevChainId({ QUANTAPOOL_PUBLIC_DEV_CHAIN_ID: '0' }),
        /positive safe integer/
    );
});

test('public fixture selector fails closed outside its exact local chain', () => {
    const web3 = fakeWeb3();
    const options = {
        repoRoot: '/unused',
        rpcUrl: 'https://rpc.example',
        chainId: 3151911,
        env: {
            QUANTAPOOL_PUBLIC_DEV_ACCOUNT: '0',
            QUANTAPOOL_PUBLIC_DEV_CHAIN_ID: '3151911'
        }
    };
    assert.throws(
        () => loadDeployerFromEnvironment(web3, options),
        /restricted to a loopback RPC URL/
    );
    assert.throws(
        () =>
            loadDeployerFromEnvironment(web3, {
                ...options,
                rpcUrl: 'http://127.0.0.1:32012',
                chainId: 3151912
            }),
        /exact chain 3151911/
    );
});

test('loads an explicitly selected published fixture on the exact local chain', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quantapool-public-fixture-'));
    const packageDir = path.join(root, 'qrl-package');
    const constantsDir = path.join(
        packageDir,
        'src',
        'prelaunch_data_generator',
        'genesis_constants'
    );
    fs.mkdirSync(constantsDir, { recursive: true });
    const seed = '01'.repeat(51);
    fs.writeFileSync(
        path.join(constantsDir, 'genesis_constants.star'),
        `new_prefunded_account("Q${'23'.repeat(64)}", "${seed}")\n`
    );

    const web3 = fakeWeb3();
    const account = loadDeployerFromEnvironment(web3, {
        repoRoot: root,
        rpcUrl: 'http://127.0.0.1:32012',
        chainId: 3151911,
        env: {
            QUANTAPOOL_PUBLIC_DEV_ACCOUNT: '0',
            QUANTAPOOL_PUBLIC_DEV_CHAIN_ID: '3151911',
            QRL_PACKAGE_DIR: packageDir
        }
    });
    assert.equal(account.seed, `0x${seed}`);
});
