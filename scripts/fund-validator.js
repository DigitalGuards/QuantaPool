/**
 * Fund a validator when 40k QRL threshold is reached
 *
 * This script checks the DepositPool queue status and funds a validator
 * when sufficient QRL has accumulated.
 */

const path = require('path');
const fs = require('fs');

// Load environment variables using dotenv
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Web3 } = require('@theqrl/web3');
const { MnemonicToSeedBin } = require('@theqrl/wallet.js');

const config = require('../config/testnet.json');

/**
 * Load contract artifact from artifacts directory
 * @param {string} name - Contract name
 * @returns {Object} Contract artifact with abi and bytecode
 */
function loadArtifact(name) {
    const artifactPath = path.join(__dirname, '..', 'artifacts', `${name}.json`);
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact not found: ${artifactPath}`);
    }
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

/**
 * Format wei to QRL with 4 decimal places
 * @param {BigInt|string} wei - Amount in wei
 * @returns {string} Formatted QRL amount
 */
function formatQRL(wei) {
    return parseFloat(Web3.utils.fromWei(wei.toString(), 'ether')).toFixed(4);
}

/**
 * Estimate gas for a transaction with a safety buffer
 * @param {Object} web3 - Web3 instance
 * @param {Object} txParams - Transaction parameters
 * @returns {BigInt} Estimated gas with 20% buffer
 */
async function estimateGasWithBuffer(web3, txParams) {
    const estimated = await web3.zond.estimateGas(txParams);
    // Add 20% buffer for safety
    return BigInt(estimated) * 120n / 100n;
}

async function fundValidator() {
    // Validate environment
    if (!process.env.TESTNET_SEED) {
        throw new Error('TESTNET_SEED environment variable is required');
    }

    const web3 = new Web3(config.provider);
    const depositPoolAbi = loadArtifact('DepositPool').abi;

    // Setup account from seed
    const mnemonic = process.env.TESTNET_SEED;
    const seedBin = MnemonicToSeedBin(mnemonic);
    const seedHex = '0x' + Buffer.from(seedBin).toString('hex');
    const account = web3.zond.accounts.seedToAccount(seedHex);
    web3.zond.accounts.wallet.add(account);

    console.log('Account:', account.address);

    const depositPool = new web3.zond.Contract(depositPoolAbi, config.contracts.depositPool);

    // Check queue status
    const queueStatus = await depositPool.methods.getQueueStatus().call();
    console.log('\n📊 Queue Status:');
    console.log('  Pending:', web3.utils.fromWei(queueStatus.pending.toString(), 'ether'), 'QRL');
    console.log('  Validators Ready:', queueStatus.validatorsReady.toString());

    const validatorCount = await depositPool.methods.validatorCount().call();
    console.log('  Current Validators:', validatorCount.toString());

    // List available validator-related methods (for debugging)
    const methods = Object.keys(depositPool.methods);
    const relevantMethods = methods.filter(m => {
        const lower = m.toLowerCase();
        return (lower.includes('fund') || lower.includes('validator')) && !m.startsWith('0x');
    });
    console.log('\n🔧 Validator-related methods:', relevantMethods.join(', '));

    // Try to fund validator using BigInt comparison
    if (queueStatus.validatorsReady > 0n) {
        console.log('\n🚀 Funding next validator...');

        try {
            const fundData = depositPool.methods.fundValidator().encodeABI();

            // Estimate gas dynamically instead of using hardcoded value
            const txParams = {
                from: account.address,
                to: config.contracts.depositPool,
                data: fundData
            };

            const gasEstimate = await estimateGasWithBuffer(web3, txParams);
            console.log(`  Gas estimate: ${gasEstimate.toString()}`);

            const tx = await web3.zond.sendTransaction({
                ...txParams,
                gas: gasEstimate.toString()
            });

            console.log('✅ TX:', tx.transactionHash);

            const newValidatorCount = await depositPool.methods.validatorCount().call();
            console.log('📈 New validator count:', newValidatorCount.toString());
        } catch (err) {
            console.error('❌ Fund failed:', err.message);
            throw err;
        }
    } else {
        console.log('\n⚠️ No validators ready to fund');
    }
}

fundValidator().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
