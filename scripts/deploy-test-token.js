const { Web3 } = require('@theqrl/web3');
const { loadDeployer } = require('./lib/loadDeployer');
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

async function main() {
    console.log('Connecting to QRL testnet...');
    console.log(`Provider: ${config.provider}`);

    const web3 = new Web3(config.provider);

    // Check connection
    try {
        const chainId = await web3.qrl.getChainId();
        console.log(`Connected! Chain ID: ${chainId}`);
    } catch (err) {
        console.error('Failed to connect to node:', err.message);
        console.log('\nMake sure your node is running:');
        console.log('  systemctl --user status gzond.service');
        process.exit(1);
    }

    // Load compiled contract
    const artifactPath = path.join(__dirname, '..', 'artifacts', 'TestToken.json');
    if (!fs.existsSync(artifactPath)) {
        console.error('Contract not compiled. Run: npm run compile');
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    console.log(`Loaded ${artifact.contractName} artifact`);

    // Get account from seed mnemonic
    const mnemonic = process.env.TESTNET_SEED;
    if (!mnemonic) {
        console.error('TESTNET_SEED not found in .env');
        process.exit(1);
    }

    console.log('Setting up account from seed...');

    // Convert mnemonic to seed binary, then to hex
    let account;
    try {
        account = loadDeployer(web3, mnemonic);
        console.log(`Account: ${account.address}`);
    } catch (err) {
        console.error('Failed to create account from seed:', err.message);
        process.exit(1);
    }

    // Check balance
    const balance = await web3.qrl.getBalance(account.address);
    console.log(`Balance: ${web3.utils.fromWei(balance, 'ether')} QRL`);

    if (balance === '0' || balance === 0n) {
        console.error('\nNo balance! Request testnet QRL from Discord faucet.');
        process.exit(1);
    }

    // Deploy contract
    console.log('\nDeploying TestToken...');
    const contract = new web3.qrl.Contract(artifact.abi);

    const initialSupply = 1000000; // 1 million tokens

    const deployTx = contract.deploy({
        data: artifact.bytecode,
        arguments: [initialSupply]
    });

    try {
        const gas = await deployTx.estimateGas({ from: account.address });
        console.log(`Estimated gas: ${gas}`);

        const deployed = await deployTx.send({
            from: account.address,
            gas: Math.floor(Number(gas) * 1.2) // 20% buffer
        });

        console.log('\n✓ TestToken deployed!');
        console.log(`  Address: ${deployed.options.address}`);
        console.log(`  TX Hash: ${deployed.transactionHash || 'check explorer'}`);

        // Update config with deployed address
        config.contracts.testToken = deployed.options.address;
        fs.writeFileSync(
            path.join(__dirname, '..', 'config', 'testnet.json'),
            JSON.stringify(config, null, 2)
        );
        console.log('\nConfig updated with contract address.');

    } catch (err) {
        console.error('Deployment failed:', err.message);
        if (err.message.includes('insufficient funds')) {
            console.log('\nNeed more testnet QRL for gas.');
        }
        process.exit(1);
    }
}

main().catch(console.error);
