const { createHash } = require('crypto');

const QIP55_DEPOSIT_RUNTIME_BYTES = 7_970;
const QIP55_DEPOSIT_RUNTIME_SHA256 =
    'f2db8aa6b661b536a673f8c064bf69478aecee0d863cdfe2ab08b1a7b12af43e';
const GET_DEPOSIT_ROOT_SELECTOR = '0xc5f2892f';
const GET_DEPOSIT_COUNT_SELECTOR = '0x621fd130';
const EXPECTED_DEPOSIT_DOMAIN = '0x03000000';
const EXPECTED_MAX_EFFECTIVE_BALANCE = '40000000000000';

function normalizeAddress(value, label) {
    const normalized = String(value || '').replace(/^0x/i, 'Q');
    if (!/^Q[a-f0-9]{128}$/i.test(normalized)) {
        throw new Error(`${label} must be a full 64-byte QIP-55 address`);
    }
    return normalized.toLowerCase();
}

function normalizeForkVersion(value, label) {
    const normalized = String(value || '').toLowerCase();
    if (!/^0x[a-f0-9]{8}$/.test(normalized)) {
        throw new Error(`${label} must be a four-byte hex value`);
    }
    return normalized;
}

function getQrysmRestUrl(config, env = process.env) {
    const raw = env.QRYSM_REST_URL || config.qrysmRestUrl;
    if (!raw) throw new Error('Set QRYSM_REST_URL to the reviewed Qrysm REST endpoint');

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('QRYSM_REST_URL must be a valid HTTP or HTTPS URL');
    }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (!loopback && parsed.protocol !== 'https:') {
        throw new Error('Non-loopback QRYSM_REST_URL endpoints must use HTTPS');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('QRYSM_REST_URL must not contain credentials, a query, or a fragment');
    }
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.toString().replace(/\/$/, '');
}

async function getJson(url, fetchFn) {
    const response = await fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return response.json();
}

function requireCallShape(value, expectedBytes, label) {
    if (!new RegExp(`^0x[a-f0-9]{${expectedBytes * 2}}$`, 'i').test(String(value))) {
        throw new Error(`${label} returned a non-canonical ${expectedBytes}-byte value`);
    }
}

async function verifyBeaconDepositTarget({ web3, config, env = process.env, fetchFn = fetch }) {
    const restUrl = getQrysmRestUrl(config, env);
    const expectedAddress = normalizeAddress(config.depositContract, 'Configured deposit contract');
    const expectedForkVersion = normalizeForkVersion(
        config.genesisForkVersion,
        'Configured genesis fork version'
    );
    const expectedChainId = BigInt(config.chainId);

    const [connectedChainId, contractResponse, specResponse] = await Promise.all([
        web3.qrl.getChainId(),
        getJson(`${restUrl}/qrl/v1/config/deposit_contract`, fetchFn),
        getJson(`${restUrl}/qrl/v1/config/spec`, fetchFn)
    ]);
    if (BigInt(connectedChainId) !== expectedChainId) {
        throw new Error(`Wrong execution chain: expected ${expectedChainId}, received ${connectedChainId}`);
    }

    const consensusContract = contractResponse?.data || {};
    const spec = specResponse?.data || {};
    if (BigInt(consensusContract.chain_id) !== expectedChainId) {
        throw new Error('Qrysm deposit contract chain ID does not match the execution chain');
    }
    if (BigInt(spec.DEPOSIT_CHAIN_ID) !== expectedChainId) {
        throw new Error('Qrysm spec deposit chain ID does not match the execution chain');
    }
    if (normalizeAddress(consensusContract.address, 'Qrysm deposit contract') !== expectedAddress) {
        throw new Error('Configured deposit contract differs from the Qrysm deposit contract');
    }
    if (normalizeAddress(spec.DEPOSIT_CONTRACT_ADDRESS, 'Qrysm spec deposit contract') !== expectedAddress) {
        throw new Error('Qrysm spec deposit contract differs from the reviewed configuration');
    }
    if (normalizeForkVersion(spec.GENESIS_FORK_VERSION, 'Qrysm genesis fork version') !== expectedForkVersion) {
        throw new Error('Configured genesis fork version differs from the Qrysm chain');
    }
    if (String(spec.DOMAIN_DEPOSIT).toLowerCase() !== EXPECTED_DEPOSIT_DOMAIN) {
        throw new Error(`Unsupported Qrysm deposit domain: ${spec.DOMAIN_DEPOSIT}`);
    }
    if (String(spec.MAX_EFFECTIVE_BALANCE) !== EXPECTED_MAX_EFFECTIVE_BALANCE) {
        throw new Error(`Unsupported Qrysm validator stake: ${spec.MAX_EFFECTIVE_BALANCE}`);
    }

    const runtimeHex = await web3.qrl.getCode(config.depositContract);
    if (!/^0x[a-f0-9]+$/i.test(runtimeHex) || runtimeHex === '0x') {
        throw new Error('Configured deposit contract has no execution bytecode');
    }
    const runtime = Buffer.from(runtimeHex.slice(2), 'hex');
    const runtimeSha256 = createHash('sha256').update(runtime).digest('hex');
    if (
        runtime.length !== QIP55_DEPOSIT_RUNTIME_BYTES ||
        runtimeSha256 !== QIP55_DEPOSIT_RUNTIME_SHA256
    ) {
        throw new Error(
            `Deposit contract runtime mismatch: ${runtime.length} bytes, SHA-256 ${runtimeSha256}`
        );
    }

    const [depositRoot, depositCount] = await Promise.all([
        web3.qrl.call(
            { to: config.depositContract, data: GET_DEPOSIT_ROOT_SELECTOR },
            'latest'
        ),
        web3.qrl.call(
            { to: config.depositContract, data: GET_DEPOSIT_COUNT_SELECTOR },
            'latest'
        )
    ]);
    requireCallShape(depositRoot, 64, 'get_deposit_root()');
    requireCallShape(depositCount, 192, 'get_deposit_count()');

    return {
        chainId: expectedChainId,
        depositContract: expectedAddress,
        depositDomain: EXPECTED_DEPOSIT_DOMAIN,
        forkVersion: expectedForkVersion,
        restUrl,
        runtimeSha256
    };
}

module.exports = {
    EXPECTED_DEPOSIT_DOMAIN,
    EXPECTED_MAX_EFFECTIVE_BALANCE,
    GET_DEPOSIT_COUNT_SELECTOR,
    GET_DEPOSIT_ROOT_SELECTOR,
    QIP55_DEPOSIT_RUNTIME_BYTES,
    QIP55_DEPOSIT_RUNTIME_SHA256,
    getQrysmRestUrl,
    normalizeAddress,
    verifyBeaconDepositTarget
};
