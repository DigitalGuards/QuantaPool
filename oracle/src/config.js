/**
 * QuantaPool Oracle Configuration
 *
 * Configuration for the validator balance oracle service.
 */

require('dotenv').config();

const config = {
  // Zond Network
  network: {
    rpcUrl: process.env.ZOND_RPC_URL || 'https://qrlwallet.com/api/zond-rpc/testnet',
    beaconApiUrl: process.env.BEACON_API_URL || 'http://localhost:3500',
    chainId: parseInt(process.env.CHAIN_ID || '32382'),
  },

  // Contract Addresses (convert Z prefix to 0x)
  contracts: {
    stQRL: normalizeAddress(process.env.STQRL_ADDRESS || 'Z844A6eB87927780E938908743eA24a56A220Efe8'),
    depositPool: normalizeAddress(process.env.DEPOSIT_POOL_ADDRESS || 'Z9E800e8271df4Ac91334C65641405b04584B57DC'),
    rewardsOracle: normalizeAddress(process.env.REWARDS_ORACLE_ADDRESS || 'Z541b1f2c501956BCd7a4a6913180b2Fc27BdE17E'),
    operatorRegistry: normalizeAddress(process.env.OPERATOR_REGISTRY_ADDRESS || 'ZD370e9505D265381e839f8289f46D02815d0FF95'),
  },

  // Oracle Wallet
  oracle: {
    privateKey: process.env.ORACLE_PRIVATE_KEY || '',
    address: normalizeAddress(process.env.ORACLE_ADDRESS || ''),
  },

  // Reporting Schedule
  schedule: {
    // Cron expression: Run every epoch (~128 minutes on Zond)
    // Default: every 2 hours (approximately one epoch)
    cronExpression: process.env.REPORT_CRON || '0 */2 * * *',
    // Minimum time between reports (in seconds)
    minReportInterval: parseInt(process.env.MIN_REPORT_INTERVAL || '7200'), // 2 hours
  },

  // Safety Thresholds
  safety: {
    // Maximum allowed balance change per report (in wei)
    // Prevents erroneous reports from massive changes
    maxBalanceChangePercent: parseFloat(process.env.MAX_BALANCE_CHANGE_PERCENT || '5'),
    // Minimum balance to report (skip if below)
    minBalanceToReport: process.env.MIN_BALANCE_TO_REPORT || '0',
    // Alert threshold for potential slashing (negative balance change)
    slashingAlertThreshold: parseFloat(process.env.SLASHING_ALERT_THRESHOLD || '0.1'),
  },

  // Alerting
  alerts: {
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || '/var/log/quantapool-oracle/oracle.log',
  },

  // Gas Settings
  gas: {
    maxGasPrice: process.env.MAX_GAS_PRICE || '100000000000', // 100 gwei
    gasLimit: parseInt(process.env.GAS_LIMIT || '500000'),
  },
};

/**
 * Normalize address - convert Z prefix to 0x
 */
function normalizeAddress(address) {
  if (!address) return '';
  if (address.startsWith('Z')) {
    return '0x' + address.slice(1);
  }
  return address;
}

module.exports = config;
