/**
 * Configuration loader for QuantaPool Contract Exporter
 */

require('dotenv').config();

const config = {
    // QRL RPC endpoint
    QRL_RPC_URL: process.env.QRL_RPC_URL || 'https://qrlwallet.com/api/qrl-rpc/testnet',

    // Contract addresses (Q-prefix format for QRL).
    // Live v2 testnet deployment (chainId 1337) — override via env in prod.
    STQRL_ADDRESS: process.env.STQRL_ADDRESS || 'Q09046968aF19E745F4aBa7A9fa5CD946b4E981DB',
    DEPOSIT_POOL_ADDRESS: process.env.DEPOSIT_POOL_ADDRESS || 'Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9',
    VALIDATOR_MANAGER_ADDRESS: process.env.VALIDATOR_MANAGER_ADDRESS || 'Q1b083D7Dc47212DcBc4595249D9384Fa16cE6FC5',
    // V2 removed the rewards oracle (trustless balance-delta sync via _syncRewards)
    // and the operator registry (folded into ValidatorManager). Left empty so the
    // exporter's v1 code paths safeCall into nothing instead of querying stale
    // v1-leftover Q-prefixed addresses. TODO: rewrite exporter for v2 ABI.
    REWARDS_ORACLE_ADDRESS: process.env.REWARDS_ORACLE_ADDRESS || '',
    OPERATOR_REGISTRY_ADDRESS: process.env.OPERATOR_REGISTRY_ADDRESS || '',

    // Metrics server port
    METRICS_PORT: parseInt(process.env.METRICS_PORT) || 9101,

    // How often to scrape contract state (milliseconds)
    SCRAPE_INTERVAL_MS: parseInt(process.env.CONTRACT_SCRAPE_INTERVAL) || 30000,

    // Event polling interval (milliseconds) - QRL has 60s block time
    EVENT_POLL_INTERVAL_MS: parseInt(process.env.EVENT_POLL_INTERVAL_MS) || 60000,
};

// Validate required configuration
function validateConfig() {
    const required = ['QRL_RPC_URL', 'STQRL_ADDRESS', 'DEPOSIT_POOL_ADDRESS'];
    const missing = required.filter(key => !config[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }

    // Validate address format - QRL uses Q-prefix natively
    ['STQRL_ADDRESS', 'DEPOSIT_POOL_ADDRESS', 'VALIDATOR_MANAGER_ADDRESS', 'REWARDS_ORACLE_ADDRESS', 'OPERATOR_REGISTRY_ADDRESS'].forEach(key => {
        if (config[key] && !config[key].startsWith('Q')) {
            console.warn(`Warning: ${key} should use Q-prefix format (QRL native), got: ${config[key]}`);
        }
    });
}

validateConfig();

module.exports = config;
