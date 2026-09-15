// Execute captured certificate updates only on the identified disposable local chain.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Web3 } = require('@theqrl/web3');
const { loadDeployerFromEnvironment } = require('../../scripts/lib/loadDeployer');
const { headerRoot, proposalId, votes } = require('./make-plan');

const root = path.resolve(__dirname, '../..');
const terminal = process.argv[2] === '--execute-terminal-finality';
const fresh = terminal || process.argv[2] === '--execute-fresh-finality';
const pipeline = terminal || process.argv.includes('--pipeline-votes');
const observeRecord = terminal || process.argv.includes('--observe-validator');
const chainId = terminal ? 3151915 : 3151914;
const fixtureAccount = terminal ? '2' : '0';
const runtime = path.join(root, `findings/native-qrl-finality/${terminal ? 'terminal-live' : pipeline ? 'pipeline-live' : fresh ? 'fresh-live' : 'live'}`);
const outputPath = path.join(runtime, 'live-run.json');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const hash = (value) => createHash('sha256').update(value).digest('hex');

function loopback(value) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, 'http:');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.username + parsed.password + parsed.search + parsed.hash, '');
  assert.equal(parsed.pathname, '/');
}

function validatorKeyRoot(value) {
  const key = Buffer.from(value.replace(/^0x/, ''), 'hex');
  assert.equal(key.length, 2592);
  let nodes = Array.from({ length: 128 }, (_, index) => index < 81 ? key.subarray(index * 32, (index + 1) * 32) : Buffer.alloc(32));
  while (nodes.length > 1) {
    nodes = Array.from({ length: nodes.length / 2 }, (_, index) => createHash('sha256').update(Buffer.concat([nodes[index * 2], nodes[index * 2 + 1]])).digest());
  }
  return `0x${nodes[0].toString('hex')}`;
}

function freshPlan(witness, network) {
  assert.equal(witness.schemaVersion, 1);
  assert.equal(witness.qrysmCommit, '9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3');
  assert.equal(witness.genesisValidatorsRoot, network.beaconGenesis.genesis_validators_root);
  assert(witness.updates.length >= 1 && witness.updates.length <= 2);
  const header = (value) => ({
    slot: value.slot, proposerIndex: value.proposer_index,
    parentRoot: value.parent_root, stateRoot: value.state_root, bodyRoot: value.body_root
  });
  const bootstrap = header(witness.bootstrapHeader);
  const steps = [{ op: 'deploy', id: 'verifier', args: [
    bootstrap, headerRoot(bootstrap), witness.bootstrapCurrentCommittee.root,
    witness.bootstrapCurrentCommittee.branch, witness.bootstrapNextCommittee.root,
    witness.bootstrapNextCommittee.branch, witness.genesisValidatorsRoot,
    network.beaconGenesis.genesis_fork_version, network.beaconGenesis.genesis_time,
    network.beaconConfig.SECONDS_PER_SLOT, '8', '64'
  ] }];
  const roots = [];
  witness.updates.forEach((update, index) => {
    assert.equal(update.nativeSignatureVerification, true);
    const attested = header(update.attestedHeader);
    const finalized = header(update.finalizedHeader);
    assert.equal(headerRoot(attested), update.attestedRoot);
    assert.equal(headerRoot(finalized), update.finalizedRoot);
    assert.equal(BigInt(update.signatureSlot), BigInt(attested.slot) + 1n);
    const args = [attested, finalized, update.finalityBranch,
      update.finalizedNextCommittee.root, update.finalizedNextCommittee.branch];
    const id = proposalId(args);
    roots.push({ attested: update.attestedRoot, finalized: update.finalizedRoot, id });
    const add = (name, method, values, extra = {}) => steps.push({
      name: `update[${index}] ${name}`, op: 'call', target: '@verifier', method, args: values, ...extra
    });
    add('begin', 'beginUpdate', args, { want: [id] });
    add('empty quorum cannot finalize', 'finalize', [id], { revert: '*' });
    const selected = votes(update).slice(0, 86);
    for (let start = 0; start < 85; start += 12) {
      const end = Math.min(start + 12, 85);
      add(`submit ${start}-${end - 1}`, 'submit', [id, selected.slice(start, end)]);
    }
    add('exact 85 distinct positions recorded', 'proposalVotes', [id], { want: ['85'] });
    add('85 positions do not meet quorum', 'finalize', [id], { revert: '*' });
    add('submit final quorum position', 'submit', [id, selected.slice(85)]);
    add('exact 86 distinct positions recorded', 'proposalVotes', [id], { want: ['86'] });
    add('finalize', 'finalize', [id]);
    add('finalized slot advances', 'finalizedSlot', [], { want: [finalized.slot] });
    add('finalized header matches captured root', 'finalizedHeaderRoot', [], { want: [update.finalizedRoot] });
    add('finalized state matches captured root', 'finalizedStateRoot', [], { want: [finalized.stateRoot] });
    add('current period follows verified transition', 'currentPeriod', [], { want: [update.signaturePeriod] });
  });
  const incorrect = structuredClone(steps.find((step) => step.method === 'beginUpdate'));
  const bytes = Buffer.from(incorrect.args[2][1].slice(2), 'hex');
  bytes[0] ^= 1;
  incorrect.args[2][1] = `0x${bytes.toString('hex')}`;
  steps.push({ ...incorrect, name: 'incorrect finality branch', revert: '*' });
  return { plan: { steps }, metadata: { bootstrapRoot: headerRoot(bootstrap), updateRoots: roots } };
}

async function main() {
  assert(['--execute-local-finality', '--execute-fresh-finality', '--execute-terminal-finality'].includes(process.argv[2]));
  assert(!pipeline || fresh, 'Pipelined votes are restricted to the fresh fixture modes');
  assert(!observeRecord || fresh);
  assert.equal(process.env.QUANTAPOOL_PUBLIC_DEV_ACCOUNT, fixtureAccount);
  assert.equal(process.env.QUANTAPOOL_PUBLIC_DEV_CHAIN_ID, String(chainId));
  const sourceNetwork = read(path.join(root, `findings/native-qrl-prototype/${terminal ? 'lifecycle/' : ''}network.json`));
  fs.mkdirSync(runtime, { recursive: true });
  const checked = JSON.parse(execFileSync('python3', [
    path.join(root, 'prototype/network/verify-network.py'), sourceNetwork.enclave, '--chain-id', String(chainId)
  ], { encoding: 'utf8' }));
  assert.equal(checked.executionGenesis, sourceNetwork.executionGenesis);
  assert.deepEqual(checked.beaconGenesis, sourceNetwork.beaconGenesis);
  assert.equal(checked.chainId, chainId);
  loopback(checked.rpcUrl);
  loopback(checked.beaconUrl);
  const planPath = fresh ? path.resolve(process.argv[3] || path.join(root, 'findings/native-qrl-finality/fresh/witness.json')) : path.join(root, 'build/prototype/finality-plan.json');
  const planBytes = fs.readFileSync(planPath);
  const input = fresh ? freshPlan(JSON.parse(planBytes), checked) : {
    plan: JSON.parse(planBytes), metadata: read(path.join(root, 'build/prototype/finality-plan.meta.json'))
  };
  const { plan, metadata } = input;
  let checkpoint;
  if (observeRecord) {
    const witness = JSON.parse(planBytes);
    const finalized = witness.updates.at(-1).finalizedHeader;
    checkpoint = witness.finalizedValidatorWitnesses.find((value) => value.slot === finalized.slot);
    assert(checkpoint && checkpoint.validators.length === 1);
    assert.equal(checkpoint.stateRoot, finalized.state_root);
    assert.equal(checkpoint.validators[0].index, terminal ? '64' : '63');
    assert.equal(checkpoint.validators[0].balance, '0');
  }
  if (terminal) {
    const lifecycle = path.join(root, 'findings/native-qrl-prototype/lifecycle');
    const observed = read(path.join(lifecycle, 'terminal-finalized-observation.json'));
    assert.equal(observed.finalizedValidator.status, 'withdrawal_done');
    assert.equal(observed.finalizedValidator.balance, '0');
    const events = fs.readFileSync(path.join(lifecycle, 'consensus-cash-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const returned = events.filter((event) => event.withdrawals.length > 0).at(-1);
    assert(returned, 'Require an observed actual native withdrawal');
    const witness = JSON.parse(planBytes);
    assert(BigInt(witness.bootstrapHeader.slot) < BigInt(returned.beaconSlot), 'Bootstrap must precede actual terminal withdrawal');
    assert(BigInt(witness.updates.at(-1).finalizedHeader.slot) > BigInt(returned.beaconSlot), 'Accepted update must finalize after actual terminal withdrawal');
  }
  const deploy = plan.steps.find((step) => step.op === 'deploy' && step.id === 'verifier' && !step.revert);
  assert(deploy);
  if (!fresh) assert.equal(metadata.costGroups.filter((group) => group.kind === 'captured-quorum-update').length, 4);
  const constructorArgs = structuredClone(deploy.args);
  assert.equal(constructorArgs.length, 12);
  assert.equal(constructorArgs[11], '64');
  const maxAgeSlots = fresh ? 64 : 4096;
  constructorArgs[11] = String(maxAgeSlots);
  assert.equal(constructorArgs[8], checked.beaconGenesis.genesis_time);
  assert.equal(constructorArgs[9], terminal ? '3' : '6');
  assert.equal(constructorArgs[10], '8');
  const abi = read(path.join(root, 'build/prototype/FinalityFeasibilityVerifier.abi'));
  const bytecode = fs.readFileSync(path.join(root, 'build/prototype/FinalityFeasibilityVerifier.bin'), 'utf8').trim();
  const web3 = new Web3(new Web3.providers.HttpProvider(checked.rpcUrl, {
    providerOptions: { redirect: 'error' }
  }));
  const account = loadDeployerFromEnvironment(web3, {
    repoRoot: root, rpcUrl: checked.rpcUrl, chainId,
    env: { QUANTAPOOL_PUBLIC_DEV_ACCOUNT: fixtureAccount, QUANTAPOOL_PUBLIC_DEV_CHAIN_ID: String(chainId) }
  });
  let result = fs.existsSync(outputPath) ? read(outputPath) : {
    chainId, executionGenesis: checked.executionGenesis, beaconGenesis: checked.beaconGenesis,
    network: checked, artifactSha256: hash(bytecode), planSha256: hash(planBytes),
    account: account.address, maxAgeSlots, vmMaxAgeSlots: 64, pipelineVotes: pipeline,
    constructorSha256: hash(json(constructorArgs)), updateRoots: metadata.updateRoots || [], inputHashes: [],
    scope: fresh ? 'Actual local-chain transactions enforce a 64-slot age bound using freshly captured certificates. An independently selected initial checkpoint and fixed-fork occupied-slot subset remain explicit.' : 'Actual local-chain transactions replay historical captured certificates within an explicit 4096-slot age bound. Initial checkpoint trust is supplied independently; no current 64-slot accounting freshness claim.',
    startedAt: new Date().toISOString(), transactions: [], calls: [], completed: []
  };
  assert.equal(result.executionGenesis, checked.executionGenesis);
  assert.equal(result.artifactSha256, hash(bytecode));
  if (!fresh) assert.equal(result.planSha256, hash(planBytes));
  if (fresh) {
    assert.equal(result.constructorSha256, hash(json(constructorArgs)));
    for (let index = 0; index < result.updateRoots.length; index++) {
      assert.deepEqual(result.updateRoots[index], metadata.updateRoots[index]);
    }
    result.updateRoots = metadata.updateRoots;
    result.inputHashes.push(hash(planBytes));
  }
  const save = () => fs.writeFileSync(outputPath, `${json(result)}\n`);
  save();

  async function rpc(method, params) {
    const response = await fetch(checked.rpcUrl, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    assert(response.ok);
    return response.json();
  }

  async function recordReceipt(name, data, receipt, estimate, fixedGasLimit = null, recordSlot = null) {
    const calldataBytes = (data.length - 2) / 2;
    assert.equal(BigInt(receipt.status), 1n);
    const raw = await rpc('qrl_getRawTransactionByHash', [receipt.transactionHash]);
    assert(!raw.error && /^0x[0-9a-f]+$/i.test(raw.result));
    const transactionBytes = (raw.result.length - 2) / 2;
    assert(transactionBytes <= 128 * 1024);
    const block = await web3.qrl.getBlock(receipt.blockNumber);
    const minedSlot = (BigInt(block.timestamp) - BigInt(checked.beaconGenesis.genesis_time)) / BigInt(checked.beaconConfig.SECONDS_PER_SLOT);
    const updateIndex = name.match(/^update\[(\d+)\]/)?.[1];
    const referenceSlot = recordSlot || (updateIndex === undefined ? constructorArgs[0].slot : plan.steps.find(
      (step) => step.name === `update[${updateIndex}] begin`
    ).args[0].slot);
    const record = {
      name, calldataBytes, transactionBytes, estimatedGas: estimate, fixedGasLimit,
      gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
      minedTimestamp: block.timestamp, minedSlot, inputAgeSlots: minedSlot - BigInt(referenceSlot),
      feeBaseUnits: BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice), receipt
    };
    assert(record.inputAgeSlots <= BigInt(maxAgeSlots));
    result.transactions.push(record);
    save();
    console.log(json({ name, gasUsed: receipt.gasUsed, transactionBytes, transactionHash: receipt.transactionHash }));
    return receipt;
  }

  async function send(name, to, data, recordSlot = null) {
    const tx = { from: account.address, data, value: '0', ...(to ? { to } : {}) };
    assert((data.length - 2) / 2 < 120000, 'Bound this fixture below the 128KiB signed transaction limit');
    const estimate = BigInt(await web3.qrl.estimateGas(tx));
    const receipt = await web3.qrl.sendTransaction({ ...tx, gas: estimate * 12n / 10n + 10000n });
    return recordReceipt(name, data, receipt, estimate, null, recordSlot);
  }

  if (!result.address) {
    const creation = new web3.qrl.Contract(abi).deploy({ data: `0x${bytecode}`, arguments: constructorArgs });
    const receipt = await send(fresh ? 'deploy verifier with live 64-slot age bound' : 'deploy verifier with explicit historical age bound', null, creation.encodeABI());
    result.address = receipt.contractAddress;
    save();
  }
  const verifier = new web3.qrl.Contract(abi, result.address);
  assert.equal(await verifier.methods.bootstrapRoot().call(), metadata.bootstrapRoot);
  assert.equal(BigInt(await verifier.methods.maxAgeSlots().call()), BigInt(maxAgeSlots));
  let recordConsumer;
  let record;
  if (observeRecord) {
    const recordAbi = read(path.join(root, 'build/prototype/FinalizedValidatorRecordProbe.abi'));
    const recordBytecode = fs.readFileSync(path.join(root, 'build/prototype/FinalizedValidatorRecordProbe.bin'), 'utf8').trim();
    const rawRecord = checkpoint.validators[0];
    const fields = recordAbi.find((entry) => entry.type === 'function' && entry.name === 'observe').inputs[0].components;
    record = Object.fromEntries(fields.map((field) => {
      assert(Object.hasOwn(rawRecord, field.name));
      return [field.name, rawRecord[field.name]];
    }));
    const recipient = `Q${record.withdrawalRecipient.replace(/^0x/, '')}`;
    if (terminal) {
      const probe = read(path.join(root, 'findings/native-qrl-prototype/lifecycle/probe.json'));
      assert.equal(recipient.toLowerCase(), probe.address.toLowerCase());
      assert.equal(rawRecord.publicKey.toLowerCase(), probe.validatorPubkey.toLowerCase());
      assert.equal(record.publicKeyRoot, validatorKeyRoot(probe.validatorPubkey));
    }
    if (!result.recordConsumer) {
      const creation = new web3.qrl.Contract(recordAbi).deploy({ data: `0x${recordBytecode}`, arguments: [
        result.address, record.index, record.publicKeyRoot, recipient, '64'
      ] });
      const receipt = await send('deploy immutable selected-validator record consumer', null, creation.encodeABI(), checkpoint.slot);
      result.recordConsumer = { address: receipt.contractAddress, artifactSha256: hash(recordBytecode), index: record.index, recipient };
      save();
    }
    assert.equal(result.recordConsumer.artifactSha256, hash(recordBytecode));
    recordConsumer = new web3.qrl.Contract(recordAbi, result.recordConsumer.address);
    assert.equal((await recordConsumer.methods.verifier().call()).toLowerCase(), result.address.toLowerCase());
  }

  async function submitPipeline(batch) {
    assert(pipeline && batch.length >= 1 && batch.length <= 8);
    const nonce = BigInt(await web3.qrl.getTransactionCount(account.address, 'pending'));
    const pending = batch.map(async (step, index) => {
      assert.equal(step.method, 'submit');
      assert(step.args[1].length >= 1 && step.args[1].length <= 12);
      const data = verifier.methods.submit(...step.args).encodeABI();
      assert((data.length - 2) / 2 < 120000);
      // Passed VM and mined fixtures use at most 6.31M gas for twelve cold-key seats.
      // Reserve 8.5M for that bounded shape and 1M for a single-seat final batch.
      const gas = step.args[1].length === 1 ? 1_000_000n : 8_500_000n;
      const receipt = await web3.qrl.sendTransaction({
        from: account.address, to: result.address, value: '0', data, gas, nonce: nonce + BigInt(index)
      });
      await recordReceipt(step.name, data, receipt, null, gas);
      result.completed.push(step.name);
      save();
    });
    const outcomes = await Promise.allSettled(pending);
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    if (rejected.length) throw rejected[0].reason;
  }

  async function reject(step) {
    const data = verifier.methods[step.method](...step.args).encodeABI();
    const response = await rpc('qrl_call', [{ from: account.address, to: result.address, data }, 'latest']);
    assert(response.error, `Expected contract rejection: ${step.name}`);
    assert(/revert/i.test(response.error.message), `Expected execution revert, not an RPC failure: ${step.name}`);
    result.calls.push({ name: step.name, method: step.method, kind: 'read-only qrl_call expected revert', error: response.error });
  }

  const additional = fresh ? ['incorrect finality branch'] : ['incorrect finality branch', 'incorrect finalized header'];
  const steps = [
    ...additional.map((name) => plan.steps.find((step) => step.name === name)),
    ...plan.steps.filter((step) => /^update\[\d+\]/.test(step.name) && step.op === 'call' && step.target === '@verifier')
  ];
  assert(steps.every(Boolean));
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex];
    if (result.completed.includes(step.name)) continue;
    if (pipeline && step.method === 'submit' && !step.revert) {
      const batch = [];
      let next = stepIndex;
      while (next < steps.length && steps[next].method === 'submit' && !steps[next].revert) {
        if (!result.completed.includes(steps[next].name)) batch.push(steps[next]);
        next++;
      }
      await submitPipeline(batch);
      stepIndex = next - 1;
      continue;
    } else if (step.revert) {
      await reject(step);
    } else if (['beginUpdate', 'submit', 'finalize'].includes(step.method)) {
      const method = verifier.methods[step.method](...step.args);
      if (step.want) assert.equal(String(await method.call({ from: account.address })), String(step.want[0]));
      await send(step.name, result.address, method.encodeABI());
    } else {
      assert(step.want && step.want.length === 1);
      const actual = await verifier.methods[step.method](...step.args).call();
      assert.equal(String(actual).toLowerCase(), String(step.want[0]).toLowerCase(), step.name);
      result.calls.push({ name: step.name, method: step.method, kind: 'read-only qrl_call success', actual: String(actual) });
    }
    result.completed.push(step.name);
    save();
  }
  result.finalizedSlot = String(await verifier.methods.finalizedSlot().call());
  result.finalizedStateRoot = await verifier.methods.finalizedStateRoot().call();
  result.finalizedHeaderRoot = await verifier.methods.finalizedHeaderRoot().call();
  result.currentPeriod = String(await verifier.methods.currentPeriod().call());
  if (observeRecord && result.recordConsumer.observedSlot !== checkpoint.slot) {
    assert.equal(result.finalizedSlot, checkpoint.slot);
    assert.equal(result.finalizedStateRoot, checkpoint.stateRoot);
    const method = recordConsumer.methods.observe(record, checkpoint.slotBranch);
    const receipt = await send('authenticate actual terminal-zero validator record', result.recordConsumer.address, method.encodeABI(), checkpoint.slot);
    assert.equal(await recordConsumer.methods.hasObservation().call(), true);
    assert.equal(String(await recordConsumer.methods.observedSlot().call()), checkpoint.slot);
    assert.equal(String(await recordConsumer.methods.balanceShor().call()), '0');
    assert.equal(await recordConsumer.methods.terminal().call(), true);
    Object.assign(result.recordConsumer, { observedSlot: checkpoint.slot, stateRoot: checkpoint.stateRoot, balanceShor: '0', terminal: true, observationReceipt: receipt });
    save();
  }
  result.totalGasUsed = result.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n).toString();
  result.totalFeeBaseUnits = result.transactions.reduce((sum, tx) => sum + BigInt(tx.feeBaseUnits), 0n).toString();
  result.totalTransactionBytes = result.transactions.reduce((sum, tx) => sum + tx.transactionBytes, 0);
  result.finishedAt = new Date().toISOString();
  save();
  console.log(json({ finalizedSlot: result.finalizedSlot, currentPeriod: result.currentPeriod, transactions: result.transactions.length, totalGasUsed: result.totalGasUsed }));
}

main().catch((error) => { console.error(String(error.message).slice(0, 1000)); process.exitCode = 1; });
