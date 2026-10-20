const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Web3 } = require('@theqrl/web3');
const { loadDeployerFromEnvironment } = require('../../scripts/lib/loadDeployer');

const repoRoot = path.resolve(__dirname, '../..');
const runtime = path.join(repoRoot, 'findings/native-qrl-prototype/lifecycle');
const statePath = path.join(runtime, 'probe.json');
const claimProgressPath = path.join(runtime, 'claim-progress.json');
const principal = 40_000n * 10n ** 18n;
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const write = (file, value) => fs.writeFileSync(file, `${json(value)}\n`);
const normalize = (value) => String(value).replace(/^Q|^0x/i, '').toLowerCase();

function requireLoopback(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.equal(url.pathname, '/');
}

async function main() {
  const command = process.argv[2];
  assert(['deploy', 'fund', 'observe', 'claim'].includes(command), 'Expected deploy, fund, observe or claim');
  assert.equal(process.env.QUANTAPOOL_PUBLIC_DEV_ACCOUNT, '0', 'Use explicit disposable public account 0');
  assert.equal(process.env.QUANTAPOOL_PUBLIC_DEV_CHAIN_ID, '3151915');
  const network = read(path.join(runtime, 'network.json'));
  assert.equal(network.chainId, 3151915);
  requireLoopback(network.rpcUrl);
  requireLoopback(network.beaconUrl);
  const provider = new Web3.providers.HttpProvider(network.rpcUrl, { providerOptions: { redirect: 'error' } });
  const web3 = new Web3(provider);
  assert.equal(Number(await web3.qrl.getChainId()), 3151915);
  assert.equal((await web3.qrl.getBlock(0)).hash.toLowerCase(), network.executionGenesis.toLowerCase());
  const genesisResponse = await fetch(`${network.beaconUrl}/qrl/v1/beacon/genesis`, { redirect: 'error' });
  assert(genesisResponse.ok);
  assert.deepEqual((await genesisResponse.json()).data, network.beaconGenesis);
  const abi = read(path.join(repoRoot, 'build/prototype/NativeReturnProbe.abi'));
  const bytecode = fs.readFileSync(path.join(repoRoot, 'build/prototype/NativeReturnProbe.bin'), 'utf8').trim();
  const account = (index) => loadDeployerFromEnvironment(web3, {
    repoRoot, rpcUrl: network.rpcUrl, chainId: 3151915,
    env: { QUANTAPOOL_PUBLIC_DEV_ACCOUNT: String(index), QUANTAPOOL_PUBLIC_DEV_CHAIN_ID: '3151915' }
  });
  const beneficiary = account(0);
  const feeAccount = account(1);
  const caller = account(2);
  const depositAddress = `Q${'42'.repeat(64)}`;
  assert((await web3.qrl.getCode(depositAddress)).length > 2);

  async function send(from, to, data, value = 0n) {
    const tx = { from, data, value: value.toString(), ...(to ? { to } : {}) };
    const estimate = BigInt(await web3.qrl.estimateGas(tx));
    const receipt = await web3.qrl.sendTransaction({ ...tx, gas: estimate * 12n / 10n + 10000n });
    assert.equal(BigInt(receipt.status), 1n);
    return receipt;
  }

  if (command === 'deploy') {
    assert(!fs.existsSync(statePath), 'A probe already exists; preserve its state');
    const creation = new web3.qrl.Contract(abi).deploy({ data: `0x${bytecode}`, arguments: [depositAddress, feeAccount.address] });
    const receipt = await send(beneficiary.address, null, creation.encodeABI());
    const probe = new web3.qrl.Contract(abi, receipt.contractAddress);
    assert.equal(normalize(await probe.methods.beneficiary().call()), normalize(beneficiary.address));
    assert.equal(normalize(await probe.methods.feeRecipient().call()), normalize(feeAccount.address));
    write(statePath, {
      chainId: 3151915, genesis: network.executionGenesis, address: receipt.contractAddress,
      beneficiary: beneficiary.address, feeRecipient: feeAccount.address, caller: caller.address,
      artifactSha256: createHash('sha256').update(bytecode).digest('hex'), deployment: receipt,
      scope: 'Controlled fresh-key physical lifecycle; secure canonical admission and live finality verification remain separate dependencies.'
    });
    console.log(json({ action: command, address: receipt.contractAddress, transactionHash: receipt.transactionHash }));
    return;
  }

  const saved = read(statePath);
  assert.equal(saved.genesis, network.executionGenesis);
  assert.equal(saved.artifactSha256, createHash('sha256').update(bytecode).digest('hex'));
  const probe = new web3.qrl.Contract(abi, saved.address);
  assert.equal(normalize(await probe.methods.beneficiary().call()), normalize(saved.beneficiary));
  assert.equal(normalize(await probe.methods.feeRecipient().call()), normalize(saved.feeRecipient));

  if (command === 'fund') {
    assert(!saved.funding, 'Funding already recorded');
    assert.equal(BigInt(await probe.methods.fundedPrincipal().call()), 0n);
    const entries = read(path.join(runtime, 'deposit-data.json'));
    assert.equal(entries.length, 1);
    const deposit = entries[0];
    const hex = (value, length) => {
      const raw = String(value).replace(/^0x/, '');
      assert(new RegExp(`^[a-fA-F0-9]{${length * 2}}$`).test(raw));
      return `0x${raw}`;
    };
    assert.equal(BigInt(deposit.amount), 40_000_000_000_000n);
    const recipient = deposit.withdrawal_recipient || deposit.withdrawal_credentials;
    assert.equal(normalize(recipient), normalize(saved.address));
    const key = hex(deposit.pubkey, 2592);
    const lookup = await fetch(`${network.beaconUrl}/qrl/v1/beacon/states/head/validators/${key}`, { redirect: 'error' });
    assert.equal(lookup.status, 404, 'The controlled fixture key must not exist in the beacon registry');
    const before = {
      beneficiary: await web3.qrl.getBalance(saved.beneficiary),
      beacon: await web3.qrl.getBalance(depositAddress),
      pool: await web3.qrl.getBalance(saved.address)
    };
    const method = probe.methods.fund(key, hex(deposit.randao_commitment, 32), hex(deposit.signature, 4627), hex(deposit.deposit_data_root, 32));
    const receipt = await send(saved.beneficiary, saved.address, method.encodeABI(), principal);
    assert.equal(BigInt(await probe.methods.fundedPrincipal().call()), principal);
    const beaconAfter = BigInt(await web3.qrl.getBalance(depositAddress));
    assert.equal(beaconAfter - BigInt(before.beacon), principal);
    assert.equal(BigInt(await web3.qrl.getBalance(saved.address)), 0n);
    Object.assign(saved, { validatorPubkey: key, funding: receipt, fundingBalances: { before, beaconAfter }, principal: principal.toString() });
    write(statePath, saved);
    console.log(json({ action: command, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, principal }));
    return;
  }

  const value = await probe.methods.accounting().call();
  const accounting = { returned: BigInt(value.returned), principal: BigInt(value.principal), rewards: BigInt(value.rewards), fee: BigInt(value.fee) };
  assert.equal(accounting.principal + accounting.rewards + accounting.fee, accounting.returned);
  assert.equal(accounting.principal, accounting.returned < principal ? accounting.returned : principal);
  assert.equal(accounting.fee, (accounting.returned - accounting.principal) / 10n);
  if (command === 'observe') {
    const result = { blockNumber: await web3.qrl.getBlockNumber(), poolBalance: await web3.qrl.getBalance(saved.address), accounting };
    write(path.join(runtime, 'accounting-observation.json'), result);
    console.log(json(result));
    return;
  }

  let claimProgress = fs.existsSync(claimProgressPath) ? read(claimProgressPath) : null;
  if (!claimProgress) {
    assert.equal(BigInt(await probe.methods.principalPaid().call()), 0n, 'Claims already started without a progress record');
    assert.equal(BigInt(await probe.methods.rewardsPaid().call()), 0n);
    assert.equal(BigInt(await probe.methods.feesPaid().call()), 0n);
  } else {
    assert.equal(claimProgress.chainId, network.chainId);
    assert.equal(claimProgress.executionGenesis, network.executionGenesis);
    assert.equal(normalize(claimProgress.probe), normalize(saved.address));
  }
  const terminalProof = read(path.join(repoRoot, 'findings/native-qrl-finality/terminal-live/live-run.json'));
  assert.equal(terminalProof.chainId, 3151915);
  assert.equal(terminalProof.executionGenesis, network.executionGenesis);
  assert.equal(terminalProof.recordConsumer.terminal, true);
  assert.equal(terminalProof.recordConsumer.balanceShor, '0');
  const recordAbi = read(path.join(repoRoot, 'build/prototype/FinalizedValidatorRecordProbe.abi'));
  const consumer = new web3.qrl.Contract(recordAbi, terminalProof.recordConsumer.address);
  assert.equal(await consumer.methods.terminal().call(), true);
  assert.equal(BigInt(await consumer.methods.balanceShor().call()), 0n);
  assert.equal(normalize(await consumer.methods.poolRecipient().call()), normalize(saved.address));
  assert.equal(normalize(await consumer.methods.verifier().call()), normalize(terminalProof.address));
  assert.equal(String(await consumer.methods.observedSlot().call()), terminalProof.recordConsumer.observedSlot);
  const validatorIndex = String(await consumer.methods.validatorIndex().call());
  const observedSlot = BigInt(terminalProof.recordConsumer.observedSlot);
  const events = fs.readFileSync(path.join(runtime, 'consensus-cash-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const canonicalChecks = [];
  let canonicalDepositCount = 0;
  const originalDeposit = read(path.join(runtime, 'deposit-data.json'))[0];
  for (const event of events) {
    assert(BigInt(event.beaconSlot) <= observedSlot, 'Recorded event must precede the authenticated terminal state');
    const executionResponse = await fetch(network.rpcUrl, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'qrl_getBlockByNumber', params: [`0x${BigInt(event.executionBlock).toString(16)}`, false] })
    });
    assert(executionResponse.ok);
    const executionReply = await executionResponse.json();
    assert(!executionReply.error && executionReply.result);
    const executionBlock = executionReply.result;
    assert.equal(executionBlock.hash.toLowerCase(), event.executionHash.toLowerCase(), 'Recorded execution block was reorganized');
    const response = await fetch(`${network.beaconUrl}/qrl/v1/beacon/blocks/${event.beaconSlot}`, { redirect: 'error' });
    assert(response.ok);
    const block = (await response.json()).data.message;
    assert.equal(String(block.slot), String(event.beaconSlot));
    assert.equal(block.body.execution_payload.block_hash.toLowerCase(), executionBlock.hash.toLowerCase());
    const actualWithdrawals = block.body.execution_payload.withdrawals.filter((value) => value.validator_index === validatorIndex);
    assert.deepEqual(actualWithdrawals, event.withdrawals, 'Captured withdrawal tuples changed or were incomplete');
    const executionWithdrawals = executionBlock.withdrawals.filter((value) => BigInt(value.validatorIndex) === BigInt(validatorIndex));
    assert.equal(executionWithdrawals.length, actualWithdrawals.length);
    actualWithdrawals.forEach((value, index) => {
      const executed = executionWithdrawals[index];
      assert.equal(BigInt(executed.index), BigInt(value.index));
      assert.equal(BigInt(executed.amount), BigInt(value.amount));
      assert.equal(normalize(executed.address), normalize(value.address));
    });
    const actualDeposits = block.body.deposits.filter((value) => normalize(value.data.pubkey) === normalize(saved.validatorPubkey));
    assert.deepEqual(actualDeposits, event.deposits, 'Captured consensus deposit changed');
    for (const deposit of actualDeposits) {
      assert.equal(BigInt(deposit.data.amount), 40_000_000_000_000n);
      assert.equal(normalize(deposit.data.pubkey), normalize(saved.validatorPubkey));
      assert.equal(normalize(deposit.data.withdrawal_recipient), normalize(saved.address));
      assert.equal(normalize(deposit.data.randao_commitment), normalize(originalDeposit.randao_commitment));
      assert.equal(normalize(deposit.data.signature), normalize(originalDeposit.signature));
      canonicalDepositCount++;
    }
    canonicalChecks.push({ beaconSlot: event.beaconSlot, executionBlock: event.executionBlock, executionHash: executionBlock.hash });
  }
  assert.equal(canonicalDepositCount, 1, 'Require exactly one canonical 40,000 QRL consensus deposit');
  const canonicalFundingBlock = await web3.qrl.getBlock(saved.funding.blockNumber);
  const canonicalFunding = await web3.qrl.getTransaction(saved.funding.transactionHash);
  assert.equal(canonicalFundingBlock.hash.toLowerCase(), saved.funding.blockHash.toLowerCase());
  assert.equal(canonicalFunding.blockHash.toLowerCase(), canonicalFundingBlock.hash.toLowerCase());
  assert.equal(BigInt(canonicalFunding.value), principal);
  assert.equal(normalize(canonicalFunding.to), normalize(saved.address));
  assert.equal(normalize(canonicalFunding.from), normalize(saved.beneficiary));
  const withdrawals = events.flatMap((event) => event.withdrawals.map((withdrawal) => ({
    ...withdrawal, beaconSlot: event.beaconSlot, executionBlock: event.executionBlock
  })));
  assert(withdrawals.length > 0, 'This physical-return fixture requires at least one actual withdrawal; a terminal zero-cash loss needs separate evidence');
  const seenWithdrawalIndices = new Set();
  for (const withdrawal of withdrawals) {
    assert.equal(withdrawal.validator_index, validatorIndex);
    assert.equal(normalize(withdrawal.address), normalize(saved.address));
    assert(!seenWithdrawalIndices.has(withdrawal.index), 'Duplicate withdrawal event');
    seenWithdrawalIndices.add(withdrawal.index);
  }
  const consensusReturned = withdrawals.reduce((sum, withdrawal) => sum + BigInt(withdrawal.amount) * 10n ** 9n, 0n);
  assert.equal(consensusReturned, accounting.returned, 'All returned native cash must reconcile to actual consensus withdrawals');
  const balanceBlockBefore = claimProgress ? BigInt(claimProgress.balanceBlockBefore) : BigInt(await web3.qrl.getBlockNumber());
  const balancesBefore = { beneficiary: BigInt(await web3.qrl.getBalance(saved.beneficiary, balanceBlockBefore)), operator: BigInt(await web3.qrl.getBalance(saved.feeRecipient, balanceBlockBefore)) };
  const beforeBlock = await web3.qrl.getBlock(balanceBlockBefore);
  if (!claimProgress) {
    claimProgress = { chainId: network.chainId, executionGenesis: network.executionGenesis, probe: saved.address, balanceBlockBefore, balanceBlockHashBefore: beforeBlock.hash, claims: [] };
    write(claimProgressPath, claimProgress);
  }
  assert.equal(claimProgress.balanceBlockHashBefore.toLowerCase(), beforeBlock.hash.toLowerCase());
  const receipts = [];
  for (const [method, amount] of [['claimFees', accounting.fee], ['claimPrincipal', accounting.principal], ['claimRewards', accounting.rewards]]) {
    if (amount === 0n) continue;
    const completed = claimProgress.claims.find((value) => value.method === method);
    if (completed) {
      const transaction = await web3.qrl.getTransaction(completed.receipt.transactionHash);
      const receipt = await web3.qrl.getTransactionReceipt(completed.receipt.transactionHash);
      assert.equal(BigInt(receipt.status), 1n);
      assert.equal(receipt.blockHash.toLowerCase(), completed.receipt.blockHash.toLowerCase());
      assert.equal(normalize(transaction.from), normalize(caller.address));
      assert.equal(normalize(transaction.to), normalize(saved.address));
      assert.equal(transaction.input, probe.methods[method]().encodeABI());
      assert.equal(BigInt(transaction.value), 0n);
      receipts.push(receipt);
    } else {
      const receipt = await send(caller.address, saved.address, probe.methods[method]().encodeABI());
      receipts.push(receipt);
      claimProgress.claims.push({ method, receipt });
      write(claimProgressPath, claimProgress);
    }
  }
  const balanceBlockAfter = receipts.length ? BigInt(receipts.at(-1).blockNumber) : balanceBlockBefore;
  const balancesAfter = { beneficiary: BigInt(await web3.qrl.getBalance(saved.beneficiary, balanceBlockAfter)), operator: BigInt(await web3.qrl.getBalance(saved.feeRecipient, balanceBlockAfter)) };
  assert(balanceBlockAfter - balanceBlockBefore <= 64n, 'Keep the claim reconciliation interval bounded');
  const proposerTips = [];
  let beneficiaryTips = 0n;
  for (let height = balanceBlockBefore + 1n; height <= balanceBlockAfter; height++) {
    const block = await web3.qrl.getBlock(height);
    if (!block.transactions) assert.equal(BigInt(block.gasUsed), 0n, 'Only empty blocks may omit the transaction list');
    for (const transactionHash of block.transactions || []) {
      const receipt = receipts.find((value) => value.transactionHash.toLowerCase() === transactionHash.toLowerCase());
      assert(receipt, 'Unexpected transaction during the isolated claim interval');
      assert.equal(receipt.blockHash.toLowerCase(), block.hash.toLowerCase());
      // Pinned go-qrl core/state_transition.go credits gasUsed * effectiveTip to Coinbase.
      const tipPerGas = BigInt(receipt.effectiveGasPrice) - BigInt(block.baseFeePerGas);
      assert(tipPerGas >= 0n);
      const amount = BigInt(receipt.gasUsed) * tipPerGas;
      if (normalize(block.miner) === normalize(saved.beneficiary)) beneficiaryTips += amount;
      assert(normalize(block.miner) !== normalize(saved.feeRecipient), 'Operator balance must have no incidental proposer tips');
      proposerTips.push({ blockNumber: height, blockHash: block.hash, transactionHash, recipient: block.miner, tipPerGas, amount });
    }
  }
  assert.equal(balancesAfter.beneficiary - balancesBefore.beneficiary, accounting.principal + accounting.rewards + beneficiaryTips);
  assert.equal(balancesAfter.operator - balancesBefore.operator, accounting.fee);
  assert.equal(BigInt(await probe.methods.principalPaid().call()), accounting.principal);
  assert.equal(BigInt(await probe.methods.rewardsPaid().call()), accounting.rewards);
  assert.equal(BigInt(await probe.methods.feesPaid().call()), accounting.fee);
  assert.equal(BigInt(await web3.qrl.getBalance(saved.address)), 0n);
  const repeatedClaimChecks = [];
  for (const method of ['claimFees', 'claimPrincipal', 'claimRewards']) {
    const response = await fetch(network.rpcUrl, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'qrl_call', params: [{
        from: caller.address, to: saved.address, data: probe.methods[method]().encodeABI()
      }, 'latest'] })
    });
    assert(response.ok);
    const reply = await response.json();
    assert(reply.error && /revert/i.test(reply.error.message), `Expected repeated ${method} to revert`);
    repeatedClaimChecks.push({ method, kind: 'read-only qrl_call expected revert', error: reply.error });
  }
  const result = {
    accounting, principalShortfall: principal - accounting.principal,
    claimEvidenceRecovery: claimProgress.recovery || null,
    balancesBefore, balancesAfter, balanceBlockBefore, balanceBlockAfter, receipts, claimCaller: caller.address,
    nativeUserPayout: accounting.principal + accounting.rewards,
    incidentalBeneficiaryProposerTips: beneficiaryTips, proposerTips,
    proposerTipScope: 'Separate execution-fee credits to the genesis fixture proposer recipient during claim transactions; excluded from pool rewards and user payout.',
    gasPaidSeparatelyByCaller: true, consensusReturned, withdrawals,
    canonicalChecks, canonicalDepositCount, repeatedClaimChecks,
    canonicalityScope: 'Read-only RPC crosscheck of captured events against canonical execution blocks and matching beacon payloads. The separate deployed consumer authenticates the terminal validator state.',
    terminalProofConsumer: terminalProof.recordConsumer.address,
    authenticatedTerminalStateSlot: terminalProof.recordConsumer.observedSlot
  };
  write(path.join(runtime, 'final-reconciliation.json'), result);
  console.log(json(result));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
