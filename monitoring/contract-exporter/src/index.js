require('dotenv').config();
const express = require('express');
const { Registry, collectDefaultMetrics } = require('prom-client');
const { Web3 } = require('@theqrl/web3');
const { loadConfig } = require('./config');
const { setupMetrics } = require('./metrics');
const { ContractMonitor } = require('./contracts');

async function main() {
    const config = loadConfig();
    const register = new Registry();
    collectDefaultMetrics({ register, prefix: 'quantapool_exporter_' });
    const monitor = new ContractMonitor(new Web3(config.rpcUrl), setupMetrics(register), config);
    await monitor.start();
    const app = express();
    app.get('/metrics', async (_req, res) => {
        try { res.type(register.contentType).send(await register.metrics()); }
        catch { res.status(503).end(); }
    });
    app.get('/health', (_req, res) => {
        const healthy = monitor.lastUpdate !== 0 && Date.now() - monitor.lastUpdate <= config.interval * 3;
        res.status(healthy ? 200 : 503).json({ healthy, lastUpdate: monitor.lastUpdate });
    });
    const server = app.listen(config.port, config.host);
    const stop = () => { monitor.stop(); server.close(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
