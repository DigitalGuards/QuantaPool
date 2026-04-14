/**
 * v2 contract monitoring for QuantaPool.
 *
 * Uses minimal inline ABIs for the ~16 view functions + 6 events we need.
 * No dependency on the Hyperion build output so the exporter can ship
 * standalone (Docker image, Ansible deploy) without the contract tree.
 */

// =============================================================
//                        MINIMAL ABIs
// =============================================================
// Only the functions and events the exporter reads. Keep this
// inline and human-editable rather than importing artifacts.

const view = (name, outputType) => ({
    name, type: 'function', stateMutability: 'view',
    inputs: [],
    outputs: [{ type: outputType, name: '' }]
});

const evt = (name, inputs = []) => ({
    name, type: 'event', anonymous: false, inputs
});

const STQRL_ABI = [
    view('totalPooledQRL', 'uint256'),
    view('totalShares', 'uint256'),
    view('getExchangeRate', 'uint256'),
    view('paused', 'bool')
];

const POOL_ABI = [
    view('bufferedQRL', 'uint256'),
    view('validatorCount', 'uint256'),
    view('withdrawalReserve', 'uint256'),
    view('totalWithdrawalShares', 'uint256'),
    view('totalRewardsReceived', 'uint256'),
    view('totalSlashingLosses', 'uint256'),
    view('minDeposit', 'uint256'),
    view('paused', 'bool'),
    // Events (subset — enough to drive counters)
    evt('Deposited', [
        { name: 'user', type: 'address', indexed: true },
        { name: 'qrlAmount', type: 'uint256', indexed: false },
        { name: 'shares', type: 'uint256', indexed: false }
    ]),
    evt('WithdrawalRequested', [
        { name: 'user', type: 'address', indexed: true },
        { name: 'shares', type: 'uint256', indexed: false },
        { name: 'qrlAmount', type: 'uint256', indexed: false },
        { name: 'requestBlock', type: 'uint256', indexed: false }
    ]),
    evt('WithdrawalClaimed', [
        { name: 'user', type: 'address', indexed: true },
        { name: 'shares', type: 'uint256', indexed: false },
        { name: 'qrlAmount', type: 'uint256', indexed: false }
    ]),
    evt('WithdrawalCancelled', [
        { name: 'user', type: 'address', indexed: true },
        { name: 'requestId', type: 'uint256', indexed: false },
        { name: 'shares', type: 'uint256', indexed: false }
    ]),
    evt('ValidatorFunded', [
        { name: 'validatorId', type: 'uint256', indexed: true },
        { name: 'pubkey', type: 'bytes', indexed: false },
        { name: 'amount', type: 'uint256', indexed: false }
    ]),
    evt('RewardsSynced', [
        { name: 'rewards', type: 'uint256', indexed: false },
        { name: 'newTotalPooled', type: 'uint256', indexed: false },
        { name: 'blockNumber', type: 'uint256', indexed: false }
    ]),
    evt('SlashingDetected', [
        { name: 'loss', type: 'uint256', indexed: false },
        { name: 'newTotalPooled', type: 'uint256', indexed: false },
        { name: 'blockNumber', type: 'uint256', indexed: false }
    ])
];

const VM_ABI = [
    view('totalValidators', 'uint256'),
    view('activeValidatorCount', 'uint256'),
    view('pendingValidatorCount', 'uint256'),
    evt('ValidatorRegistered', [
        { name: 'validatorId', type: 'uint256', indexed: true },
        { name: 'pubkey', type: 'bytes', indexed: false },
        { name: 'status', type: 'uint8', indexed: false }
    ]),
    evt('ValidatorActivated', [
        { name: 'validatorId', type: 'uint256', indexed: true },
        { name: 'activatedBlock', type: 'uint256', indexed: false }
    ]),
    evt('ValidatorExitRequested', [
        { name: 'validatorId', type: 'uint256', indexed: true },
        { name: 'requestBlock', type: 'uint256', indexed: false }
    ]),
    evt('ValidatorExited', [
        { name: 'validatorId', type: 'uint256', indexed: true },
        { name: 'exitedBlock', type: 'uint256', indexed: false }
    ]),
    evt('ValidatorSlashed', [
        { name: 'validatorId', type: 'uint256', indexed: true },
        { name: 'slashedBlock', type: 'uint256', indexed: false }
    ])
];

// =============================================================
//                      HELPERS
// =============================================================
const ONE_E18 = 1_000_000_000_000_000_000n;

/**
 * BigInt or string (Solidity 18-decimal "wei") → floating-point QRL.
 * Note: this is the on-chain accounting unit (1e18-scaled), NOT QRL's beacon-chain
 * "Planck" (1e9). The pool contract tracks balances in 18-decimal units; the deposit
 * data's `amount` field that goes into the beacon contract is in 1e9 Planck. Different
 * units, different layers. Precision loss in the float cast is acceptable for gauges.
 */
function weiToQrl(v) {
    const bi = typeof v === 'bigint' ? v : BigInt(v);
    const whole = Number(bi / ONE_E18);
    const frac = Number(bi % ONE_E18) / 1e18;
    return whole + frac;
}

// =============================================================
//                     CONTRACT MONITOR
// =============================================================

class ContractMonitor {
    constructor(web3, metrics, config) {
        this.web3 = web3;
        this.metrics = metrics;
        this.config = config;
        this.lastUpdate = null;
        this.contracts = {};
        this.lastProcessedBlock = 0n;
    }

    async start() {
        console.log('Initializing v2 contract monitor...');

        this.contracts.stQRL = new this.web3.qrl.Contract(STQRL_ABI, this.config.STQRL_ADDRESS);
        this.contracts.pool = new this.web3.qrl.Contract(POOL_ABI, this.config.DEPOSIT_POOL_ADDRESS);
        this.contracts.vm = new this.web3.qrl.Contract(VM_ABI, this.config.VALIDATOR_MANAGER_ADDRESS);

        console.log('Contracts initialized:');
        console.log(`  stQRLv2:          ${this.config.STQRL_ADDRESS}`);
        console.log(`  DepositPoolV2:    ${this.config.DEPOSIT_POOL_ADDRESS}`);
        console.log(`  ValidatorManager: ${this.config.VALIDATOR_MANAGER_ADDRESS}`);

        this.lastProcessedBlock = await this.web3.qrl.getBlockNumber();
        console.log(`Starting from block ${this.lastProcessedBlock}`);

        await this.collectMetrics();

        setInterval(() => this.collectMetrics(), this.config.SCRAPE_INTERVAL_MS);
        setInterval(() => this.pollEvents(), this.config.EVENT_POLL_INTERVAL_MS);

        console.log('Contract monitor started');
    }

    async safeCall(fn, defaultValue, label) {
        try {
            return await fn();
        } catch (error) {
            console.warn(`Contract call failed [${label || '?'}]: ${error.message}`);
            this.metrics.rpcErrors.inc({ method: label || 'call', error: error.code || 'unknown' });
            return defaultValue;
        }
    }

    async collectMetrics() {
        const startTime = Date.now();

        try {
            const blockNumber = await this.web3.qrl.getBlockNumber();
            this.metrics.blockHeight.set(Number(blockNumber));

            const poolBalance = await this.web3.qrl.getBalance(this.config.DEPOSIT_POOL_ADDRESS);
            this.metrics.poolBalance.set(weiToQrl(poolBalance));

            // stQRL reads
            const [totalPooled, totalShares, exchangeRate, stQRLPaused] = await Promise.all([
                this.safeCall(() => this.contracts.stQRL.methods.totalPooledQRL().call(), 0n, 'stQRL.totalPooledQRL'),
                this.safeCall(() => this.contracts.stQRL.methods.totalShares().call(), 0n, 'stQRL.totalShares'),
                this.safeCall(() => this.contracts.stQRL.methods.getExchangeRate().call(), ONE_E18, 'stQRL.getExchangeRate'),
                this.safeCall(() => this.contracts.stQRL.methods.paused().call(), false, 'stQRL.paused')
            ]);

            this.metrics.totalPooledQRL.set(weiToQrl(totalPooled));
            this.metrics.totalShares.set(weiToQrl(totalShares));
            this.metrics.exchangeRate.set(Number(exchangeRate));
            this.metrics.exchangeRateNormalized.set(Number(exchangeRate) / 1e18);
            this.metrics.stQRLPaused.set(stQRLPaused ? 1 : 0);

            // DepositPool reads
            const [
                buffered,
                validatorCount,
                withdrawalReserve,
                totalWithdrawalShares,
                totalRewards,
                totalSlashing,
                minDeposit,
                poolPaused
            ] = await Promise.all([
                this.safeCall(() => this.contracts.pool.methods.bufferedQRL().call(), 0n, 'pool.bufferedQRL'),
                this.safeCall(() => this.contracts.pool.methods.validatorCount().call(), 0n, 'pool.validatorCount'),
                this.safeCall(() => this.contracts.pool.methods.withdrawalReserve().call(), 0n, 'pool.withdrawalReserve'),
                this.safeCall(() => this.contracts.pool.methods.totalWithdrawalShares().call(), 0n, 'pool.totalWithdrawalShares'),
                this.safeCall(() => this.contracts.pool.methods.totalRewardsReceived().call(), 0n, 'pool.totalRewardsReceived'),
                this.safeCall(() => this.contracts.pool.methods.totalSlashingLosses().call(), 0n, 'pool.totalSlashingLosses'),
                this.safeCall(() => this.contracts.pool.methods.minDeposit().call(), 0n, 'pool.minDeposit'),
                this.safeCall(() => this.contracts.pool.methods.paused().call(), false, 'pool.paused')
            ]);

            this.metrics.bufferedQRL.set(weiToQrl(buffered));
            this.metrics.validatorCount.set(Number(validatorCount));
            this.metrics.withdrawalReserve.set(weiToQrl(withdrawalReserve));
            this.metrics.pendingWithdrawalShares.set(weiToQrl(totalWithdrawalShares));
            this.metrics.totalRewards.set(weiToQrl(totalRewards));
            this.metrics.totalSlashing.set(weiToQrl(totalSlashing));
            this.metrics.minDeposit.set(weiToQrl(minDeposit));
            this.metrics.poolPaused.set(poolPaused ? 1 : 0);

            // ValidatorManager reads
            const [vmTotal, vmActive, vmPending] = await Promise.all([
                this.safeCall(() => this.contracts.vm.methods.totalValidators().call(), 0n, 'vm.totalValidators'),
                this.safeCall(() => this.contracts.vm.methods.activeValidatorCount().call(), 0n, 'vm.activeValidatorCount'),
                this.safeCall(() => this.contracts.vm.methods.pendingValidatorCount().call(), 0n, 'vm.pendingValidatorCount')
            ]);

            this.metrics.vmTotalValidators.set(Number(vmTotal));
            this.metrics.vmActiveValidators.set(Number(vmActive));
            this.metrics.vmPendingValidators.set(Number(vmPending));

            const latency = (Date.now() - startTime) / 1000;
            this.metrics.rpcLatency.observe({ method: 'collectMetrics' }, latency);

            this.lastUpdate = new Date().toISOString();
            this.metrics.lastUpdateTimestamp.set(Math.floor(Date.now() / 1000));

            console.log(
                `Metrics collected in ${latency.toFixed(2)}s — ` +
                `block=${blockNumber} pooled=${weiToQrl(totalPooled).toFixed(4)} QRL ` +
                `shares=${weiToQrl(totalShares).toFixed(4)} rate=${(Number(exchangeRate) / 1e18).toFixed(6)} ` +
                `validators=${validatorCount}/${vmActive}a`
            );
        } catch (error) {
            console.error('Error collecting metrics:', error.message);
            this.metrics.rpcErrors.inc({ method: 'collectMetrics', error: error.code || 'unknown' });
        }
    }

    async pollEvents() {
        try {
            const currentBlock = await this.web3.qrl.getBlockNumber();

            if (currentBlock > this.lastProcessedBlock) {
                await this.processEvents(this.lastProcessedBlock + 1n, currentBlock);
                this.lastProcessedBlock = currentBlock;
            }
        } catch (error) {
            console.error('Error polling events:', error.message);
            this.metrics.rpcErrors.inc({ method: 'pollEvents', error: error.code || 'unknown' });
        }
    }

    async processEvents(fromBlock, toBlock) {
        const range = { fromBlock, toBlock };

        const count = async (contract, evtName, handler) => {
            try {
                const events = await contract.getPastEvents(evtName, range);
                events.forEach(handler);
                if (events.length > 0) {
                    console.log(`  ${evtName}: +${events.length}`);
                }
            } catch (error) {
                console.warn(`getPastEvents(${evtName}) failed: ${error.message}`);
            }
        };

        await Promise.all([
            count(this.contracts.pool, 'Deposited', () => this.metrics.depositEvents.inc()),
            count(this.contracts.pool, 'WithdrawalRequested', () => this.metrics.withdrawalEvents.inc({ type: 'requested' })),
            count(this.contracts.pool, 'WithdrawalClaimed', () => this.metrics.withdrawalEvents.inc({ type: 'claimed' })),
            count(this.contracts.pool, 'WithdrawalCancelled', () => this.metrics.withdrawalEvents.inc({ type: 'cancelled' })),
            count(this.contracts.pool, 'ValidatorFunded', () => this.metrics.validatorFundedEvents.inc()),
            count(this.contracts.pool, 'RewardsSynced', () => this.metrics.rewardsSyncEvents.inc()),
            count(this.contracts.pool, 'SlashingDetected', () => this.metrics.slashingEvents.inc()),
            count(this.contracts.vm, 'ValidatorRegistered', () => this.metrics.vmEvents.inc({ type: 'registered' })),
            count(this.contracts.vm, 'ValidatorActivated', () => this.metrics.vmEvents.inc({ type: 'activated' })),
            count(this.contracts.vm, 'ValidatorExitRequested', () => this.metrics.vmEvents.inc({ type: 'exit_requested' })),
            count(this.contracts.vm, 'ValidatorExited', () => this.metrics.vmEvents.inc({ type: 'exited' })),
            count(this.contracts.vm, 'ValidatorSlashed', () => this.metrics.vmEvents.inc({ type: 'slashed' }))
        ]);
    }
}

module.exports = { ContractMonitor };
