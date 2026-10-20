// Native lifecycle transactions against the immutable fresh fixture bindings.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { context, locked, runtime, root, read, write, normalized, hash } = require('./transactions');
const { header, headerRoot, proposalId, votes } = require('./finality-codec');
const UNIT = 10n ** 18n;
const MAX_AMOUNT = (1n << 256n) - 1n;
const poolPath = path.join(runtime, 'pool.json');
const deployPath = path.join(runtime, 'deployment.json');

function witnessFile(file, network, allowBootstrapOnly = false) {
  const witness = read(path.resolve(file));
  assert.equal(witness.qrysmCommit, '3b816311ac3e86b7a7af40a062ae290318554f7a');
  assert.equal(witness.genesisValidatorsRoot, network.beaconGenesis.genesis_validators_root);
  assert(witness.updates.length >= (allowBootstrapOnly ? 0 : 1) && witness.updates.length <= 4);
  for (const update of witness.updates) {
    assert.equal(update.nativeSignatureVerification, true);
    assert.equal(headerRoot(header(update.attestedHeader)), update.attestedRoot);
    assert.equal(headerRoot(header(update.finalizedHeader)), update.finalizedRoot);
    assert.equal(BigInt(update.signatureSlot), BigInt(update.attestedHeader.slot) + 1n);
  }
  return witness;
}

async function applyUpdates(c, address, witness) {
  const verifier = c.contract('NativeFinalityVerifier', address);
  for (const update of witness.updates) {
    if (BigInt(update.finalizedHeader.slot) <= BigInt(await verifier.methods.finalizedSlot().call())) continue;
    const args = [header(update.attestedHeader), header(update.finalizedHeader), update.finalityBranch,
      update.finalizedNextCommittee.root, update.finalizedNextCommittee.branch];
    const id = proposalId(args);
    const prefix = `finality-${id}`;
    await c.send(`${prefix}-begin`, address, verifier.methods.beginUpdate(...args).encodeABI());
    const selected = votes(update).slice(0, 86);
    const batch = [];
    for (let start = 0; start < selected.length; start += 12) {
      batch.push({ name: `${prefix}-seats-${start}`, to: address,
        data: verifier.methods.submit(id, selected.slice(start, start + 12)).encodeABI() });
    }
    await c.sendBatch(batch);
    await c.send(`${prefix}-finalize`, address, verifier.methods.finalize(id).encodeABI());
    assert.equal(String(await verifier.methods.finalizedSlot().call()), update.finalizedHeader.slot);
    assert.equal(await verifier.methods.finalizedStateRoot().call(), update.finalizedHeader.state_root);
  }
}

function depositData(amount) {
  const entry = read(path.join(runtime, 'deposits', `deposit-${amount}.json`))[0];
  return { publicKey: entry.pubkey, randaoCommitment: entry.randao_commitment,
    signature: entry.signature, dataRoot: entry.deposit_data_root };
}

async function admit(c, data, stateFile) {
  assert(stateFile, 'Native state witness at the already settled checkpoint required');
  const state = read(path.resolve(stateFile));
  const preparation = read(path.join(runtime, 'prepare-exit-result.json'));
  const exitBytes = fs.readFileSync(preparation.file);
  const exit = JSON.parse(exitBytes);
  const fixture = read(path.join(runtime, 'fixture.json'));
  assert.equal(hash(exitBytes), preparation.sha256, 'Preserve the original public exit');
  assert.equal(preparation.chainId, 3151916);
  assert.deepEqual(preparation.beaconGenesis, c.network.beaconGenesis);
  assert.equal(preparation.pooledFundingAlreadyRecorded, false, 'Public exit must be available before pooled funding');
  assert.equal(exit.message.epoch, '0', 'Gate stores the exact epoch-zero public exit');
  assert.equal(exit.message.validator_index, preparation.validatorIndex);
  const source = state.validators.find(item => item.index === preparation.validatorIndex);
  assert(source, 'Canonical candidate proof must be included in this native state witness');
  assert.equal(normalized(source.publicKey), normalized(fixture.validatorPubkey));
  assert.equal(normalized(source.withdrawalRecipient), normalized(data.address));
  assert.equal(source.balanceShor, '2000000000000');
  const gate = c.contract('NativeValidatorGate', data.gateAddress);
  const pool = c.contract('NativeQrlPool', data.address);
  const finality = c.contract('NativeFinalityVerifier', data.finalityAddress);
  const method = c.artifact('NativeValidatorGate').abi.find(item => item.name === 'admitAndFundValidator');
  const witness = Object.fromEntries(method.inputs[0].components.map(item => [item.name, source[item.name]]));
  const transactionName = `fund-validator-${source.index}-38000`;
  const calldata = gate.methods.admitAndFundValidator(witness, depositData(38000), exit.signature).encodeABI();
  const intentPath = path.join(runtime, `admission-${source.index}.json`);
  const journal = path.join(runtime, 'submitted-transactions.jsonl');
  const submitted = fs.existsSync(journal) && fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    .find(item => item.name === transactionName);
  let intent = fs.existsSync(intentPath) ? read(intentPath) : null;
  if (submitted) {
    assert(intent, 'Preserved funding intent required to reconcile a previously broadcast transaction');
    assert.equal(intent.calldataSha256, hash(calldata), 'Retry must preserve the original funding proof and public exit');
  } else {
    assert.equal(String(await finality.methods.finalizedSlot().call()), state.slot);
    assert.equal(await finality.methods.finalizedStateRoot().call(), state.stateRoot);
    assert.equal(String(await pool.methods.appliedSlot().call()), state.slot);
    assert.equal(await pool.methods.appliedStateRoot().call(), state.stateRoot);
    assert.equal(String(await pool.methods.stage().call()), '0');
    assert.equal(String(await pool.methods.pendingTotal().call()), '0');
    const before = await c.rpc('qrl_getBlockByNumber', ['latest', false]);
    const operator = await pool.methods.getPosition(c.account(2).address).call({}, before.number);
    intent = { chainId: 3151916, genesis: c.network.executionGenesis, calldataSha256: hash(calldata),
      beforeBlock: before.number, beforeHash: before.hash,
      cashBefore: String(BigInt(await c.rpc('qrl_getBalance', [data.address, before.number]))),
      riskBefore: String(await pool.methods.riskAssets().call({}, before.number)),
      totalSharesBefore: String(await pool.methods.totalShares().call({}, before.number)),
      operatorSharesBefore: String(operator.shares), operatorPrincipalBefore: String(operator.principalBasis) };
    write(intentPath, intent);
  }
  assert.equal(intent.genesis, c.network.executionGenesis);
  assert.equal((await c.rpc('qrl_getBlockByNumber', [intent.beforeBlock, false])).hash, intent.beforeHash);
  const cashBefore = BigInt(intent.cashBefore);
  const riskBefore = BigInt(intent.riskBefore);
  const receipt = await c.send(transactionName, data.gateAddress, calldata);
  const stored = await gate.methods.storedExit(source.index).call({}, receipt.blockNumber);
  assert.equal(stored.funded, true);
  assert.equal(stored.epoch, 0n);
  assert.equal(stored.signature, exit.signature);
  const cashAfter = BigInt(await c.rpc('qrl_getBalance', [data.address, receipt.blockNumber]));
  const riskAfter = BigInt(await pool.methods.riskAssets().call({}, receipt.blockNumber));
  const operatorAfter = await pool.methods.getPosition(c.account(2).address).call({}, receipt.blockNumber);
  if (!data.pooledFunding) {
    assert.equal(cashBefore - cashAfter, 38000n * UNIT);
    assert.equal(riskAfter - riskBefore, 2000n * UNIT);
    assert.equal(BigInt(operatorAfter.principalBasis) - BigInt(intent.operatorPrincipalBefore), 2000n * UNIT);
    const priorShares = BigInt(intent.totalSharesBefore);
    const expectedShares = priorShares === 0n ? 2000n * UNIT * BigInt(await pool.methods.SHARE_SCALE().call()) :
      2000n * UNIT * priorShares / riskBefore;
    assert.equal(BigInt(operatorAfter.shares) - BigInt(intent.operatorSharesBefore), expectedShares);
    data.pooledFunding = { recordedAt: new Date().toISOString(), transactionHash: receipt.transactionHash,
      blockNumber: String(BigInt(receipt.blockNumber)), validatorIndex: source.index,
      settledSlot: state.slot, settledStateRoot: state.stateRoot, nativeStateWitnessSha256: hash(fs.readFileSync(stateFile)),
      publicExitSha256: preparation.sha256, publicExitAvailableAt: preparation.preparedAt,
      publicExitStoredOnChain: true, topUpQrl: '38000', adoptedBootstrapPrincipalQrl: '2000',
      cashBefore, cashAfter, riskBefore, riskAfter, adoptedInternalShares: String(expectedShares),
      operatorPrincipalBasis: String(operatorAfter.principalBasis),
      operatorPositionValue: String(await pool.methods.positionValue(c.account(2).address).call({}, receipt.blockNumber)) };
    write(poolPath, data);
  }
}

async function requestAll(c, data, pool) {
  assert(data.pooledFunding, 'Require actual admitted native validator');
  const entries = data.withdrawalRequests || [];
  for (const actor of [0, 3, 2]) {
    const name = `user-${actor}-request-full-exit`;
    const receipt = await c.send(name, data.address, pool.methods.requestWithdrawal(MAX_AMOUNT).encodeABI(), 0n, actor);
    if (!entries.some(item => item.actor === actor)) {
      entries.push({ actor, beneficiary: c.account(actor).address, transactionHash: receipt.transactionHash,
        blockNumber: String(BigInt(receipt.blockNumber)), amount: String(MAX_AMOUNT), kind: 'full-position-at-next-finalized-cutoff' });
      data.withdrawalRequests = entries;
      write(poolPath, data);
    }
  }
  const gate = c.contract('NativeValidatorGate', data.gateAddress);
  const receipt = await c.send('request-canonical-validator-exit', data.gateAddress, gate.methods.requestNextExit().encodeABI());
  const stored = await gate.methods.storedExit(data.pooledFunding.validatorIndex).call();
  assert.equal(stored.funded, true);
  assert.equal(stored.requested, true);
  data.exitRequested = { transactionHash: receipt.transactionHash, blockNumber: String(BigInt(receipt.blockNumber)),
    validatorIndex: data.pooledFunding.validatorIndex, publicExitOnly: true };
  write(poolPath, data);
}

async function main() {
  const command = process.argv[2];
  assert(['deploy', 'update', 'bootstrap', 'deposit-users', 'admit', 'request-all', 'claim-all', 'status'].includes(command));
  const c = await context();
  if (command === 'deploy') {
    assert(process.argv[3], 'Fresh public certificate witness required');
    const witness = witnessFile(process.argv[3], c.network, true);
    const bootstrap = header(witness.bootstrapHeader);
    const artifacts = ['NativeFinalityVerifier', 'NativePortfolioVerifier', 'NativeValidatorGate', 'NativeQrlPool'];
    const compilerManifest = read(path.join(root, 'build/native/manifest.json'));
    assert.equal(compilerManifest.compiler.hyperionCommit, 'cee9d335984c139c1dc0b0e84ec13290031ea4b1');
    const compileStarted = Date.parse(compilerManifest.generatedAt);
    const sourceHashes = {};
    for (const file of fs.readdirSync(path.join(root, 'native/contracts')).filter(file => file.endsWith('.hyp'))) {
      const source = path.join(root, 'native/contracts', file);
      assert(fs.statSync(source).mtimeMs <= compileStarted, `Source ${file} changed after compilation began`);
      sourceHashes[file] = hash(fs.readFileSync(source));
    }
    const frozen = path.join(runtime, 'artifacts');
    fs.mkdirSync(frozen, { recursive: true });
    for (const name of artifacts) for (const suffix of ['abi', 'bin', 'bin-runtime']) {
      const source = path.join(root, 'build/native', `${name}.${suffix}`);
      assert(fs.statSync(source).mtimeMs >= compileStarted, `Artifact ${name}.${suffix} predates this compilation`);
      const destination = path.join(frozen, `${name}.${suffix}`);
      if (fs.existsSync(destination)) assert.equal(hash(fs.readFileSync(destination)), hash(fs.readFileSync(source)), 'Deployed artifact snapshot cannot be replaced');
      else fs.copyFileSync(source, destination);
    }
    const artifactHashes = Object.fromEntries(artifacts.map(name => [name, hash(c.artifact(name).bytecode)]));
    for (const name of artifacts) {
      const deployedCode = fs.readFileSync(path.join(root, 'build/native', `${name}.bin-runtime`), 'utf8').trim();
      assert(deployedCode.length / 2 <= 24576, `${name} exceeds the unmodified native code-size limit`);
    }
    const data = fs.existsSync(deployPath) ? read(deployPath) : {
      chainId: 3151916, genesis: c.network.executionGenesis, beaconGenesis: c.network.beaconGenesis,
      artifactHashes, sourceHashes, compilerManifest, witnessSha256: hash(fs.readFileSync(path.resolve(process.argv[3]))),
      trustAnchor: { slot: bootstrap.slot, root: headerRoot(bootstrap),
        scope: 'Independently selected local fixture checkpoint; RPC selection is an explicit bootstrap trust assumption.' },
      maxAgeSlots: 64, recoveryWindowSlots: 4096, operatorAddress: c.account(2).address,
      feeRecipient: c.account(1).address, users: [c.account(0).address, c.account(3).address]
    };
    assert.deepEqual(data.artifactHashes, artifactHashes, 'Freeze the deployed implementation artifacts');
    assert.equal(data.genesis, c.network.executionGenesis);
    assert.equal(data.witnessSha256, hash(fs.readFileSync(path.resolve(process.argv[3]))));
    write(deployPath, data);
    if (!data.finalityAddress) {
      const args = [bootstrap, headerRoot(bootstrap), witness.bootstrapCurrentCommittee.root,
        witness.bootstrapCurrentCommittee.branch, witness.bootstrapNextCommittee.root,
        witness.bootstrapNextCommittee.branch, witness.genesisValidatorsRoot,
        c.network.beaconGenesis.genesis_fork_version, c.network.beaconGenesis.genesis_time,
        '3', '8', '64', '4096'];
      data.finalityAddress = (await c.deploy('deploy-finality', 'NativeFinalityVerifier', args)).contractAddress;
      write(deployPath, data);
    }
    if (!data.predictedPool) {
      const nonce = BigInt(await c.rpc('qrl_getTransactionCount', [c.account(2).address, 'pending']));
      data.predictedGate = c.predict(c.account(2).address, nonce + 1n);
      data.predictedPool = c.predict(c.account(2).address, nonce + 2n);
      data.portfolioNonce = String(nonce);
      write(deployPath, data);
    }
    if (!data.portfolioAddress) {
      data.portfolioAddress = (await c.deploy('deploy-portfolio', 'NativePortfolioVerifier', [data.finalityAddress, data.predictedPool, data.predictedGate])).contractAddress;
      write(deployPath, data);
    }
    if (!data.gateAddress) {
      data.gateAddress = (await c.deploy('deploy-gate', 'NativeValidatorGate', [data.finalityAddress, data.portfolioAddress, data.predictedPool,
        c.network.canonicalDeposit.address, c.network.beaconGenesis.genesis_validators_root,
        c.network.beaconGenesis.genesis_fork_version, data.operatorAddress])).contractAddress;
      assert.equal(normalized(data.gateAddress), normalized(data.predictedGate));
      write(deployPath, data);
    }
    if (!data.address) {
      data.address = (await c.deploy('deploy-pool', 'NativeQrlPool', [data.finalityAddress, data.portfolioAddress, data.gateAddress, data.feeRecipient, UNIT])).contractAddress;
      assert.equal(normalized(data.address), normalized(data.predictedPool));
      write(deployPath, data);
    }
    for (const [name, address] of [['NativeQrlPool', data.address], ['NativePortfolioVerifier', data.portfolioAddress], ['NativeValidatorGate', data.gateAddress]]) {
      const contract = c.contract(name, address);
      assert.equal(normalized(await contract.methods.finality().call()), normalized(data.finalityAddress));
      if (name !== 'NativeQrlPool') assert.equal(normalized(await contract.methods.pool().call()), normalized(data.address));
      if (name === 'NativeValidatorGate') assert.equal(normalized(await contract.methods.validatorOperator().call()), normalized(data.operatorAddress));
    }
    write(poolPath, data);
    await applyUpdates(c, data.finalityAddress, witness);
    return;
  }
  const data = read(poolPath);
  assert.equal(data.genesis, c.network.executionGenesis);
  for (const [name, expected] of Object.entries(data.artifactHashes)) assert.equal(hash(c.artifact(name).bytecode), expected, 'Deployed artifact changed');
  if (command === 'update') return applyUpdates(c, data.finalityAddress, witnessFile(process.argv[3], c.network));
  const pool = c.contract('NativeQrlPool', data.address);
  if (command === 'admit') return admit(c, data, process.argv[3]);
  if (command === 'request-all') return requestAll(c, data, pool);
  if (command === 'claim-all') return require('./claims').claimAll(c, data, pool);
  if (command === 'bootstrap') {
    const fixture = read(path.join(runtime, 'fixture.json'));
    assert(fixture.depositBound && normalized(fixture.withdrawalRecipient) === normalized(data.address));
    const lookup = await fetch(`${c.network.beaconUrl}/qrl/v1/beacon/states/head/validators/${fixture.validatorPubkey}`, { redirect: 'error' });
    if (!data.bootstrap) assert.equal(lookup.status, 404, 'Fresh key must be absent before its bootstrap');
    const gate = c.contract('NativeValidatorGate', data.gateAddress);
    const receipt = await c.send('operator-bootstrap-2000', data.gateAddress, gate.methods.bootstrapValidator(depositData(2000)).encodeABI(), 2000n * UNIT);
    const head = await (await fetch(`${c.network.beaconUrl}/qrl/v1/beacon/headers/head`, { redirect: 'error' })).json();
    data.bootstrap = { transactionHash: receipt.transactionHash, blockNumber: String(BigInt(receipt.blockNumber)),
      beaconHeadSlot: head.data.header.message.slot, operatorContributionQrl: '2000',
      scope: 'Only operator preparation capital; pooled ledger credit occurs only at authenticated atomic admission.' };
    write(poolPath, data);
    return;
  }
  if (command === 'deposit-users') {
    const receipts = [];
    for (const [actor, amount] of [[0, 20000n], [3, 22000n]]) {
      const receipt = await c.send(`user-${actor}-deposit-${amount}`, data.address, pool.methods.deposit().encodeABI(), amount * UNIT, actor);
      receipts.push({ actor, amountQrl: String(amount), transactionHash: receipt.transactionHash, blockNumber: String(BigInt(receipt.blockNumber)) });
    }
    data.userDeposits = receipts;
    write(poolPath, data);
    return;
  }
  const finality = c.contract('NativeFinalityVerifier', data.finalityAddress);
  const portfolio = c.contract('NativePortfolioVerifier', data.portfolioAddress);
  console.log(JSON.stringify({ address: data.address, finalityStatus: String(await finality.methods.status().call()),
    finalizedSlot: String(await finality.methods.finalizedSlot().call()),
    currentPeriod: String(await finality.methods.currentPeriod().call()),
    trustDeadlineSlot: String(await finality.methods.trustDeadlineSlot().call()),
    cash: String(BigInt(await c.rpc('qrl_getBalance', [data.address, 'latest']))),
    riskAssets: String(await pool.methods.riskAssets().call()), pending: String(await pool.methods.pendingTotal().call()),
    appliedSlot: String(await pool.methods.appliedSlot().call()), stage: String(await pool.methods.stage().call()),
    registryMutationBlock: String(await portfolio.methods.lastRegistryMutationBlock().call()) }));
}
locked(main).catch(error => { console.error(error.message); process.exitCode = 1; });
