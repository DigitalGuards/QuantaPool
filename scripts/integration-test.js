/**
 * QuantaPool Integration Test Suite
 *
 * Tests the full flow:
 * 1. Create test wallets
 * 2. Fund them from main wallet
 * 3. Test deposits from multiple wallets
 * 4. Verify stQRL balances and queue status
 * 5. Test withdrawal requests
 * 6. Test withdrawal claims (after waiting)
 */

const { Web3 } = require('@theqrl/web3');
const { MnemonicToSeedBin, SeedBinToMnemonic } = require('@theqrl/wallet.js');
const crypto = require('crypto');
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

// Helper to format QRL
function formatQRL(wei) {
    return parseFloat(Web3.utils.fromWei(wei.toString(), 'ether')).toFixed(4);
}

// Helper to display address
function shortAddr(addr) {
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

class IntegrationTest {
    constructor() {
        this.web3 = new Web3(config.provider);
        this.stQRLArtifact = loadArtifact('stQRL');
        this.depositPoolArtifact = loadArtifact('DepositPool');

        this.stQRL = new this.web3.zond.Contract(this.stQRLArtifact.abi, config.contracts.stQRL);
        this.depositPool = new this.web3.zond.Contract(this.depositPoolArtifact.abi, config.contracts.depositPool);

        this.mainAccount = null;
        this.testWallets = [];
    }

    async setupMainAccount() {
        console.log('\n📋 Setting up main account...');

        const mnemonic = process.env.TESTNET_SEED;
        const seedBin = MnemonicToSeedBin(mnemonic);
        const seedHex = '0x' + Buffer.from(seedBin).toString('hex');
        this.mainAccount = this.web3.zond.accounts.seedToAccount(seedHex);
        this.web3.zond.accounts.wallet.add(this.mainAccount);

        const balance = await this.web3.zond.getBalance(this.mainAccount.address);
        console.log(`   Main wallet: ${shortAddr(this.mainAccount.address)}`);
        console.log(`   Balance: ${formatQRL(balance)} QRL`);

        return balance;
    }

    async createTestWallets(count = 2) {
        console.log(`\n🔑 Creating ${count} test wallets...`);

        this.testWallets = [];

        for (let i = 0; i < count; i++) {
            // Generate random seed
            const randomBytes = crypto.randomBytes(48);
            const seedHex = '0x' + randomBytes.toString('hex');

            const account = this.web3.zond.accounts.seedToAccount(seedHex);
            this.web3.zond.accounts.wallet.add(account);

            this.testWallets.push({
                account,
                seedHex,
                name: `TestWallet${i + 1}`
            });

            console.log(`   ${this.testWallets[i].name}: ${shortAddr(account.address)}`);
        }

        return this.testWallets;
    }

    async fundTestWallets(amountPerWallet = '100') {
        console.log(`\n💰 Funding test wallets with ${amountPerWallet} QRL each...`);

        const amountWei = this.web3.utils.toWei(amountPerWallet, 'ether');

        for (const wallet of this.testWallets) {
            try {
                const tx = await this.web3.zond.sendTransaction({
                    from: this.mainAccount.address,
                    to: wallet.account.address,
                    value: amountWei,
                    gas: 21000
                });

                const balance = await this.web3.zond.getBalance(wallet.account.address);
                console.log(`   ✓ ${wallet.name}: ${formatQRL(balance)} QRL (tx: ${tx.transactionHash.slice(0, 16)}...)`);
            } catch (err) {
                console.log(`   ✗ ${wallet.name}: Failed - ${err.message}`);
            }
        }
    }

    async checkProtocolState() {
        console.log('\n📊 Protocol State:');

        const [exchangeRate, totalAssets, totalSupply, queueStatus, liquidReserve, validatorCount] = await Promise.all([
            this.stQRL.methods.getExchangeRate().call(),
            this.stQRL.methods.totalAssets().call(),
            this.stQRL.methods.totalSupply().call(),
            this.depositPool.methods.getQueueStatus().call(),
            this.depositPool.methods.liquidReserve().call(),
            this.depositPool.methods.validatorCount().call()
        ]);

        console.log(`   Exchange Rate: ${formatQRL(exchangeRate)} QRL/stQRL`);
        console.log(`   Total Assets: ${formatQRL(totalAssets)} QRL`);
        console.log(`   Total stQRL: ${formatQRL(totalSupply)}`);
        console.log(`   Pending Deposits: ${formatQRL(queueStatus.pending)} QRL`);
        console.log(`   Queue Progress: ${formatQRL(queueStatus.pending)}/40,000 QRL (${(Number(queueStatus.pending) / 40000e18 * 100).toFixed(2)}%)`);
        console.log(`   Liquid Reserve: ${formatQRL(liquidReserve)} QRL`);
        console.log(`   Validators: ${validatorCount}`);

        return { exchangeRate, totalAssets, totalSupply, queueStatus, liquidReserve, validatorCount };
    }

    async testDeposit(wallet, amount) {
        console.log(`\n📥 Testing deposit: ${wallet.name} depositing ${amount} QRL...`);

        const amountWei = this.web3.utils.toWei(amount, 'ether');

        // Get balances before
        const qrlBefore = await this.web3.zond.getBalance(wallet.account.address);
        const stQRLBefore = await this.stQRL.methods.balanceOf(wallet.account.address).call();

        console.log(`   Before: ${formatQRL(qrlBefore)} QRL, ${formatQRL(stQRLBefore)} stQRL`);

        try {
            // Encode and send deposit
            const depositData = this.depositPool.methods.deposit().encodeABI();

            const tx = await this.web3.zond.sendTransaction({
                from: wallet.account.address,
                to: config.contracts.depositPool,
                value: amountWei,
                data: depositData,
                gas: 200000
            });

            // Get balances after
            const qrlAfter = await this.web3.zond.getBalance(wallet.account.address);
            const stQRLAfter = await this.stQRL.methods.balanceOf(wallet.account.address).call();

            console.log(`   After: ${formatQRL(qrlAfter)} QRL, ${formatQRL(stQRLAfter)} stQRL`);
            console.log(`   ✓ Received ${formatQRL(BigInt(stQRLAfter) - BigInt(stQRLBefore))} stQRL`);
            console.log(`   TX: ${tx.transactionHash}`);

            return { success: true, txHash: tx.transactionHash, stQRLReceived: BigInt(stQRLAfter) - BigInt(stQRLBefore) };
        } catch (err) {
            console.log(`   ✗ Failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    async testWithdrawalRequest(wallet, shares) {
        console.log(`\n📤 Testing withdrawal request: ${wallet.name} withdrawing ${shares} stQRL...`);

        const sharesWei = this.web3.utils.toWei(shares, 'ether');

        // Check current stQRL balance
        const stQRLBalance = await this.stQRL.methods.balanceOf(wallet.account.address).call();
        console.log(`   Current stQRL balance: ${formatQRL(stQRLBalance)}`);

        if (BigInt(stQRLBalance) < BigInt(sharesWei)) {
            console.log(`   ✗ Insufficient stQRL balance`);
            return { success: false, error: 'Insufficient balance' };
        }

        try {
            const withdrawData = this.depositPool.methods.requestWithdrawal(sharesWei).encodeABI();

            const tx = await this.web3.zond.sendTransaction({
                from: wallet.account.address,
                to: config.contracts.depositPool,
                data: withdrawData,
                gas: 200000
            });

            // Check withdrawal request
            const request = await this.depositPool.methods.getWithdrawalRequest(wallet.account.address).call();

            console.log(`   ✓ Withdrawal requested!`);
            console.log(`   Shares: ${formatQRL(request.shares)} stQRL`);
            console.log(`   Assets: ${formatQRL(request.assets)} QRL`);
            console.log(`   Request block: ${request.requestBlock}`);
            console.log(`   Can claim: ${request.canClaim}`);
            console.log(`   TX: ${tx.transactionHash}`);

            return { success: true, txHash: tx.transactionHash, request };
        } catch (err) {
            console.log(`   ✗ Failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    async checkWithdrawalStatus(wallet) {
        console.log(`\n⏳ Checking withdrawal status for ${wallet.name}...`);

        const request = await this.depositPool.methods.getWithdrawalRequest(wallet.account.address).call();
        const currentBlock = await this.web3.zond.getBlockNumber();

        if (BigInt(request.shares) === 0n) {
            console.log(`   No pending withdrawal`);
            return null;
        }

        const blocksRemaining = Number(request.requestBlock) + 128 - Number(currentBlock);

        console.log(`   Shares: ${formatQRL(request.shares)} stQRL`);
        console.log(`   Assets: ${formatQRL(request.assets)} QRL`);
        console.log(`   Current block: ${currentBlock}`);
        console.log(`   Request block: ${request.requestBlock}`);
        console.log(`   Blocks remaining: ${Math.max(0, blocksRemaining)}`);
        console.log(`   Can claim: ${request.canClaim}`);

        return { request, blocksRemaining, canClaim: request.canClaim };
    }

    async testWithdrawalClaim(wallet) {
        console.log(`\n💸 Testing withdrawal claim for ${wallet.name}...`);

        const request = await this.depositPool.methods.getWithdrawalRequest(wallet.account.address).call();

        if (BigInt(request.shares) === 0n) {
            console.log(`   ✗ No pending withdrawal to claim`);
            return { success: false, error: 'No pending withdrawal' };
        }

        if (!request.canClaim) {
            console.log(`   ✗ Cannot claim yet - waiting period not over`);
            return { success: false, error: 'Waiting period not over' };
        }

        const qrlBefore = await this.web3.zond.getBalance(wallet.account.address);

        try {
            const claimData = this.depositPool.methods.claimWithdrawal().encodeABI();

            const tx = await this.web3.zond.sendTransaction({
                from: wallet.account.address,
                to: config.contracts.depositPool,
                data: claimData,
                gas: 200000
            });

            const qrlAfter = await this.web3.zond.getBalance(wallet.account.address);
            const qrlReceived = BigInt(qrlAfter) - BigInt(qrlBefore);

            console.log(`   ✓ Withdrawal claimed!`);
            console.log(`   QRL received: ~${formatQRL(qrlReceived)} QRL (minus gas)`);
            console.log(`   TX: ${tx.transactionHash}`);

            return { success: true, txHash: tx.transactionHash, qrlReceived };
        } catch (err) {
            console.log(`   ✗ Failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    async runFullTest() {
        console.log('='.repeat(60));
        console.log('🧪 QuantaPool Integration Test Suite');
        console.log('='.repeat(60));

        // 1. Setup
        const mainBalance = await this.setupMainAccount();

        if (BigInt(mainBalance) < BigInt(this.web3.utils.toWei('300', 'ether'))) {
            console.log('\n⚠️  Warning: Main wallet has less than 300 QRL. Tests may fail.');
        }

        // 2. Check initial protocol state
        await this.checkProtocolState();

        // 3. Create test wallets
        await this.createTestWallets(2);

        // 4. Fund test wallets
        await this.fundTestWallets('100');

        // 5. Test deposits from multiple wallets
        console.log('\n' + '='.repeat(60));
        console.log('📥 DEPOSIT TESTS');
        console.log('='.repeat(60));

        for (const wallet of this.testWallets) {
            await this.testDeposit(wallet, '50');
        }

        // Also deposit from main wallet
        await this.testDeposit({ account: this.mainAccount, name: 'MainWallet' }, '25');

        // 6. Check protocol state after deposits
        await this.checkProtocolState();

        // 7. Test withdrawal request
        console.log('\n' + '='.repeat(60));
        console.log('📤 WITHDRAWAL TESTS');
        console.log('='.repeat(60));

        // Request withdrawal from first test wallet
        await this.testWithdrawalRequest(this.testWallets[0], '10');

        // Check status
        await this.checkWithdrawalStatus(this.testWallets[0]);

        // Try to claim (will likely fail due to waiting period)
        await this.testWithdrawalClaim(this.testWallets[0]);

        // 8. Final state
        console.log('\n' + '='.repeat(60));
        console.log('📊 FINAL STATE');
        console.log('='.repeat(60));

        await this.checkProtocolState();

        // Print all wallet balances
        console.log('\n💼 Wallet Balances:');

        const mainQRL = await this.web3.zond.getBalance(this.mainAccount.address);
        const mainStQRL = await this.stQRL.methods.balanceOf(this.mainAccount.address).call();
        console.log(`   MainWallet: ${formatQRL(mainQRL)} QRL, ${formatQRL(mainStQRL)} stQRL`);

        for (const wallet of this.testWallets) {
            const qrl = await this.web3.zond.getBalance(wallet.account.address);
            const stQRL = await this.stQRL.methods.balanceOf(wallet.account.address).call();
            console.log(`   ${wallet.name}: ${formatQRL(qrl)} QRL, ${formatQRL(stQRL)} stQRL`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ Integration test complete!');
        console.log('='.repeat(60));
    }
}

// Run tests
const test = new IntegrationTest();
test.runFullTest().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
