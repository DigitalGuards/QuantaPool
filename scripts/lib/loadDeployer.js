const { MLDSA87 } = require('@theqrl/wallet.js');

const MNEMONIC_WORDS = 34;

function loadDeployer(web3, mnemonic) {
    if (!mnemonic || mnemonic.trim().split(/\s+/).length !== MNEMONIC_WORDS) {
        throw new Error(
            `Deployer mnemonic must be ${MNEMONIC_WORDS} words. ` +
            `wallet.js v3 changed mnemonic length from 32 to ${MNEMONIC_WORDS} words; regenerate the seed.`
        );
    }
    const wallet = MLDSA87.newWalletFromMnemonic(mnemonic);
    const seedHex = wallet.getHexExtendedSeed();
    const account = web3.qrl.accounts.seedToAccount(seedHex);
    web3.qrl.accounts.wallet.add(account);
    // Also register the seed on web3.qrl.wallet so that web3.qrl.sendTransaction
    // can sign locally for contracts instantiated via `new web3.qrl.Contract(abi, addr)`
    // (where the wallet is otherwise not inherited). Matches the pattern used by
    // myqrlwallet-frontend's qrlStore.sendToken().
    if (web3.qrl.wallet && typeof web3.qrl.wallet.add === 'function') {
        web3.qrl.wallet.add(seedHex);
    }
    return account;
}

module.exports = { loadDeployer };
