/**
 * Prometheus metrics definitions for QuantaPool v2.
 *
 * Metric naming convention: quantapool_<area>_<noun>[_<unit>]
 *   area  = pool | stqrl | vm | rpc | exporter
 *   unit  = qrl (converted from planck) | shares | bool | seconds | bps
 */

const { Gauge, Counter, Histogram } = require('prom-client');

function setupMetrics(register) {
    // =========================================================
    //  stQRLv2 token
    // =========================================================
    const totalPooledQRL = new Gauge({
        name: 'quantapool_total_pooled_qrl',
        help: 'Total QRL managed by the protocol (buffer + staked + reserve accounted via stQRL.totalPooledQRL)',
        registers: [register]
    });
    const totalShares = new Gauge({
        name: 'quantapool_total_shares',
        help: 'Total stQRL shares outstanding (stQRL.totalShares, human-scaled QRL equivalent)',
        registers: [register]
    });
    const exchangeRate = new Gauge({
        name: 'quantapool_exchange_rate',
        help: 'QRL per share, raw 1e18-scaled uint256 (stQRL.getExchangeRate)',
        registers: [register]
    });
    const exchangeRateNormalized = new Gauge({
        name: 'quantapool_exchange_rate_normalized',
        help: 'QRL per share as a float (1.0 = 1:1)',
        registers: [register]
    });
    const stQRLPaused = new Gauge({
        name: 'quantapool_stqrl_paused',
        help: 'stQRL token paused flag (1=paused, 0=active)',
        registers: [register]
    });

    // =========================================================
    //  DepositPoolV2
    // =========================================================
    const bufferedQRL = new Gauge({
        name: 'quantapool_buffered_qrl',
        help: 'QRL sitting in the pool buffer waiting to fund a validator (DepositPool.bufferedQRL)',
        registers: [register]
    });
    const validatorCount = new Gauge({
        name: 'quantapool_validator_count',
        help: 'Validators funded by the pool (DepositPool.validatorCount)',
        registers: [register]
    });
    const withdrawalReserve = new Gauge({
        name: 'quantapool_withdrawal_reserve_qrl',
        help: 'QRL earmarked for pending withdrawal claims (DepositPool.withdrawalReserve)',
        registers: [register]
    });
    const pendingWithdrawalShares = new Gauge({
        name: 'quantapool_pending_withdrawal_shares',
        help: 'Shares locked for pending withdrawals across all users (DepositPool.totalWithdrawalShares)',
        registers: [register]
    });
    const totalRewards = new Gauge({
        name: 'quantapool_total_rewards_qrl',
        help: 'Cumulative rewards accrued since deploy (DepositPool.totalRewardsReceived)',
        registers: [register]
    });
    const totalSlashing = new Gauge({
        name: 'quantapool_total_slashing_qrl',
        help: 'Cumulative slashing losses since deploy (DepositPool.totalSlashingLosses)',
        registers: [register]
    });
    const minDeposit = new Gauge({
        name: 'quantapool_min_deposit_qrl',
        help: 'Minimum deposit threshold enforced by DepositPool (DepositPool.minDeposit)',
        registers: [register]
    });
    const poolPaused = new Gauge({
        name: 'quantapool_deposit_pool_paused',
        help: 'DepositPool paused flag (1=paused, 0=active)',
        registers: [register]
    });
    const poolBalance = new Gauge({
        name: 'quantapool_deposit_pool_balance_qrl',
        help: 'Native QRL balance of the DepositPool contract (should == pooled + reserve + buffered)',
        registers: [register]
    });

    // =========================================================
    //  ValidatorManager
    // =========================================================
    const vmTotalValidators = new Gauge({
        name: 'quantapool_vm_total_validators',
        help: 'Validators ever registered on ValidatorManager (includes exited/slashed)',
        registers: [register]
    });
    const vmPendingValidators = new Gauge({
        name: 'quantapool_vm_pending_validators',
        help: 'Validators in Pending state (registered, awaiting activation)',
        registers: [register]
    });
    const vmActiveValidators = new Gauge({
        name: 'quantapool_vm_active_validators',
        help: 'Validators in Active state',
        registers: [register]
    });

    // =========================================================
    //  Event counters (v2 events)
    // =========================================================
    const depositEvents = new Counter({
        name: 'quantapool_deposit_events_total',
        help: 'DepositPool Deposited events seen',
        registers: [register]
    });
    const withdrawalEvents = new Counter({
        name: 'quantapool_withdrawal_events_total',
        help: 'DepositPool withdrawal-lifecycle events seen',
        labelNames: ['type'], // requested | claimed | cancelled
        registers: [register]
    });
    const validatorFundedEvents = new Counter({
        name: 'quantapool_validator_funded_events_total',
        help: 'DepositPool ValidatorFunded events (real or MVP path)',
        registers: [register]
    });
    const rewardsSyncEvents = new Counter({
        name: 'quantapool_rewards_sync_events_total',
        help: 'DepositPool RewardsSynced events (trustless reward attribution)',
        registers: [register]
    });
    const slashingEvents = new Counter({
        name: 'quantapool_slashing_events_total',
        help: 'DepositPool SlashingDetected events',
        registers: [register]
    });
    const vmEvents = new Counter({
        name: 'quantapool_vm_events_total',
        help: 'ValidatorManager lifecycle events seen',
        labelNames: ['type'], // registered | activated | exit_requested | exited | slashed
        registers: [register]
    });

    // =========================================================
    //  Exporter / RPC health
    // =========================================================
    const blockHeight = new Gauge({
        name: 'quantapool_block_height',
        help: 'Latest block number observed by the exporter',
        registers: [register]
    });
    const lastUpdateTimestamp = new Gauge({
        name: 'quantapool_exporter_last_update_timestamp',
        help: 'Unix timestamp of last successful scrape',
        registers: [register]
    });
    const rpcLatency = new Histogram({
        name: 'quantapool_rpc_latency_seconds',
        help: 'RPC round-trip latency for a full scrape',
        labelNames: ['method'],
        buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [register]
    });
    const rpcErrors = new Counter({
        name: 'quantapool_rpc_errors_total',
        help: 'RPC errors by method and class',
        labelNames: ['method', 'error'],
        registers: [register]
    });

    return {
        // stQRL
        totalPooledQRL,
        totalShares,
        exchangeRate,
        exchangeRateNormalized,
        stQRLPaused,
        // pool
        bufferedQRL,
        validatorCount,
        withdrawalReserve,
        pendingWithdrawalShares,
        totalRewards,
        totalSlashing,
        minDeposit,
        poolPaused,
        poolBalance,
        // VM
        vmTotalValidators,
        vmPendingValidators,
        vmActiveValidators,
        // events
        depositEvents,
        withdrawalEvents,
        validatorFundedEvents,
        rewardsSyncEvents,
        slashingEvents,
        vmEvents,
        // health
        blockHeight,
        lastUpdateTimestamp,
        rpcLatency,
        rpcErrors
    };
}

module.exports = { setupMetrics };
