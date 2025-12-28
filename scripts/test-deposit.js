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
    console.log('='.repeat(60));
    console.log('QuantaPool Test Deposit');
    console.log('='.repeat(60));

    const web3 = new Web3(config.provider);

    // Setup account
    const mnemonic = process.env.TESTNET_SEED;
    const seedBin = MnemonicToSeedBin(mnemonic);
    const seedHex = '0x' + Buffer.from(seedBin).toString('hex');
    const account = web3.zond.accounts.seedToAccount(seedHex);
    web3.zond.accounts.wallet.add(account);

    console.log(`\nAccount: ${account.address}`);

    // Load contracts
    const stQRLArtifact = loadArtifact('stQRL');
    const depositPoolArtifact = loadArtifact('DepositPool');

    const stQRL = new web3.zond.Contract(stQRLArtifact.abi, config.contracts.stQRL);
    const depositPool = new web3.zond.Contract(depositPoolArtifact.abi, config.contracts.depositPool);

    // Check initial state
    console.log('\n--- Initial State ---');

    const qrlBalance = await web3.zond.getBalance(account.address);
    console.log(`QRL Balance: ${web3.utils.fromWei(qrlBalance, 'ether')} QRL`);

    const stQRLBalance = await stQRL.methods.balanceOf(account.address).call();
    console.log(`stQRL Balance: ${web3.utils.fromWei(stQRLBalance, 'ether')} stQRL`);

    const exchangeRate = await stQRL.methods.getExchangeRate().call();
    console.log(`Exchange Rate: ${web3.utils.fromWei(exchangeRate, 'ether')} QRL per stQRL`);

    const totalAssets = await stQRL.methods.totalAssets().call();
    console.log(`Total Assets: ${web3.utils.fromWei(totalAssets, 'ether')} QRL`);

    // Get queue status
    const queueStatus = await depositPool.methods.getQueueStatus().call();
    console.log(`\nDeposit Queue:`);
    console.log(`  Pending: ${web3.utils.fromWei(queueStatus.pending, 'ether')} QRL`);
    console.log(`  Remaining to threshold: ${web3.utils.fromWei(queueStatus.remaining, 'ether')} QRL`);

    // Make a test deposit
    const depositAmount = web3.utils.toWei('10', 'ether'); // 10 QRL
    console.log(`\n--- Making Deposit: 10 QRL ---`);

    // Encode deposit call
    const depositData = depositPool.methods.deposit().encodeABI();

    const tx = await web3.zond.sendTransaction({
        from: account.address,
        to: config.contracts.depositPool,
        value: depositAmount,
        data: depositData,
        gas: 200000
    });

    console.log(`TX Hash: ${tx.transactionHash}`);

    // Check final state
    console.log('\n--- After Deposit ---');

    const newQRLBalance = await web3.zond.getBalance(account.address);
    console.log(`QRL Balance: ${web3.utils.fromWei(newQRLBalance, 'ether')} QRL`);

    const newStQRLBalance = await stQRL.methods.balanceOf(account.address).call();
    console.log(`stQRL Balance: ${web3.utils.fromWei(newStQRLBalance, 'ether')} stQRL`);

    const newTotalAssets = await stQRL.methods.totalAssets().call();
    console.log(`Total Assets: ${web3.utils.fromWei(newTotalAssets, 'ether')} QRL`);

    const newQueueStatus = await depositPool.methods.getQueueStatus().call();
    console.log(`\nDeposit Queue:`);
    console.log(`  Pending: ${web3.utils.fromWei(newQueueStatus.pending, 'ether')} QRL`);
    console.log(`  Remaining to threshold: ${web3.utils.fromWei(newQueueStatus.remaining, 'ether')} QRL`);

    console.log('\n' + '='.repeat(60));
    console.log('✓ Test deposit successful!');
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('\nError:', err.message);
    process.exit(1);
});
