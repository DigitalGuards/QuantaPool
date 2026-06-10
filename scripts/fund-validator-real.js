// fund-validator-real.js - broadcast the real pool.fundValidator(...)
//
// Prereqs:
//   1. Run `node scripts/verify-deposit-data.js <deposit_data.json>` first
//      and confirm all checks pass. This script re-runs the same assertions
//      in-process but `verify-deposit-data.js` prints nicer output.
//   2. Deployer balance has ≥ 40,001 QRL (40k deposit + gas buffer).
//   3. v2.2 pool addresses are in config/testnet-hyperion.json.
//
// Usage: node scripts/fund-validator-real.js <deposit_data.json>
require('dotenv').config({ path: '.env' });
const { Web3 } = require('@theqrl/web3');
const fs = require('fs');
const { loadDeployer } = require('./lib/loadDeployer');

const PUBKEY_BYTES = 2592;
const SIGNATURE_BYTES = 4627;
const CREDENTIALS_BYTES = 32;

function normHex(h) {
    return (h || '').toLowerCase().replace(/^(0x|q)/i, '');
}

async function sendTx(web3, method, account, to, label, { value = 0n } = {}) {
    const data = method.encodeABI();
    const gas = await method.estimateGas({ from: account.address, to, data, value: value.toString() });
    const gasPrice = BigInt((await web3.qrl.getGasPrice()) || 1_000_000_000);
    const receipt = await web3.qrl.sendTransaction({
        type: '0x2',
        from: account.address,
        to,
        data,
        gas: ((BigInt(gas) * 12n) / 10n).toString(),
        value: value.toString(),
        maxFeePerGas: (gasPrice * 2n).toString(),
        maxPriorityFeePerGas: gasPrice.toString()
    }, undefined, { checkRevertBeforeSending: true });
    const hash = typeof receipt.transactionHash === 'string'
        ? receipt.transactionHash
        : '0x' + Buffer.from(receipt.transactionHash).toString('hex');
    console.log(`  → ${label}: ${hash}`);
    // Wait for proxy catch-up so reads after writes don't race.
    const receiptBlock = BigInt(receipt.blockNumber);
    for (let i = 0; i < 30; i++) {
        const head = BigInt(await web3.qrl.getBlockNumber());
        if (head >= receiptBlock) break;
        await new Promise(r => setTimeout(r, 500));
    }
    return receipt;
}

(async () => {
    const depositFile = process.argv[2];
    if (!depositFile) { console.error('usage: node scripts/fund-validator-real.js <deposit_data.json>'); process.exit(1); }
    const raw = JSON.parse(fs.readFileSync(depositFile, 'utf8'));
    const d = Array.isArray(raw) ? raw[0] : raw;
    const config = JSON.parse(fs.readFileSync('config/testnet-hyperion.json', 'utf8'));
    const poolAddr = config.contracts.depositPoolV2;

    const pubkey = '0x' + normHex(d.pubkey);
    const creds = '0x' + normHex(d.withdrawal_credentials);
    const sig = '0x' + normHex(d.signature);
    const root = '0x' + normHex(d.deposit_data_root);

    if ((pubkey.length - 2) / 2 !== PUBKEY_BYTES) { console.error(`pubkey length: ${(pubkey.length-2)/2}`); process.exit(1); }
    if ((sig.length - 2) / 2 !== SIGNATURE_BYTES) { console.error(`sig length: ${(sig.length-2)/2}`); process.exit(1); }
    if ((creds.length - 2) / 2 !== CREDENTIALS_BYTES) { console.error(`creds length: ${(creds.length-2)/2}`); process.exit(1); }
    const credsLower = normHex(creds);
    const poolLower = normHex(poolAddr);
    if (credsLower.slice(0, 2) !== '00') { console.error(`creds prefix: ${credsLower.slice(0,2)}`); process.exit(1); }
    if (credsLower.slice(24) !== poolLower) { console.error(`creds addr: ${credsLower.slice(24)}, pool: ${poolLower}`); process.exit(1); }

    const web3 = new Web3(config.providerUrl || 'https://qrlwallet.com/api/qrl-rpc/testnet');
    const account = loadDeployer(web3, process.env.TESTNET_SEED);
    console.log(`deployer: ${account.address}`);
    console.log(`pool:     ${poolAddr}`);

    const poolAbi = JSON.parse(fs.readFileSync('build/hyperion/DepositPoolV2.abi', 'utf8'));
    const pool = new web3.qrl.Contract(poolAbi, poolAddr);

    const VALIDATOR_STAKE = BigInt(await pool.methods.VALIDATOR_STAKE().call());
    const bufferedBefore = BigInt(await pool.methods.bufferedQRL().call());
    const balBefore = BigInt(await web3.qrl.getBalance(account.address));
    const fmt = (p) => (Number(p) / 1e18).toFixed(6) + ' QRL';
    console.log(`VALIDATOR_STAKE: ${fmt(VALIDATOR_STAKE)}`);
    console.log(`bufferedQRL:     ${fmt(bufferedBefore)}`);
    console.log(`deployer bal:    ${fmt(balBefore)}`);

    if (bufferedBefore < VALIDATOR_STAKE) {
        const need = VALIDATOR_STAKE - bufferedBefore;
        if (balBefore < need + 1n * 10n ** 18n) {
            console.error(`insufficient deployer balance; need ${fmt(need)} + 1 QRL gas`);
            process.exit(1);
        }
        console.log(`\n[1/2] topping up buffer with ${fmt(need)}`);
        await sendTx(web3, pool.methods.deposit(), account, poolAddr, `pool.deposit(${fmt(need)})`, { value: need });
    } else {
        console.log('\n[1/2] buffer already at VALIDATOR_STAKE, skipping deposit');
    }

    const bufferedAfter = BigInt(await pool.methods.bufferedQRL().call());
    console.log(`bufferedQRL now: ${fmt(bufferedAfter)}`);

    console.log('\n[2/2] broadcasting pool.fundValidator(...)');
    console.log(`  pubkey:           ${pubkey.slice(0, 18)}...${pubkey.slice(-16)}`);
    console.log(`  creds:            ${creds}`);
    console.log(`  signature:        ${sig.slice(0, 18)}...${sig.slice(-16)} (${SIGNATURE_BYTES} bytes)`);
    console.log(`  deposit_data_root ${root}`);

    const validatorsBefore = BigInt(await pool.methods.validatorCount().call());
    const receipt = await sendTx(
        web3,
        pool.methods.fundValidator(pubkey, creds, sig, root),
        account,
        poolAddr,
        'pool.fundValidator(...)'
    );
    const validatorsAfter = BigInt(await pool.methods.validatorCount().call());
    const bufferedFinal = BigInt(await pool.methods.bufferedQRL().call());
    console.log(`\npool.validatorCount: ${validatorsBefore} → ${validatorsAfter}`);
    console.log(`bufferedQRL:         ${fmt(bufferedAfter)} → ${fmt(bufferedFinal)}`);
    console.log(`beacon deposit contract balance delta should be +40000 QRL on Q4242...`);
    console.log('\nREAL fundValidator() PATH SUCCESSFULLY EXECUTED 🎉');
    process.exit(0);
})().catch((err) => {
    console.error('fund-validator-real failed:', err?.message || err);
    if (err?.innerError?.data) console.error('revert data:', err.innerError.data);
    process.exit(1);
});
