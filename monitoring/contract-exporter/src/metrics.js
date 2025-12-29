/**
 * Prometheus metrics definitions for QuantaPool
 */

const { Gauge, Counter, Histogram } = require('prom-client');

function setupMetrics(register) {
    // ============================================
    // DEPOSIT POOL METRICS
    // ============================================
    const pendingDeposits = new Gauge({
        name: 'quantapool_pending_deposits_qrl',
        help: 'QRL waiting in deposit queue (in ether units)',
        registers: [register]
    });

    const liquidReserve = new Gauge({
        name: 'quantapool_liquid_reserve_qrl',
        help: 'QRL available for immediate withdrawals',
        registers: [register]
    });

    const validatorCount = new Gauge({
        name: 'quantapool_validator_count',
        help: 'Number of validators created',
        registers: [register]
    });

    const pendingWithdrawals = new Gauge({
        name: 'quantapool_pending_withdrawals_qrl',
        help: 'Total QRL in pending withdrawal requests',
        registers: [register]
    });

    const contractPaused = new Gauge({
        name: 'quantapool_deposit_pool_paused',
        help: 'Whether the deposit pool is paused (1=paused, 0=active)',
        registers: [register]
    });

    const depositPoolBalance = new Gauge({
        name: 'quantapool_deposit_pool_balance_qrl',
        help: 'Native QRL balance of the deposit pool contract',
        registers: [register]
    });

    // ============================================
    // stQRL TOKEN METRICS
    // ============================================
    const totalAssets = new Gauge({
        name: 'quantapool_total_assets_qrl',
        help: 'Total QRL assets under management',
        registers: [register]
    });

    const totalSupply = new Gauge({
        name: 'quantapool_stqrl_total_supply',
        help: 'Total stQRL token supply',
        registers: [register]
    });

    const exchangeRate = new Gauge({
        name: 'quantapool_exchange_rate',
        help: 'stQRL to QRL exchange rate (scaled by 1e18)',
        registers: [register]
    });

    const exchangeRateNormalized = new Gauge({
        name: 'quantapool_exchange_rate_normalized',
        help: 'stQRL to QRL exchange rate (1.0 = 1:1)',
        registers: [register]
    });

    // ============================================
    // REWARDS ORACLE METRICS
    // ============================================
    const lastReportTimestamp = new Gauge({
        name: 'quantapool_oracle_last_report_timestamp',
        help: 'Unix timestamp of last oracle report',
        registers: [register]
    });

    const lastReportedBalance = new Gauge({
        name: 'quantapool_oracle_last_balance_qrl',
        help: 'Last reported validator balance from oracle',
        registers: [register]
    });

    const oracleCooldownRemaining = new Gauge({
        name: 'quantapool_oracle_cooldown_seconds',
        help: 'Seconds remaining until next report allowed',
        registers: [register]
    });

    // ============================================
    // OPERATOR REGISTRY METRICS
    // ============================================
    const totalOperators = new Gauge({
        name: 'quantapool_total_operators',
        help: 'Number of registered operators',
        registers: [register]
    });

    const commissionRate = new Gauge({
        name: 'quantapool_commission_rate_bps',
        help: 'Commission rate in basis points',
        registers: [register]
    });

    // ============================================
    // EVENT COUNTERS
    // ============================================
    const depositEvents = new Counter({
        name: 'quantapool_deposit_events_total',
        help: 'Total number of deposit events',
        labelNames: ['status'],
        registers: [register]
    });

    const withdrawalEvents = new Counter({
        name: 'quantapool_withdrawal_events_total',
        help: 'Total number of withdrawal events',
        labelNames: ['type'],
        registers: [register]
    });

    const validatorEvents = new Counter({
        name: 'quantapool_validator_events_total',
        help: 'Total number of validator events',
        labelNames: ['type'],
        registers: [register]
    });

    const oracleReportEvents = new Counter({
        name: 'quantapool_oracle_report_events_total',
        help: 'Total number of oracle report submissions',
        registers: [register]
    });

    // ============================================
    // RPC HEALTH METRICS
    // ============================================
    const rpcLatency = new Histogram({
        name: 'quantapool_rpc_latency_seconds',
        help: 'RPC call latency in seconds',
        labelNames: ['method'],
        buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [register]
    });

    const rpcErrors = new Counter({
        name: 'quantapool_rpc_errors_total',
        help: 'Total RPC errors',
        labelNames: ['method', 'error'],
        registers: [register]
    });

    const blockHeight = new Gauge({
        name: 'quantapool_block_height',
        help: 'Current block height from RPC',
        registers: [register]
    });

    const lastUpdateTimestamp = new Gauge({
        name: 'quantapool_exporter_last_update_timestamp',
        help: 'Unix timestamp of last successful metrics collection',
        registers: [register]
    });

    return {
        // Deposit Pool
        pendingDeposits,
        liquidReserve,
        validatorCount,
        pendingWithdrawals,
        contractPaused,
        depositPoolBalance,
        // stQRL
        totalAssets,
        totalSupply,
        exchangeRate,
        exchangeRateNormalized,
        // Oracle
        lastReportTimestamp,
        lastReportedBalance,
        oracleCooldownRemaining,
        // Operators
        totalOperators,
        commissionRate,
        // Events
        depositEvents,
        withdrawalEvents,
        validatorEvents,
        oracleReportEvents,
        // RPC
        rpcLatency,
        rpcErrors,
        blockHeight,
        lastUpdateTimestamp
    };
}

module.exports = { setupMetrics };
