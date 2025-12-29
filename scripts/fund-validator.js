/**
 * Fund a validator when 40k QRL threshold is reached
 *
 * This script checks the DepositPool queue status and funds a validator
 * when sufficient QRL has accumulated.
 *
 * Usage:
 *   node scripts/fund-validator.js          # MVP mode (accounting only)
 *   node scripts/fund-validator.js --beacon # Real beacon chain deposit
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Web3 } = require('@theqrl/web3');
const { MnemonicToSeedBin } = require('@theqrl/wallet.js');

const config = require('../config/testnet.json');

function loadArtifact(name) {
    const artifactPath = path.join(__dirname, '..', 'artifacts', `${name}.json`);
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact not found: ${artifactPath}`);
    }
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

function loadDepositData(folder = 'validator_keys') {
    const files = fs.readdirSync(folder);
    const depositFile = files.find(f => f.startsWith('deposit_data-'));
    if (!depositFile) {
        throw new Error(`No deposit_data file found in ${folder}`);
    }
    const depositPath = path.join(folder, depositFile);
    const data = JSON.parse(fs.readFileSync(depositPath, 'utf8'));
    return data[0];
}

async function estimateGasWithBuffer(web3, txParams) {
    const estimated = await web3.zond.estimateGas(txParams);
    return BigInt(estimated) * 150n / 100n;
}

async function fundValidator() {
    if (!process.env.TESTNET_SEED) {
        throw new Error('TESTNET_SEED environment variable is required');
    }

    const beaconMode = process.argv.includes('--beacon');
    const web3 = new Web3(config.provider);
    const depositPoolAbi = loadArtifact('DepositPool').abi;

    // Setup account from seed
    const mnemonic = process.env.TESTNET_SEED;
    const seedBin = MnemonicToSeedBin(mnemonic);
    const seedHex = '0x' + Buffer.from(seedBin).toString('hex');
    const account = web3.zond.accounts.seedToAccount(seedHex);
    web3.zond.accounts.wallet.add(account);

    console.log('Account:', account.address);
    console.log('Mode:', beaconMode ? 'BEACON CHAIN DEPOSIT' : 'MVP (accounting only)');

    const depositPool = new web3.zond.Contract(depositPoolAbi, config.contracts.depositPool);

    // Check queue status
    const queueStatus = await depositPool.methods.getQueueStatus().call();
    console.log('\nQueue Status:');
    console.log('  Pending:', web3.utils.fromWei(queueStatus.pending.toString(), 'ether'), 'QRL');
    console.log('  Validators Ready:', queueStatus.validatorsReady.toString());

    const validatorCount = await depositPool.methods.validatorCount().call();
    console.log('  Current Validators:', validatorCount.toString());

    if (queueStatus.validatorsReady > 0n) {
        console.log('\nFunding next validator...');

        let fundData;

        if (beaconMode) {
            // Real beacon chain deposit
            console.log('Loading deposit data from validator_keys/...');
            const depositData = loadDepositData();

            console.log('  Pubkey:', depositData.pubkey.slice(0, 40) + '...');
            console.log('  Amount:', depositData.amount / 1e9, 'QRL');

            fundData = depositPool.methods.fundValidator(
                depositData.pubkey,
                depositData.withdrawal_credentials,
                depositData.signature,
                depositData.deposit_data_root
            ).encodeABI();
        } else {
            // MVP mode - accounting only
            fundData = depositPool.methods.fundValidatorMVP().encodeABI();
        }

        const txParams = {
            from: account.address,
            to: config.contracts.depositPool,
            data: fundData
        };

        try {
            const gasEstimate = await estimateGasWithBuffer(web3, txParams);
            console.log('  Gas estimate:', gasEstimate.toString());

            const tx = await web3.zond.sendTransaction({
                ...txParams,
                gas: gasEstimate.toString()
            });

            console.log('\nTransaction:', tx.transactionHash);

            const newValidatorCount = await depositPool.methods.validatorCount().call();
            console.log('New validator count:', newValidatorCount.toString());

            if (beaconMode) {
                console.log('\nValidator staked to beacon chain!');
                console.log('The validator will activate after ~1 epoch (~128 minutes).');
            }
        } catch (err) {
            console.error('\nFund failed:', err.message);
            throw err;
        }
    } else {
        console.log('\nNo validators ready to fund');
    }
}

fundValidator().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
