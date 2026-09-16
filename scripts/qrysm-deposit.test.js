const assert = require('node:assert/strict');
const test = require('node:test');

const {
    CryptoBytes,
    CryptoPublicKeyBytes,
    CryptoSecretKeyBytes,
    cryptoSignKeypair,
    cryptoSignSignature,
    cryptoSignVerify
} = require('@theqrl/mldsa87');
const {
    QRYSM_MLDSA87_CONTEXT,
    SIGNATURE_BYTES,
    VALIDATOR_STAKE_SHOR,
    computeDepositRoots,
    validateDepositEntry
} = require('./lib/qrysmDeposit');

const poolAddress = `Q${'ab'.repeat(64)}`;
const forkVersion = '0x10000038';
const expected = { forkVersion, networkName: 'dev', poolAddress };

function hex(value) {
    return `0x${Buffer.from(value).toString('hex')}`;
}

function makeSignedDepositEntry() {
    assert.equal(CryptoBytes, SIGNATURE_BYTES);
    const publicKey = new Uint8Array(CryptoPublicKeyBytes);
    const secretKey = new Uint8Array(CryptoSecretKeyBytes);
    const seed = new Uint8Array(32).fill(0x42);
    cryptoSignKeypair(seed, publicKey, secretKey);

    const withdrawalRecipient = Buffer.from(poolAddress.slice(1), 'hex');
    const signature = new Uint8Array(SIGNATURE_BYTES);
    const unsignedRoots = computeDepositRoots({
        pubkey: Buffer.from(publicKey),
        withdrawalRecipient,
        amount: VALIDATOR_STAKE_SHOR,
        signature: Buffer.from(signature),
        forkVersion: Buffer.from(forkVersion.slice(2), 'hex')
    });
    cryptoSignSignature(
        signature,
        unsignedRoots.signingRoot,
        secretKey,
        false,
        QRYSM_MLDSA87_CONTEXT
    );
    secretKey.fill(0);
    seed.fill(0);

    const roots = computeDepositRoots({
        pubkey: Buffer.from(publicKey),
        withdrawalRecipient,
        amount: VALIDATOR_STAKE_SHOR,
        signature: Buffer.from(signature),
        forkVersion: Buffer.from(forkVersion.slice(2), 'hex')
    });
    return {
        entry: {
            pubkey: hex(publicKey),
            withdrawal_recipient: hex(withdrawalRecipient),
            amount: VALIDATOR_STAKE_SHOR.toString(),
            signature: hex(signature),
            deposit_data_root: hex(roots.depositDataRoot),
            message_root: hex(roots.messageRoot),
            fork_version: forkVersion,
            network_name: 'dev'
        },
        roots
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function updateDepositDataRoot(entry) {
    const roots = computeDepositRoots({
        pubkey: Buffer.from(entry.pubkey.slice(2), 'hex'),
        withdrawalRecipient: Buffer.from(entry.withdrawal_recipient.slice(2), 'hex'),
        amount: BigInt(entry.amount),
        signature: Buffer.from(entry.signature.slice(2), 'hex'),
        forkVersion: Buffer.from(entry.fork_version.slice(2), 'hex')
    });
    entry.deposit_data_root = hex(roots.depositDataRoot);
}

test('validates the Qrysm SSZ roots and descriptor-bound ML-DSA-87 signature', () => {
    const { entry, roots } = makeSignedDepositEntry();
    const validated = validateDepositEntry(entry, expected);

    assert.deepEqual(validated.messageRoot, roots.messageRoot);
    assert.deepEqual(validated.depositDataRoot, roots.depositDataRoot);
    assert.equal(
        cryptoSignVerify(
            validated.signature,
            roots.signingRoot,
            validated.pubkey,
            QRYSM_MLDSA87_CONTEXT
        ),
        true
    );
    assert.equal(
        cryptoSignVerify(
            validated.signature,
            roots.signingRoot,
            validated.pubkey,
            Buffer.from('ZOND', 'ascii')
        ),
        false
    );
});

test('rejects a signature that has matching SSZ data but invalid ML-DSA bytes', () => {
    const { entry } = makeSignedDepositEntry();
    const tampered = clone(entry);
    const signature = Buffer.from(tampered.signature.slice(2), 'hex');
    signature[signature.length - 1] ^= 1;
    tampered.signature = hex(signature);
    updateDepositDataRoot(tampered);

    assert.throws(() => validateDepositEntry(tampered, expected), /signature is invalid/);
});

test('rejects mismatched roots, routing, fork, amount, network, and legacy fields', () => {
    const { entry } = makeSignedDepositEntry();
    const cases = [
        ['message root', { message_root: `0x${'00'.repeat(32)}` }, /message root/],
        ['deposit root', { deposit_data_root: `0x${'00'.repeat(32)}` }, /data root/],
        ['recipient', { withdrawal_recipient: `0x${'cd'.repeat(64)}` }, /deployed pool/],
        ['fork', { fork_version: '0x10000039' }, /consensus chain/],
        ['amount', { amount: '39999999999999' }, /exactly 40000 QRL/],
        ['unsafe numeric amount', { amount: Number.MAX_SAFE_INTEGER + 1 }, /safe unsigned integer/],
        ['network', { network_name: 'mainnet' }, /network name/],
        ['legacy field', { withdrawal_credentials: `0x${'00'.repeat(32)}` }, /Legacy/]
    ];

    for (const [name, override, expectedError] of cases) {
        assert.throws(
            () => validateDepositEntry({ ...clone(entry), ...override }, expected),
            expectedError,
            name
        );
    }
});
