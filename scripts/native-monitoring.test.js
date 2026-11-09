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

// Driven through the installed @theqrl/web3 client and a local JSON-RPC
// endpoint, because the reply checks and the decoding are the library's.
// Since 2.0.0 the client refuses a reply whose id differs from the request,
// decodes addresses as checksummed Q addresses, and decodes each word
// strictly. The exporter's binding to the pool's finality and portfolio
// contracts goes through those decoded addresses.
test('native monitoring scrapes one block through the installed QRL web3 client', async () => {
    const http = require('node:http');
    const { Web3 } = require('@theqrl/web3');
    const coder = new Web3().qrl.abi;
    const finalityAddress = `Q${'ab'.repeat(64)}`;
    const portfolioAddress = `Q${'cd'.repeat(32)}${'12'.repeat(32)}`;
    const outputs = {
        [poolAddress]: { pendingTotal: 42000n * 10n ** 18n, recovering: true, poolStatus: 2n,
            poolRecoveryDeadlineSlot: 5000n, finality: finalityAddress, portfolio: portfolioAddress,
            fundingGate: poolAddress },
        [finalityAddress]: { status: 1n, finalizedSlot: 777n, trustDeadlineSlot: 888n },
        [portfolioAddress]: { registryCount: 3n }
    };
    const methods = new Map([...POOL_ABI, ...FINALITY_ABI, ...PORTFOLIO_ABI].map(method => [
        coder.encodeFunctionSignature(`${method.name}()`), method]));
    let chainId = 3151916n;
    const calls = [];
    const answer = ({ method, params }) => {
        if (method === 'qrl_chainId') return `0x${chainId.toString(16)}`;
        if (method === 'qrl_getCode') return '0x1234';
        if (method === 'qrl_blockNumber') return '0x63';
        assert.equal(method, 'qrl_call');
        const [{ to, data, input }, block] = params;
        const abi = methods.get(String(data ?? input).slice(0, 10));
        assert(abi, 'The exporter calls only its declared views');
        const contract = Object.keys(outputs).find(address => address.toLowerCase() === to.toLowerCase());
        assert(contract, `Unexpected call target ${to}`);
        calls.push({ name: abi.name, contract, block });
        return coder.encodeParameter(abi.outputs[0].type, outputs[contract][abi.name] ?? 0n);
    };
    const server = http.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => { body += chunk; });
        request.on('end', () => {
            const parsed = JSON.parse(body);
            const reply = one => ({ jsonrpc: '2.0', id: one.id, result: answer(one) });
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(reply) : reply(parsed)));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const measured = {};
    const metrics = { qrlFields: new Set(['pendingTotal']) };
    for (const name of ['pendingTotal', 'recovering', 'poolStatus', 'poolRecoveryDeadlineSlot', 'finalityStatus',
        'finalizedSlot', 'trustDeadlineSlot', 'validatorCount', 'executionBlock', 'lastSuccess', 'scrapeSuccess']) {
        metrics[name] = { set: value => { measured[name] = value; } };
    }
    const config = loadConfig({ ...fixture(), QRL_RPC_URL: `http://127.0.0.1:${server.address().port}` });
    const monitor = new ContractMonitor(new Web3(config.rpcUrl), metrics, config);
    try {
        await monitor.start();
        monitor.stop();
        assert.deepEqual(measured, { ...measured, pendingTotal: 42000, recovering: 1, poolStatus: 2,
            poolRecoveryDeadlineSlot: 5000, finalityStatus: 1, finalizedSlot: 777, trustDeadlineSlot: 888,
            validatorCount: 3, executionBlock: 99, scrapeSuccess: 1 });
        assert.equal(calls.length, POOL_ABI.length + 4);
        assert(calls.every(call => call.block === '0x63'));
        for (const name of ['status', 'finalizedSlot', 'trustDeadlineSlot']) {
            assert.equal(calls.find(call => call.name === name).contract, finalityAddress);
        }
        assert.equal(calls.find(call => call.name === 'registryCount').contract, portfolioAddress);
        chainId = 1n;
        await assert.rejects(monitor.start(), /Wrong monitoring chain/);
    } finally {
        monitor.stop();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
