/**
 * QuantaPool Oracle Status Checker
 *
 * Usage: node src/status.js
 */

const Web3 = require('@theqrl/web3');
const config = require('./config');

const REWARDS_ORACLE_ABI = [
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
    inputs: [],
    name: 'oracleCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'reportCooldown',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

async function checkStatus() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              QuantaPool Oracle Status                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const web3 = new Web3(config.network.rpcUrl);
  const rewardsOracle = new web3.eth.Contract(
    REWARDS_ORACLE_ABI,
    config.contracts.rewardsOracle
  );

  try {
    // Get oracle status
    const status = await rewardsOracle.methods.getStatus().call();
    const oracleCount = await rewardsOracle.methods.oracleCount().call();
    const cooldownConfig = await rewardsOracle.methods.reportCooldown().call();

    const lastReportDate = new Date(parseInt(status.lastReport) * 1000);
    const lastBalance = web3.utils.fromWei(status.lastBalance.toString(), 'ether');

    console.log('Configuration:');
    console.log(`  RPC URL:          ${config.network.rpcUrl}`);
    console.log(`  RewardsOracle:    ${config.contracts.rewardsOracle}`);
    console.log(`  Oracle Address:   ${config.oracle.address || 'Not configured'}`);
    console.log('');

    console.log('Contract Status:');
    console.log(`  Authorized Oracles: ${oracleCount}`);
    console.log(`  Report Cooldown:    ${cooldownConfig} seconds`);
    console.log(`  Last Report:        ${lastReportDate.toISOString()}`);
    console.log(`  Last Balance:       ${lastBalance} QRL`);
    console.log(`  Cooldown Remaining: ${status.cooldownRemaining} seconds`);
    console.log(`  Can Report:         ${status.canReport ? 'YES ✓' : 'NO ✗'}`);
    console.log('');

    // Check if our address is authorized
    if (config.oracle.address) {
      const isOracleABI = [{
        inputs: [{ name: '', type: 'address' }],
        name: 'isOracle',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
      }];
      const contract = new web3.eth.Contract(isOracleABI, config.contracts.rewardsOracle);
      const isAuthorized = await contract.methods.isOracle(config.oracle.address).call();
      console.log(`Oracle Authorization: ${isAuthorized ? 'AUTHORIZED ✓' : 'NOT AUTHORIZED ✗'}`);
    }

  } catch (error) {
    console.error(`Error checking status: ${error.message}`);
    process.exit(1);
  }
}

checkStatus();
