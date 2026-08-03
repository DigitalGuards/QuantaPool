/**
 * Scenario 2 wallet fan-out: generate N fresh ML-DSA-87 wallets and seed each
 * with QRL from a funder mnemonic. Writes results to .env.scenario2 (gitignored).
 *
 * Usage: FUNDER_MNEMONIC="..." NUM=4 PER_WALLET_QRL=5000 node scripts/fanout-test-wallets.js
 */

const fs = require('fs');
const path = require('path');
const { Web3 } = require('@theqrl/web3');
const { MLDSA87 } = require('@theqrl/wallet.js');

const RPC = process.env.QRL_RPC_URL || 'https://qrlwallet.com/api/qrl-rpc/testnet';
const NUM = parseInt(process.env.NUM || '4', 10);
const PER = process.env.PER_WALLET_QRL || '5000';
const OUT = path.join(__dirname, '..', '.env.scenario2');
const FUNDER = process.env.FUNDER_MNEMONIC;

if (!FUNDER) {
    console.error('Set FUNDER_MNEMONIC env var (34-word ML-DSA-87)');
    process.exit(1);
}

(async () => {
    const web3 = new Web3(RPC);

    // Funder
    const funderWallet = MLDSA87.newWalletFromMnemonic(FUNDER);
    const funderSeed = funderWallet.getHexExtendedSeed();
    const funder = web3.qrl.accounts.seedToAccount(funderSeed);
    web3.qrl.accounts.wallet.add(funder);
    if (web3.qrl.wallet?.add) web3.qrl.wallet.add(funderSeed);

    const startBalance = await web3.qrl.getBalance(funder.address);
    console.log(`Funder ${funder.address}: ${web3.utils.fromPlanck(startBalance, 'quanta')} QRL`);
    const planckPer = web3.utils.toPlanck(PER, 'quanta');
    console.log(`Generating ${NUM} wallets, sending ${PER} QRL each (${web3.utils.fromPlanck(BigInt(planckPer) * BigInt(NUM), 'quanta')} QRL total)\n`);

    const results = [];
    for (let i = 1; i <= NUM; i++) {
        const w = MLDSA87.newWallet();
        const mnemonic = w.getMnemonic();
        const seed = w.getHexExtendedSeed();
        const acct = web3.qrl.accounts.seedToAccount(seed);

        const tx = await web3.qrl.sendTransaction({
            from: funder.address,
            to: acct.address,
            value: planckPer,
            gas: 21000,
        });
        console.log(`  [${i}/${NUM}] -> ${acct.address}  tx=${tx.transactionHash}`);
        results.push({ idx: i, address: acct.address, mnemonic, seed, tx: tx.transactionHash });
    }

    const lines = [
        `# Scenario 2 test wallets - generated ${new Date().toISOString()}`,
        `# Funder: ${funder.address}`,
        `# Each wallet: ${PER} QRL`,
        '',
    ];
    results.forEach(({ idx, address, mnemonic, seed, tx }) => {
        lines.push(`# wallet ${idx}: ${address}  fund_tx=${tx}`);
        lines.push(`SCEN2_W${idx}_ADDRESS=${address}`);
        lines.push(`SCEN2_W${idx}_SEED=${seed}`);
        lines.push(`SCEN2_W${idx}_MNEMONIC="${mnemonic}"`);
        lines.push('');
    });
    fs.writeFileSync(OUT, lines.join('\n'), { mode: 0o600 });
    console.log(`\nWrote ${OUT} (mode 600). gitignored.`);

    const endBalance = await web3.qrl.getBalance(funder.address);
    console.log(`Funder remaining: ${web3.utils.fromPlanck(endBalance, 'quanta')} QRL`);
})();
