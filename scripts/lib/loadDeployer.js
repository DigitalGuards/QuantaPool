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
    return account;
}

module.exports = { loadDeployer };
