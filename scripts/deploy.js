const { Web3 } = require('@theqrl/web3');
const { MnemonicToSeedBin } = require('@theqrl/wallet.js');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env
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

// Load config
const config = require('../config/testnet.json');

// Load artifact
function loadArtifact(name) {
    const artifactPath = path.join(__dirname, '..', 'artifacts', `${name}.json`);
    if (!fs.existsSync(artifactPath)) {
        console.error(`Artifact not found: ${name}. Run: npm run compile`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

// Deploy contract
async function deploy(web3, account, artifactName, constructorArgs = []) {
    const artifact = loadArtifact(artifactName);
    console.log(`\nDeploying ${artifactName}...`);

    const contract = new web3.zond.Contract(artifact.abi);

    const deployTx = contract.deploy({
        data: artifact.bytecode,
        arguments: constructorArgs
    });

    const gas = await deployTx.estimateGas({ from: account.address });
    console.log(`  Gas estimate: ${gas}`);

    const deployed = await deployTx.send({
        from: account.address,
        gas: Math.floor(Number(gas) * 1.2)
    });

    console.log(`  ✓ Deployed at: ${deployed.options.address}`);
    return deployed;
}

async function main() {
    console.log('='.repeat(60));
    console.log('QuantaPool MVP Deployment');
    console.log('='.repeat(60));

    console.log('\nConnecting to Zond testnet...');
    console.log(`Provider: ${config.provider}`);

    const web3 = new Web3(config.provider);

    // Check connection
    try {
        const chainId = await web3.zond.getChainId();
        console.log(`Connected! Chain ID: ${chainId}`);

        // Check sync status
        const syncing = await web3.zond.isSyncing();
        if (syncing) {
            console.log('\n⚠️  Node is still syncing:');
            console.log(`   Current: ${parseInt(syncing.currentBlock, 16)}`);
            console.log(`   Highest: ${parseInt(syncing.highestBlock, 16)}`);
            console.log('\nDeployment may fail. Continue anyway? (Ctrl+C to abort)');
            await new Promise(r => setTimeout(r, 3000));
        }
    } catch (err) {
        console.error('Failed to connect to node:', err.message);
        process.exit(1);
    }

    // Setup account
    const mnemonic = process.env.TESTNET_SEED;
    if (!mnemonic) {
        console.error('TESTNET_SEED not found in .env');
        process.exit(1);
    }

    const seedBin = MnemonicToSeedBin(mnemonic);
    const seedHex = '0x' + Buffer.from(seedBin).toString('hex');
    const account = web3.zond.accounts.seedToAccount(seedHex);
    web3.zond.accounts.wallet.add(account);

    console.log(`\nDeployer: ${account.address}`);

    const balance = await web3.zond.getBalance(account.address);
    const balanceQRL = web3.utils.fromWei(balance, 'ether');
    console.log(`Balance: ${balanceQRL} QRL`);

    if (parseFloat(balanceQRL) < 1) {
        console.error('\n⚠️  Low balance! Deployment may fail.');
        console.log('Request testnet QRL from Discord faucet.');
    }

    // Deploy contracts in order
    console.log('\n' + '-'.repeat(60));
    console.log('Deploying contracts...');
    console.log('-'.repeat(60));

    // 1. Deploy stQRL (no dependencies)
    const stQRL = await deploy(web3, account, 'stQRL');

    // 2. Deploy DepositPool (depends on stQRL)
    const depositPool = await deploy(web3, account, 'DepositPool', [
        stQRL.options.address
    ]);

    // 3. Deploy RewardsOracle (depends on stQRL)
    const rewardsOracle = await deploy(web3, account, 'RewardsOracle', [
        stQRL.options.address
    ]);

    // 4. Deploy OperatorRegistry (no constructor args)
    const operatorRegistry = await deploy(web3, account, 'OperatorRegistry');

    // Configure contracts
    console.log('\n' + '-'.repeat(60));
    console.log('Configuring contracts...');
    console.log('-'.repeat(60));

    // Set DepositPool in stQRL
    console.log('\nSetting DepositPool in stQRL...');
    const stQRLContract = new web3.zond.Contract(
        loadArtifact('stQRL').abi,
        stQRL.options.address
    );
    await stQRLContract.methods.setDepositPool(depositPool.options.address).send({
        from: account.address,
        gas: 100000
    });
    console.log('  ✓ DepositPool set');

    // Set RewardsOracle in stQRL
    console.log('\nSetting RewardsOracle in stQRL...');
    await stQRLContract.methods.setRewardsOracle(rewardsOracle.options.address).send({
        from: account.address,
        gas: 100000
    });
    console.log('  ✓ RewardsOracle set');

    // Save addresses to config
    config.contracts = {
        stQRL: stQRL.options.address,
        depositPool: depositPool.options.address,
        rewardsOracle: rewardsOracle.options.address,
        operatorRegistry: operatorRegistry.options.address
    };

    fs.writeFileSync(
        path.join(__dirname, '..', 'config', 'testnet.json'),
        JSON.stringify(config, null, 2)
    );

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Deployment Complete!');
    console.log('='.repeat(60));
    console.log('\nContract Addresses:');
    console.log(`  stQRL:            ${stQRL.options.address}`);
    console.log(`  DepositPool:      ${depositPool.options.address}`);
    console.log(`  RewardsOracle:    ${rewardsOracle.options.address}`);
    console.log(`  OperatorRegistry: ${operatorRegistry.options.address}`);
    console.log('\nAddresses saved to config/testnet.json');
    console.log('\nNext steps:');
    console.log('  1. Verify contracts on zondscan.com');
    console.log('  2. Test deposit with: node scripts/test-deposit.js');
    console.log('  3. Check exchange rate with: node scripts/check-rate.js');
}

main().catch(err => {
    console.error('\nDeployment failed:', err.message);
    process.exit(1);
});
