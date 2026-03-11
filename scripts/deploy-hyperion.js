const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Web3 } = require('@theqrl/web3');
const { MnemonicToSeedBin } = require('@theqrl/wallet.js');

const repoRoot = path.join(__dirname, '..');
const configPath = process.env.HYPERION_CONFIG || path.join(repoRoot, 'config', 'testnet-hyperion.json');
const manifestPath = path.join(repoRoot, 'hyperion', 'artifacts', 'manifest.json');

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadDeployConfig() {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config not found: ${configPath}`);
    }

    return loadJson(configPath);
}

function loadManifest() {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            `Manifest not found: ${manifestPath}. Run "npm run compile:hyperion" first.`
        );
    }

    return loadJson(manifestPath);
}

function loadArtifact(contractName) {
    const manifest = loadManifest();
    const entry = manifest.contracts.find(item => item.contractName === contractName);

    if (!entry) {
        throw new Error(`Contract ${contractName} not found in ${manifestPath}`);
    }

    const artifactsDir = path.dirname(manifestPath);
    const abiPath = path.join(artifactsDir, entry.abiFile);
    const binPath = path.join(artifactsDir, entry.binFile);

    if (!fs.existsSync(abiPath) || !fs.existsSync(binPath)) {
        throw new Error(`Missing Hyperion artifact files for ${contractName}`);
    }

    return {
        abi: loadJson(abiPath),
        bytecode: `0x${fs.readFileSync(binPath, 'utf8').trim()}`
    };
}

function getAccount(web3) {
    if (!process.env.TESTNET_SEED) {
        throw new Error('TESTNET_SEED environment variable is required');
    }

    const seedBin = MnemonicToSeedBin(process.env.TESTNET_SEED);
    const seedHex = `0x${Buffer.from(seedBin).toString('hex')}`;
    const account = web3.zond.accounts.seedToAccount(seedHex);
    web3.zond.accounts.wallet.add(account);
    return account;
}

async function deployContract(web3, account, contractName, constructorArgs = []) {
    const artifact = loadArtifact(contractName);
    console.log(`\nDeploying ${contractName}...`);

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

    console.log(`  Address: ${deployed.options.address}`);
    return deployed;
}

async function sendConfiguredTx(method, account, label) {
    const gas = await method.estimateGas({ from: account.address });
    const tx = await method.send({
        from: account.address,
        gas: Math.floor(Number(gas) * 1.2)
    });

    console.log(`${label}: ${tx.transactionHash || 'submitted'}`);
}

async function main() {
    const config = loadDeployConfig();

    console.log('='.repeat(60));
    console.log('QuantaPool Hyperion v2 Deployment');
    console.log('='.repeat(60));
    console.log(`Config: ${configPath}`);
    console.log(`Provider: ${config.provider}`);

    const web3 = new Web3(config.provider);
    const chainId = await web3.zond.getChainId();
    console.log(`Connected to chain ID: ${chainId}`);

    const account = getAccount(web3);
    console.log(`Deployer: ${account.address}`);

    const balance = await web3.zond.getBalance(account.address);
    console.log(`Balance: ${web3.utils.fromWei(balance, 'ether')} QRL`);

    const stQRL = await deployContract(web3, account, 'stQRLv2');
    const depositPool = await deployContract(web3, account, 'DepositPoolV2');
    const validatorManager = await deployContract(web3, account, 'ValidatorManager');

    console.log('\nConfiguring contract links...');

    await sendConfiguredTx(
        new web3.zond.Contract(loadArtifact('DepositPoolV2').abi, depositPool.options.address)
            .methods.setStQRL(stQRL.options.address),
        account,
        '  DepositPoolV2.setStQRL'
    );

    await sendConfiguredTx(
        new web3.zond.Contract(loadArtifact('stQRLv2').abi, stQRL.options.address)
            .methods.setDepositPool(depositPool.options.address),
        account,
        '  stQRLv2.setDepositPool'
    );

    await sendConfiguredTx(
        new web3.zond.Contract(loadArtifact('ValidatorManager').abi, validatorManager.options.address)
            .methods.setDepositPool(depositPool.options.address),
        account,
        '  ValidatorManager.setDepositPool'
    );

    config.contracts = {
        stQRLV2: stQRL.options.address,
        depositPoolV2: depositPool.options.address,
        validatorManager: validatorManager.options.address
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('\nDeployment complete.');
    console.log(`stQRLV2: ${stQRL.options.address}`);
    console.log(`DepositPoolV2: ${depositPool.options.address}`);
    console.log(`ValidatorManager: ${validatorManager.options.address}`);
    console.log(`Updated config: ${configPath}`);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
