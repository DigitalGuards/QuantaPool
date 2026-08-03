/* eslint-disable no-console */
require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const { Web3 } = require('@theqrl/web3');

const { loadDeployer } = require('./lib/loadDeployer');

const EXPECTED_CHAIN_ID = 1337n;
const CONFIRMATION = '--confirm-live-v2-pause';
const repoRoot = path.join(__dirname, '..');
const config = require(path.join(repoRoot, 'config', 'testnet-hyperion.json'));

function loadAbi(name) {
    return JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'build', 'hyperion', `${name}.abi`), 'utf8')
    );
}

async function send(web3, method, account, to, label) {
    const data = method.encodeABI();
    const gas = await method.estimateGas({
        from: account.address,
        to,
        data,
        value: '0'
    });
    const baseGasPrice = BigInt((await web3.qrl.getGasPrice()) || 1_000_000_000);
    const receipt = await web3.qrl.sendTransaction(
        {
            type: '0x2',
            from: account.address,
            to,
            data,
            gas: ((BigInt(gas) * 12n) / 10n).toString(),
            value: '0',
            maxFeePerGas: (baseGasPrice * 2n).toString(),
            maxPriorityFeePerGas: baseGasPrice.toString()
        },
        undefined,
        { checkRevertBeforeSending: true }
    );
    const hash =
        typeof receipt.transactionHash === 'string'
            ? receipt.transactionHash
            : `0x${Buffer.from(receipt.transactionHash).toString('hex')}`;
    console.log(`${label}: ${hash}`);
}

async function main() {
    if (!process.argv.includes(CONFIRMATION)) {
        throw new Error(`Refusing to mutate live contracts without ${CONFIRMATION}`);
    }

    const web3 = new Web3(config.provider);
    const account = loadDeployer(web3, process.env.TESTNET_SEED);
    const chainId = BigInt(await web3.qrl.getChainId());
    if (chainId !== EXPECTED_CHAIN_ID) {
        throw new Error(`Wrong chain: expected ${EXPECTED_CHAIN_ID}, received ${chainId}`);
    }

    const poolAddress = config.contracts.depositPoolV2;
    const tokenAddress = config.contracts.stQRLV2;
    const pool = new web3.qrl.Contract(loadAbi('DepositPoolV2'), poolAddress);
    const token = new web3.qrl.Contract(loadAbi('stQRLv2'), tokenAddress);

    const [poolOwner, tokenOwner, poolPaused, tokenPaused] = await Promise.all([
        pool.methods.owner().call(),
        token.methods.owner().call(),
        pool.methods.paused().call(),
        token.methods.paused().call()
    ]);
    if (
        poolOwner.toLowerCase() !== account.address.toLowerCase() ||
        tokenOwner.toLowerCase() !== account.address.toLowerCase()
    ) {
        throw new Error('Configured deployer is not the owner of both live contracts');
    }

    console.log(`chain=${chainId} pool=${poolAddress} token=${tokenAddress}`);
    if (!poolPaused) {
        await send(web3, pool.methods.pause(), account, poolAddress, 'pool.pause');
    }
    if (!tokenPaused) {
        await send(web3, token.methods.pause(), account, tokenAddress, 'token.pause');
    }

    const [finalPoolPaused, finalTokenPaused] = await Promise.all([
        pool.methods.paused().call(),
        token.methods.paused().call()
    ]);
    if (!finalPoolPaused || !finalTokenPaused) {
        throw new Error('Pause verification failed');
    }
    console.log('verified: pool and stQRL are paused');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
