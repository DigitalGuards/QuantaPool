/* eslint-disable no-console */
require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const { Web3 } = require('@theqrl/web3');

const { loadDeployer } = require('./lib/loadDeployer');

const repoRoot = path.join(__dirname, '..');
const config = require(path.join(repoRoot, 'config', 'testnet-hyperion.json'));

const PHASES = ['status', 'smoke', 'rewards', 'withdraw', 'validator', 'errors', 'pause', 'lifecycle', 'claim-prep', 'all'];

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

// Assert that calling a method reverts. `match` is advisory: the QRL RPC proxy
// strips the custom-error name and returns a generic "execution reverted", so we
// accept that as a successful revert and note when the specific name surfaces.
async function expectRevert(method, account, to, label, { value = 0n, match } = {}) {
    try {
        await method.estimateGas({
            from: account.address,
            to,
            data: method.encodeABI(),
            value: value.toString()
        });
        fail(`${label} did NOT revert (expected revert)`);
    } catch (e) {
        const msg = e?.innerError?.message || e?.cause?.message || e?.message || String(e);
        const reverted = /revert/i.test(msg);
        if (!reverted) {
            fail(`${label} threw non-revert error: ${msg}`);
        } else if (match && msg.includes(match)) {
            ok(`${label} reverts with "${match}"`);
        } else {
            ok(`${label} reverts as expected${match ? ` (generic; proxy masked "${match}")` : ''}`);
        }
    }
}

// Encode-and-send pattern mirroring myqrlwallet-frontend's qrlStore.sendToken().
// Contract instances created via `new web3.qrl.Contract(abi, addr)` do not
// auto-bind to the wallet, so calling `.send({from})` on them forwards as
// qrl_sendTransaction and the proxy rejects with "unknown account". Building
// the tx object manually and routing through web3.qrl.sendTransaction uses
// the wallet registered on web3.qrl.wallet for local signing.
async function tx(web3, method, account, to, label, { value = 0n } = {}) {
    const data = method.encodeABI();
    const gas = await method.estimateGas({
        from: account.address,
        to,
        data,
        value: value.toString()
    });
    const baseGasPrice = (await web3.qrl.getGasPrice()) || 1_000_000_000n;
    const txObj = {
        type: '0x2',
        from: account.address,
        to,
        data,
        gas: ((BigInt(gas) * 12n) / 10n).toString(),
        value: value.toString(),
        maxFeePerGas: (baseGasPrice * 2n).toString(),
        maxPriorityFeePerGas: baseGasPrice.toString()
    };
    const receipt = await web3.qrl.sendTransaction(txObj, undefined, {
        checkRevertBeforeSending: true
    });
    const hash = typeof receipt.transactionHash === 'string'
        ? receipt.transactionHash
        : '0x' + Buffer.from(receipt.transactionHash).toString('hex');
    console.log(`  → ${label} : ${hash}`);
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
    const stQRL = new web3.qrl.Contract(loadAbi('stQRLv2'), config.contracts.stQRLV2);
    const pool = new web3.qrl.Contract(loadAbi('DepositPoolV2'), config.contracts.depositPoolV2);
    const vm = new web3.qrl.Contract(loadAbi('ValidatorManager'), config.contracts.validatorManager);

    const chainId = await web3.qrl.getChainId();
    const balance = await web3.qrl.getBalance(account.address);
    console.log(`Chain ${chainId} | deployer ${account.address} | balance ${fmt(balance)} QRL`);
    console.log(`stQRL=${config.contracts.stQRLV2}`);
    console.log(`pool =${config.contracts.depositPoolV2}`);
    console.log(`vm   =${config.contracts.validatorManager}\n`);
    await dumpStatus(pool);

    // ===== Phase 0: status (read-only) =====
    if (phase === 'status') {
        const shares = BigInt(await stQRL.methods.balanceOf(account.address).call());
        const locked = BigInt(await stQRL.methods.lockedSharesOf(account.address).call());
        const qrlValue = BigInt(await stQRL.methods.getQRLValue(account.address).call());
        const rewards = await pool.methods.getRewardStats().call();
        const vmStats = await vm.methods.getStats().call();
        const wcounts = await pool.methods.getWithdrawalRequestCount(account.address).call();
        console.log(`\nUser position (deployer):`);
        console.log(`  stQRL shares:     ${fmt(shares)}  (locked: ${fmt(locked)})`);
        console.log(`  QRL value:        ${fmt(qrlValue)}`);
        console.log(`  withdraw reqs:    total=${wcounts.total} pending=${wcounts.pending}`);
        console.log(`\nProtocol accounting:`);
        console.log(`  rewards:          ${fmt(BigInt(rewards.totalRewards))} QRL (net: ${fmt(BigInt(rewards.netRewards))})`);
        console.log(`  slashing:         ${fmt(BigInt(rewards.totalSlashing))} QRL`);
        console.log(`  lastSync block:   ${rewards.lastSync}`);
        console.log(`  paused (pool):    ${await pool.methods.paused().call()}`);
        console.log(`  paused (stQRL):   ${await stQRL.methods.paused().call()}`);
        console.log(`\nValidatorManager:`);
        console.log(`  total=${vmStats.total} pending=${vmStats.pending} active=${vmStats.active}`);
        console.log(`  totalStaked:      ${fmt(BigInt(vmStats.totalStaked))} QRL`);
        // Iterate each request
        if (Number(wcounts.total) > 0) {
            console.log(`\nWithdrawal requests:`);
            for (let i = 0; i < Number(wcounts.total); i++) {
                const r = await pool.methods.getWithdrawalRequest(account.address, i.toString()).call();
                console.log(`  #${i}: shares=${fmt(BigInt(r.shares))} QRL=${fmt(BigInt(r.currentQRLValue))} canClaim=${r.canClaim} blocksRemaining=${r.blocksRemaining} claimed=${r.claimed}`);
            }
        }
        console.log('');
        return;
    }

    // ===== Phase 1: smoke deposit (100 QRL) =====
    if (phase === 'smoke' || phase === 'all') {
        console.log('\n[1] Smoke deposit (100 QRL)');
        const before = {
            shares: BigInt(await stQRL.methods.balanceOf(account.address).call()),
            pooled: BigInt(await stQRL.methods.totalPooledQRL().call()),
            buffered: BigInt(await pool.methods.bufferedQRL().call())
        };
        const value = 100n * 10n ** 18n;
        await tx(web3, pool.methods.deposit(), account, config.contracts.depositPoolV2, 'pool.deposit(100 QRL)', { value });
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
        const baseGasPrice = (await web3.qrl.getGasPrice()) || 1_000_000_000n;
        await web3.qrl.sendTransaction({
            type: '0x2',
            from: account.address,
            to: config.contracts.depositPoolV2,
            value: donate.toString(),
            gas: '100000',
            maxFeePerGas: (baseGasPrice * 2n).toString(),
            maxPriorityFeePerGas: baseGasPrice.toString()
        });
        console.log('  → donated 1 QRL via raw transfer');
        await tx(web3, pool.methods.syncRewards(), account, config.contracts.depositPoolV2, 'pool.syncRewards()');
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
            await tx(web3, pool.methods.requestWithdrawal(reqShares.toString()), account, config.contracts.depositPoolV2, `pool.requestWithdrawal(${fmt(reqShares)})`);
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
            await tx(web3, pool.methods.deposit(), account, config.contracts.depositPoolV2, `pool.deposit(${fmt(need)} QRL)`, { value: need });
        }
        const can = await pool.methods.canFundValidator().call();
        expect(can.possible, `canFundValidator: possible=${can.possible} buffered=${fmt(BigInt(can.bufferedAmount))}`);

        // Register a placeholder Dilithium pubkey on ValidatorManager (no real keys yet).
        const placeholderPubkey = '0x' + 'aa'.repeat(2592);
        const before = BigInt(await vm.methods.totalValidators().call());
        await tx(web3, vm.methods.registerValidator(placeholderPubkey), account, config.contracts.validatorManager, 'vm.registerValidator(placeholder)');
        const validatorId = BigInt(await vm.methods.totalValidators().call());
        expect(validatorId === before + 1n, `vm.totalValidators bumped → ${validatorId}`);

        // Fund via MVP path (no real beacon deposit)
        const bufferedBefore = BigInt(await pool.methods.bufferedQRL().call());
        const validatorsBefore = BigInt(await pool.methods.validatorCount().call());
        await tx(web3, pool.methods.fundValidatorMVP(), account, config.contracts.depositPoolV2, 'pool.fundValidatorMVP()');
        const bufferedAfter = BigInt(await pool.methods.bufferedQRL().call());
        const validatorsAfter = BigInt(await pool.methods.validatorCount().call());
        expect(bufferedAfter === bufferedBefore - VALIDATOR_STAKE, `bufferedQRL -= 40000 QRL`);
        expect(validatorsAfter === validatorsBefore + 1n, `pool.validatorCount += 1 → ${validatorsAfter}`);

        // Activate on VM (operator action, simulated)
        await tx(web3, vm.methods.activateValidator(validatorId.toString()), account, config.contracts.validatorManager, `vm.activateValidator(${validatorId})`);
        const stats = await vm.methods.getStats().call();
        expect(BigInt(stats.active) >= 1n, `vm.getStats: active=${stats.active}`);

        await dumpStatus(pool);
    }

    // ===== Phase 5: error cases (reverts) =====
    if (phase === 'errors' || phase === 'all') {
        console.log('\n[5] Revert cases');

        // Deposit below minDeposit (1 wei should revert BelowMinDeposit)
        await expectRevert(
            pool.methods.deposit(),
            account,
            config.contracts.depositPoolV2,
            'pool.deposit(1 wei)',
            { value: 1n, match: 'BelowMinDeposit' }
        );

        // Withdraw 0 shares -> ZeroAmount
        await expectRevert(
            pool.methods.requestWithdrawal('0'),
            account,
            config.contracts.depositPoolV2,
            'pool.requestWithdrawal(0)',
            { match: 'ZeroAmount' }
        );

        // Withdraw more unlocked shares than we hold -> InsufficientShares
        const held = BigInt(await stQRL.methods.sharesOf(account.address).call());
        const locked = BigInt(await stQRL.methods.lockedSharesOf(account.address).call());
        const unlocked = held - locked;
        const absurd = unlocked + 10n ** 20n;
        await expectRevert(
            pool.methods.requestWithdrawal(absurd.toString()),
            account,
            config.contracts.depositPoolV2,
            `pool.requestWithdrawal(>unlocked: ${fmt(absurd)})`,
            { match: 'InsufficientShares' }
        );

        // Second setStQRL should revert (one-shot)
        await expectRevert(
            pool.methods.setStQRL(config.contracts.stQRLV2),
            account,
            config.contracts.depositPoolV2,
            'pool.setStQRL(<again>)',
            { match: 'StQRLAlreadySet' }
        );

        // Second setDepositPool on stQRL should revert (one-shot)
        await expectRevert(
            stQRL.methods.setDepositPool(config.contracts.depositPoolV2),
            account,
            config.contracts.stQRLV2,
            'stQRL.setDepositPool(<again>)',
            { match: 'DepositPoolAlreadySet' }
        );

        // registerValidator with wrong pubkey length (2591 bytes, off by one) -> InvalidPubkeyLength
        const badPubkey = '0x' + 'bb'.repeat(2591);
        await expectRevert(
            vm.methods.registerValidator(badPubkey),
            account,
            config.contracts.validatorManager,
            'vm.registerValidator(2591-byte pubkey)',
            { match: 'InvalidPubkeyLength' }
        );
    }

    // ===== Phase 6: pause / unpause =====
    if (phase === 'pause' || phase === 'all') {
        console.log('\n[6] Pause / unpause cycle');
        const beforePaused = await pool.methods.paused().call();
        expect(beforePaused === false, `pool.paused() == false initially`);

        await tx(web3, pool.methods.pause(), account, config.contracts.depositPoolV2, 'pool.pause()');
        const midPaused = await pool.methods.paused().call();
        expect(midPaused === true, `pool.paused() == true after pause()`);

        // Deposit should now revert with ContractPaused
        await expectRevert(
            pool.methods.deposit(),
            account,
            config.contracts.depositPoolV2,
            'pool.deposit while paused',
            { value: 100n * 10n ** 18n, match: 'ContractPaused' }
        );

        await tx(web3, pool.methods.unpause(), account, config.contracts.depositPoolV2, 'pool.unpause()');
        const afterPaused = await pool.methods.paused().call();
        expect(afterPaused === false, `pool.paused() == false after unpause()`);
    }

    // ===== Phase 7: validator lifecycle on VM =====
    if (phase === 'lifecycle' || phase === 'all') {
        console.log('\n[7] Validator lifecycle (request-exit → mark-exited)');
        const stats0 = await vm.methods.getStats().call();
        if (BigInt(stats0.active) === 0n) {
            console.log('  (skipping — no active validators; run `validator` phase first)');
        } else {
            // Grab the first Active validator id by scanning totalValidators.
            const total = BigInt(await vm.methods.totalValidators().call());
            let targetId = 0n;
            for (let i = 1n; i <= total; i++) {
                const v = await vm.methods.validators(i.toString()).call();
                // ValidatorStatus enum: None=0, Pending=1, Active=2, Exiting=3, Exited=4, Slashed=5
                if (Number(v.status) === 2) { targetId = i; break; }
            }
            expect(targetId > 0n, `found an Active validator (id=${targetId})`);

            await tx(web3, vm.methods.requestValidatorExit(targetId.toString()), account, config.contracts.validatorManager, `vm.requestValidatorExit(${targetId})`);
            let v = await vm.methods.validators(targetId.toString()).call();
            expect(Number(v.status) === 3, `status: Active → Exiting (got ${v.status})`);

            await tx(web3, vm.methods.markValidatorExited(targetId.toString()), account, config.contracts.validatorManager, `vm.markValidatorExited(${targetId})`);
            v = await vm.methods.validators(targetId.toString()).call();
            expect(Number(v.status) === 4, `status: Exiting → Exited (got ${v.status})`);

            const stats1 = await vm.methods.getStats().call();
            expect(BigInt(stats1.active) === BigInt(stats0.active) - 1n, `active count decremented (${stats0.active} → ${stats1.active})`);

            // markValidatorExited again should revert (status is now Exited, not Exiting)
            await expectRevert(
                vm.methods.markValidatorExited(targetId.toString()),
                account,
                config.contracts.validatorManager,
                `vm.markValidatorExited(${targetId}) again`,
                { match: 'InvalidStatusTransition' }
            );
        }
    }

    // ===== Phase 8: claim-prep (fund reserve; assert WithdrawalNotReady) =====
    if (phase === 'claim-prep' || phase === 'all') {
        console.log('\n[8] Claim prep (fund withdrawal reserve; assert not-ready-yet)');
        const counts = await pool.methods.getWithdrawalRequestCount(account.address).call();
        const total = Number(counts.total);
        if (total === 0) {
            console.log('  (skipping — no withdrawal requests; run `withdraw` phase first)');
        } else {
            // Fund reserve for the next pending request.
            const nextIdx = Number(await pool.methods.nextWithdrawalIndex(account.address).call());
            const req = await pool.methods.getWithdrawalRequest(account.address, nextIdx.toString()).call();
            if (req.claimed) {
                console.log(`  (skipping — next request (idx=${nextIdx}) already claimed)`);
            } else {
                const need = BigInt(req.currentQRLValue);
                const reserveBefore = BigInt(await pool.methods.withdrawalReserve().call());
                const pooledBefore = BigInt(await stQRL.methods.totalPooledQRL().call());

                if (reserveBefore >= need) {
                    ok(`reserve already sufficient (${fmt(reserveBefore)} >= ${fmt(need)} QRL)`);
                } else {
                    const delta = need - reserveBefore;
                    if (delta > pooledBefore) {
                        console.log(`  ✗ skipping: need to move ${fmt(delta)} QRL into reserve but pooled=${fmt(pooledBefore)}`);
                        return;
                    }
                    await tx(web3, pool.methods.fundWithdrawalReserve(delta.toString()), account, config.contracts.depositPoolV2, `pool.fundWithdrawalReserve(${fmt(delta)})`);
                    const reserveAfter = BigInt(await pool.methods.withdrawalReserve().call());
                    const pooledAfter = BigInt(await stQRL.methods.totalPooledQRL().call());
                    expect(reserveAfter === reserveBefore + delta, `reserve += ${fmt(delta)} QRL`);
                    expect(pooledAfter === pooledBefore - delta, `pooled -= ${fmt(delta)} QRL (reclassified, not burned)`);
                }

                // Claim should still revert because 128 blocks haven't elapsed
                const blocksRemaining = BigInt((await pool.methods.getWithdrawalRequest(account.address, nextIdx.toString()).call()).blocksRemaining);
                if (blocksRemaining > 0n) {
                    await expectRevert(
                        pool.methods.claimWithdrawal(),
                        account,
                        config.contracts.depositPoolV2,
                        `pool.claimWithdrawal() (${blocksRemaining} blocks remain)`,
                        { match: 'WithdrawalNotReady' }
                    );
                } else {
                    ok(`${blocksRemaining} blocks remain — claim would succeed`);
                }
            }
        }
        await dumpStatus(pool);
    }

    console.log('\nDone.');
}

main().catch((e) => {
    console.error('\nIntegration test FAILED:');
    console.error(e);
    process.exit(1);
});
