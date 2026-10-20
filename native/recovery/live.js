// Real local recovery-timeout regression. Uses isolated public fixture actors4/5.
// No validator signing key, native deposit, main-graph mutation or state shortcut.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const tx = require('./transactions');
const { header, headerRoot, proposalId, votes } = require('../lifecycle/finality-codec');
const { checkpoint, ensureProofTools } = require('../lifecycle/checkpoint');
const UNIT = 10n ** 18n;
const graphFile = path.join(tx.runtime, 'pool.json');
const reportFile = path.join(tx.runtime, 'report.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (file, args) => execFileSync(file, args, { cwd: tx.root, encoding: 'utf8', maxBuffer: 4 << 20 });

async function beacon(c, route) {
  const response = await fetch(c.network.beaconUrl + route, { redirect: 'error' });
  assert(response.ok, `Beacon read ${route} failed`);
  return (await response.json()).data;
}
function capture(c, bootstrap, attested) {
  const directory = path.join(tx.runtime, 'certificates', `bootstrap-${bootstrap}${attested === undefined ? '' : `-attested-${attested}`}`);
  const witnessPath = path.join(directory, 'witness.json');
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(witnessPath)) {
    const args = ['native/proofs/capture-finality.py', '--network', path.join(tx.networkRuntime, 'network.json'),
      '--output-dir', directory, '--bootstrap-slot', String(bootstrap),
      ...(attested === undefined ? ['--bootstrap-only'] : ['--attested-slots', String(attested), '--allow-unfinalized-updates'])];
    fs.writeFileSync(path.join(directory, 'capture.log'), run('python3', args));
    fs.writeFileSync(path.join(directory, 'verification.log'), run(path.join(tx.networkRuntime, 'bin/analyze-finality'), ['-capture-dir', directory, '-output', witnessPath]));
  }
  const witness = tx.read(witnessPath);
  assert.equal(witness.qrysmCommit, '3b816311ac3e86b7a7af40a062ae290318554f7a');
  assert.equal(witness.genesisValidatorsRoot, c.network.beaconGenesis.genesis_validators_root);
  for (const item of witness.updates) {
    assert(item.nativeSignatureVerification);
    assert.equal(headerRoot(header(item.attestedHeader)), item.attestedRoot);
    assert.equal(headerRoot(header(item.finalizedHeader)), item.finalizedRoot);
  }
  return { witness, witnessPath };
}

function freeze(c) {
  const manifest = tx.read(path.join(tx.root, 'build/native/manifest.json'));
  assert.equal(manifest.compiler.hyperionCommit, 'cee9d335984c139c1dc0b0e84ec13290031ea4b1');
  for (const [name, expected] of Object.entries(manifest.sourceHashes)) {
    assert.equal(tx.hash(fs.readFileSync(path.join(tx.root, 'native/contracts', name))), expected, `Source ${name} changed since qualification`);
  }
  const names = ['NativeFinalityVerifier', 'NativePortfolioVerifier', 'NativeValidatorGate', 'NativeQrlPool', 'NativeCheckpointExecutor'];
  fs.mkdirSync(path.join(tx.runtime, 'artifacts'), { recursive: true });
  for (const name of names) {
    const source = path.join(tx.root, name === 'NativeCheckpointExecutor' ? 'build/native-checkpoint-executor' : 'build/native');
    for (const suffix of ['abi', 'bin', 'bin-runtime']) {
      const from = path.join(source, `${name}.${suffix}`); const to = path.join(tx.runtime, 'artifacts', `${name}.${suffix}`);
      if (fs.existsSync(to)) assert.equal(tx.hash(fs.readFileSync(to)), tx.hash(fs.readFileSync(from)), 'Frozen recovery graph artifact changed');
      else fs.copyFileSync(from, to);
    }
    assert(fs.readFileSync(path.join(source, `${name}.bin-runtime`), 'utf8').trim().length / 2 <= 24576);
  }
  assert(c.artifact('NativeQrlPool').abi.some(item => item.name === 'poolStatus'), 'Qualified pool-timeout source required');
  return { compilerManifest: manifest, sourceHashes: manifest.sourceHashes,
    artifactHashes: Object.fromEntries(names.slice(0, 4).map(name => [name, tx.hash(c.artifact(name).bytecode)])) };
}

async function deploy(c) {
  let data = fs.existsSync(graphFile) ? tx.read(graphFile) : null;
  if (!data) {
    const artifacts = freeze(c);
    const finalized = await beacon(c, '/qrl/v1/beacon/headers/finalized');
    const source = capture(c, finalized.header.message.slot);
    data = { chainId: 3151916, genesis: c.network.executionGenesis, beaconGenesis: c.network.beaconGenesis,
      ...artifacts, initialWitness: source.witnessPath, trustAnchor: { slot: finalized.header.message.slot, root: finalized.root,
        boundary: 'Explicit initial trust selection from the guarded disposable native chain.' },
      actor: 4, depositor: c.account(4).address, recoveryCaller: c.account(5).address, maxAgeSlots: 64, recoveryWindowSlots: 96 };
    tx.write(graphFile, data);
  }
  assert.equal(data.genesis, c.network.executionGenesis);
  const witness = tx.read(data.initialWitness); const bootstrap = header(witness.bootstrapHeader);
  if (!data.finalityAddress) {
    data.finalityAddress = (await c.deploy('recovery-deploy-finality', 'NativeFinalityVerifier', [bootstrap, headerRoot(bootstrap),
      witness.bootstrapCurrentCommittee.root, witness.bootstrapCurrentCommittee.branch,
      witness.bootstrapNextCommittee.root, witness.bootstrapNextCommittee.branch, witness.genesisValidatorsRoot,
      c.network.beaconGenesis.genesis_fork_version, c.network.beaconGenesis.genesis_time, '3', '8', '64', '96'])).contractAddress;
    tx.write(graphFile, data);
  }
  if (!data.predictedPool) {
    const nonce = BigInt(await c.rpc('qrl_getTransactionCount', [c.account(4).address, 'pending']));
    data.predictedGate = c.predict(c.account(4).address, nonce + 1n); data.predictedPool = c.predict(c.account(4).address, nonce + 2n); tx.write(graphFile, data);
  }
  if (!data.portfolioAddress) {
    data.portfolioAddress = (await c.deploy('recovery-deploy-portfolio', 'NativePortfolioVerifier', [data.finalityAddress, data.predictedPool, data.predictedGate])).contractAddress; tx.write(graphFile, data);
  }
  if (!data.gateAddress) {
    data.gateAddress = (await c.deploy('recovery-deploy-gate', 'NativeValidatorGate', [data.finalityAddress, data.portfolioAddress, data.predictedPool,
      c.network.canonicalDeposit.address, c.network.beaconGenesis.genesis_validators_root, c.network.beaconGenesis.genesis_fork_version, c.account(4).address])).contractAddress;
    assert.equal(tx.normalized(data.gateAddress), tx.normalized(data.predictedGate)); tx.write(graphFile, data);
  }
  if (!data.address) {
    data.address = (await c.deploy('recovery-deploy-pool', 'NativeQrlPool', [data.finalityAddress, data.portfolioAddress, data.gateAddress, c.account(4).address, UNIT])).contractAddress;
    assert.equal(tx.normalized(data.address), tx.normalized(data.predictedPool)); tx.write(graphFile, data);
  }
  if (!data.executorAddress) {
    data.executorAddress = (await c.deploy('recovery-deploy-executor', 'NativeCheckpointExecutor', [data.portfolioAddress, data.address])).contractAddress;
    tx.write(graphFile, data);
    tx.write(path.join(tx.runtime, 'checkpoint-executor.json'), { address: data.executorAddress, portfolioAddress: data.portfolioAddress, poolAddress: data.address });
  }
  return data;
}

async function update(c, data) {
  const finality = c.contract('NativeFinalityVerifier', data.finalityAddress);
  const accepted = Number(await finality.methods.finalizedSlot().call());
  const period = Number(await finality.methods.currentPeriod().call());
  const head = Number((await beacon(c, '/qrl/v1/beacon/headers/head')).header.message.slot);
  const latest = Math.min(Math.floor((head - 1) / 8) * 8, (period + 2) * 64 - 8);
  for (let attested = latest; attested > Math.max(accepted, latest - 64); attested -= 8) {
    const check = await beacon(c, `/qrl/v1/beacon/states/${attested}/finality_checkpoints`);
    const point = await beacon(c, `/qrl/v1/beacon/headers/${check.finalized.root}`);
    const slot = Number(point.header.message.slot);
    if (slot <= accepted || Math.floor(slot / 64) !== Math.floor((attested + 1) / 64)) continue;
    const { witness } = capture(c, accepted, attested);
    assert.equal(witness.updates.length, 1); const value = witness.updates[0];
    const args = [header(value.attestedHeader), header(value.finalizedHeader), value.finalityBranch,
      value.finalizedNextCommittee.root, value.finalizedNextCommittee.branch];
    const id = proposalId(args); const prefix = `recovery-finality-${id}`;
    await c.send(`${prefix}-begin`, data.finalityAddress, finality.methods.beginUpdate(...args).encodeABI());
    const selected = votes(value).slice(0, 86); const calls = [];
    for (let i = 0; i < selected.length; i += 12) calls.push({ name: `${prefix}-seats-${i}`, to: data.finalityAddress,
      data: finality.methods.submit(id, selected.slice(i, i + 12)).encodeABI() });
    // Twelve uncached ML-DSA keys can consume over 6.3M gas on the native VM.
    // Preserve the qualified cold-key margin even when a previous update warmed keys.
    await c.sendBatch(calls, 8500000n);
    await c.send(`${prefix}-finalize`, data.finalityAddress, finality.methods.finalize(id).encodeABI());
    assert.equal(String(await finality.methods.finalizedSlot().call()), value.finalizedHeader.slot);
    return true;
  }
  return false;
}

async function main() {
  assert.equal(process.argv[2], '--execute', 'Explicit --execute required for isolated local transactions');
  ensureProofTools();
  const c = await tx.context(); const data = await deploy(c);
  const pool = c.contract('NativeQrlPool', data.address); const finality = c.contract('NativeFinalityVerifier', data.finalityAddress);
  assert.equal(String(await pool.methods.poolRecoveryWindowSlots().call()), '96');
  if (!data.deposit) {
    await update(c, data);
    const receipt = await c.send('recovery-deposit-ten', data.address, pool.methods.deposit().encodeABI(), 10n * UNIT);
    data.deposit = { transactionHash: receipt.transactionHash, blockNumber: BigInt(receipt.blockNumber).toString(), amount: String(10n * UNIT) }; tx.write(graphFile, data);
  }
  const wallDeadline = Date.now() + 15 * 60 * 1000;
  while (!data.appliedSlot) {
    assert(Date.now() < wallDeadline, 'Bounded recovery setup deadline');
    await update(c, data);
    const accepted = Number(await finality.methods.finalizedSlot().call());
    if (accepted > Number(data.deposit.blockNumber)) {
      const result = await checkpoint(c, { runtime: tx.runtime, diagnosticCalls: false });
      assert.equal(result.pool.riskAssets, String(10n * UNIT)); assert.equal(result.pool.pending, '0');
      data.appliedSlot = result.pool.appliedSlot; data.poolDeadline = String(await pool.methods.poolRecoveryDeadlineSlot().call()); tx.write(graphFile, data); break;
    }
    await sleep(3000);
  }
  while (String(await pool.methods.poolStatus().call()) !== '2') {
    assert(Date.now() < wallDeadline, 'Bounded recovery observation deadline');
    const head = Number((await beacon(c, '/qrl/v1/beacon/headers/head')).header.message.slot);
    const accepted = Number(await finality.methods.finalizedSlot().call());
    if (head - accepted >= 32) await update(c, data);
    console.log(JSON.stringify({ poolDeadline: data.poolDeadline, appliedSlot: data.appliedSlot, headSlot: head,
      finalizedSlot: String(await finality.methods.finalizedSlot().call()), finalityStatus: String(await finality.methods.status().call()), poolStatus: String(await pool.methods.poolStatus().call()) }));
    await sleep(6000);
  }
  if (String(await finality.methods.status().call()) !== '0') await update(c, data);
  assert.equal(String(await finality.methods.status().call()), '0', 'Global finality must remain healthy at pool timeout');
  assert.equal(String(await pool.methods.appliedSlot().call()), data.appliedSlot);
  assert.equal(String(await pool.methods.poolStatus().call()), '2');
  // Leave an observable healthy-finality/expired-pool state for the read-only UI.
  const headBeforeUI = Number((await beacon(c, '/qrl/v1/beacon/headers/head')).header.message.slot);
  if (headBeforeUI - Number(await finality.methods.finalizedSlot().call()) > 32) await update(c, data);
  const ui = { observedAt: new Date().toISOString(), address: data.address, finalityAddress: data.finalityAddress,
    appliedSlot: data.appliedSlot, poolDeadline: data.poolDeadline, poolStatus: String(await pool.methods.poolStatus().call()),
    finalityStatus: String(await finality.methods.status().call()), observationSeconds: 60, principalQrl: '10' };
  assert.equal(ui.poolStatus, '2'); assert.equal(ui.finalityStatus, '0');
  tx.write(path.join(tx.runtime, 'ui-ready.json'), ui); console.log(JSON.stringify({ uiReady: true, ...ui }));
  await sleep(60000);
  if (String(await finality.methods.status().call()) !== '0') await update(c, data);
  const begin = await c.send('recovery-independent-begin', data.address, pool.methods.beginRecovery().encodeABI(), 0n, 5);
  assert.equal(String(await finality.methods.status().call({}, begin.blockNumber)), '0');
  const recovering = { observedAt: new Date().toISOString(), address: data.address,
    transactionHash: begin.transactionHash, blockNumber: String(BigInt(begin.blockNumber)),
    observationSeconds: 20, principalQrl: '10' };
  tx.write(path.join(tx.runtime, 'ui-recovering.json'), recovering);
  console.log(JSON.stringify({ uiRecovering: true, ...recovering }));
  await sleep(20000);
  const balanceBefore = BigInt(await c.rpc('qrl_getBalance', [c.account(4).address, 'latest']));
  const claim = await c.send('recovery-claim-ten', data.address, pool.methods.claimRecovery().encodeABI());
  const balanceAfter = BigInt(await c.rpc('qrl_getBalance', [c.account(4).address, claim.blockNumber]));
  const paidGas = BigInt(claim.gasUsed) * BigInt(claim.effectiveGasPrice);
  assert.equal(balanceAfter + paidGas - balanceBefore, 10n * UNIT);
  assert.equal(BigInt(await c.rpc('qrl_getBalance', [data.address, 'latest'])), 0n);
  assert.equal(String(await pool.methods.feeReserve().call()), '0');
  assert.equal(String(await pool.methods.totalFeesPaid().call()), '0');
  let repeatedRejected = false;
  try { await c.rpc('qrl_call', [{ from: c.account(4).address, to: data.address, data: pool.methods.claimRecovery().encodeABI() }, 'latest']); } catch (error) { repeatedRejected = /no recovered cash/.test(error.message); }
  assert(repeatedRejected, 'Repeated recovery claim must have no entitlement');
  const report = { completedAt: new Date().toISOString(), chainId: 3151916, executionGenesis: c.network.executionGenesis,
    pool: data.address, finality: data.finalityAddress, appliedSlot: data.appliedSlot, poolDeadline: data.poolDeadline,
    healthyFinalizedSlot: String(await finality.methods.finalizedSlot().call({}, begin.blockNumber)), globalFinalityStatusAtRecovery: '0',
    recoveryCaller: c.account(5).address, depositor: c.account(4).address, beginRecoveryTransaction: begin.transactionHash,
    principalClaimTransaction: claim.transactionHash, principalReturnedBaseUnits: String(10n * UNIT), earnedFees: '0', remainingPoolCash: '0',
    repeatedClaimRejectedByCall: true, validatorSigningKeyAccess: false, syntheticStateUsed: false,
    boundary: 'Actual isolated graph, genuine native certificates, complete on-chain cash/flow proofs and mined recovery transactions. Initial checkpoint selection remains explicit bootstrap trust.' };
  tx.write(reportFile, report); console.log(tx.json(report));
}
if (require.main === module) tx.locked(main).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { update, deploy, main };
