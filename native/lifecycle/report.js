// Read-only reconciliation for this completed, isolated native validator lifecycle.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { context, runtime, read, write, normalized, hash } = require('./transactions');

const UNIT = 10n ** 18n;
const SHOR = 10n ** 9n;
const records = name => fs.readFileSync(path.join(runtime, name), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

async function transactionCosts(c, tag) {
  const submitted = records('submitted-transactions.jsonl');
  const seen = new Set();
  const groups = {};
  const blocks = new Map();
  let pendingOrLater = 0;
  for (let start = 0; start < submitted.length; start += 8) {
    const batch = submitted.slice(start, start + 8);
    const receipts = await Promise.all(batch.map(item => c.rpc('qrl_getTransactionReceipt', [item.transactionHash])));
    for (let offset = 0; offset < batch.length; offset++) {
      const item = batch[offset];
      assert(!seen.has(item.transactionHash), 'Duplicate signed transaction in the journal');
      seen.add(item.transactionHash);
      const receipt = receipts[offset];
      if (!receipt || BigInt(receipt.blockNumber) > BigInt(tag)) { pendingOrLater++; continue; }
      if (!blocks.has(receipt.blockNumber)) blocks.set(receipt.blockNumber,
        await c.rpc('qrl_getBlockByNumber', [receipt.blockNumber, false]));
      assert.equal(blocks.get(receipt.blockNumber).hash, receipt.blockHash);
      const groupName = ['deploy-', 'finality-', 'portfolio-'].find(prefix => item.name.startsWith(prefix))?.slice(0, -1) || 'lifecycle';
      const group = groups[groupName] ||= { successful: 0, reverted: 0, gasUsed: 0n, gasCostBaseUnits: 0n };
      const status = BigInt(receipt.status);
      assert(status === 0n || status === 1n);
      if (status === 1n) group.successful++; else group.reverted++;
      group.gasUsed += BigInt(receipt.gasUsed);
      group.gasCostBaseUnits += BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
    }
  }
  return { throughExecutionBlock: String(BigInt(tag)), pendingOrLater,
    groups: Object.fromEntries(Object.entries(groups).map(([name, value]) => [name, {
      ...value, gasUsed: String(value.gasUsed), gasCostBaseUnits: String(value.gasCostBaseUnits),
    }])), scope: 'Gas paid by public fixture transaction senders, including mined reverts. These costs do not debit pooled principal.' };
}

async function report() {
  const c = await context();
  const deployment = read(path.join(runtime, 'pool.json'));
  const claims = read(path.join(runtime, 'final-claims.json'));
  assert.equal(claims.complete, true, 'Complete the authenticated terminal claims first');
  assert.equal(claims.executionGenesis, c.network.executionGenesis);
  assert.equal(normalized(claims.pool), normalized(deployment.address));
  const fixture = read(path.join(runtime, 'fixture.json'));
  const transactions = records('transactions.jsonl');
  const seenTransactions = new Set();
  for (const item of transactions) {
    assert(!seenTransactions.has(item.transactionHash), 'Duplicate receipt in the local journal');
    seenTransactions.add(item.transactionHash);
  }
  async function canonicalReceipt(item) {
    assert(item, 'Required lifecycle transaction is absent');
    const receipt = await c.rpc('qrl_getTransactionReceipt', [item.transactionHash]);
    assert.equal(BigInt(receipt.status), 1n);
    assert.equal(receipt.blockHash, item.receipt.blockHash);
    const block = await c.rpc('qrl_getBlockByNumber', [receipt.blockNumber, false]);
    assert.equal(block.hash, receipt.blockHash);
    return receipt;
  }
  const graph = {};
  for (const [kind, name, address] of [
    ['finality', 'NativeFinalityVerifier', deployment.finalityAddress],
    ['portfolio', 'NativePortfolioVerifier', deployment.portfolioAddress],
    ['gate', 'NativeValidatorGate', deployment.gateAddress],
    ['pool', 'NativeQrlPool', deployment.address],
  ]) {
    const frozen = c.artifact(name).bytecode;
    assert.equal(hash(frozen), deployment.artifactHashes[name]);
    const item = transactions.find(value => value.name === `deploy-${kind}`);
    const receipt = await canonicalReceipt(item);
    assert.equal(normalized(receipt.contractAddress), normalized(address));
    const transaction = await c.rpc('qrl_getTransactionByHash', [item.transactionHash]);
    assert(transaction.input.toLowerCase().startsWith(`0x${frozen.toLowerCase()}`), 'Actual creation must use the frozen artifact');
    const code = await c.rpc('qrl_getCode', [address, claims.afterBlock.number]);
    assert(code.length > 2);
    graph[kind] = { address, transactionHash: item.transactionHash,
      frozenCreationSha256: deployment.artifactHashes[name], deployedRuntimeSha256: hash(Buffer.from(code.slice(2), 'hex')) };
  }
  const pool = c.contract('NativeQrlPool', deployment.address);
  const portfolio = c.contract('NativePortfolioVerifier', deployment.portfolioAddress);
  const gate = c.contract('NativeValidatorGate', deployment.gateAddress);
  const tag = claims.afterBlock.number;
  const snapshot = await portfolio.methods.latestSnapshot().call({}, tag);
  assert.equal(String(snapshot.registeredCount), '1');
  assert.equal(String(await portfolio.methods.terminalValidatorCount().call({}, tag)), '1');
  assert.equal(String(snapshot.validatorBalanceBaseUnits), '0');
  assert.equal(String(await pool.methods.totalShares().call({}, tag)), '0');
  assert.equal(String(await pool.methods.pendingTotal().call({}, tag)), '0');
  assert.equal(String(await pool.methods.claimReserve().call({}, tag)), '0');
  assert.equal(String(await pool.methods.feeReserve().call({}, tag)), '0');
  assert.equal(String(await pool.methods.appliedSlot().call({}, tag)), String(snapshot.slot));
  const storedExit = await gate.methods.storedExit(deployment.pooledFunding.validatorIndex).call({}, tag);
  assert.equal(storedExit.funded, true);
  assert.equal(storedExit.requested, true);

  let contributions = 0n;
  const contributionReceipts = [];
  for (const name of ['operator-bootstrap-2000', 'user-0-deposit-20000', 'user-3-deposit-22000']) {
    const item = transactions.find(value => value.name === name);
    const receipt = await canonicalReceipt(item);
    const transaction = await c.rpc('qrl_getTransactionByHash', [item.transactionHash]);
    assert.equal(BigInt(transaction.value), BigInt(item.value));
    contributions += BigInt(transaction.value);
    contributionReceipts.push({ name, transactionHash: item.transactionHash, blockNumber: receipt.blockNumber, value: item.value });
  }
  assert.equal(contributions, 44000n * UNIT);
  let deposits = 0n;
  let withdrawals = 0n;
  const withdrawalIndices = new Set();
  const depositSlots = [];
  const withdrawalEvents = [];
  for (const event of records('consensus-cash-events.jsonl')) {
    assert(BigInt(event.beaconSlot) <= BigInt(snapshot.slot), 'All return observations must precede the authenticated terminal state');
    const number = `0x${BigInt(event.executionBlock).toString(16)}`;
    const block = await c.rpc('qrl_getBlockByNumber', [number, false]);
    assert.equal(block.hash, event.executionHash, 'Observed return block must remain canonical');
    for (const withdrawal of event.withdrawals) {
      const key = String(withdrawal.index);
      assert(!withdrawalIndices.has(key), 'A native withdrawal may only be counted once');
      withdrawalIndices.add(key);
      assert.equal(String(withdrawal.validator_index), String(deployment.pooledFunding.validatorIndex));
      assert.equal(normalized(withdrawal.address), normalized(deployment.address));
      assert((block.withdrawals || []).some(actual => BigInt(actual.index) === BigInt(withdrawal.index) &&
        BigInt(actual.validatorIndex) === BigInt(withdrawal.validator_index) &&
        BigInt(actual.amount) === BigInt(withdrawal.amount) && normalized(actual.address) === normalized(withdrawal.address)),
      'Recorded withdrawal tuple must occur in the canonical execution payload');
      withdrawals += BigInt(withdrawal.amount) * SHOR;
      withdrawalEvents.push({ slot: event.beaconSlot, executionBlock: event.executionBlock, executionHash: block.hash,
        index: key, amountShor: String(withdrawal.amount) });
    }
    if (event.deposits.length) {
      const response = await fetch(`${c.network.beaconUrl}/qrl/v1/beacon/blocks/${event.beaconSlot}`, { redirect: 'error' });
      assert(response.ok && response.headers.get('content-type')?.includes('application/json'));
      const beaconBlock = (await response.json()).data.message;
      assert.equal(beaconBlock.body.execution_payload.block_hash, block.hash);
      const actualDeposits = beaconBlock.body.deposits.filter(item => normalized(item.data.pubkey) === normalized(fixture.validatorPubkey));
      assert.deepEqual(actualDeposits, event.deposits);
      for (const item of actualDeposits) {
        assert.equal(normalized(item.data.withdrawal_recipient), normalized(deployment.address));
        deposits += BigInt(item.data.amount) * SHOR;
      }
      depositSlots.push(event.beaconSlot);
    }
  }
  assert.equal(deposits, 40000n * UNIT);
  assert.equal(withdrawals, BigInt(snapshot.cumulativeNativeWithdrawals),
    'Observed native returns must equal the complete contract-authenticated withdrawal history');
  assert.equal(BigInt(snapshot.cumulativeValidatorDepositsBaseUnits) + BigInt(snapshot.cumulativeAdmissionPrincipalBaseUnits), deposits);
  const cash = BigInt(await c.rpc('qrl_getBalance', [deployment.address, tag]));
  assert.equal(cash, BigInt(claims.remainingCash));
  const paid = BigInt(claims.totalNativePayout);
  assert.equal(contributions + withdrawals - deposits, paid + cash,
    'Contributions plus net native validator returns must equal payouts and accounted residue');
  const netConsensusResult = withdrawals - deposits;
  const positiveConsensusGain = netConsensusResult > 0n ? netConsensusResult : 0n;
  assert(BigInt(claims.fee) <= positiveConsensusGain / 10n,
    'This fixture has no gifts or earlier claims: earned fees cannot exceed ten percent of net consensus gain');
  assert.equal(String(await pool.methods.cumulativeCashPayments().call({}, tag)), String(paid));
  for (const item of Object.values(claims.receipts)) {
    await canonicalReceipt(transactions.find(value => value.transactionHash === item.transactionHash));
  }
  const costs = await transactionCosts(c, tag);
  assert.equal((await c.rpc('qrl_getBlockByNumber', [tag, false])).hash, claims.afterBlock.hash);
  const result = { observedAt: new Date().toISOString(), chainId: 3151916, executionGenesis: c.network.executionGenesis,
    graph, sourceHashes: deployment.sourceHashes, trustAnchor: deployment.trustAnchor,
    terminalCheckpoint: { slot: String(snapshot.slot), stateRoot: snapshot.stateRoot, executionBlock: String(snapshot.executionBlock),
      validatorIndex: String(deployment.pooledFunding.validatorIndex), validatorBalanceBaseUnits: '0' },
    contributionReceipts, depositSlots, withdrawalEvents,
    contributions: String(contributions), validatorPrincipalFunded: String(deposits), nativeConsensusReturns: String(withdrawals),
    nativeConsensusNetResult: String(netConsensusResult), nativePayoutIncludingEarnedFee: String(paid),
    nativeUserPayout: String(paid - BigInt(claims.fee)), earnedOperatorFee: claims.fee, accountedResidue: String(cash),
    users: claims.users, publicExitSha256: deployment.pooledFunding.publicExitSha256,
    publicExitAvailableAt: deployment.pooledFunding.publicExitAvailableAt,
    pooledFundingTransactionHash: deployment.pooledFunding.transactionHash,
    claimsEvidenceSha256: hash(fs.readFileSync(path.join(runtime, 'final-claims.json'))),
    transactionCosts: costs,
    scope: 'Actual original frozen graph lifecycle on the isolated chain. Complete authenticated portfolio state authorizes accounting. RPC canonicality checks independently reconcile native transactions. Later source recovery-timeout, capacity and immutable operator-admission hardening are separate evidence. Execution tips remain operator-routable and are excluded from guaranteed pool rewards.' };
  write(path.join(runtime, 'completed-lifecycle.json'), result);
  console.log(JSON.stringify({ complete: true, nativeConsensusNetResult: result.nativeConsensusNetResult,
    nativeUserPayout: result.nativeUserPayout, earnedOperatorFee: result.earnedOperatorFee, accountedResidue: result.accountedResidue }));
}

if (require.main === module) report().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { report, transactionCosts };
