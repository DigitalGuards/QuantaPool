// Separate immutable mechanical helper; the funded four-contract graph stays frozen.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tx = require('./transactions');

tx.locked(async () => {
  const c = await tx.context();
  const pool = tx.read(path.join(tx.runtime, 'pool.json'));
  const directory = path.join(tx.root, 'build/native-checkpoint-executor');
  const manifest = tx.read(path.join(directory, 'manifest.json'));
  assert.equal(manifest.compiler.sha256, '11b53f5b2519f381aa46d5704d9e0dde3f0ff2552be07b0cd3aba17741ee612a');
  for (const [file, expected] of Object.entries(manifest.sources)) {
    assert.equal(tx.hash(fs.readFileSync(path.join(tx.root, 'native/contracts', file))), expected, 'Executor source changed after qualification');
  }
  const name = 'NativeCheckpointExecutor';
  const artifactHashes = {};
  for (const suffix of ['abi', 'bin', 'bin-runtime']) {
    const source = path.join(directory, `${name}.${suffix}`);
    const bytes = fs.readFileSync(source);
    const frozen = path.join(tx.runtime, 'artifacts', `${name}.${suffix}`);
    artifactHashes[suffix] = tx.hash(bytes);
    assert.equal(artifactHashes[suffix], manifest.artifacts[suffix], 'Executor artifact differs from qualification');
    if (fs.existsSync(frozen)) assert.equal(tx.hash(fs.readFileSync(frozen)), artifactHashes[suffix], 'Preserve the frozen executor artifact');
    else fs.copyFileSync(source, frozen);
  }
  const recordPath = path.join(tx.runtime, 'checkpoint-executor.json');
  const prior = fs.existsSync(recordPath) ? tx.read(recordPath) : null;
  if (prior) assert.deepEqual(prior.artifactHashes, artifactHashes);
  const receipt = await c.deploy('deploy-checkpoint-executor', name, [pool.portfolioAddress, pool.address]);
  const executor = c.contract(name, receipt.contractAddress);
  assert.equal(tx.normalized(await executor.methods.portfolio().call()), tx.normalized(pool.portfolioAddress));
  assert.equal(tx.normalized(await executor.methods.pool().call()), tx.normalized(pool.address));
  const record = { chainId: 3151916, genesis: c.network.executionGenesis, address: receipt.contractAddress,
    portfolioAddress: pool.portfolioAddress, poolAddress: pool.address, artifactHashes,
    sourceHash: tx.hash(fs.readFileSync(path.join(tx.root, 'native/contracts/NativeCheckpointExecutor.hyp'))),
    compiler: manifest, transactionHash: receipt.transactionHash, blockNumber: String(BigInt(receipt.blockNumber)),
    deployedCodeSha256: tx.hash(Buffer.from((await c.rpc('qrl_getCode', [receipt.contractAddress, receipt.blockNumber])).slice(2), 'hex')),
    scope: 'Immutable typed permissionless checkpoint calls only; no value, signer authority, accounting setters or changes to the funded core graph.' };
  tx.write(recordPath, record);
  console.log(tx.json(record));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
