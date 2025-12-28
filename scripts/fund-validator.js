/**
 * Fund a validator when 40k QRL threshold is reached
 */

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

async function fundValidator() {
    const web3 = new Web3(config.provider);
    const depositPoolAbi = loadArtifact('DepositPool').abi;

    // Setup account
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

    // List available methods
    const methods = Object.keys(depositPool.methods);
    const relevantMethods = methods.filter(m => {
        const lower = m.toLowerCase();
        return (lower.includes('fund') || lower.includes('validator')) && !m.startsWith('0x');
    });
    console.log('\n🔧 Validator-related methods:', relevantMethods.join(', '));

    // Try to fund validator
    if (Number(queueStatus.validatorsReady) > 0) {
        console.log('\n🚀 Funding next validator...');

        try {
            const fundData = depositPool.methods.fundValidator().encodeABI();
            const tx = await web3.zond.sendTransaction({
                from: account.address,
                to: config.contracts.depositPool,
                data: fundData,
                gas: 1000000
            });
            console.log('✅ TX:', tx.transactionHash);

            const newValidatorCount = await depositPool.methods.validatorCount().call();
            console.log('📈 New validator count:', newValidatorCount.toString());
        } catch (err) {
            console.log('❌ Fund failed:', err.message);
        }
    } else {
        console.log('\n⚠️ No validators ready to fund');
    }
}

fundValidator().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
