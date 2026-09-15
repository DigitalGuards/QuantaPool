// All values come from view calls at one execution block. This read-only
// observer cannot submit reports, update accounting or access a signing key.
const view = (name, type = 'uint256') => ({ name, type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type }] });
const POOL_ABI = [
    ...['riskAssets', 'freeCash', 'pendingTotal', 'claimReserve', 'feeReserve', 'totalFeesPaid',
        'consensusLossCarry', 'eligibleConsensusRewardBudget', 'FEE_BPS'].map(name => view(name)),
    view('recovering', 'bool'), view('lastCheckpointBlock', 'uint64'), view('appliedSlot', 'uint64'),
    view('poolStatus', 'uint8'), view('poolRecoveryDeadlineSlot'),
    view('finality', 'address'), view('portfolio', 'address'), view('fundingGate', 'address')
];
const FINALITY_ABI = [view('status', 'uint8'), view('finalizedSlot', 'uint64'), view('trustDeadlineSlot')];
const PORTFOLIO_ABI = [view('registryCount', 'uint64'), view('snapshotId', 'uint64')];

class ContractMonitor {
    constructor(web3, metrics, config) { Object.assign(this, { web3, metrics, config }); this.busy = false; this.lastUpdate = 0; }
    async start() {
        if (BigInt(await this.web3.qrl.getChainId()) !== this.config.chainId) throw new Error('Wrong monitoring chain');
        if ((await this.web3.qrl.getCode(this.config.poolAddress)).length <= 2) throw new Error('Missing native pool');
        this.pool = new this.web3.qrl.Contract(POOL_ABI, this.config.poolAddress);
        await this.scrape();
        this.timer = setInterval(() => this.scrape().catch(error => console.error(error.message)), this.config.interval);
    }
    async scrape() {
        if (this.busy) return;
        this.busy = true;
        try {
            const block = await this.web3.qrl.getBlockNumber();
            const call = (contract, name) => contract.methods[name]().call({}, block);
            const values = Object.fromEntries(await Promise.all(POOL_ABI.map(async method => [method.name, await call(this.pool, method.name)])));
            const finality = new this.web3.qrl.Contract(FINALITY_ABI, values.finality);
            const portfolio = new this.web3.qrl.Contract(PORTFOLIO_ABI, values.portfolio);
            const extra = await Promise.all([call(finality, 'status'), call(finality, 'finalizedSlot'),
                call(finality, 'trustDeadlineSlot'), call(portfolio, 'registryCount')]);
            for (const [name, value] of Object.entries(values)) if (this.metrics[name]) {
                const integer = BigInt(value);
                this.metrics[name].set(name === 'recovering' ? Number(value) :
                    this.metrics.qrlFields.has(name) ?
                        Number(integer / 10n ** 18n) + Number(integer % 10n ** 18n) / 1e18 : Number(integer));
            }
            ['finalityStatus', 'finalizedSlot', 'trustDeadlineSlot', 'validatorCount'].forEach((name, index) => this.metrics[name].set(Number(extra[index])));
            this.metrics.executionBlock.set(Number(block));
            this.lastUpdate = Date.now();
            this.metrics.lastSuccess.set(this.lastUpdate / 1000);
            this.metrics.scrapeSuccess.set(1);
        } catch (error) { this.metrics.scrapeSuccess.set(0); throw error; }
        finally { this.busy = false; }
    }
    stop() { clearInterval(this.timer); }
}
module.exports = { ContractMonitor, POOL_ABI, FINALITY_ABI, PORTFOLIO_ABI };
