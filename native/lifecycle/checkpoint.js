// Complete native portfolio settlement on the explicitly identified local chain.
// Call checkpoint(c) inside transactions.locked(); this module owns no signer.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const tx = require('./transactions');
const { header, headerRoot } = require('./finality-codec');
const { witness, cash } = require('../proofs/make-plan');

const ZERO = `0x${'00'.repeat(32)}`;
const number = value => BigInt(String(value));
const hexEqual = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
const flipped = value => `0x${(parseInt(value.slice(2, 4), 16) ^ 1).toString(16).padStart(2, '0')}${value.slice(4)}`;

function snapshot(value) {
  return { slot: String(value[0]), executionBlock: String(value[1]), depositIndex: String(value[2]),
    cash: String(value[3]), validatorBalance: String(value[4]), nativeWithdrawals: String(value[5]),
    stateRoot: value[6], headerRoot: value[7], registryCount: String(value[8]),
    validatorDeposits: String(value[9]), admissionPrincipal: String(value[10]) };
}
function progress(value) {
  return { active: value[0], slot: String(value[1]), registryCount: String(value[2]),
    validatorCursor: String(value[3]), nextHeaderRoot: value[4] };
}
function run(program, args, log) {
  const result = execFileSync(program, args, { cwd: tx.root, encoding: 'utf8', maxBuffer: 4 << 20,
    env: { ...process.env, GOWORK: 'off', GOMAXPROCS: '2' } });
  if (log) fs.writeFileSync(log, result);
  return result;
}
function ensureProofTools() {
  const directory = path.join(tx.networkRuntime, 'bin');
  fs.mkdirSync(directory, { recursive: true });
  const names = ['export-flow', 'export-state', 'verify-cash'];
  const sources = ['go.mod', 'go.sum', 'ssz.go', 'flowcache.go', 'state.go', ...names.map(name => `cmd/${name}/main.go`)];
  const identity = tx.hash(sources.map(name => fs.readFileSync(path.join(tx.root, 'native/proofs', name))).reduce((a, b) => Buffer.concat([a, b]), Buffer.from('go1.26.5;CGO_ENABLED=0;tags=develop;')));
  const marker = path.join(directory, 'checkpoint-proof-tools.json');
  const prior = fs.existsSync(marker) ? tx.read(marker) : null;
  if (!prior || !prior.binaries || prior.sourceHash !== identity || names.some(name => !fs.existsSync(path.join(directory, name)) || tx.hash(fs.readFileSync(path.join(directory, name))) !== prior.binaries[name])) {
    execFileSync('go', ['build', '-mod=readonly', '-p=2', '-tags=develop', '-o', `${directory}/`, ...names.map(name => `./cmd/${name}`)], {
      cwd: path.join(tx.root, 'native/proofs'), stdio: 'pipe', env: { ...process.env, GOWORK: 'off', GOMAXPROCS: '2', GOTOOLCHAIN: 'go1.26.5', CGO_ENABLED: '0' } });
    tx.write(marker, { qrysmCommit: '3b816311ac3e86b7a7af40a062ae290318554f7a', sourceHash: identity,
      binaries: Object.fromEntries(names.map(name => [name, tx.hash(fs.readFileSync(path.join(directory, name)))])) });
  }
  return directory;
}

async function checkpoint(c, options = {}) {
  const io = options.runtime ? { ...tx, runtime: path.resolve(options.runtime) } : tx;
  assert.equal(c.network.chainId, 3151916);
  const data = io.read(path.join(io.runtime, 'pool.json'));
  assert.equal(data.genesis, c.network.executionGenesis);
  for (const [name, expected] of Object.entries(data.artifactHashes)) assert.equal(io.hash(c.artifact(name).bytecode), expected, 'Frozen deployed artifact changed');
  const portfolio = c.contract('NativePortfolioVerifier', data.portfolioAddress);
  const pool = c.contract('NativeQrlPool', data.address);
  const finality = c.contract('NativeFinalityVerifier', data.finalityAddress);
  assert.equal(io.normalized(await portfolio.methods.pool().call()), io.normalized(data.address));
  assert.equal(io.normalized(await portfolio.methods.finality().call()), io.normalized(data.finalityAddress));
  assert.equal(io.normalized(await portfolio.methods.gate().call()), io.normalized(data.gateAddress));
  let executor = null;
  let executorAddress = null;
  const executorPath = path.join(io.runtime, 'checkpoint-executor.json');
  if (fs.existsSync(executorPath)) {
    const mechanical = io.read(executorPath);
    assert.equal(io.normalized(mechanical.portfolioAddress), io.normalized(data.portfolioAddress));
    assert.equal(io.normalized(mechanical.poolAddress), io.normalized(data.address));
    executorAddress = mechanical.address;
    executor = c.contract('NativeCheckpointExecutor', executorAddress);
    assert.equal(io.normalized(await executor.methods.portfolio().call()), io.normalized(data.portfolioAddress));
    assert.equal(io.normalized(await executor.methods.pool().call()), io.normalized(data.address));
  }
  assert(options.captureOnly || executor, 'Deploy and qualify the immutable checkpoint executor before submitting a portfolio');
  const tools = ensureProofTools();
  const maxAge = number(await portfolio.methods.maxAgeSlots().call());
  const results = { schemaVersion: 1, chainId: 3151916, startedAt: new Date().toISOString(),
    pool: data.address, portfolio: data.portfolioAddress, finality: data.finalityAddress,
    diagnosticCalls: [], receipts: [], boundary: 'Actual local native proofs and transactions. Diagnostic qrl_call results are separately labelled and do not imply mined reverts.' };
  async function nowSlot() {
    const block = await c.rpc('qrl_getBlockByNumber', ['latest', false]);
    return (BigInt(block.timestamp) - number(c.network.beaconGenesis.genesis_time)) / number(c.network.beaconConfig.SECONDS_PER_SLOT);
  }
  async function fresh(slot) {
    const now = await nowSlot();
    assert(now >= number(slot) && now - number(slot) <= maxAge, `Checkpoint ${slot} is stale at ${now}; refresh finality before retrying`);
    await finality.methods.economicCheckpoint().call();
    return now - number(slot);
  }
  async function send(name, target, method) {
    const receipt = await c.send(name, target, method.encodeABI());
    results.receipts.push({ name, transactionHash: receipt.transactionHash, blockNumber: String(BigInt(receipt.blockNumber)), gasUsed: String(BigInt(receipt.gasUsed)) });
    return receipt;
  }
  async function finishLedgerStage() {
    for (let i = 0; i < 64; i++) {
      const stage = number(await pool.methods.stage().call());
      if (stage === 0n) return;
      const id = String(await pool.methods.lastCheckpointId().call());
      const applied = number(await pool.methods.appliedSlot().call());
      const age = (await nowSlot()) - applied;
      if (age > maxAge || number(await finality.methods.status().call()) !== 0n) {
        await send(`checkpoint-ledger-${id}-abort-stale`, data.address, pool.methods.abortStaging());
        results.staleLedgerStageAborted = true;
        return;
      }
      const cursor = String(await pool.methods[stage === 1n ? 'pendingHead' : 'queueHead']().call());
      const method = stage === 1n ? 'activateDeposits' : 'processQueue';
      await send(`checkpoint-ledger-${id}-${method}-${cursor}`, data.address, pool.methods[method]('32'));
    }
    throw new Error('Bounded ledger-stage execution did not finish');
  }
  if (!options.captureOnly) await finishLedgerStage();
  let pending = progress(await portfolio.methods.checkpointProgress().call());
  if (pending.active && ((await nowSlot()) - number(pending.slot) > maxAge || number(await finality.methods.status().call()) === 2n)) {
    assert(!options.captureOnly, 'Stale pending checkpoint requires permissionless abort before a new capture');
    await send(`portfolio-${pending.slot}-abort-stale`, data.portfolioAddress, portfolio.methods.abortStaleCheckpoint());
    results.stalePortfolioAborted = { slot: pending.slot, mined: true };
    pending = progress(await portfolio.methods.checkpointProgress().call());
  }
  const beforeId = String(await portfolio.methods.snapshotId().call());
  const before = snapshot(await portfolio.methods.latestSnapshot().call());
  const authority = await finality.methods.economicCheckpoint().call();
  const targetSlot = pending.active ? pending.slot : String(authority[0]);
  let expectedStateRoot = pending.active && targetSlot !== String(authority[0]) ? null : authority[1];
  let expectedHeaderRoot = pending.active && targetSlot !== String(authority[0]) ? null : await finality.methods.finalizedHeaderRoot().call();
  const stopRoot = beforeId === '0' ? await portfolio.methods.initialHeaderRoot().call() : before.headerRoot;
  const stopSlot = beforeId === '0' ? String(await portfolio.methods.initialSlot().call()) : before.slot;
  assert(stopRoot !== ZERO);
  const registryCount = number(await portfolio.methods.registryCount().call());
  assert(registryCount <= 1024n, 'Bounded local capture supports at most 1024 registered validators');
  const registry = [];
  for (let i = 0n; i < registryCount; i++) {
    const value = await portfolio.methods.registeredValidator(i.toString()).call();
    registry.push({ index: String(value[0]), publicKeyRoot: value[1], admissionSlot: String(value[2]) });
  }
  if (pending.active) assert.equal(pending.registryCount, String(registryCount), 'Registry changed during locked staging');
  const directory = path.join(io.runtime, 'checkpoints', `slot-${targetSlot}-registry-${registryCount}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const reportPath = path.join(directory, 'result.json');
  results.directory = directory;
  try {
    if (number(targetSlot) > number(stopSlot)) {
      results.ageAtCapture = String(await fresh(targetSlot));
      const captureDirectory = path.join(directory, 'cash');
      if (!fs.existsSync(path.join(captureDirectory, 'manifest.json'))) {
        // A partial failed capture is preserved; retry uses a separately named directory.
        assert(!fs.existsSync(captureDirectory) || fs.readdirSync(captureDirectory).length === 0, 'Incomplete cash capture exists; inspect before retrying');
        run('python3', [path.join(io.root, 'native/proofs/capture-checkpoint.py'), '--network', path.join(io.networkRuntime, 'network.json'),
          '--account', data.address, '--slot', targetSlot, '--output-dir', captureDirectory], path.join(directory, 'capture-cash.log'));
      }
      const cashPath = path.join(directory, 'cash-witness.json');
      run(path.join(tools, 'verify-cash'), ['--capture-dir', captureDirectory, '--output', cashPath], path.join(directory, 'verify-cash.log'));
      const account = io.read(cashPath);
      const nativeHeader = io.read(path.join(captureDirectory, 'header.json')).data;
      assert.equal(headerRoot(header(nativeHeader.header.message)), nativeHeader.root, 'Captured canonical header root mismatch');
      if (expectedStateRoot !== null) assert(hexEqual(account.beaconStateRoot, expectedStateRoot), 'Captured root differs from on-chain finalized authority');
      if (expectedHeaderRoot !== null) assert(hexEqual(nativeHeader.root, expectedHeaderRoot), 'Captured header differs from on-chain finalized authority');
      expectedStateRoot = account.beaconStateRoot; expectedHeaderRoot = nativeHeader.root;
      assert.equal(account.slot, targetSlot);
      assert.equal(io.normalized(account.account), io.normalized(data.address));
      assert.equal(account.nativeSSZVerified, true); assert.equal(account.nativeAccountProofVerified, true);
      const requested = options.candidateIndex === undefined ? [] : [String(BigInt(options.candidateIndex))];
      const indices = [...new Set([...registry.map(value => value.index), ...requested])];
      const statePath = path.join(directory, 'state-witness.json');
      run(path.join(tools, 'export-state'), ['--state', path.join(captureDirectory, 'state.ssz'), '--config', path.join(captureDirectory, 'config.yml'),
        '--state-root', expectedStateRoot, '--indices', indices.join(','), '--output', statePath]);
      const state = io.read(statePath);
      assert.equal(state.slot, targetSlot); assert.equal(state.stateRoot, expectedStateRoot);
      const validators = registry.map((registered, i) => {
        const value = state.validators[i]; assert.equal(value.index, registered.index);
        assert(hexEqual(value.publicKeyRoot, registered.publicKeyRoot), 'Canonical registry key mismatch');
        return witness(value);
      });
      const priorCompact = fs.readdirSync(path.join(io.runtime, 'checkpoints')).map(name => path.join(io.runtime, 'checkpoints', name, 'flow-witness.json'))
        .filter(value => fs.existsSync(value) && path.dirname(value) !== directory)
        .map(file => ({ file, value: io.read(file) }))
        .filter(item => item.value.blocks.length && number(item.value.blocks[0].header.slot) > number(stopSlot) &&
          number(item.value.blocks[0].header.slot) < number(targetSlot) && hexEqual(item.value.stopRoot, stopRoot))
        .sort((a, b) => Number(number(b.value.blocks[0].header.slot) - number(a.value.blocks[0].header.slot)))[0];
      const capturedStopRoot = priorCompact ? priorCompact.value.startRoot : stopRoot;
      const flowDirectory = path.join(directory, 'flow');
      if (!fs.existsSync(path.join(flowDirectory, 'flow-manifest.json'))) {
        assert(!fs.existsSync(flowDirectory) || fs.readdirSync(flowDirectory).length === 0, 'Incomplete flow capture exists; inspect before retrying');
        const checkpointsDirectory = path.join(io.runtime, 'checkpoints');
        const cached = fs.readdirSync(checkpointsDirectory).map(name => path.join(checkpointsDirectory, name, 'flow'))
          .filter(value => value !== flowDirectory && fs.existsSync(path.join(value, 'flow-manifest.json')))
          .sort((a, b) => fs.statSync(path.join(b, 'flow-manifest.json')).mtimeMs - fs.statSync(path.join(a, 'flow-manifest.json')).mtimeMs).slice(0, 3);
        run('python3', [path.join(io.root, 'native/proofs/capture-flow.py'), '--network', path.join(io.networkRuntime, 'network.json'),
          '--start-root', expectedHeaderRoot, '--stop-root', capturedStopRoot, '--max-blocks', String(options.maxBlocks || 4096), '--output-dir', flowDirectory,
          ...cached.flatMap(value => ['--cache-dir', value])], path.join(directory, 'capture-flow.log'));
      }
      const flowPath = path.join(directory, 'flow-witness.json');
      run(path.join(tools, 'export-flow'), ['--capture-dir', flowDirectory, '--output', flowPath,
        ...(priorCompact ? ['--stop-root', stopRoot, '--witness-cache', priorCompact.file] : [])]);
      const flows = io.read(flowPath);
      assert.equal(flows.startRoot, expectedHeaderRoot); assert.equal(flows.stopRoot, stopRoot);
      assert.equal(flows.nativeRootVerified, true);
      results.target = { slot: targetSlot, stateRoot: expectedStateRoot, headerRoot: expectedHeaderRoot,
        executionBlock: account.executionBlock, depositIndex: account.executionDepositIndex, cash: account.balanceBaseUnits,
        previousSlot: stopSlot, previousHeaderRoot: stopRoot, registryCount: String(registryCount), occupiedBlocks: flows.blocks.length,
        stateWitness: statePath, cashWitness: cashPath, flowWitness: flowPath };
      io.write(path.join(directory, 'inputs.json'), results.target);
      if (options.captureOnly) { results.captureOnly = true; io.write(reportPath, results); return results; }
      const prefix = `portfolio-${targetSlot}-${expectedHeaderRoot.slice(2, 18)}-${registryCount}`;
      const checkpointArgs = cash(account, account.accountProof);
      if (!pending.active) {
        await fresh(targetSlot);
        const validCall = { from: c.account(c.defaultActor === undefined ? 2 : c.defaultActor).address, to: data.portfolioAddress, data: portfolio.methods.beginCheckpoint(checkpointArgs).encodeABI() };
        await c.rpc('qrl_call', [validCall, 'latest']);
        if (options.diagnosticCalls !== false) {
          const invalid = structuredClone(checkpointArgs); invalid.executionStateRoot = flipped(invalid.executionStateRoot);
          let rejected = false; let reason;
          try { await c.rpc('qrl_call', [{ ...validCall, data: portfolio.methods.beginCheckpoint(invalid).encodeABI() }, 'latest']); }
          catch (error) { reason = error.message; rejected = /invalid SSZ proof/.test(reason); }
          assert(rejected, `Wrong finalized root did not produce expected native rejection: ${reason}`);
          results.diagnosticCalls.push({ name: 'forged execution state root', execution: 'qrl_call', rejected: true, mined: false, reason });
          assert.equal(String(await portfolio.methods.snapshotId().call()), beforeId);
        }
        await send(`${prefix}-begin`, data.portfolioAddress, portfolio.methods.beginCheckpoint(checkpointArgs));
        pending = progress(await portfolio.methods.checkpointProgress().call());
        assert.equal(pending.slot, targetSlot); assert.equal(pending.registryCount, String(registryCount));
      }
      const entries = [];
      for (let start = Number(pending.validatorCursor); start < validators.length; start += 4) entries.push({ name: `${prefix}-validators-${start}`,
        to: data.portfolioAddress, data: portfolio.methods.appendValidators(validators.slice(start, start + 4)).encodeABI() });
      let first = flows.blocks.length;
      if (!hexEqual(pending.nextHeaderRoot, stopRoot)) {
        first = flows.blocks.findIndex(value => hexEqual(headerRoot(value.header), pending.nextHeaderRoot));
        assert(first >= 0, 'Staged ancestry cursor absent from complete captured interval');
      }
      const blockGroups = chunks(flows.blocks.slice(first), 4);
      // Pack at most three existing verifier calls. Deposit-heavy blocks can
      // expand calldata, so shrink groups until the signed native size fits.
      let groupOffset = 0;
      while (groupOffset < blockGroups.length) {
        let count = Math.min(3, blockGroups.length - groupOffset);
        let encoded;
        while (count > 0) {
          const finish = groupOffset + count === blockGroups.length;
          encoded = executor.methods.appendAndSettle(blockGroups.slice(groupOffset, groupOffset + count), finish).encodeABI();
          if ((encoded.length - 2) / 2 <= 120000) break;
          count--;
        }
        assert(count > 0, 'One four-block group exceeds the native calldata bound; export smaller bounded groups');
        entries.push({ name: `${prefix}-executor-blocks-${first + groupOffset * 4}`, to: executorAddress, data: encoded });
        groupOffset += count;
      }
      if (blockGroups.length === 0) entries.push({ name: `${prefix}-executor-finish`, to: executorAddress,
        data: executor.methods.appendAndSettle([], true).encodeABI() });
      results.mechanicalExecutor = { address: executorAddress, transactions: entries.length,
        maximumCalldataBytes: Math.max(...entries.map(entry => (entry.data.length - 2) / 2)),
        finalizationAndLedgerStagingAtomic: true };
      for (const batch of chunks(entries, 64)) {
        await fresh(targetSlot);
        const receipts = await c.sendBatch(batch, 6000000n);
        receipts.forEach((receipt, i) => results.receipts.push({ name: batch[i].name, transactionHash: receipt.transactionHash,
          blockNumber: String(BigInt(receipt.blockNumber)), gasUsed: String(BigInt(receipt.gasUsed)) }));
      }
      pending = progress(await portfolio.methods.checkpointProgress().call());
      assert.equal(pending.active, false, 'Atomic executor did not finalize the complete portfolio');
      const committed = snapshot(await portfolio.methods.latestSnapshot().call());
      assert.equal(committed.slot, targetSlot); assert.equal(committed.stateRoot, expectedStateRoot);
      results.snapshot = committed;
    } else {
      assert.equal(targetSlot, stopSlot, 'Finality cannot move behind accepted portfolio');
      results.snapshot = before;
      const inputsPath = path.join(directory, 'inputs.json');
      if (fs.existsSync(inputsPath)) results.target = io.read(inputsPath);
      if (options.candidateIndex !== undefined) {
        const captureDirectory = path.join(directory, 'cash');
        assert(fs.existsSync(path.join(captureDirectory, 'state.ssz')), 'Settled state capture is unavailable for candidate export');
        const indices = [...new Set([...registry.map(value => value.index), String(BigInt(options.candidateIndex))])];
        const statePath = path.join(directory, 'state-witness.json');
        run(path.join(tools, 'export-state'), ['--state', path.join(captureDirectory, 'state.ssz'), '--config', path.join(captureDirectory, 'config.yml'),
          '--state-root', before.stateRoot, '--indices', indices.join(','), '--output', statePath]);
        results.target = { ...results.target, stateWitness: statePath };
      }
    }
    if (options.captureOnly) { results.captureOnly = true; io.write(reportPath, results); return results; }
    const id = String(await portfolio.methods.snapshotId().call());
    if (number(await pool.methods.lastCheckpointId().call()) < number(id)) {
      await fresh(results.snapshot.slot);
      await send(`checkpoint-ledger-${id}-settle`, data.address, pool.methods.settleCheckpoint());
    }
    await finishLedgerStage();
    results.pool = { address: data.address, appliedSlot: String(await pool.methods.appliedSlot().call()),
      snapshotId: String(await pool.methods.lastCheckpointId().call()), stage: String(await pool.methods.stage().call()),
      riskAssets: String(await pool.methods.riskAssets().call()), pending: String(await pool.methods.pendingTotal().call()),
      claimReserve: String(await pool.methods.claimReserve().call()), feeReserve: String(await pool.methods.feeReserve().call()),
      queueHead: String(await pool.methods.queueHead().call()), requestCount: String(await pool.methods.requestCount().call()) };
    results.completedAt = new Date().toISOString(); results.ageAtCompletion = String((await nowSlot()) - number(results.snapshot.slot));
    io.write(reportPath, results); io.write(path.join(io.runtime, 'latest-checkpoint.json'), results);
    return results;
  } catch (error) { results.error = error.message; results.stoppedAt = new Date().toISOString(); io.write(reportPath, results); throw error; }
}

if (require.main === module) {
  const args = process.argv.slice(2); const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--capture-only') options.captureOnly = true;
    else if (args[i] === '--candidate-index') {
      assert(args[i + 1] && /^\d+$/.test(args[i + 1]), 'Canonical validator index required');
      options.candidateIndex = args[++i];
    } else throw new Error(`Unknown checkpoint argument: ${args[i]}`);
  }
  tx.locked(async () => { const result = await checkpoint(await tx.context(), options); console.log(tx.json(result)); })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { checkpoint, snapshot, progress, ensureProofTools };
