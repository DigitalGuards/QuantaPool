/**
 * QuantaPool Balance Reporter Oracle
 *
 * This service reports validator balances to the RewardsOracle contract,
 * enabling accurate stQRL exchange rate calculations.
 *
 * Usage:
 *   node src/index.js          # Run as daemon with cron schedule
 *   node src/index.js --once   # Run single report and exit
 */

const Web3 = require('@theqrl/web3');
const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');
const { sendAlert } = require('./alerts');

// Contract ABIs (minimal interfaces)
const REWARDS_ORACLE_ABI = [
  {
    inputs: [{ name: 'newTotalBalance', type: 'uint256' }],
    name: 'submitReport',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getStatus',
    outputs: [
      { name: 'lastReport', type: 'uint256' },
      { name: 'cooldownRemaining', type: 'uint256' },
      { name: 'lastBalance', type: 'uint256' },
      { name: 'canReport', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'address' }],
    name: 'isOracle',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'lastReportedBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const OPERATOR_REGISTRY_ABI = [
  {
    inputs: [],
    name: 'getActiveValidatorCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'getValidatorByIndex',
    outputs: [
      { name: 'pubkey', type: 'bytes' },
      { name: 'withdrawalCredentials', type: 'bytes32' },
      { name: 'isActive', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

class BalanceReporter {
  constructor() {
    this.web3 = new Web3(config.network.rpcUrl);
    this.rewardsOracle = new this.web3.eth.Contract(
      REWARDS_ORACLE_ABI,
      config.contracts.rewardsOracle
    );
    this.operatorRegistry = new this.web3.eth.Contract(
      OPERATOR_REGISTRY_ABI,
      config.contracts.operatorRegistry
    );
    this.account = null;
  }

  async initialize() {
    logger.info('Initializing QuantaPool Balance Reporter Oracle');
    logger.info(`Network: ${config.network.rpcUrl}`);
    logger.info(`RewardsOracle: ${config.contracts.rewardsOracle}`);
    logger.info(`OperatorRegistry: ${config.contracts.operatorRegistry}`);

    // Setup account if private key provided
    if (config.oracle.privateKey) {
      this.account = this.web3.eth.accounts.privateKeyToAccount(
        config.oracle.privateKey.startsWith('0x')
          ? config.oracle.privateKey
          : '0x' + config.oracle.privateKey
      );
      this.web3.eth.accounts.wallet.add(this.account);
      logger.info(`Oracle address: ${this.account.address}`);

      // Verify oracle authorization
      const isAuthorized = await this.rewardsOracle.methods
        .isOracle(this.account.address)
        .call();
      if (!isAuthorized) {
        logger.warn('WARNING: This address is not authorized as an oracle!');
        logger.warn('Reports will fail. Contact contract owner to add oracle.');
      }
    } else {
      logger.warn('No private key configured - running in read-only mode');
    }
  }

  /**
   * Fetch validator balances from the beacon chain API
   */
  async fetchValidatorBalances() {
    logger.info('Fetching validator balances from beacon chain...');

    try {
      // Get validator count from registry
      const validatorCount = await this.operatorRegistry.methods
        .getActiveValidatorCount()
        .call();
      logger.info(`Active validators in registry: ${validatorCount}`);

      if (validatorCount === 0n || validatorCount === '0') {
        logger.info('No active validators registered');
        return 0n;
      }

      // Fetch all validator pubkeys
      const pubkeys = [];
      for (let i = 0; i < parseInt(validatorCount); i++) {
        try {
          const validator = await this.operatorRegistry.methods
            .getValidatorByIndex(i)
            .call();
          if (validator.isActive) {
            pubkeys.push(validator.pubkey);
          }
        } catch (e) {
          logger.warn(`Failed to fetch validator ${i}: ${e.message}`);
        }
      }

      if (pubkeys.length === 0) {
        logger.info('No active validator pubkeys found');
        return 0n;
      }

      logger.info(`Found ${pubkeys.length} active validator pubkeys`);

      // Query beacon API for balances
      const axios = require('axios');
      let totalBalance = 0n;

      for (const pubkey of pubkeys) {
        try {
          const response = await axios.get(
            `${config.network.beaconApiUrl}/eth/v1/beacon/states/head/validators/${pubkey}`
          );
          if (response.data && response.data.data) {
            const balance = BigInt(response.data.data.balance);
            totalBalance += balance;
            logger.debug(`Validator ${pubkey.slice(0, 20)}...: ${balance} gwei`);
          }
        } catch (e) {
          logger.warn(`Failed to fetch balance for ${pubkey.slice(0, 20)}...: ${e.message}`);
        }
      }

      // Convert from gwei to wei
      const totalBalanceWei = totalBalance * 1000000000n;
      logger.info(`Total validator balance: ${this.web3.utils.fromWei(totalBalanceWei.toString(), 'ether')} QRL`);

      return totalBalanceWei;
    } catch (error) {
      logger.error(`Error fetching validator balances: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get current oracle status from contract
   */
  async getOracleStatus() {
    const status = await this.rewardsOracle.methods.getStatus().call();
    return {
      lastReport: new Date(parseInt(status.lastReport) * 1000),
      cooldownRemaining: parseInt(status.cooldownRemaining),
      lastBalance: BigInt(status.lastBalance),
      canReport: status.canReport,
    };
  }

  /**
   * Validate the balance change is within acceptable bounds
   */
  validateBalanceChange(newBalance, lastBalance) {
    if (lastBalance === 0n) {
      logger.info('First report - no previous balance to compare');
      return { valid: true };
    }

    const changePercent =
      Number(((newBalance - lastBalance) * 10000n) / lastBalance) / 100;

    logger.info(`Balance change: ${changePercent.toFixed(2)}%`);

    // Check for potential slashing (significant negative change)
    if (changePercent < -config.safety.slashingAlertThreshold) {
      const message = `ALERT: Possible slashing detected! Balance dropped ${Math.abs(changePercent).toFixed(2)}%`;
      logger.error(message);
      sendAlert(message, 'critical');
      return {
        valid: false,
        reason: message,
      };
    }

    // Check for excessive positive change (possible error)
    if (Math.abs(changePercent) > config.safety.maxBalanceChangePercent) {
      const message = `Balance change of ${changePercent.toFixed(2)}% exceeds max allowed ${config.safety.maxBalanceChangePercent}%`;
      logger.warn(message);
      return {
        valid: false,
        reason: message,
      };
    }

    return { valid: true };
  }

  /**
   * Submit balance report to RewardsOracle contract
   */
  async submitReport(newBalance) {
    if (!this.account) {
      logger.error('Cannot submit report: no private key configured');
      return false;
    }

    const status = await this.getOracleStatus();

    if (!status.canReport) {
      logger.info(`Cannot report yet. Cooldown remaining: ${status.cooldownRemaining}s`);
      return false;
    }

    // Validate balance change
    const validation = this.validateBalanceChange(newBalance, status.lastBalance);
    if (!validation.valid) {
      logger.error(`Report validation failed: ${validation.reason}`);
      return false;
    }

    logger.info(`Submitting balance report: ${this.web3.utils.fromWei(newBalance.toString(), 'ether')} QRL`);

    try {
      const gasPrice = await this.web3.eth.getGasPrice();
      const tx = await this.rewardsOracle.methods
        .submitReport(newBalance.toString())
        .send({
          from: this.account.address,
          gas: config.gas.gasLimit,
          gasPrice: gasPrice,
        });

      logger.info(`Report submitted successfully! TX: ${tx.transactionHash}`);

      // Calculate and log rewards
      const rewards = newBalance - status.lastBalance;
      if (rewards > 0n) {
        logger.info(`Rewards reported: ${this.web3.utils.fromWei(rewards.toString(), 'ether')} QRL`);
      }

      sendAlert(
        `Balance report submitted: ${this.web3.utils.fromWei(newBalance.toString(), 'ether')} QRL`,
        'info'
      );

      return true;
    } catch (error) {
      logger.error(`Failed to submit report: ${error.message}`);
      sendAlert(`Oracle report failed: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Main reporting cycle
   */
  async runReportCycle() {
    logger.info('Starting balance report cycle...');

    try {
      // Fetch current balances
      const totalBalance = await this.fetchValidatorBalances();

      if (totalBalance === 0n) {
        logger.info('No balance to report (no validators or all at 0)');
        return;
      }

      // Submit report
      await this.submitReport(totalBalance);
    } catch (error) {
      logger.error(`Report cycle failed: ${error.message}`);
      sendAlert(`Oracle report cycle failed: ${error.message}`, 'error');
    }
  }

  /**
   * Start the oracle daemon
   */
  async start() {
    await this.initialize();

    // Check if running in one-shot mode
    if (process.argv.includes('--once')) {
      logger.info('Running single report cycle...');
      await this.runReportCycle();
      process.exit(0);
    }

    // Start cron scheduler
    logger.info(`Starting scheduler with cron: ${config.schedule.cronExpression}`);

    cron.schedule(config.schedule.cronExpression, async () => {
      await this.runReportCycle();
    });

    // Run immediately on startup
    await this.runReportCycle();

    logger.info('Oracle daemon running. Press Ctrl+C to stop.');
  }
}

// Main entry point
const reporter = new BalanceReporter();
reporter.start().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
