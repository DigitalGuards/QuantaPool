/**
 * QuantaPool Integration Test Suite
 *
 * Enterprise-grade integration tests with proper assertions.
 *
 * Tests the full flow:
 * 1. Create test wallets
 * 2. Fund them from main wallet
 * 3. Test deposits from multiple wallets
 * 4. Verify stQRL balances and queue status
 * 5. Test withdrawal requests
 * 6. Test withdrawal claims (after waiting)
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const crypto = require('crypto');

// Load environment variables using dotenv
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Web3 } = require('@theqrl/web3');
const { loadDeployer } = require('./lib/loadDeployer');

const config = require('../config/testnet.json');

// Test result tracking
const testResults = {
    passed: 0,
    failed: 0,
    assertions: []
};

/**
 * Custom assertion wrapper that tracks results
 * @param {boolean} condition - Condition to assert
 * @param {string} message - Description of the assertion
 */
function assertCondition(condition, message) {
    try {
        assert.ok(condition, message);
        testResults.passed++;
        testResults.assertions.push({ status: 'PASS', message });
        console.log(`   ✓ ASSERT: ${message}`);
    } catch (err) {
        testResults.failed++;
        testResults.assertions.push({ status: 'FAIL', message, error: err.message });
        console.log(`   ✗ ASSERT FAILED: ${message}`);
        throw err;
    }
}

/**
 * Assert two BigInt values are equal
 * @param {BigInt} actual - Actual value
 * @param {BigInt} expected - Expected value
 * @param {string} message - Description
 */
function assertBigIntEqual(actual, expected, message) {
    assertCondition(
        BigInt(actual) === BigInt(expected),
        `${message} (expected: ${expected}, actual: ${actual})`
    );
}

/**
 * Assert BigInt is greater than threshold
 * @param {BigInt} actual - Actual value
 * @param {BigInt} threshold - Minimum threshold
 * @param {string} message - Description
 */
function assertBigIntGreaterThan(actual, threshold, message) {
    assertCondition(
        BigInt(actual) > BigInt(threshold),
        `${message} (actual: ${actual}, threshold: ${threshold})`
    );
}

/**
 * Load contract artifact from artifacts directory
 * @param {string} name - Contract name
 * @returns {Object} Contract artifact with abi and bytecode
 */
function loadArtifact(name) {
    const artifactPath = path.join(__dirname, '..', 'artifacts', `${name}.json`);
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact not found: ${artifactPath}`);
    }
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

/**
 * Format wei to QRL with 4 decimal places
 * @param {BigInt|string} wei - Amount in wei
 * @returns {string} Formatted QRL amount
 */
function formatQRL(wei) {
    return parseFloat(Web3.utils.fromWei(wei.toString(), 'ether')).toFixed(4);
}

/**
 * Calculate percentage using proper BigInt handling
 * @param {BigInt} value - Current value in wei
 * @param {BigInt} total - Total value in wei
 * @returns {string} Formatted percentage
 */
function calculatePercentage(value, total) {
    // Guard against division by zero
    if (BigInt(total) === 0n) {
        return '0.00';
    }
    const valueEther = parseFloat(Web3.utils.fromWei(value.toString(), 'ether'));
    const totalEther = parseFloat(Web3.utils.fromWei(total.toString(), 'ether'));
    return ((valueEther / totalEther) * 100).toFixed(2);
}

/**
 * Display shortened address
 * @param {string} addr - Full address
 * @returns {string} Shortened address
 */
function shortAddr(addr) {
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

/**
 * Estimate gas for a transaction with a safety buffer
 * @param {Object} web3 - Web3 instance
 * @param {Object} txParams - Transaction parameters
 * @returns {BigInt} Estimated gas with 20% buffer
 */
async function estimateGasWithBuffer(web3, txParams) {
    const estimated = await web3.qrl.estimateGas(txParams);
    return BigInt(estimated) * 120n / 100n;
}

class IntegrationTest {
    constructor() {
        this.web3 = new Web3(config.provider);
        this.stQRLArtifact = loadArtifact('stQRL');
        this.depositPoolArtifact = loadArtifact('DepositPool');

        this.stQRL = new this.web3.qrl.Contract(this.stQRLArtifact.abi, config.contracts.stQRL);
        this.depositPool = new this.web3.qrl.Contract(this.depositPoolArtifact.abi, config.contracts.depositPool);

        this.mainAccount = null;
        this.testWallets = [];
        this.initialState = null;
    }

    async setupMainAccount() {
        console.log('\n📋 Setting up main account...');

        if (!process.env.TESTNET_SEED) {
            throw new Error('TESTNET_SEED environment variable is required');
        }

        const mnemonic = process.env.TESTNET_SEED;
        this.mainAccount = loadDeployer(this.web3, mnemonic);

        const balance = await this.web3.qrl.getBalance(this.mainAccount.address);
        console.log(`   Main wallet: ${shortAddr(this.mainAccount.address)}`);
        console.log(`   Balance: ${formatQRL(balance)} QRL`);

        assertBigIntGreaterThan(balance, 0n, 'Main wallet has positive balance');

        return balance;
    }

    async createTestWallets(count = 2) {
        console.log(`\n🔑 Creating ${count} test wallets...`);

        this.testWallets = [];

        for (let i = 0; i < count; i++) {
            const randomBytes = crypto.randomBytes(48);
            const seedHex = '0x' + randomBytes.toString('hex');

            const account = this.web3.qrl.accounts.seedToAccount(seedHex);
            this.web3.qrl.accounts.wallet.add(account);

            this.testWallets.push({
                account,
                seedHex,
                name: `TestWallet${i + 1}`
            });

            console.log(`   ${this.testWallets[i].name}: ${shortAddr(account.address)}`);
        }

        assertCondition(this.testWallets.length === count, `Created ${count} test wallets`);

        return this.testWallets;
    }

    async fundTestWallets(amountPerWallet = '100') {
        console.log(`\n💰 Funding test wallets with ${amountPerWallet} QRL each...`);

        const amountWei = this.web3.utils.toWei(amountPerWallet, 'ether');

        for (const wallet of this.testWallets) {
            try {
                const tx = await this.web3.qrl.sendTransaction({
                    from: this.mainAccount.address,
                    to: wallet.account.address,
                    value: amountWei,
                    gas: 21000
                });

                const balance = await this.web3.qrl.getBalance(wallet.account.address);
                console.log(`   ✓ ${wallet.name}: ${formatQRL(balance)} QRL (tx: ${tx.transactionHash.slice(0, 16)}...)`);

                // Assert wallet was funded correctly
                assertBigIntEqual(balance, amountWei, `${wallet.name} received correct funding`);
            } catch (err) {
                console.log(`   ✗ ${wallet.name}: Failed - ${err.message}`);
                throw err;
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

        // Use proper BigInt handling for percentage calculation
        const thresholdWei = this.web3.utils.toWei('40000', 'ether');
        const progressPercent = calculatePercentage(queueStatus.pending, thresholdWei);

        console.log(`   Exchange Rate: ${formatQRL(exchangeRate)} QRL/stQRL`);
        console.log(`   Total Assets: ${formatQRL(totalAssets)} QRL`);
        console.log(`   Total stQRL: ${formatQRL(totalSupply)}`);
        console.log(`   Pending Deposits: ${formatQRL(queueStatus.pending)} QRL`);
        console.log(`   Queue Progress: ${formatQRL(queueStatus.pending)}/40,000 QRL (${progressPercent}%)`);
        console.log(`   Liquid Reserve: ${formatQRL(liquidReserve)} QRL`);
        console.log(`   Validators: ${validatorCount}`);

        return { exchangeRate, totalAssets, totalSupply, queueStatus, liquidReserve, validatorCount };
    }

    async testDeposit(wallet, amount) {
        console.log(`\n📥 Testing deposit: ${wallet.name} depositing ${amount} QRL...`);

        const amountWei = this.web3.utils.toWei(amount, 'ether');

        // Get balances before
        const qrlBefore = await this.web3.qrl.getBalance(wallet.account.address);
        const stQRLBefore = await this.stQRL.methods.balanceOf(wallet.account.address).call();
        const protocolStateBefore = await this.checkProtocolState();

        console.log(`   Before: ${formatQRL(qrlBefore)} QRL, ${formatQRL(stQRLBefore)} stQRL`);

        try {
            const depositData = this.depositPool.methods.deposit().encodeABI();

            // Estimate gas dynamically
            const txParams = {
                from: wallet.account.address,
                to: config.contracts.depositPool,
                value: amountWei,
                data: depositData
            };

            const gasEstimate = await estimateGasWithBuffer(this.web3, txParams);

            const tx = await this.web3.qrl.sendTransaction({
                ...txParams,
                gas: gasEstimate.toString()
            });

            // Get balances after
            const qrlAfter = await this.web3.qrl.getBalance(wallet.account.address);
            const stQRLAfter = await this.stQRL.methods.balanceOf(wallet.account.address).call();
            const stQRLReceived = BigInt(stQRLAfter) - BigInt(stQRLBefore);

            console.log(`   After: ${formatQRL(qrlAfter)} QRL, ${formatQRL(stQRLAfter)} stQRL`);
            console.log(`   ✓ Received ${formatQRL(stQRLReceived)} stQRL`);
            console.log(`   TX: ${tx.transactionHash}`);

            // ASSERTIONS
            assertBigIntGreaterThan(stQRLReceived, 0n, `${wallet.name} received stQRL tokens`);

            // Use convertToShares to get exact expected amount (handles any exchange rate)
            const expectedStQRL = await this.stQRL.methods.convertToShares(amountWei).call();
            assertBigIntEqual(stQRLReceived, BigInt(expectedStQRL), `${wallet.name} received correct stQRL amount`);

            // Verify protocol state updated
            const protocolStateAfter = await this.depositPool.methods.getQueueStatus().call();
            const pendingIncrease = BigInt(protocolStateAfter.pending) - BigInt(protocolStateBefore.queueStatus.pending);
            assertBigIntEqual(pendingIncrease, amountWei, 'Protocol pending deposits increased correctly');

            return { success: true, txHash: tx.transactionHash, stQRLReceived };
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

            // Estimate gas dynamically
            const txParams = {
                from: wallet.account.address,
                to: config.contracts.depositPool,
                data: withdrawData
            };

            const gasEstimate = await estimateGasWithBuffer(this.web3, txParams);

            const tx = await this.web3.qrl.sendTransaction({
                ...txParams,
                gas: gasEstimate.toString()
            });

            // Check withdrawal request
            const request = await this.depositPool.methods.getWithdrawalRequest(wallet.account.address).call();

            console.log(`   ✓ Withdrawal requested!`);
            console.log(`   Shares: ${formatQRL(request.shares)} stQRL`);
            console.log(`   Assets: ${formatQRL(request.assets)} QRL`);
            console.log(`   Request block: ${request.requestBlock}`);
            console.log(`   Can claim: ${request.canClaim}`);
            console.log(`   TX: ${tx.transactionHash}`);

            // ASSERTIONS
            assertBigIntEqual(request.shares, sharesWei, 'Withdrawal request has correct shares');
            assertBigIntGreaterThan(request.requestBlock, 0n, 'Request block is set');
            assertCondition(request.canClaim === false, 'Cannot claim immediately (waiting period)');

            return { success: true, txHash: tx.transactionHash, request };
        } catch (err) {
            console.log(`   ✗ Failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    async checkWithdrawalStatus(wallet) {
        console.log(`\n⏳ Checking withdrawal status for ${wallet.name}...`);

        const request = await this.depositPool.methods.getWithdrawalRequest(wallet.account.address).call();
        const currentBlock = await this.web3.qrl.getBlockNumber();

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
            // This is expected behavior, not a test failure
            return { success: false, error: 'Waiting period not over', expected: true };
        }

        const qrlBefore = await this.web3.qrl.getBalance(wallet.account.address);

        try {
            const claimData = this.depositPool.methods.claimWithdrawal().encodeABI();

            const txParams = {
                from: wallet.account.address,
                to: config.contracts.depositPool,
                data: claimData
            };

            const gasEstimate = await estimateGasWithBuffer(this.web3, txParams);

            const tx = await this.web3.qrl.sendTransaction({
                ...txParams,
                gas: gasEstimate.toString()
            });

            const qrlAfter = await this.web3.qrl.getBalance(wallet.account.address);
            const qrlReceived = BigInt(qrlAfter) - BigInt(qrlBefore);

            console.log(`   ✓ Withdrawal claimed!`);
            console.log(`   QRL received: ~${formatQRL(qrlReceived)} QRL (minus gas)`);
            console.log(`   TX: ${tx.transactionHash}`);

            // ASSERTIONS
            assertBigIntGreaterThan(qrlAfter, qrlBefore, 'QRL balance increased after claim');

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

        try {
            // 1. Setup
            const mainBalance = await this.setupMainAccount();

            const minRequiredBalance = this.web3.utils.toWei('300', 'ether');
            assertBigIntGreaterThan(mainBalance, minRequiredBalance, 'Main wallet has sufficient funds (>300 QRL)');

            // 2. Store initial protocol state
            this.initialState = await this.checkProtocolState();

            // 3. Create test wallets
            await this.createTestWallets(2);

            // 4. Fund test wallets
            await this.fundTestWallets('100');

            // 5. Test deposits from multiple wallets
            console.log('\n' + '='.repeat(60));
            console.log('📥 DEPOSIT TESTS');
            console.log('='.repeat(60));

            // Track actual stQRL minted from each deposit
            let totalStQRLMinted = 0n;

            for (const wallet of this.testWallets) {
                const result = await this.testDeposit(wallet, '50');
                assertCondition(result.success, `${wallet.name} deposit succeeded`);
                totalStQRLMinted += result.stQRLReceived;
            }

            // Also deposit from main wallet
            const mainDepositResult = await this.testDeposit({ account: this.mainAccount, name: 'MainWallet' }, '25');
            assertCondition(mainDepositResult.success, 'MainWallet deposit succeeded');
            totalStQRLMinted += mainDepositResult.stQRLReceived;

            // 6. Check protocol state after deposits
            const stateAfterDeposits = await this.checkProtocolState();

            // Verify total stQRL supply increased by the sum of minted shares
            const supplyIncrease = BigInt(stateAfterDeposits.totalSupply) - BigInt(this.initialState.totalSupply);
            assertBigIntEqual(supplyIncrease, totalStQRLMinted, 'Total stQRL supply increased by sum of minted shares');

            // 7. Test withdrawal request
            console.log('\n' + '='.repeat(60));
            console.log('📤 WITHDRAWAL TESTS');
            console.log('='.repeat(60));

            const withdrawResult = await this.testWithdrawalRequest(this.testWallets[0], '10');
            assertCondition(withdrawResult.success, 'Withdrawal request succeeded');

            // Check status
            const status = await this.checkWithdrawalStatus(this.testWallets[0]);
            assertCondition(status !== null, 'Withdrawal status is available');
            assertCondition(status.blocksRemaining > 0, 'Waiting period is active');

            // Try to claim (will fail due to waiting period - expected)
            const claimResult = await this.testWithdrawalClaim(this.testWallets[0]);
            assertCondition(claimResult.expected === true || claimResult.success === true, 'Claim behaves correctly');

            // 8. Final state
            console.log('\n' + '='.repeat(60));
            console.log('📊 FINAL STATE');
            console.log('='.repeat(60));

            await this.checkProtocolState();

            // Print all wallet balances
            console.log('\n💼 Wallet Balances:');

            const mainQRL = await this.web3.qrl.getBalance(this.mainAccount.address);
            const mainStQRL = await this.stQRL.methods.balanceOf(this.mainAccount.address).call();
            console.log(`   MainWallet: ${formatQRL(mainQRL)} QRL, ${formatQRL(mainStQRL)} stQRL`);

            for (const wallet of this.testWallets) {
                const qrl = await this.web3.qrl.getBalance(wallet.account.address);
                const stQRL = await this.stQRL.methods.balanceOf(wallet.account.address).call();
                console.log(`   ${wallet.name}: ${formatQRL(qrl)} QRL, ${formatQRL(stQRL)} stQRL`);
            }

            // Print test summary
            console.log('\n' + '='.repeat(60));
            console.log('📋 TEST SUMMARY');
            console.log('='.repeat(60));
            console.log(`   Passed: ${testResults.passed}`);
            console.log(`   Failed: ${testResults.failed}`);
            console.log(`   Total:  ${testResults.passed + testResults.failed}`);

            if (testResults.failed > 0) {
                console.log('\n❌ FAILED ASSERTIONS:');
                testResults.assertions
                    .filter(a => a.status === 'FAIL')
                    .forEach(a => console.log(`   - ${a.message}`));
                throw new Error(`${testResults.failed} assertion(s) failed`);
            }

            console.log('\n' + '='.repeat(60));
            console.log('✅ All integration tests passed!');
            console.log('='.repeat(60));

        } catch (err) {
            console.error('\n❌ Test suite failed:', err.message);
            throw err;
        }
    }
}

// Run tests
const test = new IntegrationTest();
test.runFullTest()
    .then(() => {
        process.exit(0);
    })
    .catch(err => {
        console.error('\n❌ Test failed:', err.message);
        process.exit(1);
    });
