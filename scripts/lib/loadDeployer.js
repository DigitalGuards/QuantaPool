const fs = require('fs');
const path = require('path');

const { MLDSA87 } = require('@theqrl/wallet.js');

const MNEMONIC_WORDS = 34;
const EXTENDED_SEED_HEX_LENGTH = 102;

function loadDeployer(web3, secret) {
    const value = secret?.trim() || '';
    const rawHex = value.replace(/^0x/i, '');
    let seedHex;

    if (
        rawHex.length === EXTENDED_SEED_HEX_LENGTH &&
        /^[0-9a-fA-F]+$/.test(rawHex)
    ) {
        seedHex = `0x${rawHex}`;
    } else if (value.split(/\s+/).length === MNEMONIC_WORDS) {
        const wallet = MLDSA87.newWalletFromMnemonic(value);
        seedHex = wallet.getHexExtendedSeed();
    } else {
        throw new Error(
            `Deployer seed must be a ${MNEMONIC_WORDS}-word ML-DSA-87 mnemonic ` +
                `or a ${EXTENDED_SEED_HEX_LENGTH}-character extended-seed hex value.`
        );
    }

    const account = web3.qrl.accounts.seedToAccount(seedHex);
    web3.qrl.accounts.wallet.add(account);
    if (
        web3.qrl.wallet &&
        web3.qrl.wallet !== web3.qrl.accounts.wallet &&
        typeof web3.qrl.wallet.add === 'function'
    ) {
        web3.qrl.wallet.add(seedHex);
    }
    return account;
}

function parsePublicDevSeeds(source) {
    const seeds = [];
    const pattern =
        /new_prefunded_account\(\s*"Q[0-9a-fA-F]{128}",\s*"([0-9a-fA-F]{102})",?\s*\)/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        seeds.push(match[1]);
    }
    return seeds;
}

function isLoopbackRpcUrl(rpcUrl) {
    let parsed;
    try {
        parsed = new URL(rpcUrl);
    } catch {
        return false;
    }
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
}

function parseExpectedPublicDevChainId(env = process.env) {
    const value = env.QUANTAPOOL_PUBLIC_DEV_CHAIN_ID?.trim();
    if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new Error(
            'QUANTAPOOL_PUBLIC_DEV_CHAIN_ID must be an explicit positive decimal integer'
        );
    }
    const chainId = Number(value);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
        throw new Error(
            'QUANTAPOOL_PUBLIC_DEV_CHAIN_ID must be an explicit positive safe integer'
        );
    }
    return chainId;
}

function loadPublicDevSeed(repoRoot, accountIndex, env = process.env) {
    if (!/^(0|[1-9][0-9]*)$/.test(accountIndex)) {
        throw new Error('QUANTAPOOL_PUBLIC_DEV_ACCOUNT must be a non-negative integer');
    }

    const packageDir = env.QRL_PACKAGE_DIR
        ? path.resolve(env.QRL_PACKAGE_DIR)
        : path.resolve(repoRoot, '..', 'qrl-package');
    const constantsPath = path.join(
        packageDir,
        'src',
        'prelaunch_data_generator',
        'genesis_constants',
        'genesis_constants.star'
    );
    const seeds = parsePublicDevSeeds(fs.readFileSync(constantsPath, 'utf8'));
    const index = Number(accountIndex);
    if (!seeds[index]) {
        throw new Error(`Public development account #${index} is absent from ${constantsPath}`);
    }
    return seeds[index];
}

function loadDeployerFromEnvironment(web3, options) {
    const { repoRoot, rpcUrl, chainId, env = process.env } = options;
    const publicDevAccount = env.QUANTAPOOL_PUBLIC_DEV_ACCOUNT?.trim();
    if (publicDevAccount) {
        const expectedChainId = parseExpectedPublicDevChainId(env);
        if (!isLoopbackRpcUrl(rpcUrl) || Number(chainId) !== expectedChainId) {
            throw new Error(
                'QUANTAPOOL_PUBLIC_DEV_ACCOUNT is restricted to a loopback RPC URL ' +
                    `on exact chain ${expectedChainId}`
            );
        }
        return loadDeployer(web3, loadPublicDevSeed(repoRoot, publicDevAccount, env));
    }

    if (env.TESTNET_SEED?.trim()) {
        return loadDeployer(web3, env.TESTNET_SEED);
    }

    throw new Error(
        'Set TESTNET_SEED, or select a published local Kurtosis account with ' +
            'QUANTAPOOL_PUBLIC_DEV_ACCOUNT and QUANTAPOOL_PUBLIC_DEV_CHAIN_ID'
    );
}

module.exports = {
    isLoopbackRpcUrl,
    loadDeployer,
    loadDeployerFromEnvironment,
    loadPublicDevSeed,
    parseExpectedPublicDevChainId,
    parsePublicDevSeeds
};
