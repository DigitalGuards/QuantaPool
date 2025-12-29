/**
 * Upgrade DepositPool contract to new version with beacon chain integration
 *
 * This script:
 * 1. Deploys the new DepositPool contract
 * 2. Updates stQRL to point to new DepositPool
 * 3. Updates config with new address
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
        throw new Error(`Artifact not found: ${artifactPath}. Run: node scripts/compile.js`);
    }
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

async function main() {
    console.log('='.repeat(60));
    console.log('DepositPool Upgrade - Beacon Chain Integration');
    console.log('='.repeat(60));

    if (!process.env.TESTNET_SEED) {
        throw new Error('TESTNET_SEED environment variable is required');
    }

    const web3 = new Web3(config.provider);

    // Setup account
    const mnemonic = process.env.TESTNET_SEED;
    const seedBin = MnemonicToSeedBin(mnemonic);
    const seedHex = '0x' + Buffer.from(seedBin).toString('hex');
    const account = web3.zond.accounts.seedToAccount(seedHex);
    web3.zond.accounts.wallet.add(account);

    console.log('\nDeployer:', account.address);

    const balance = await web3.zond.getBalance(account.address);
    console.log('Balance:', web3.utils.fromWei(balance, 'ether'), 'QRL');

    // Check current state
    console.log('\n--- Current State ---');
    console.log('stQRL:', config.contracts.stQRL);
    console.log('DepositPool (old):', config.contracts.depositPool);

    const stQRLAbi = loadArtifact('stQRL').abi;
    const stQRLContract = new web3.zond.Contract(stQRLAbi, config.contracts.stQRL);

    const currentDepositPool = await stQRLContract.methods.depositPool().call();
    console.log('stQRL.depositPool():', currentDepositPool);

    // Get current TVL
    const oldDepositPoolAbi = loadArtifact('DepositPool').abi;
    const oldDepositPool = new web3.zond.Contract(oldDepositPoolAbi, config.contracts.depositPool);

    const pendingDeposits = await oldDepositPool.methods.pendingDeposits().call();
    const validatorCount = await oldDepositPool.methods.validatorCount().call();
    const liquidReserve = await oldDepositPool.methods.liquidReserve().call();

    console.log('\nCurrent DepositPool state:');
    console.log('  Pending deposits:', web3.utils.fromWei(pendingDeposits.toString(), 'ether'), 'QRL');
    console.log('  Validator count:', validatorCount.toString());
    console.log('  Liquid reserve:', web3.utils.fromWei(liquidReserve.toString(), 'ether'), 'QRL');

    // Deploy new DepositPool
    console.log('\n--- Deploying New DepositPool ---');

    const depositPoolArtifact = loadArtifact('DepositPool');
    const DepositPoolContract = new web3.zond.Contract(depositPoolArtifact.abi);

    const deployTx = DepositPoolContract.deploy({
        data: depositPoolArtifact.bytecode,
        arguments: [config.contracts.stQRL]
    });

    const gas = await deployTx.estimateGas({ from: account.address });
    console.log('Gas estimate:', gas.toString());

    const newDepositPool = await deployTx.send({
        from: account.address,
        gas: Math.floor(Number(gas) * 1.2)
    });

    console.log('New DepositPool deployed:', newDepositPool.options.address);

    // Verify new contract has beacon deposit support
    const newContract = new web3.zond.Contract(depositPoolArtifact.abi, newDepositPool.options.address);
    const depositContract = await newContract.methods.DEPOSIT_CONTRACT().call();
    console.log('DEPOSIT_CONTRACT:', depositContract);

    // Update stQRL to point to new DepositPool
    console.log('\n--- Updating stQRL ---');

    const setDepositPoolTx = await stQRLContract.methods.setDepositPool(
        newDepositPool.options.address
    ).send({
        from: account.address,
        gas: 100000
    });

    console.log('stQRL.setDepositPool() TX:', setDepositPoolTx.transactionHash);

    // Verify update
    const newDepositPoolAddr = await stQRLContract.methods.depositPool().call();
    console.log('Verified stQRL.depositPool():', newDepositPoolAddr);

    // Update config
    console.log('\n--- Updating Config ---');

    const oldAddress = config.contracts.depositPool;
    config.contracts.depositPool = newDepositPool.options.address;

    fs.writeFileSync(
        path.join(__dirname, '..', 'config', 'testnet.json'),
        JSON.stringify(config, null, 2)
    );

    console.log('Config updated.');

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Upgrade Complete!');
    console.log('='.repeat(60));
    console.log('\nOld DepositPool:', oldAddress);
    console.log('New DepositPool:', newDepositPool.options.address);
    console.log('\nNew Features:');
    console.log('  - fundValidator(pubkey, withdrawal_credentials, signature, deposit_data_root)');
    console.log('  - fundValidatorMVP() for accounting-only testing');
    console.log('  - DEPOSIT_CONTRACT:', depositContract);
    console.log('\nNote: Old contract still has locked funds. Use emergencyWithdraw if needed.');
}

main().catch(err => {
    console.error('\nUpgrade failed:', err.message);
    process.exit(1);
});
