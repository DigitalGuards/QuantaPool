/**
 * Race-condition probe: deposit 100 QRL, immediately read bufferedQRL,
 * then read again after a short wait. If the immediate read already
 * reflects the deposit, the backend cache fix landed.
 */

require('dotenv').config({ path: '.env.scenario2' });
const fs = require('fs');
const { Web3 } = require('@theqrl/web3');
const { MLDSA87 } = require('@theqrl/wallet.js');

const cfg = JSON.parse(fs.readFileSync('config/testnet-hyperion.json', 'utf8'));
const poolAbi = JSON.parse(fs.readFileSync('build/hyperion/DepositPoolV2.abi', 'utf8'));

const FUNDER = process.env.FUNDER_MNEMONIC;
if (!FUNDER) {
    console.error('Set FUNDER_MNEMONIC (34-word ML-DSA-87 mnemonic) in .env.scenario2 or the environment.');
    process.exit(1);
}

(async () => {
    const web3 = new Web3(cfg.provider);
    const pool = new web3.qrl.Contract(poolAbi, cfg.contracts.depositPoolV2);

    const wallet = MLDSA87.newWalletFromMnemonic(FUNDER);
    const seed = wallet.getHexExtendedSeed();
    const acct = web3.qrl.accounts.seedToAccount(seed);
    web3.qrl.accounts.wallet.add(acct);
    if (web3.qrl.wallet?.add) web3.qrl.wallet.add(seed);

    const before = BigInt(await pool.methods.bufferedQRL().call());
    console.log('buffer BEFORE:        ', web3.utils.fromPlanck(before, 'quanta'), 'QRL');

    const amount = web3.utils.toPlanck('100', 'quanta');
    const t0 = Date.now();
    const receipt = await web3.qrl.sendTransaction({
        from: acct.address,
        to: cfg.contracts.depositPoolV2,
        value: amount,
        data: pool.methods.deposit().encodeABI(),
        gas: 300000,
    });
    const txMs = Date.now() - t0;
    console.log(`tx ${receipt.transactionHash} in block ${receipt.blockNumber} (${txMs}ms)`);

    const immediate = BigInt(await pool.methods.bufferedQRL().call());
    console.log('buffer IMMEDIATELY:   ', web3.utils.fromPlanck(immediate, 'quanta'), 'QRL  (delta:', web3.utils.fromPlanck(immediate - before, 'quanta'), ')');

    await new Promise(r => setTimeout(r, 10_000));
    const later = BigInt(await pool.methods.bufferedQRL().call());
    console.log('buffer +10s:          ', web3.utils.fromPlanck(later, 'quanta'), 'QRL  (delta:', web3.utils.fromPlanck(later - before, 'quanta'), ')');

    console.log();
    const expected = BigInt(amount);
    if (immediate - before === expected) {
        console.log('✅ RACE FIXED - immediate read already reflects the deposit.');
    } else if (later - before === expected && immediate - before !== expected) {
        console.log('❌ RACE STILL PRESENT - immediate read was stale, +10s read caught up.');
    } else {
        console.log('⚠️  unexpected deltas - check manually.');
    }
})();
