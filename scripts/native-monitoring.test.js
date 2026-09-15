const assert = require('node:assert/strict');
const test = require('node:test');
const { loadConfig } = require('../monitoring/contract-exporter/src/config');
const { ContractMonitor, POOL_ABI, FINALITY_ABI, PORTFOLIO_ABI } = require('../monitoring/contract-exporter/src/contracts');

const poolAddress = `Q${'11'.repeat(64)}`;
const fixture = () => ({ QRL_RPC_URL: 'http://127.0.0.1:12345', QRL_CHAIN_ID: '3151916', NATIVE_POOL_ADDRESS: poolAddress });

test('monitoring requires explicit native deployment identity', () => {
    assert.throws(() => loadConfig({}));
    assert.throws(() => loadConfig({ ...fixture(), NATIVE_POOL_ADDRESS: `Q${'11'.repeat(20)}` }));
    assert.throws(() => loadConfig({ ...fixture(), QRL_CHAIN_ID: '0' }));
    assert.equal(loadConfig(fixture()).chainId, 3151916n);
});

test('native monitoring has read-only contract interfaces and samples one block', async () => {
    const seen = [];
    const outputs = { pendingTotal: 42000n * 10n ** 18n, finality: poolAddress,
        portfolio: poolAddress, fundingGate: poolAddress, recovering: false,
        poolStatus: 2n, status: 0n, poolRecoveryDeadlineSlot: 5000n };
    for (const method of [...POOL_ABI, ...FINALITY_ABI, ...PORTFOLIO_ABI]) {
        assert.equal(method.stateMutability, 'view');
    }
    class Contract {
        constructor(abi) {
            this.methods = Object.fromEntries(abi.map(({ name }) => [name, () => ({
                call: async (_options, block) => { seen.push(block); return outputs[name] ?? 0n; }
            })]));
        }
    }
    const web3 = { qrl: { Contract, getChainId: async () => 3151916n,
        getCode: async () => '0x1234', getBlockNumber: async () => 99n } };
    const measured = {};
    const metrics = { qrlFields: new Set(['pendingTotal']) };
    for (const name of ['pendingTotal', 'finalityStatus', 'finalizedSlot', 'trustDeadlineSlot',
        'validatorCount', 'executionBlock', 'lastSuccess', 'scrapeSuccess', 'poolStatus', 'poolRecoveryDeadlineSlot']) {
        metrics[name] = { set: value => { measured[name] = value; } };
    }
    const monitor = new ContractMonitor(web3, metrics, loadConfig(fixture()));
    try {
        await monitor.start();
        assert.equal(measured.pendingTotal, 42000);
        assert.equal(measured.scrapeSuccess, 1);
        assert.equal(measured.finalityStatus, 0);
        assert.equal(measured.poolStatus, 2);
        assert.equal(measured.poolRecoveryDeadlineSlot, 5000);
        assert(seen.length > 10 && seen.every(block => block === 99n));
    } finally { monitor.stop(); }
    web3.qrl.getChainId = async () => 1n;
    await assert.rejects(monitor.start(), /Wrong monitoring chain/);
});
