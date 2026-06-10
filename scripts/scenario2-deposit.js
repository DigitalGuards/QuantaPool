/**
 * Scenario 2: loops through SCEN2_W{1..8} in .env.scenario2 and deposits
 * each wallet's full balance (minus gas buffer) into DepositPoolV2.
 * Prints per-wallet shares minted + final pool totals.
 */

require('dotenv').config({ path: '.env.scenario2' });
const fs = require('fs');
const path = require('path');
const { Web3 } = require('@theqrl/web3');

const CONFIG = JSON.parse(fs.readFileSync('config/testnet-hyperion.json', 'utf8'));
const POOL = CONFIG.contracts.depositPoolV2;
const STQRL = CONFIG.contracts.stQRLV2;

const POOL_ABI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build/hyperion/DepositPoolV2.abi'), 'utf8'));
const STQRL_ABI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build/hyperion/stQRLv2.abi'), 'utf8'));

const GAS_RESERVE = '1'; // keep 1 QRL per wallet for gas

(async () => {
    const web3 = new Web3(CONFIG.provider);
    const pool = new web3.qrl.Contract(POOL_ABI, POOL);
    const stqrl = new web3.qrl.Contract(STQRL_ABI, STQRL);

    const before = {
        buffer: await pool.methods.bufferedQRL().call(),
        pooled: await stqrl.methods.totalPooledQRL().call(),
        shares: await stqrl.methods.totalShares().call(),
        rate: await stqrl.methods.getExchangeRate().call(),
    };
    console.log('Pool BEFORE:');
    console.log(`  buffer=${web3.utils.fromPlanck(before.buffer, 'quanta')} QRL`);
    console.log(`  totalPooled=${web3.utils.fromPlanck(before.pooled, 'quanta')} QRL`);
    console.log(`  totalShares=${web3.utils.fromPlanck(before.shares, 'quanta')}`);
    console.log(`  exchangeRate=${Number(before.rate) / 1e18}`);
    console.log();

    const reserve = BigInt(web3.utils.toPlanck(GAS_RESERVE, 'quanta'));
    for (let i = 1; i <= 8; i++) {
        const seed = process.env[`SCEN2_W${i}_SEED`];
        const address = process.env[`SCEN2_W${i}_ADDRESS`];
        if (!seed) {
            console.log(`W${i}: no seed in env, skipping`);
            continue;
        }

        const acct = web3.qrl.accounts.seedToAccount(seed);
        web3.qrl.accounts.wallet.add(acct);
        if (web3.qrl.wallet?.add) web3.qrl.wallet.add(seed);

        const bal = BigInt(await web3.qrl.getBalance(acct.address));
        const amount = bal - reserve;
        if (amount <= 0n) {
            console.log(`W${i} ${acct.address}: balance too low (${web3.utils.fromPlanck(bal, 'quanta')} QRL), skip`);
            continue;
        }

        const data = pool.methods.deposit().encodeABI();
        const receipt = await web3.qrl.sendTransaction({
            from: acct.address,
            to: POOL,
            value: amount.toString(),
            data,
            gas: 300000,
        });

        const shares = await stqrl.methods.balanceOf(acct.address).call();
        console.log(
            `W${i} ${acct.address}  deposited=${web3.utils.fromPlanck(amount, 'quanta')} QRL  ` +
            `shares=${web3.utils.fromPlanck(shares, 'quanta')}  tx=${receipt.transactionHash}`
        );
    }

    console.log();
    const after = {
        buffer: await pool.methods.bufferedQRL().call(),
        pooled: await stqrl.methods.totalPooledQRL().call(),
        shares: await stqrl.methods.totalShares().call(),
        rate: await stqrl.methods.getExchangeRate().call(),
    };
    console.log('Pool AFTER:');
    console.log(`  buffer=${web3.utils.fromPlanck(after.buffer, 'quanta')} QRL  (+${web3.utils.fromPlanck(BigInt(after.buffer) - BigInt(before.buffer), 'quanta')})`);
    console.log(`  totalPooled=${web3.utils.fromPlanck(after.pooled, 'quanta')} QRL`);
    console.log(`  totalShares=${web3.utils.fromPlanck(after.shares, 'quanta')}`);
    console.log(`  exchangeRate=${Number(after.rate) / 1e18}`);
})();
