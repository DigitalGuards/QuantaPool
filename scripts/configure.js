const { Web3 } = require('@theqrl/web3');
const { MnemonicToSeedBin } = require('@theqrl/wallet.js');
const fs = require('fs');
const path = require('path');

// Load environment variables
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                process.env[key.trim()] = value.trim();
            }
        });
    }
}

loadEnv();

const config = require('../config/testnet.json');

function loadArtifact(name) {
    return JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'artifacts', `${name}.json`),
        'utf8'
    ));
}

async function main() {
    console.log('Configuring QuantaPool contracts...\n');

    const web3 = new Web3(config.provider);

    // Setup account
    const mnemonic = process.env.TESTNET_SEED;
    const seedBin = MnemonicToSeedBin(mnemonic);
    const seedHex = '0x' + Buffer.from(seedBin).toString('hex');
    const account = web3.zond.accounts.seedToAccount(seedHex);
    web3.zond.accounts.wallet.add(account);

    console.log(`Account: ${account.address}`);
    console.log(`stQRL: ${config.contracts.stQRL}`);
    console.log(`DepositPool: ${config.contracts.depositPool}`);
    console.log(`RewardsOracle: ${config.contracts.rewardsOracle}`);

    const stQRLArtifact = loadArtifact('stQRL');
    const stQRL = new web3.zond.Contract(stQRLArtifact.abi, config.contracts.stQRL);

    // Check current settings
    const currentDepositPool = await stQRL.methods.depositPool().call();
    const currentOracle = await stQRL.methods.rewardsOracle().call();

    console.log(`\nCurrent DepositPool: ${currentDepositPool}`);
    console.log(`Current Oracle: ${currentOracle}`);

    // Set DepositPool if not set
    if (currentDepositPool === 'Z0000000000000000000000000000000000000000') {
        console.log('\nSetting DepositPool...');
        const txData = stQRL.methods.setDepositPool(config.contracts.depositPool).encodeABI();
        const tx1 = await web3.zond.sendTransaction({
            from: account.address,
            to: config.contracts.stQRL,
            data: txData,
            gas: 100000
        });
        console.log(`  ✓ TX: ${tx1.transactionHash}`);
    } else {
        console.log('\n✓ DepositPool already set');
    }

    // Set RewardsOracle if not set
    if (currentOracle === 'Z0000000000000000000000000000000000000000') {
        console.log('\nSetting RewardsOracle...');
        const txData = stQRL.methods.setRewardsOracle(config.contracts.rewardsOracle).encodeABI();
        const tx2 = await web3.zond.sendTransaction({
            from: account.address,
            to: config.contracts.stQRL,
            data: txData,
            gas: 100000
        });
        console.log(`  ✓ TX: ${tx2.transactionHash}`);
    } else {
        console.log('✓ RewardsOracle already set');
    }

    console.log('\n✓ Configuration complete!');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
