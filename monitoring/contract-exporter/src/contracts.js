/**
 * Contract monitoring logic for QuantaPool
 */

const fs = require('fs');
const path = require('path');

class ContractMonitor {
    constructor(web3, metrics, config) {
        this.web3 = web3;
        this.metrics = metrics;
        this.config = config;
        this.lastUpdate = null;
        this.contracts = {};
        this.lastProcessedBlock = 0n;
    }

    /**
     * Load contract artifact from file or use bundled ABI
     */
    loadArtifact(name) {
        // Try to load from artifacts folder (relative to monitoring dir or QuantaPool root)
        const possiblePaths = [
            path.join(__dirname, '..', '..', '..', 'artifacts', `${name}.json`),  // From monitoring/contract-exporter/src
            path.join(process.cwd(), 'artifacts', `${name}.json`),  // From cwd
            path.join(process.cwd(), '..', 'artifacts', `${name}.json`),  // Up one level
        ];

        for (const artifactPath of possiblePaths) {
            if (fs.existsSync(artifactPath)) {
                console.log(`  Loading ${name} ABI from ${artifactPath}`);
                const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
                return artifact.abi;
            }
        }

        console.warn(`  Warning: Could not find ${name}.json artifact, using minimal ABI`);
        return null;
    }

    async start() {
        console.log('Initializing contract monitor...');

        // Load contract ABIs
        await this.initializeContracts();

        // Get initial block number
        this.lastProcessedBlock = await this.web3.zond.getBlockNumber();
        console.log(`Starting from block ${this.lastProcessedBlock}`);

        // Initial metrics collection
        await this.collectMetrics();

        // Start periodic collection
        setInterval(() => this.collectMetrics(), this.config.SCRAPE_INTERVAL_MS);

        // Start event polling (separate interval for events)
        setInterval(() => this.pollEvents(), this.config.EVENT_POLL_INTERVAL_MS);

        console.log('Contract monitor started');
    }

    async initializeContracts() {
        // Load ABIs from artifacts or use fallback minimal ABIs
        const stQRLABI = this.loadArtifact('stQRL') || this.getMinimalStQRLABI();
        const depositPoolABI = this.loadArtifact('DepositPool') || this.getMinimalDepositPoolABI();
        const rewardsOracleABI = this.loadArtifact('RewardsOracle') || this.getMinimalRewardsOracleABI();
        const operatorRegistryABI = this.loadArtifact('OperatorRegistry') || this.getMinimalOperatorRegistryABI();

        // Initialize contract instances
        this.contracts.stQRL = new this.web3.zond.Contract(stQRLABI, this.config.STQRL_ADDRESS);
        this.contracts.depositPool = new this.web3.zond.Contract(depositPoolABI, this.config.DEPOSIT_POOL_ADDRESS);
        this.contracts.rewardsOracle = new this.web3.zond.Contract(rewardsOracleABI, this.config.REWARDS_ORACLE_ADDRESS);
        this.contracts.operatorRegistry = new this.web3.zond.Contract(operatorRegistryABI, this.config.OPERATOR_REGISTRY_ADDRESS);

        console.log('Contracts initialized:');
        console.log(`  stQRL: ${this.config.STQRL_ADDRESS}`);
        console.log(`  DepositPool: ${this.config.DEPOSIT_POOL_ADDRESS}`);
        console.log(`  RewardsOracle: ${this.config.REWARDS_ORACLE_ADDRESS}`);
        console.log(`  OperatorRegistry: ${this.config.OPERATOR_REGISTRY_ADDRESS}`);
    }

    // Fallback minimal ABIs (in case artifacts not available)
    getMinimalStQRLABI() {
        return [
            { name: 'totalAssets', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'totalSupply', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'getExchangeRate', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
        ];
    }

    getMinimalDepositPoolABI() {
        return [
            { name: 'pendingDeposits', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'liquidReserve', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'validatorCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'pendingWithdrawals', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'paused', type: 'function', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' }
        ];
    }

    getMinimalRewardsOracleABI() {
        return [
            { name: 'lastReportTimestamp', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'lastReportedBalance', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'reportCooldown', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
        ];
    }

    getMinimalOperatorRegistryABI() {
        return [
            { name: 'commissionRate', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
            { name: 'getOperatorCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
        ];
    }

    async collectMetrics() {
        const startTime = Date.now();

        try {
            // Get current block
            const blockNumber = await this.web3.zond.getBlockNumber();
            this.metrics.blockHeight.set(Number(blockNumber));

            // Get deposit pool native balance
            const poolBalance = await this.web3.zond.getBalance(this.config.DEPOSIT_POOL_ADDRESS);
            this.metrics.depositPoolBalance.set(Number(this.web3.utils.fromWei(poolBalance, 'ether')));

            // Collect Deposit Pool metrics
            const [pendingDeposits, liquidReserve, validatorCount, pendingWithdrawals, dpPaused] = await Promise.all([
                this.safeCall(() => this.contracts.depositPool.methods.pendingDeposits().call(), 0n),
                this.safeCall(() => this.contracts.depositPool.methods.liquidReserve().call(), 0n),
                this.safeCall(() => this.contracts.depositPool.methods.validatorCount().call(), 0n),
                this.safeCall(() => this.contracts.depositPool.methods.pendingWithdrawals().call(), 0n),
                this.safeCall(() => this.contracts.depositPool.methods.paused().call(), false)
            ]);

            this.metrics.pendingDeposits.set(Number(this.web3.utils.fromWei(pendingDeposits.toString(), 'ether')));
            this.metrics.liquidReserve.set(Number(this.web3.utils.fromWei(liquidReserve.toString(), 'ether')));
            this.metrics.validatorCount.set(Number(validatorCount));
            this.metrics.pendingWithdrawals.set(Number(this.web3.utils.fromWei(pendingWithdrawals.toString(), 'ether')));
            this.metrics.contractPaused.set(dpPaused ? 1 : 0);

            // Collect stQRL metrics
            const [totalAssets, totalSupply, exchangeRate] = await Promise.all([
                this.safeCall(() => this.contracts.stQRL.methods.totalAssets().call(), 0n),
                this.safeCall(() => this.contracts.stQRL.methods.totalSupply().call(), 0n),
                this.safeCall(() => this.contracts.stQRL.methods.getExchangeRate().call(), BigInt(1e18))
            ]);

            this.metrics.totalAssets.set(Number(this.web3.utils.fromWei(totalAssets.toString(), 'ether')));
            this.metrics.totalSupply.set(Number(this.web3.utils.fromWei(totalSupply.toString(), 'ether')));
            this.metrics.exchangeRate.set(Number(exchangeRate));
            this.metrics.exchangeRateNormalized.set(Number(exchangeRate) / 1e18);

            // Collect Oracle metrics
            const [lastReportTimestamp, lastReportedBalance, reportCooldown] = await Promise.all([
                this.safeCall(() => this.contracts.rewardsOracle.methods.lastReportTimestamp().call(), 0n),
                this.safeCall(() => this.contracts.rewardsOracle.methods.lastReportedBalance().call(), 0n),
                this.safeCall(() => this.contracts.rewardsOracle.methods.reportCooldown().call(), 0n)
            ]);

            const now = Math.floor(Date.now() / 1000);
            const cooldownRemaining = Math.max(0, Number(lastReportTimestamp) + Number(reportCooldown) - now);

            this.metrics.lastReportTimestamp.set(Number(lastReportTimestamp));
            this.metrics.lastReportedBalance.set(Number(this.web3.utils.fromWei(lastReportedBalance.toString(), 'ether')));
            this.metrics.oracleCooldownRemaining.set(cooldownRemaining);

            // Collect Operator Registry metrics
            const [totalOperators, commissionRate] = await Promise.all([
                this.safeCall(() => this.contracts.operatorRegistry.methods.getOperatorCount().call(), 0n),
                this.safeCall(() => this.contracts.operatorRegistry.methods.commissionRate().call(), 0n)
            ]);

            this.metrics.totalOperators.set(Number(totalOperators));
            this.metrics.commissionRate.set(Number(commissionRate));

            // Record latency
            const latency = (Date.now() - startTime) / 1000;
            this.metrics.rpcLatency.observe({ method: 'collectMetrics' }, latency);

            this.lastUpdate = new Date().toISOString();
            this.metrics.lastUpdateTimestamp.set(Math.floor(Date.now() / 1000));

            console.log(`Metrics collected in ${latency.toFixed(2)}s - Block: ${blockNumber}, TVL: ${this.web3.utils.fromWei(totalAssets.toString(), 'ether')} QRL`);

        } catch (error) {
            console.error('Error collecting metrics:', error.message);
            this.metrics.rpcErrors.inc({ method: 'collectMetrics', error: error.code || 'unknown' });
        }
    }

    async safeCall(fn, defaultValue) {
        try {
            return await fn();
        } catch (error) {
            console.warn(`Contract call failed: ${error.message}`);
            return defaultValue;
        }
    }

    async pollEvents() {
        try {
            const currentBlock = await this.web3.zond.getBlockNumber();

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
        console.log(`Processing events from block ${fromBlock} to ${toBlock}`);

        try {
            // Process Deposited events
            const depositedEvents = await this.contracts.depositPool.getPastEvents('Deposited', { fromBlock, toBlock });
            depositedEvents.forEach(() => {
                this.metrics.depositEvents.inc({ status: 'success' });
            });
            if (depositedEvents.length > 0) {
                console.log(`  Found ${depositedEvents.length} Deposited events`);
            }

            // Process Withdrawal events
            const withdrawalRequestedEvents = await this.contracts.depositPool.getPastEvents('WithdrawalRequested', { fromBlock, toBlock });
            withdrawalRequestedEvents.forEach(() => {
                this.metrics.withdrawalEvents.inc({ type: 'requested' });
            });

            const withdrawalClaimedEvents = await this.contracts.depositPool.getPastEvents('WithdrawalClaimed', { fromBlock, toBlock });
            withdrawalClaimedEvents.forEach(() => {
                this.metrics.withdrawalEvents.inc({ type: 'claimed' });
            });

            // Process Validator events
            const validatorFundedEvents = await this.contracts.depositPool.getPastEvents('ValidatorFunded', { fromBlock, toBlock });
            validatorFundedEvents.forEach(() => {
                this.metrics.validatorEvents.inc({ type: 'funded' });
            });

            const validatorStakedEvents = await this.contracts.depositPool.getPastEvents('ValidatorStaked', { fromBlock, toBlock });
            validatorStakedEvents.forEach(() => {
                this.metrics.validatorEvents.inc({ type: 'staked' });
            });

            // Process Oracle reports
            const reportEvents = await this.contracts.rewardsOracle.getPastEvents('ReportSubmitted', { fromBlock, toBlock });
            reportEvents.forEach(() => {
                this.metrics.oracleReportEvents.inc();
            });
            if (reportEvents.length > 0) {
                console.log(`  Found ${reportEvents.length} oracle report events`);
            }

        } catch (error) {
            console.error('Error processing events:', error.message);
        }
    }
}

module.exports = { ContractMonitor };
