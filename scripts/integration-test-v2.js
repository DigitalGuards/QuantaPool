/* eslint-disable no-console */
require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const { Web3 } = require('@theqrl/web3');

const { loadDeployer } = require('./lib/loadDeployer');

const repoRoot = path.join(__dirname, '..');
const config = require(path.join(repoRoot, 'config', 'testnet-hyperion.json'));

const PHASES = ['smoke', 'rewards', 'withdraw', 'validator', 'all'];

function loadAbi(name) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'hyperion', 'artifacts', `${name}.abi`), 'utf8'));
}

function fmt(planck) {
    // planck is a BigInt; quanta = planck / 10^18
    const ONE = 1_000_000_000_000_000_000n;
    const whole = planck / ONE;
    const frac = (planck % ONE).toString().padStart(18, '0').replace(/0+$/, '');
    return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

function ok(msg) {
    console.log(`  ✓ ${msg}`);
}

function fail(msg) {
    console.log(`  ✗ FAIL: ${msg}`);
    process.exitCode = 1;
}

function expect(cond, msg) {
    cond ? ok(msg) : fail(msg);
}

async function tx(method, account, label, sendOptions = {}) {
    const gas = await method.estimateGas({ from: account.address, ...sendOptions });
    const receipt = await method.send({
        from: account.address,
        gas: Math.floor(Number(gas) * 1.2),
        ...sendOptions
    });
    console.log(`  → ${label} : ${receipt.transactionHash}`);
    return receipt;
}

async function dumpStatus(pool) {
    const s = await pool.methods.getPoolStatus().call();
    console.log(
        `  state: pooled=${fmt(s.totalPooled)} shares=${fmt(s.totalShares)} ` +
        `buffered=${fmt(s.buffered)} validators=${s.validators} ` +
        `pendingShares=${fmt(s.pendingWithdrawalShares)} reserve=${fmt(s.reserveBalance)} ` +
        `rate=${fmt(s.exchangeRate)}`
    );
}

async function main() {
    const phase = process.argv[2] || 'all';
    if (!PHASES.includes(phase)) {
        console.error(`Usage: node ${path.basename(__filename)} [${PHASES.join('|')}]`);
        process.exit(1);
    }

    const web3 = new Web3(config.provider);
    const account = loadDeployer(web3, process.env.TESTNET_SEED);
    web3.qrl.defaultAccount = account.address;
    const stQRL = new web3.qrl.Contract(loadAbi('stQRLv2'), config.contracts.stQRLV2);
    const pool = new web3.qrl.Contract(loadAbi('DepositPoolV2'), config.contracts.depositPoolV2);
    const vm = new web3.qrl.Contract(loadAbi('ValidatorManager'), config.contracts.validatorManager);
    // The wallet attached on `web3` does not automatically propagate to Contract
    // instances created by user code; bind it explicitly so .send({from}) signs
    // locally instead of forwarding to the node (which fails with "unknown account").
    for (const c of [stQRL, pool, vm]) {
        c.wallet = web3.qrl.accounts.wallet;
        c.defaultAccount = account.address;
    }

    const chainId = await web3.qrl.getChainId();
    const balance = await web3.qrl.getBalance(account.address);
    console.log(`Chain ${chainId} | deployer ${account.address} | balance ${fmt(balance)} QRL`);
    console.log(`stQRL=${config.contracts.stQRLV2}`);
    console.log(`pool =${config.contracts.depositPoolV2}`);
    console.log(`vm   =${config.contracts.validatorManager}\n`);
    await dumpStatus(pool);

    // ===== Phase 1: smoke deposit (100 QRL) =====
    if (phase === 'smoke' || phase === 'all') {
        console.log('\n[1] Smoke deposit (100 QRL)');
        const before = {
            shares: BigInt(await stQRL.methods.balanceOf(account.address).call()),
            pooled: BigInt(await stQRL.methods.totalPooledQRL().call()),
            buffered: BigInt(await pool.methods.bufferedQRL().call())
        };
        const value = 100n * 10n ** 18n;
        await tx(pool.methods.deposit(), account, 'pool.deposit(100 QRL)', { value: value.toString() });
        const after = {
            shares: BigInt(await stQRL.methods.balanceOf(account.address).call()),
            pooled: BigInt(await stQRL.methods.totalPooledQRL().call()),
            buffered: BigInt(await pool.methods.bufferedQRL().call())
        };
        expect(after.shares > before.shares, `shares minted (${fmt(before.shares)} → ${fmt(after.shares)})`);
        expect(after.pooled === before.pooled + value, `totalPooledQRL +100 QRL (${fmt(after.pooled)})`);
        expect(after.buffered === before.buffered + value, `bufferedQRL +100 QRL (${fmt(after.buffered)})`);
        const qrlValue = BigInt(await stQRL.methods.getQRLValue(account.address).call());
        expect(qrlValue > 0n, `getQRLValue back-converts (${fmt(qrlValue)} QRL)`);
        await dumpStatus(pool);
    }

    // ===== Phase 2: rewards sync (donate 1 QRL → syncRewards) =====
    if (phase === 'rewards' || phase === 'all') {
        console.log('\n[2] Rewards sync (donate 1 QRL → syncRewards)');
        const beforeRate = BigInt(await stQRL.methods.getExchangeRate().call());
        const beforeRewards = BigInt((await pool.methods.getRewardStats().call()).totalRewards);
        const donate = 1n * 10n ** 18n;
        // Send raw QRL to pool address — triggers receive(), bumps balance only
        await web3.qrl.sendTransaction({
            from: account.address,
            to: config.contracts.depositPoolV2,
            value: donate.toString(),
            gas: 100_000
        });
        console.log('  → donated 1 QRL via raw transfer');
        await tx(pool.methods.syncRewards(), account, 'pool.syncRewards()');
        const afterRate = BigInt(await stQRL.methods.getExchangeRate().call());
        const afterRewards = BigInt((await pool.methods.getRewardStats().call()).totalRewards);
        expect(afterRate > beforeRate, `exchange rate increased (${fmt(beforeRate)} → ${fmt(afterRate)})`);
        expect(afterRewards === beforeRewards + donate, `totalRewardsReceived +1 QRL`);
        await dumpStatus(pool);
    }

    // ===== Phase 3: request withdrawal (lock + assert canClaim=false) =====
    if (phase === 'withdraw' || phase === 'all') {
        console.log('\n[3] Request withdrawal (50% of shares)');
        const balShares = BigInt(await stQRL.methods.balanceOf(account.address).call());
        const reqShares = balShares / 2n;
        if (reqShares === 0n) {
            console.log('  (skipping — no shares to withdraw)');
        } else {
            const lockedBefore = BigInt(await stQRL.methods.lockedSharesOf(account.address).call());
            await tx(pool.methods.requestWithdrawal(reqShares.toString()), account, `pool.requestWithdrawal(${fmt(reqShares)})`);
            const lockedAfter = BigInt(await stQRL.methods.lockedSharesOf(account.address).call());
            expect(lockedAfter === lockedBefore + reqShares, `locked shares += request amount`);
            const counts = await pool.methods.getWithdrawalRequestCount(account.address).call();
            const requestId = BigInt(counts.total) - 1n;
            const req = await pool.methods.getWithdrawalRequest(account.address, requestId.toString()).call();
            expect(BigInt(req.shares) === reqShares, `request[${requestId}].shares == requested`);
            expect(!req.canClaim, `canClaim=false (no reserve funded yet)`);
            expect(BigInt(req.blocksRemaining) > 0n, `blocksRemaining=${req.blocksRemaining} (~128 expected)`);
            console.log(`  qrlAmount snapshot at request: ${fmt(BigInt(req.currentQRLValue))} QRL`);
        }
        await dumpStatus(pool);
    }

    // ===== Phase 4: validator MVP funding (40,000 QRL) =====
    if (phase === 'validator' || phase === 'all') {
        console.log('\n[4] Validator MVP funding (40,000 QRL — large deposit + register + fund)');
        const VALIDATOR_STAKE = 40_000n * 10n ** 18n;
        const buffered = BigInt(await pool.methods.bufferedQRL().call());
        const balQRL = BigInt(await web3.qrl.getBalance(account.address));
        if (buffered < VALIDATOR_STAKE) {
            const need = VALIDATOR_STAKE - buffered;
            const reserveForGas = 1n * 10n ** 18n;
            if (balQRL < need + reserveForGas) {
                console.log(`  ✗ skipping: need ${fmt(need)} QRL more in buffer, deployer has ${fmt(balQRL)} QRL`);
                return;
            }
            console.log(`  topping up buffer with ${fmt(need)} QRL`);
            await tx(pool.methods.deposit(), account, `pool.deposit(${fmt(need)} QRL)`, { value: need.toString() });
        }
        const can = await pool.methods.canFundValidator().call();
        expect(can.possible, `canFundValidator: possible=${can.possible} buffered=${fmt(BigInt(can.bufferedAmount))}`);

        // Register a placeholder Dilithium pubkey on ValidatorManager (no real keys yet).
        const placeholderPubkey = '0x' + 'aa'.repeat(2592);
        const before = BigInt(await vm.methods.totalValidators().call());
        await tx(vm.methods.registerValidator(placeholderPubkey), account, 'vm.registerValidator(placeholder)');
        const validatorId = BigInt(await vm.methods.totalValidators().call());
        expect(validatorId === before + 1n, `vm.totalValidators bumped → ${validatorId}`);

        // Fund via MVP path (no real beacon deposit)
        const bufferedBefore = BigInt(await pool.methods.bufferedQRL().call());
        const validatorsBefore = BigInt(await pool.methods.validatorCount().call());
        await tx(pool.methods.fundValidatorMVP(), account, 'pool.fundValidatorMVP()');
        const bufferedAfter = BigInt(await pool.methods.bufferedQRL().call());
        const validatorsAfter = BigInt(await pool.methods.validatorCount().call());
        expect(bufferedAfter === bufferedBefore - VALIDATOR_STAKE, `bufferedQRL -= 40000 QRL`);
        expect(validatorsAfter === validatorsBefore + 1n, `pool.validatorCount += 1 → ${validatorsAfter}`);

        // Activate on VM (operator action, simulated)
        await tx(vm.methods.activateValidator(validatorId.toString()), account, `vm.activateValidator(${validatorId})`);
        const stats = await vm.methods.getStats().call();
        expect(BigInt(stats.active) >= 1n, `vm.getStats: active=${stats.active}`);

        await dumpStatus(pool);
    }

    console.log('\nDone.');
}

main().catch((e) => {
    console.error('\nIntegration test FAILED:');
    console.error(e);
    process.exit(1);
});
