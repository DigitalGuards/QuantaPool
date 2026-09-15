const assert = require('node:assert/strict');
const test = require('node:test');

const {
    getQrysmRestUrl,
    normalizeAddress,
    verifyBeaconDepositTarget
} = require('./lib/beaconDepositTarget');

const depositContract = `Q${'42'.repeat(64)}`;
const config = {
    chainId: 3151911,
    depositContract,
    genesisForkVersion: '0x10000038',
    qrysmRestUrl: 'http://127.0.0.1:32775'
};

function makeWeb3(chainId = config.chainId) {
    return {
        qrl: {
            getChainId: async () => chainId,
            getCode: async () => {
                throw new Error('runtime query should not be reached by this rejection test');
            }
        }
    };
}

function makeFetch({ contract = {}, spec = {} } = {}) {
    return async (url) => ({
        ok: true,
        json: async () => ({
            data: url.endsWith('/deposit_contract')
                ? {
                      address: depositContract,
                      chain_id: String(config.chainId),
                      ...contract
                  }
                : {
                      DEPOSIT_CHAIN_ID: String(config.chainId),
                      DEPOSIT_CONTRACT_ADDRESS: depositContract,
                      GENESIS_FORK_VERSION: config.genesisForkVersion,
                      DOMAIN_DEPOSIT: '0x03000000',
                      MAX_EFFECTIVE_BALANCE: '40000000000000',
                      ...spec
                  }
        })
    });
}

test('accepts loopback Qrysm REST and requires TLS for remote endpoints', () => {
    assert.equal(getQrysmRestUrl(config), 'http://127.0.0.1:32775');
    assert.equal(
        getQrysmRestUrl({ ...config, qrysmRestUrl: 'https://beacon.example/qrl/' }),
        'https://beacon.example/qrl'
    );
    assert.throws(
        () => getQrysmRestUrl({ ...config, qrysmRestUrl: 'http://beacon.example' }),
        /must use HTTPS/
    );
    assert.throws(
        () => getQrysmRestUrl({ ...config, qrysmRestUrl: 'https://user:pass@beacon.example' }),
        /must not contain credentials/
    );
});

test('normalizes only full QIP-55 deposit addresses', () => {
    assert.equal(normalizeAddress(depositContract, 'deposit'), depositContract.toLowerCase());
    assert.equal(
        normalizeAddress(`0x${depositContract.slice(1)}`, 'deposit'),
        depositContract.toLowerCase()
    );
    assert.throws(() => normalizeAddress('Q1234', 'deposit'), /64-byte QIP-55/);
});

test('rejects execution and consensus identity mismatches before bytecode use', async (t) => {
    await t.test('execution chain', async () => {
        await assert.rejects(
            verifyBeaconDepositTarget({
                web3: makeWeb3(config.chainId + 1),
                config,
                fetchFn: makeFetch()
            }),
            /Wrong execution chain/
        );
    });
    await t.test('consensus chain', async () => {
        await assert.rejects(
            verifyBeaconDepositTarget({
                web3: makeWeb3(),
                config,
                fetchFn: makeFetch({ contract: { chain_id: '1' } })
            }),
            /chain ID does not match/
        );
    });
    await t.test('deposit address', async () => {
        await assert.rejects(
            verifyBeaconDepositTarget({
                web3: makeWeb3(),
                config,
                fetchFn: makeFetch({ contract: { address: `Q${'43'.repeat(64)}` } })
            }),
            /differs from the Qrysm deposit contract/
        );
    });
    await t.test('fork version', async () => {
        await assert.rejects(
            verifyBeaconDepositTarget({
                web3: makeWeb3(),
                config,
                fetchFn: makeFetch({ spec: { GENESIS_FORK_VERSION: '0x10000039' } })
            }),
            /differs from the Qrysm chain/
        );
    });
    await t.test('deposit domain', async () => {
        await assert.rejects(
            verifyBeaconDepositTarget({
                web3: makeWeb3(),
                config,
                fetchFn: makeFetch({ spec: { DOMAIN_DEPOSIT: '0x04000000' } })
            }),
            /Unsupported Qrysm deposit domain/
        );
    });
    await t.test('validator stake', async () => {
        await assert.rejects(
            verifyBeaconDepositTarget({
                web3: makeWeb3(),
                config,
                fetchFn: makeFetch({ spec: { MAX_EFFECTIVE_BALANCE: '32000000000' } })
            }),
            /Unsupported Qrysm validator stake/
        );
    });
});
