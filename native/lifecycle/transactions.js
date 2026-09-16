// Local fixture transactions with raw receipt polling and canonical block checks.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Web3 } = require('@theqrl/web3');
const { loadDeployerFromEnvironment } = require('../../scripts/lib/loadDeployer');
const root = path.resolve(__dirname, '../..');
const networkRuntime = path.join(root, 'findings/native-network-20260915');
const runtime = path.join(networkRuntime, 'lifecycle');
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${json(value)}\n`);
const normalized = value => String(value).replace(/^(?:Q|0x)/i, '').toLowerCase();
const hash = value => createHash('sha256').update(value).digest('hex');

async function context() {
  assert.equal(process.env.QUANTAPOOL_PUBLIC_LOCAL_NETWORK, '3151916');
  assert.equal(process.env.QUANTAPOOL_PUBLIC_DEV_ACCOUNT, '2');
  assert.equal(process.env.QUANTAPOOL_PUBLIC_DEV_CHAIN_ID, '3151916');
  execFileSync('python3', ['-c', 'from context import network_context; network_context()'], { cwd: __dirname, stdio: 'pipe' });
  const network = read(path.join(networkRuntime, 'network.json'));
  const web3 = new Web3(new Web3.providers.HttpProvider(network.rpcUrl, { providerOptions: { redirect: 'error' } }));
  const accounts = new Map();
  function account(index) {
    assert([0, 1, 2, 3].includes(index));
    if (!accounts.has(index)) accounts.set(index, loadDeployerFromEnvironment(web3, {
      repoRoot: root, rpcUrl: network.rpcUrl, chainId: 3151916,
      env: { QUANTAPOOL_PUBLIC_DEV_ACCOUNT: String(index), QUANTAPOOL_PUBLIC_DEV_CHAIN_ID: '3151916' }
    }));
    return accounts.get(index);
  }
  async function rpc(method, params = []) {
    const response = await fetch(network.rpcUrl, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    assert(response.ok);
    const value = await response.json();
    if (value.error) throw new Error(`${method}: ${value.error.message}`);
    return value.result;
  }
  const artifact = name => {
    const directory = fs.existsSync(path.join(runtime, 'artifacts', `${name}.abi`)) ? path.join(runtime, 'artifacts') : path.join(root, 'build/native');
    return { abi: read(path.join(directory, `${name}.abi`)), bytecode: fs.readFileSync(path.join(directory, `${name}.bin`), 'utf8').trim() };
  };
  const contract = (name, address) => new web3.qrl.Contract(artifact(name).abi, address);
  const receiptPath = path.join(runtime, 'transactions.jsonl');
  const transactionPath = path.join(runtime, 'submitted-transactions.jsonl');
  const records = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  async function prepare(name, to, data, value = 0n, actor = 2, nonceOverride = null, fixedGas = null) {
    const sender = account(actor);
    const identity = hash(json({ to, data, value: String(value), actor }));
    const saved = records(transactionPath).find(item => item.name === name);
    if (saved) {
      assert.equal(saved.identity, identity, 'A transaction name cannot identify different economic actions');
      if (!(await rpc('qrl_getTransactionReceipt', [saved.transactionHash])) && !(await rpc('qrl_getTransactionByHash', [saved.transactionHash]))) {
        const raw = fs.readFileSync(path.join(runtime, 'submitted', `${saved.transactionHash.slice(2)}.hex`), 'utf8').trim();
        assert.equal(await rpc('qrl_sendRawTransaction', [raw]), saved.transactionHash);
      }
      return saved;
    }
    assert((data.length - 2) / 2 < 120000, 'Bound calldata before signing');
    const tx = { from: sender.address, ...(to ? { to } : {}), data, value: BigInt(value) };
    const estimated = fixedGas === null ? BigInt(await web3.qrl.estimateGas(tx)) : null;
    const gas = fixedGas === null ? estimated * 12n / 10n + 10000n : BigInt(fixedGas);
    const blockGasLimit = BigInt((await rpc('qrl_getBlockByNumber', ['latest', false])).gasLimit);
    assert(gas > 0n && gas <= blockGasLimit, 'Transaction must fit the actual native block gas limit');
    const nonce = nonceOverride === null ? BigInt(await rpc('qrl_getTransactionCount', [sender.address, 'pending'])) : BigInt(nonceOverride);
    const price = BigInt(await rpc('qrl_gasPrice'));
    const signed = await web3.qrl.accounts.signTransaction({ ...tx, type: '0x2', chainId: 3151916n,
      nonce, gas, maxFeePerGas: price * 2n, maxPriorityFeePerGas: price }, sender.seed);
    assert((signed.rawTransaction.length - 2) / 2 <= 128 * 1024);
    assert(/^0x[0-9a-f]{64}$/i.test(signed.transactionHash));
    const transactionHash = signed.transactionHash;
    fs.mkdirSync(path.join(runtime, 'submitted'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(runtime, 'submitted', `${transactionHash.slice(2)}.hex`), signed.rawTransaction, { mode: 0o600 });
    const meta = { name, identity, transactionHash, from: sender.address, nonce: String(nonce),
      estimatedGas: estimated === null ? null : String(estimated), fixedGasLimit: fixedGas === null ? null : String(fixedGas),
      calldataBytes: (data.length - 2) / 2, transactionBytes: (signed.rawTransaction.length - 2) / 2,
      value: String(value), actor };
    // Persist the exact public signed message before broadcast. Retrying reuses
    // its hash and nonce, even after an interrupted receipt wait.
    fs.appendFileSync(transactionPath, JSON.stringify(meta) + '\n');
    assert.equal(await rpc('qrl_sendRawTransaction', [signed.rawTransaction]), transactionHash);
    return meta;
  }
  async function confirm(meta) {
    const prior = records(receiptPath).find(item => item.name === meta.name);
    if (prior) {
      assert.equal(prior.identity, meta.identity);
      const block = await rpc('qrl_getBlockByNumber', [prior.receipt.blockNumber, false]);
      assert.equal(block.hash, prior.receipt.blockHash, 'Saved transaction must remain canonical');
      return prior.receipt;
    }
    const deadline = Date.now() + 120000;
    let receipt;
    while (!(receipt = await rpc('qrl_getTransactionReceipt', [meta.transactionHash]))) {
      assert(Date.now() < deadline, `Receipt wait expired for ${meta.transactionHash}; the same signed message is preserved`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(BigInt(receipt.status), 1n, `Native transaction reverted: ${meta.transactionHash}`);
    const block = await rpc('qrl_getBlockByNumber', [receipt.blockNumber, false]);
    assert.equal(block.hash, receipt.blockHash);
    const record = { ...meta,
      minedSlot: String((BigInt(block.timestamp) - BigInt(network.beaconGenesis.genesis_time)) / 3n),
      feeBaseUnits: String(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)), receipt };
    fs.appendFileSync(receiptPath, JSON.stringify(record) + '\n');
    console.log(JSON.stringify({ name: meta.name, transactionHash: meta.transactionHash, gasUsed: BigInt(receipt.gasUsed).toString(), minedSlot: record.minedSlot }));
    return receipt;
  }
  async function send(name, to, data, value = 0n, actor = 2, fixedGas = null) {
    return confirm(await prepare(name, to, data, value, actor, null, fixedGas));
  }
  async function sendBatch(entries, gasLimit = 8500000n) {
    assert(entries.length >= 1 && entries.length <= 64);
    const saved = records(transactionPath);
    const firstSaved = entries.map((entry, index) => ({ entry: saved.find(item => item.name === entry.name), index })).find(item => item.entry);
    const firstNonce = firstSaved ? BigInt(firstSaved.entry.nonce) - BigInt(firstSaved.index) : BigInt(await rpc('qrl_getTransactionCount', [account(2).address, 'pending']));
    const pending = [];
    let preparationFailure;
    // Explicit nonces preserve on-chain order while a bounded eight-message
    // pipeline overlaps local RPC work. The node may temporarily hold a gap;
    // each exact signed message is still journaled before its own broadcast.
    for (let start = 0; start < entries.length; start += 8) {
      const results = await Promise.allSettled(entries.slice(start, start + 8).map((entry, offset) => {
        assert(!entry.value, 'Batches carry no user or operator QRL');
        return prepare(entry.name, entry.to, entry.data, 0n, 2, firstNonce + BigInt(start + offset), gasLimit);
      }));
      for (const result of results) {
        if (result.status === 'fulfilled') pending.push(result.value);
        else preparationFailure ||= result.reason;
      }
      if (preparationFailure) break;
    }
    const results = await Promise.allSettled(pending.map(confirm));
    if (preparationFailure) throw preparationFailure;
    const failures = results.filter(item => item.status === 'rejected');
    if (failures.length) throw failures[0].reason;
    return results.map(item => item.value);
  }
  async function deploy(name, contractName, args) {
    const { abi, bytecode } = artifact(contractName);
    const creation = new web3.qrl.Contract(abi).deploy({ data: `0x${bytecode}`, arguments: args });
    return send(name, null, creation.encodeABI());
  }
  const predict = (sender, nonce) => execFileSync(path.join(networkRuntime, 'bin/predict-address'), [sender, String(nonce)], { encoding: 'utf8' }).trim();
  return { network, web3, account, rpc, artifact, contract, send, sendBatch, deploy, predict };
}

async function locked(fn) {
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const file = path.join(runtime, '.transaction-lock');
  const fd = fs.openSync(file, 'wx', 0o600);
  fs.writeFileSync(fd, String(process.pid));
  try { return await fn(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
module.exports = { context, locked, root, runtime, networkRuntime, read, write, json, normalized, hash };
