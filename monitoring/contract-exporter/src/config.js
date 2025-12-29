/**
 * Configuration loader for QuantaPool Contract Exporter
 */

require('dotenv').config();

const config = {
    // Zond RPC endpoint
    ZOND_RPC_URL: process.env.ZOND_RPC_URL || 'https://qrlwallet.com/api/zond-rpc/testnet',

    // Contract addresses (Z-prefix format for Zond)
    STQRL_ADDRESS: process.env.STQRL_ADDRESS || 'Z844A6eB87927780E938908743eA24a56A220Efe8',
    DEPOSIT_POOL_ADDRESS: process.env.DEPOSIT_POOL_ADDRESS || 'Z9E800e8271df4Ac91334C65641405b04584B57DC',
    REWARDS_ORACLE_ADDRESS: process.env.REWARDS_ORACLE_ADDRESS || 'Z541b1f2c501956BCd7a4a6913180b2Fc27BdE17E',
    OPERATOR_REGISTRY_ADDRESS: process.env.OPERATOR_REGISTRY_ADDRESS || 'ZD370e9505D265381e839f8289f46D02815d0FF95',

    // Metrics server port
    METRICS_PORT: parseInt(process.env.METRICS_PORT) || 9101,

    // How often to scrape contract state (milliseconds)
    SCRAPE_INTERVAL_MS: parseInt(process.env.CONTRACT_SCRAPE_INTERVAL) || 30000,

    // Event polling interval (milliseconds) - Zond has 60s block time
    EVENT_POLL_INTERVAL_MS: parseInt(process.env.EVENT_POLL_INTERVAL_MS) || 60000,
};

// Validate required configuration
function validateConfig() {
    const required = ['ZOND_RPC_URL', 'STQRL_ADDRESS', 'DEPOSIT_POOL_ADDRESS'];
    const missing = required.filter(key => !config[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }

    // Validate address format - QRL/Zond uses Z-prefix natively
    ['STQRL_ADDRESS', 'DEPOSIT_POOL_ADDRESS', 'REWARDS_ORACLE_ADDRESS', 'OPERATOR_REGISTRY_ADDRESS'].forEach(key => {
        if (config[key] && !config[key].startsWith('Z')) {
            console.warn(`Warning: ${key} should use Z-prefix format (QRL native), got: ${config[key]}`);
        }
    });
}

validateConfig();

module.exports = config;
