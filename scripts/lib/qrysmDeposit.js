const { createHash } = require('crypto');
const { cryptoSignVerify } = require('@theqrl/mldsa87');

const PUBKEY_BYTES = 2592;
const WITHDRAWAL_RECIPIENT_BYTES = 64;
const SIGNATURE_BYTES = 4627;
const ROOT_BYTES = 32;
const FORK_VERSION_BYTES = 4;
const DEPOSIT_DOMAIN = Buffer.from('03000000', 'hex');
const QRYSM_MLDSA87_CONTEXT = Buffer.from('5a4f4e4401010000', 'hex');
const VALIDATOR_STAKE_SHOR = 40_000n * 1_000_000_000n;

function normalizeHex(value, label) {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a hex string`);
    }
    const normalized = value.replace(/^(?:0x|Q)/i, '').toLowerCase();
    if (normalized.length === 0 || !/^[a-f0-9]+$/.test(normalized)) {
        throw new Error(`${label} contains invalid hexadecimal data`);
    }
    return normalized;
}

function decodeHex(value, label, expectedBytes) {
    const normalized = normalizeHex(value, label);
    if (normalized.length !== expectedBytes * 2) {
        throw new Error(`${label} must be exactly ${expectedBytes} bytes`);
    }
    return Buffer.from(normalized, 'hex');
}

function sha256(left, right) {
    const hash = createHash('sha256').update(left);
    if (right !== undefined) hash.update(right);
    return hash.digest();
}

function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) result *= 2;
    return result;
}

function merkleize(chunks) {
    const width = nextPowerOfTwo(Math.max(1, chunks.length));
    let layer = Array.from({ length: width }, (_, index) => chunks[index] || Buffer.alloc(32));
    while (layer.length > 1) {
        const next = [];
        for (let index = 0; index < layer.length; index += 2) {
            next.push(sha256(layer[index], layer[index + 1]));
        }
        layer = next;
    }
    return layer[0];
}

function bytesVectorRoot(value) {
    const chunks = [];
    for (let offset = 0; offset < value.length; offset += 32) {
        const chunk = Buffer.alloc(32);
        value.copy(chunk, 0, offset, Math.min(offset + 32, value.length));
        chunks.push(chunk);
    }
    return merkleize(chunks);
}

function uint64Root(value) {
    const root = Buffer.alloc(32);
    root.writeBigUInt64LE(BigInt(value));
    return root;
}

function containerRoot(fields) {
    return merkleize(fields);
}

function computeDepositRoots({ pubkey, withdrawalRecipient, amount, signature, forkVersion }) {
    const messageRoot = containerRoot([
        bytesVectorRoot(pubkey),
        bytesVectorRoot(withdrawalRecipient),
        uint64Root(amount)
    ]);
    const forkDataRoot = containerRoot([
        bytesVectorRoot(forkVersion),
        Buffer.alloc(ROOT_BYTES)
    ]);
    const domain = Buffer.concat([DEPOSIT_DOMAIN, forkDataRoot.subarray(0, 28)]);
    const signingRoot = containerRoot([messageRoot, domain]);
    const depositDataRoot = containerRoot([
        bytesVectorRoot(pubkey),
        bytesVectorRoot(withdrawalRecipient),
        uint64Root(amount),
        bytesVectorRoot(signature)
    ]);
    return { depositDataRoot, domain, messageRoot, signingRoot };
}

// The go-qrllib replacement pinned by Qrysm b53 signs ML-DSA-87 deposit roots
// with "ZOND" || context version 1 || the default ML-DSA descriptor 0x010000.
function verifyQrysmSignature(signature, message, publicKey) {
    return cryptoSignVerify(signature, message, publicKey, QRYSM_MLDSA87_CONTEXT);
}

function parseAmount(value) {
    let amount;
    if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) {
        amount = BigInt(value);
    } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        amount = BigInt(value);
    } else {
        throw new Error('amount must be a canonical decimal string or safe unsigned integer');
    }
    if (amount > 0xffff_ffff_ffff_ffffn) {
        throw new Error('amount exceeds the SSZ uint64 range');
    }
    return amount;
}

function validateDepositEntry(entry, expected) {
    if (!entry || typeof entry !== 'object') {
        throw new Error('Deposit entry must be an object');
    }
    if (entry.withdrawal_credentials !== undefined) {
        throw new Error('Legacy withdrawal_credentials are not valid for QIP-55 deposits');
    }

    const pubkey = decodeHex(entry.pubkey, 'pubkey', PUBKEY_BYTES);
    const withdrawalRecipient = decodeHex(
        entry.withdrawal_recipient,
        'withdrawal_recipient',
        WITHDRAWAL_RECIPIENT_BYTES
    );
    const signature = decodeHex(entry.signature, 'signature', SIGNATURE_BYTES);
    const forkVersion = decodeHex(entry.fork_version, 'fork_version', FORK_VERSION_BYTES);
    const expectedRecipient = decodeHex(
        expected.poolAddress,
        'configured pool address',
        WITHDRAWAL_RECIPIENT_BYTES
    );
    const expectedForkVersion = decodeHex(
        expected.forkVersion,
        'configured fork version',
        FORK_VERSION_BYTES
    );
    const amount = parseAmount(entry.amount);

    if (!withdrawalRecipient.equals(expectedRecipient)) {
        throw new Error('Withdrawal recipient does not match the deployed pool');
    }
    if (!forkVersion.equals(expectedForkVersion)) {
        throw new Error('Deposit fork version does not match the connected consensus chain');
    }
    if (amount !== VALIDATOR_STAKE_SHOR) {
        throw new Error('Deposit amount must be exactly 40000 QRL in Shor');
    }
    if (expected.networkName && entry.network_name !== expected.networkName) {
        throw new Error('Deposit network name does not match the reviewed configuration');
    }

    const roots = computeDepositRoots({
        pubkey,
        withdrawalRecipient,
        amount,
        signature,
        forkVersion
    });
    const claimedMessageRoot = decodeHex(
        entry.message_root,
        'message_root',
        ROOT_BYTES
    );
    const claimedDepositDataRoot = decodeHex(
        entry.deposit_data_root,
        'deposit_data_root',
        ROOT_BYTES
    );
    if (!roots.messageRoot.equals(claimedMessageRoot)) {
        throw new Error('Deposit message root does not match the SSZ fields');
    }
    if (!roots.depositDataRoot.equals(claimedDepositDataRoot)) {
        throw new Error('Deposit data root does not match the SSZ fields');
    }
    if (!verifyQrysmSignature(signature, roots.signingRoot, pubkey)) {
        throw new Error('ML-DSA-87 deposit signature is invalid for the Qrysm deposit domain');
    }

    return {
        amount,
        depositDataRoot: roots.depositDataRoot,
        messageRoot: roots.messageRoot,
        pubkey,
        signature,
        withdrawalRecipient
    };
}

module.exports = {
    DEPOSIT_DOMAIN,
    FORK_VERSION_BYTES,
    PUBKEY_BYTES,
    ROOT_BYTES,
    QRYSM_MLDSA87_CONTEXT,
    SIGNATURE_BYTES,
    VALIDATOR_STAKE_SHOR,
    WITHDRAWAL_RECIPIENT_BYTES,
    computeDepositRoots,
    normalizeHex,
    parseAmount,
    validateDepositEntry,
    verifyQrysmSignature
};
