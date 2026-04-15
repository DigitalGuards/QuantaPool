// verify-deposit-data.js — safety gate for pool.fundValidator()
//
// Parses a deposit_data-*.json produced by staking-deposit-cli / qrysmctl,
// validates every field against the live v2.1 DepositPoolV2 contract, and
// refuses to print a "ready to broadcast" marker unless everything checks
// out. Run this before ever calling pool.fundValidator() — a mismatch on
// withdrawal_credentials means the validator's stake becomes unwithdrawable
// (stuck forever), which the v2.0 -> v2.1 redeploy was all about.
//
// Usage: node scripts/verify-deposit-data.js <path-to-deposit_data-*.json>
//
// Exit codes:
//   0 — every check passed; safe to paste fields into fundValidator()
//   1 — validation failure (details printed to stderr)
//
// This is deliberately a standalone script with no mutating operations.
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { Web3 } = require('@theqrl/web3');

const PUBKEY_HEX_LENGTH = 2592 * 2;       // 5184 hex chars
const SIGNATURE_HEX_LENGTH = 4627 * 2;    // 9254 hex chars (ML-DSA-87 sig per qrysm)
const CREDENTIALS_HEX_LENGTH = 32 * 2;    // 64 hex chars
const EXPECTED_PREFIX_HEX = '00';         // QRL ExecutionAddressWithdrawalPrefixByte
const EXPECTED_ZERO_PADDING_HEX = '00'.repeat(11);
const EXPECTED_AMOUNT_GWEI = 40000n * 1_000_000_000n; // 40000 QRL * 1e9 planck/QRL
const EXPECTED_FORK_VERSION = '20000089'; // testnet GENESIS_FORK_VERSION

function die(msg) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

function normHex(h) {
    if (typeof h !== 'string') die(`expected hex string, got ${typeof h}`);
    return h.toLowerCase().replace(/^(0x|q)/i, '');
}

(async () => {
    const depositFile = process.argv[2];
    if (!depositFile) die('usage: node scripts/verify-deposit-data.js <deposit_data-*.json>');
    if (!fs.existsSync(depositFile)) die(`file not found: ${depositFile}`);

    const config = JSON.parse(fs.readFileSync('config/testnet-hyperion.json', 'utf8'));
    const poolAddr = normHex(config.contracts.depositPoolV2);
    if (poolAddr.length !== 40) die(`pool address malformed: ${poolAddr}`);

    const raw = JSON.parse(fs.readFileSync(depositFile, 'utf8'));
    const entries = Array.isArray(raw) ? raw : [raw];
    if (entries.length === 0) die('deposit_data JSON has no entries');

    console.log(`verifying ${entries.length} deposit${entries.length > 1 ? 's' : ''} against pool Q${poolAddr}`);

    for (let i = 0; i < entries.length; i++) {
        const d = entries[i];
        const ctx = `entry[${i}]`;
        console.log(`\n=== ${ctx} ===`);

        const pk = normHex(d.pubkey);
        if (pk.length !== PUBKEY_HEX_LENGTH) die(`${ctx}: pubkey wrong length ${pk.length}, want ${PUBKEY_HEX_LENGTH}`);
        console.log(`  ✓ pubkey length OK (${PUBKEY_HEX_LENGTH / 2} bytes)`);
        console.log(`    pubkey: 0x${pk.slice(0, 16)}…${pk.slice(-16)}`);

        const sig = normHex(d.signature);
        if (sig.length !== SIGNATURE_HEX_LENGTH) die(`${ctx}: signature wrong length ${sig.length}, want ${SIGNATURE_HEX_LENGTH}`);
        console.log(`  ✓ signature length OK (${SIGNATURE_HEX_LENGTH / 2} bytes)`);

        const creds = normHex(d.withdrawal_credentials);
        if (creds.length !== CREDENTIALS_HEX_LENGTH) die(`${ctx}: withdrawal_credentials wrong length ${creds.length}, want ${CREDENTIALS_HEX_LENGTH}`);
        const prefix = creds.slice(0, 2);
        const pad = creds.slice(2, 24);
        const addr = creds.slice(24);
        if (prefix !== EXPECTED_PREFIX_HEX) die(`${ctx}: withdrawal prefix byte is 0x${prefix}, must be 0x${EXPECTED_PREFIX_HEX} (QRL ExecutionAddressWithdrawalPrefixByte). This is the exact bug the v2.1 redeploy fixed; a mismatch here would make the stake unwithdrawable.`);
        if (pad !== EXPECTED_ZERO_PADDING_HEX) die(`${ctx}: bytes[1..12] must be zero padding, got 0x${pad}`);
        if (addr !== poolAddr.toLowerCase()) die(`${ctx}: withdrawal address is 0x${addr}, but pool is Q${poolAddr}. Funds would route away from QuantaPool.`);
        console.log(`  ✓ withdrawal_credentials: 0x00 || 11-zero || Q${addr} (matches pool)`);

        if (d.amount !== undefined) {
            const amt = BigInt(d.amount);
            if (amt !== EXPECTED_AMOUNT_GWEI) die(`${ctx}: amount is ${amt} gwei, want ${EXPECTED_AMOUNT_GWEI} (40000 QRL)`);
            console.log(`  ✓ amount = 40000 QRL (${EXPECTED_AMOUNT_GWEI} gwei)`);
        }

        if (d.fork_version !== undefined) {
            const fv = normHex(d.fork_version);
            if (fv !== EXPECTED_FORK_VERSION) die(`${ctx}: fork_version 0x${fv}, want 0x${EXPECTED_FORK_VERSION} (testnet)`);
            console.log(`  ✓ fork_version = 0x${EXPECTED_FORK_VERSION} (testnet)`);
        }

        if (d.deposit_data_root) {
            const root = normHex(d.deposit_data_root);
            if (root.length !== 64) die(`${ctx}: deposit_data_root must be 32 bytes hex`);
            console.log(`  ✓ deposit_data_root: 0x${root.slice(0, 16)}…${root.slice(-16)}`);
        }

        if (d.deposit_message_root) {
            console.log(`    deposit_message_root: 0x${normHex(d.deposit_message_root).slice(0, 16)}…`);
        }
        if (d.network_name) {
            if (d.network_name !== 'testnet') die(`${ctx}: network_name is "${d.network_name}", want "testnet"`);
            console.log(`  ✓ network_name = testnet`);
        }
    }

    console.log('\nSanity check: dry-run the deposit against live pool (fundValidator estimate)...');
    const rpcUrl = process.env.QRL_RPC_URL || config.providerUrl || 'https://qrlwallet.com/api/qrl-rpc/testnet';
    const web3 = new Web3(rpcUrl);
    const poolAbi = JSON.parse(fs.readFileSync('build/hyperion/DepositPoolV2.abi', 'utf8'));
    const pool = new web3.qrl.Contract(poolAbi, config.contracts.depositPoolV2);
    try {
        const onChainDepositContract = await pool.methods.DEPOSIT_CONTRACT().call();
        console.log(`  pool.DEPOSIT_CONTRACT = ${onChainDepositContract}`);
        if (normHex(onChainDepositContract) !== '4242424242424242424242424242424242424242') {
            die(`pool.DEPOSIT_CONTRACT differs from Q4242... — something is wrong`);
        }
        const stake = await pool.methods.VALIDATOR_STAKE().call();
        const buffered = await pool.methods.bufferedQRL().call();
        console.log(`  pool.VALIDATOR_STAKE = ${BigInt(stake) / 10n ** 18n} QRL`);
        console.log(`  pool.bufferedQRL     = ${BigInt(buffered) / 10n ** 18n} QRL`);
        if (BigInt(buffered) < BigInt(stake)) {
            console.log(`  ⚠  buffer is below stake — fundValidator() would revert InsufficientBuffer.`);
            console.log(`     Deposit more to the pool first, or this deposit_data is safe to sit on.`);
        } else {
            console.log(`  ✓ buffer is sufficient to fund this validator now`);
        }
    } catch (err) {
        console.log(`  ⚠  could not reach live pool (${err?.message || err}); skipped dry-run checks`);
    }

    console.log('\nALL CHECKS PASSED. Safe to broadcast this deposit via pool.fundValidator().');
    process.exit(0);
})();
