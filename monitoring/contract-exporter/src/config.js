const address = /^Q[a-fA-F0-9]{128}$/;

function loadConfig(env = process.env) {
    const rpc = new URL(env.QRL_RPC_URL || '');
    if (!['http:', 'https:'].includes(rpc.protocol) || rpc.username || rpc.password) throw new Error('Invalid RPC URL');
    if (!address.test(env.NATIVE_POOL_ADDRESS || '')) throw new Error('A native 64-byte pool address is required');
    if (!/^[1-9][0-9]*$/.test(env.QRL_CHAIN_ID || '')) throw new Error('An explicit chain ID is required');
    const port = Number(env.METRICS_PORT || 9101);
    const interval = Number(env.CONTRACT_SCRAPE_INTERVAL || 30000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(interval) || interval < 1000) {
        throw new Error('Invalid metrics timing or port');
    }
    return { rpcUrl: rpc.href, poolAddress: env.NATIVE_POOL_ADDRESS, chainId: BigInt(env.QRL_CHAIN_ID),
        port, interval, host: env.METRICS_HOST || '127.0.0.1' };
}
module.exports = { loadConfig };
