// Final native payouts, with fixture proposer tips and transaction gas separated.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { runtime, read, write, normalized } = require('./transactions');

async function claimAll(c, deployment, pool) {
  const file = path.join(runtime, 'final-claims.json');
  let evidence;
  if (fs.existsSync(file)) evidence = read(file);
  else {
    assert.equal(String(await pool.methods.totalShares().call()), '0', 'All positions must already have cash-reserved withdrawals');
    assert.equal(String(await pool.methods.pendingTotal().call()), '0');
    assert.equal(String(await pool.methods.stage().call()), '0');
    const portfolio = c.contract('NativePortfolioVerifier', deployment.portfolioAddress);
    assert.equal(String(await portfolio.methods.terminalValidatorCount().call()), String(await portfolio.methods.registryCount().call()),
      'Finalized complete portfolio must authenticate every registered validator as terminal');
    const beforeBlock = await c.rpc('qrl_getBlockByNumber', ['latest', false]);
    const users = [];
    for (const [actor, contributed] of [[0, 20000n], [3, 22000n], [2, 2000n]]) {
      const beneficiary = c.account(actor).address;
      const position = await pool.methods.getPosition(beneficiary).call({}, beforeBlock.number);
      users.push({ actor, beneficiary, contributed: String(contributed * 10n ** 18n),
        principal: String(position.principalClaim), rewards: String(position.rewardClaim),
        payout: String(BigInt(position.principalClaim) + BigInt(position.rewardClaim)),
        balanceBefore: String(BigInt(await c.rpc('qrl_getBalance', [beneficiary, beforeBlock.number]))) });
    }
    const feeRecipient = await pool.methods.feeRecipient().call();
    assert.equal(normalized(feeRecipient), normalized(c.account(1).address));
    evidence = { chainId: 3151916, executionGenesis: c.network.executionGenesis, pool: deployment.address,
      beforeBlock: { number: beforeBlock.number, hash: beforeBlock.hash }, users, feeRecipient,
      fee: String(await pool.methods.feeReserve().call({}, beforeBlock.number)),
      feeBalanceBefore: String(BigInt(await c.rpc('qrl_getBalance', [feeRecipient, beforeBlock.number]))),
      cashPaymentsBefore: String(await pool.methods.cumulativeCashPayments().call({}, beforeBlock.number)),
      receipts: {}, complete: false };
    write(file, evidence);
  }
  assert.equal(evidence.executionGenesis, c.network.executionGenesis);
  assert.equal(normalized(evidence.pool), normalized(deployment.address));
  assert.equal((await c.rpc('qrl_getBlockByNumber', [evidence.beforeBlock.number, false])).hash, evidence.beforeBlock.hash);
  if (evidence.complete) {
    assert.equal((await c.rpc('qrl_getBlockByNumber', [evidence.afterBlock.number, false])).hash, evidence.afterBlock.hash,
      'Completed payout evidence must retain its original canonical endpoint');
    console.log(JSON.stringify({ complete: true, preserved: true, totalNativePayout: evidence.totalNativePayout,
      fee: evidence.fee, remainingCash: evidence.remainingCash }));
    return;
  }
  async function sendClaim(baseName, calldata, actor, reservedAmount) {
    const submittedPath = path.join(runtime, 'submitted-transactions.jsonl');
    const submitted = fs.readFileSync(submittedPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    for (let attempt = 0; attempt <= 2; attempt++) {
      const name = attempt === 0 ? baseName : `${baseName}-gas-retry-${attempt}`;
      const previous = submitted.find(item => item.name === name);
      if (previous) {
        const receipt = await c.rpc('qrl_getTransactionReceipt', [previous.transactionHash]);
        if (receipt && BigInt(receipt.status) === 0n) {
          const block = await c.rpc('qrl_getBlockByNumber', [receipt.blockNumber, false]);
          assert.equal(block.hash, receipt.blockHash, 'Only a canonical failed claim may be retried');
          const transaction = await c.rpc('qrl_getTransactionByHash', [previous.transactionHash]);
          assert.equal(BigInt(receipt.gasUsed), BigInt(transaction.gas), 'Automatic claim retries are limited to exhausted gas caps');
          evidence.failedGasAttempts ||= [];
          if (!evidence.failedGasAttempts.some(item => item.transactionHash === previous.transactionHash)) {
            evidence.failedGasAttempts.push({ transactionHash: previous.transactionHash, blockNumber: receipt.blockNumber,
              blockHash: receipt.blockHash, gasUsed: String(BigInt(receipt.gasUsed)), gasLimit: String(BigInt(transaction.gas)) });
            write(file, evidence);
          }
          continue;
        }
      }
      if (!previous) assert.equal(await reservedAmount(), baseName === 'final-native-earned-fee' ? BigInt(evidence.fee) :
        BigInt(evidence.users.find(user => user.actor === actor).payout), 'A fresh claim attempt requires its complete reservation');
      // An estimate at the preceding block can update its last cash-flow point,
      // while mining in a new block appends a more expensive storage entry.
      return c.send(name, deployment.address, calldata, 0n, actor, 300000n);
    }
    throw new Error('Two bounded claim gas retries failed; inspect the preserved receipts');
  }
  for (const user of evidence.users) {
    if (BigInt(user.payout) === 0n) continue;
    const receipt = await sendClaim(`final-native-claim-user-${user.actor}`, pool.methods.claim().encodeABI(), user.actor,
      async () => BigInt(await pool.methods.claimable(user.beneficiary).call()));
    evidence.receipts[`user-${user.actor}`] = receipt;
    write(file, evidence);
  }
  if (BigInt(evidence.fee) !== 0n) {
    const receipt = await sendClaim('final-native-earned-fee', pool.methods.claimFees().encodeABI(), 2,
      async () => BigInt(await pool.methods.feeReserve().call()));
    evidence.receipts.fee = receipt;
    write(file, evidence);
  }
  const afterBlock = await c.rpc('qrl_getBlockByNumber', ['latest', false]);
  const first = BigInt(evidence.beforeBlock.number) + 1n;
  const last = BigInt(afterBlock.number);
  assert(last - first < 4096n, 'Bound the canonical payout-interval crosscheck');
  const totals = new Map([...evidence.users.map(user => user.beneficiary), evidence.feeRecipient]
    .map(address => [normalized(address), { tips: 0n, gas: 0n, withdrawalCredits: 0n }]));
  const canonicalBlocks = [];
  let parentHash = evidence.beforeBlock.hash;
  for (let number = first; number <= last; number++) {
    const block = await c.rpc('qrl_getBlockByNumber', [`0x${number.toString(16)}`, false]);
    assert.equal(block.parentHash, parentHash, 'Payout interval must be one complete canonical parent chain');
    parentHash = block.hash;
    const miner = totals.get(normalized(block.miner));
    for (const hash of block.transactions) {
      const receipt = await c.rpc('qrl_getTransactionReceipt', [hash]);
      assert.equal(receipt.blockHash, block.hash);
      const used = BigInt(receipt.gasUsed);
      const price = BigInt(receipt.effectiveGasPrice);
      const sender = totals.get(normalized(receipt.from));
      if (sender) sender.gas += used * price;
      // Pinned go-qrl core/state_transition.go credits only the effective tip
      // to Coinbase. The base fee is already included in the sender gas cost.
      if (miner) miner.tips += used * (price - BigInt(block.baseFeePerGas));
    }
    for (const withdrawal of block.withdrawals || []) {
      const recipient = totals.get(normalized(withdrawal.address));
      if (recipient) recipient.withdrawalCredits += BigInt(withdrawal.amount) * 10n ** 9n;
    }
    canonicalBlocks.push({ number: block.number, hash: block.hash, parentHash: block.parentHash, miner: block.miner });
  }
  assert.equal(parentHash, afterBlock.hash);
  assert.equal((await c.rpc('qrl_getBlockByNumber', [evidence.beforeBlock.number, false])).hash, evidence.beforeBlock.hash);
  assert.equal((await c.rpc('qrl_getBlockByNumber', [afterBlock.number, false])).hash, afterBlock.hash,
    'Canonical payout boundaries changed during the RPC crosscheck');
  let totalPayout = BigInt(evidence.fee);
  for (const user of evidence.users) {
    const incidental = totals.get(normalized(user.beneficiary));
    const after = BigInt(await c.rpc('qrl_getBalance', [user.beneficiary, afterBlock.number]));
    const change = after - BigInt(user.balanceBefore);
    assert.equal(change, BigInt(user.payout) + incidental.tips + incidental.withdrawalCredits - incidental.gas,
      `Exact native payout reconciliation failed for actor ${user.actor}`);
    assert.equal(String(await pool.methods.claimable(user.beneficiary).call()), '0');
    user.balanceAfter = String(after);
    user.balanceChange = String(change);
    user.proposerTips = String(incidental.tips);
    user.otherNativeWithdrawals = String(incidental.withdrawalCredits);
    user.transactionGasCost = String(incidental.gas);
    user.principalShortfall = String(BigInt(user.contributed) > BigInt(user.principal) ? BigInt(user.contributed) - BigInt(user.principal) : 0n);
    totalPayout += BigInt(user.payout);
  }
  const feeIncidental = totals.get(normalized(evidence.feeRecipient));
  const feeAfter = BigInt(await c.rpc('qrl_getBalance', [evidence.feeRecipient, afterBlock.number]));
  assert.equal(feeIncidental.gas + feeIncidental.tips + feeIncidental.withdrawalCredits, 0n,
    'The fee-only fixture beneficiary must have no incidental credits or gas');
  assert.equal(feeAfter - BigInt(evidence.feeBalanceBefore), BigInt(evidence.fee));
  assert.equal(BigInt(await pool.methods.cumulativeCashPayments().call()) - BigInt(evidence.cashPaymentsBefore), totalPayout);
  assert.equal(String(await pool.methods.claimReserve().call()), '0');
  assert.equal(String(await pool.methods.feeReserve().call()), '0');
  const remainingCash = BigInt(await c.rpc('qrl_getBalance', [deployment.address, afterBlock.number]));
  const accountedRemainder = BigInt(await pool.methods.riskAssets().call({}, afterBlock.number)) + BigInt(await pool.methods.orphanCash().call({}, afterBlock.number));
  assert.equal(remainingCash, accountedRemainder, 'Any final residue must remain explicitly accounted');
  evidence.afterBlock = { number: afterBlock.number, hash: afterBlock.hash };
  evidence.canonicalBlocks = canonicalBlocks;
  evidence.feeBalanceAfter = String(feeAfter);
  evidence.totalNativePayout = String(totalPayout);
  evidence.remainingCash = String(remainingCash);
  evidence.complete = true;
  evidence.completedAt = new Date().toISOString();
  evidence.scope = 'Pool-authorized native claims from prior contract-authenticated portfolio state. RPC canonical block and external balance checks independently reconcile fixture gas and proposer tips; they are not the finality trust anchor.';
  write(file, evidence);
  console.log(JSON.stringify({ complete: true, totalNativePayout: evidence.totalNativePayout, fee: evidence.fee,
    remainingCash: evidence.remainingCash, evidence: path.relative(runtime, file) }));
}

module.exports = { claimAll };
