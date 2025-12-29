/**
 * QuantaPool Contract Metrics Exporter
 *
 * Prometheus exporter for QuantaPool smart contract metrics on QRL Zond.
 * Collects metrics from stQRL, DepositPool, RewardsOracle, and OperatorRegistry contracts.
 */

const express = require('express');
const { collectDefaultMetrics, Registry } = require('prom-client');
const { Web3 } = require('@theqrl/web3');
const { setupMetrics } = require('./metrics');
const { ContractMonitor } = require('./contracts');
const config = require('./config');

const app = express();
const register = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({
    register,
    prefix: 'quantapool_exporter_'
});

let monitor = null;

async function main() {
    console.log('='.repeat(60));
    console.log('QuantaPool Contract Metrics Exporter');
    console.log('='.repeat(60));
    console.log('');
    console.log('Configuration:');
    console.log(`  RPC URL: ${config.ZOND_RPC_URL}`);
    console.log(`  Metrics Port: ${config.METRICS_PORT}`);
    console.log(`  Scrape Interval: ${config.SCRAPE_INTERVAL_MS}ms`);
    console.log(`  Event Poll Interval: ${config.EVENT_POLL_INTERVAL_MS}ms`);
    console.log('');

    // Initialize Web3 connection
    console.log('Connecting to Zond RPC...');
    const web3 = new Web3(config.ZOND_RPC_URL);

    // Test connection
    try {
        const blockNumber = await web3.zond.getBlockNumber();
        const chainId = await web3.zond.getChainId();
        console.log(`Connected! Chain ID: ${chainId}, Block: ${blockNumber}`);
    } catch (error) {
        console.error('Failed to connect to Zond RPC:', error.message);
        process.exit(1);
    }

    // Setup custom metrics
    const metrics = setupMetrics(register);

    // Initialize contract monitor
    monitor = new ContractMonitor(web3, metrics, config);

    // Start monitoring
    await monitor.start();

    // ============================================
    // HTTP Endpoints
    // ============================================

    // Prometheus metrics endpoint
    app.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', register.contentType);
            res.end(await register.metrics());
        } catch (error) {
            console.error('Error serving metrics:', error);
            res.status(500).end(error.message);
        }
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        const healthy = monitor && monitor.lastUpdate;
        const lastUpdateAge = monitor?.lastUpdate
            ? Math.floor((Date.now() - new Date(monitor.lastUpdate).getTime()) / 1000)
            : null;

        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'healthy' : 'unhealthy',
            lastUpdate: monitor?.lastUpdate || null,
            lastUpdateAgeSeconds: lastUpdateAge,
            uptime: process.uptime()
        });
    });

    // Ready check endpoint
    app.get('/ready', (req, res) => {
        if (monitor && monitor.lastUpdate) {
            res.status(200).json({ ready: true });
        } else {
            res.status(503).json({ ready: false, reason: 'Not yet collected metrics' });
        }
    });

    // Root endpoint with info
    app.get('/', (req, res) => {
        res.json({
            name: 'QuantaPool Contract Metrics Exporter',
            version: '1.0.0',
            endpoints: {
                metrics: '/metrics',
                health: '/health',
                ready: '/ready'
            },
            contracts: {
                stQRL: config.STQRL_ADDRESS,
                depositPool: config.DEPOSIT_POOL_ADDRESS,
                rewardsOracle: config.REWARDS_ORACLE_ADDRESS,
                operatorRegistry: config.OPERATOR_REGISTRY_ADDRESS
            }
        });
    });

    // Start HTTP server
    app.listen(config.METRICS_PORT, '0.0.0.0', () => {
        console.log('');
        console.log(`Metrics server listening on http://0.0.0.0:${config.METRICS_PORT}`);
        console.log('');
        console.log('Endpoints:');
        console.log(`  GET /metrics - Prometheus metrics`);
        console.log(`  GET /health  - Health check`);
        console.log(`  GET /ready   - Readiness check`);
        console.log('');
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down...');
    process.exit(0);
});

// Start the exporter
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
