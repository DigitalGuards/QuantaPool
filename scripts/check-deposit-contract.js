/**
 * Check the beacon chain deposit contract on Zond testnet
 *
 * This script verifies the deposit contract exists and displays its current state.
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Web3 } = require('@theqrl/web3');

const config = require('../config/testnet.json');

function loadArtifact(name) {
    const artifactPath = path.join(__dirname, '..', 'artifacts', `${name}.json`);
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact not found: ${artifactPath}`);
    }
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

async function checkDepositContract() {
    const web3 = new Web3(config.provider);

    // Deposit contract address (standard beacon chain deposit contract)
    // Zond uses Z prefix format
    const DEPOSIT_CONTRACT_ADDRESS = 'Z4242424242424242424242424242424242424242';

    console.log('=== Zond Beacon Deposit Contract ===\n');
    console.log('Address:', DEPOSIT_CONTRACT_ADDRESS);
    console.log('Provider:', config.provider);

    // Check if contract exists
    const code = await web3.zond.getCode(DEPOSIT_CONTRACT_ADDRESS);
    console.log('\nContract code length:', code.length, 'bytes');

    if (code === '0x' || code.length < 10) {
        console.log('WARNING: No contract code at this address!');
        console.log('The deposit contract may not be deployed on this testnet.');
        return;
    }

    console.log('Contract deployed.');

    // Load ABI and create contract instance
    const depositAbi = loadArtifact('DepositContract').abi;
    const depositContract = new web3.zond.Contract(depositAbi, DEPOSIT_CONTRACT_ADDRESS);

    // Get deposit count
    try {
        const depositCount = await depositContract.methods.get_deposit_count().call();
        // Decode little-endian 64-bit number
        const countBuffer = Buffer.from(depositCount.slice(2), 'hex');
        let count = 0n;
        for (let i = 0; i < countBuffer.length; i++) {
            count += BigInt(countBuffer[i]) << BigInt(i * 8);
        }
        console.log('\nDeposit count:', count.toString());
    } catch (err) {
        console.log('\nCould not get deposit count:', err.message);
    }

    // Get deposit root
    try {
        const depositRoot = await depositContract.methods.get_deposit_root().call();
        console.log('Deposit root:', depositRoot);
    } catch (err) {
        console.log('Could not get deposit root:', err.message);
    }

    // Check supportsInterface
    try {
        // IDepositContract interface ID
        const supportsDeposit = await depositContract.methods.supportsInterface('0x8564090a').call();
        console.log('Supports IDepositContract:', supportsDeposit);
    } catch (err) {
        console.log('Could not check interface:', err.message);
    }

    console.log('\n=== Deposit Parameters ===');
    console.log('Minimum deposit: 1 QRL');
    console.log('Validator stake: 40,000 QRL');
    console.log('Pubkey length: 2592 bytes (Dilithium)');
    console.log('Signature length: 4595 bytes (Dilithium)');
    console.log('Withdrawal credentials: 32 bytes');
}

checkDepositContract().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
