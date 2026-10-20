// Genuine current-Qrysm certificates executed by the current native verifier.
// The execution clock and initial balances are explicit VM fixture inputs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { encodeParameters } = require('@theqrl/web3-qrl-abi');
const { keccak256 } = require('@theqrl/web3-utils');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'build/native');
const read = file => JSON.parse(fs.readFileSync(file));
const hash = data => createHash('sha256').update(data).digest('hex');
const copied = value => structuredClone(value);
const provenance = read(path.join(__dirname, 'testdata/provenance.json'));
const packed = fs.readFileSync(path.join(__dirname, 'testdata/public-certificates.json.gz'));
assert.equal(hash(packed), provenance.sha256);
const { witness, network } = JSON.parse(gunzipSync(packed));
const source = read(path.join(root, 'native/network/source-lock.json'));
assert.equal(witness.qrysmCommit, source.qrysm);
assert.equal(provenance.goQrlCommit, source['go-qrl']);
assert.equal(network.chainId, 3151916);
const compilation = read(path.join(output, 'manifest.json'));
for (const [file, expected] of Object.entries(compilation.sourceHashes)) {
  assert.equal(hash(fs.readFileSync(path.join(root, 'native/contracts', file))), expected, 'Recompile current contract sources');
}
const artifact = compilation.contracts.find(value => value.contractName === 'NativeFinalityVerifier');
assert.equal(hash(fs.readFileSync(path.join(output, artifact.binFile))), artifact.creationSha256);

const header = value => ({ slot: value.slot, proposerIndex: value.proposer_index,
  parentRoot: value.parent_root, stateRoot: value.state_root, bodyRoot: value.body_root });
const headerType = { type: 'tuple', components: [
  { name: 'slot', type: 'uint64' }, { name: 'proposerIndex', type: 'uint64' },
  { name: 'parentRoot', type: 'bytes32' }, { name: 'stateRoot', type: 'bytes32' },
  { name: 'bodyRoot', type: 'bytes32' }
] };
const args = witness.updates.map(update => [header(update.attestedHeader), header(update.finalizedHeader),
  update.finalityBranch, update.finalizedNextCommittee.root, update.finalizedNextCommittee.branch]);
const ids = args.map(value => keccak256(encodeParameters([headerType, headerType, 'bytes32'], [value[0], value[1], value[3]])));
const votes = witness.updates.map(update => update.votes.map(value => ({ seat: value.seat,
  publicKeyRoot: witness.keys[value.key].root, publicKey: witness.keys[value.key].publicKey,
  signature: update.signatures[value.signature], branch: value.branch })));
const sha = data => createHash('sha256').update(data).digest();
function headerRoot(value) {
  const integer = number => { const bytes = Buffer.alloc(32); bytes.writeBigUInt64LE(BigInt(number)); return bytes; };
  let nodes = [integer(value.slot), integer(value.proposerIndex),
    ...[value.parentRoot, value.stateRoot, value.bodyRoot].map(hex => Buffer.from(hex.slice(2), 'hex')),
    Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)];
  while (nodes.length > 1) nodes = Array.from({ length: nodes.length / 2 }, (_, i) => sha(Buffer.concat([nodes[2 * i], nodes[2 * i + 1]])));
  return `0x${nodes[0].toString('hex')}`;
}
const flip = value => `0x${(parseInt(value.slice(2, 4), 16) ^ 1).toString(16).padStart(2, '0')}${value.slice(4)}`;
const genesis = network.beaconGenesis;
const bootstrap = header(witness.bootstrapHeader);
const constructor = [bootstrap, headerRoot(bootstrap), witness.bootstrapCurrentCommittee.root,
  witness.bootstrapCurrentCommittee.branch, witness.bootstrapNextCommittee.root, witness.bootstrapNextCommittee.branch,
  witness.genesisValidatorsRoot, genesis.genesis_fork_version, genesis.genesis_time, '3', '8', '64', '4096'];
const origin = `Q${'11'.repeat(64)}`;
const independent = `Q${'22'.repeat(64)}`;
const steps = [];
const timestamp = slot => Number(BigInt(genesis.genesis_time) + BigInt(slot) * 3n);
const clock = slot => steps.push({ name: `fixture clock ${slot}`, op: 'time', time: timestamp(slot) });
const deploy = (id, values = constructor, extra = {}) => steps.push({ name: `deploy ${id}`, op: 'deploy', id,
  artifact: 'NativeFinalityVerifier', args: copied(values), ...extra });
const call = (name, target, method, values = [], extra = {}) => steps.push({ name, op: 'call', target, method,
  args: copied(values), from: independent, ...extra });
const reject = (name, target, method, values = []) => call(name, target, method, values, { revert: '*' });
const submit = (prefix, target, index, count = 86) => {
  for (let at = 0; at < count; at += 12) call(`${prefix} submit ${at}`, target, 'submit', [ids[index], votes[index].slice(at, Math.min(at + 12, count))]);
};

const forgedAnchor = copied(constructor); forgedAnchor[1] = flip(forgedAnchor[1]);
deploy('forged anchor', forgedAnchor, { revert: '*' });
const forgedCommittee = copied(constructor); forgedCommittee[2] = flip(forgedCommittee[2]);
deploy('forged initial committee', forgedCommittee, { revert: '*' });
for (const value of ['0', '64']) { const invalid = copied(constructor); invalid[12] = value; deploy(`invalid recovery ${value}`, invalid, { revert: '*' }); }
for (const id of ['normal', 'historical', 'expiredPartial', 'expiredComplete', 'calibration']) deploy(id);
const wrongFork = copied(constructor); wrongFork[7] = flip(wrongFork[7]); deploy('wrongFork', wrongFork);
reject('expiry cannot be forced early', '@normal', 'expire');

for (let index = 0; index < args.length; index++) {
  const prefix = `normal_${index}`;
  const update = witness.updates[index];
  assert(update.nativeSignatureVerification);
  assert.equal(headerRoot(args[index][0]), update.attestedRoot);
  assert.equal(headerRoot(args[index][1]), update.finalizedRoot);
  clock(update.signatureSlot);
  if (index === 0) {
    const bad = copied(args[0]); bad[1].stateRoot = flip(bad[1].stateRoot);
    reject('unauthenticated finalized root', '@normal', 'beginUpdate', bad);
    const badBranch = copied(args[0]); badBranch[4][0] = flip(badBranch[4][0]);
    reject('unauthenticated next committee', '@normal', 'beginUpdate', badBranch);
    const staged = copied(args[0]); staged[0].bodyRoot = flip(staged[0].bodyRoot);
    const stagedId = keccak256(encodeParameters([headerType, headerType, 'bytes32'], [staged[0], staged[1], staged[3]]));
    call('public unverified proposal can stage', '@normal', 'beginUpdate', staged, { want: [stagedId] });
    reject('genuine vote cannot authenticate changed message', '@normal', 'submit', [stagedId, [votes[0][0]]]);
    reject('unverified root cannot finalize', '@normal', 'finalize', [stagedId]);
    call('wrong fork stages proof', '@wrongFork', 'beginUpdate', args[0]);
    reject('wrong fork rejects native signature', '@wrongFork', 'submit', [ids[0], [votes[0][0]]]);
    for (const id of ['expiredPartial', 'expiredComplete']) {
      call(`${id} stage before expiry`, `@${id}`, 'beginUpdate', args[0]);
      submit(id, `@${id}`, 0, id === 'expiredPartial' ? 85 : 86);
    }
    const cold = votes[0].find(value => votes[0].some(other => other.seat !== value.seat && other.publicKeyRoot === value.publicKeyRoot));
    const warm = votes[0].find(value => value.seat !== cold.seat && value.publicKeyRoot === cold.publicKeyRoot);
    const seed = votes[0].find(value => value.publicKeyRoot !== cold.publicKeyRoot);
    call('calibration begin', '@calibration', 'beginUpdate', args[0]);
    call('calibration initialize counters', '@calibration', 'submit', [ids[0], [seed]]);
    call('calibration uncached native key', '@calibration', 'submit', [ids[0], [cold]]);
    call('calibration cached native key', '@calibration', 'submit', [ids[0], [warm]]);
  }
  call(`${prefix} begin`, '@normal', 'beginUpdate', args[index], { want: [ids[index]] });
  reject(`${prefix} empty quorum`, '@normal', 'finalize', [ids[index]]);
  const tampered = copied(votes[index][0]); tampered.signature = flip(tampered.signature);
  reject(`${prefix} invalid signature`, '@normal', 'submit', [ids[index], [tampered]]);
  reject(`${prefix} duplicate atomic seat`, '@normal', 'submit', [ids[index], [votes[index][0], votes[index][0]]]);
  call(`${prefix} rejected batch rolled back`, '@normal', 'proposalVotes', [ids[index]], { want: ['0'] });
  submit(prefix, '@normal', index, 85);
  reject(`${prefix} 85 seats insufficient`, '@normal', 'finalize', [ids[index]]);
  reject(`${prefix} repeated seat`, '@normal', 'submit', [ids[index], [votes[index][0]]]);
  call(`${prefix} final vote`, '@normal', 'submit', [ids[index], [votes[index][85]]]);
  call(`${prefix} finalize`, '@normal', 'finalize', [ids[index]]);
  call(`${prefix} state authenticated`, '@normal', 'economicCheckpoint', [], { want: [update.finalizedHeader.slot, update.finalizedHeader.state_root] });
  call(`${prefix} committee transition`, '@normal', 'currentCommitteeRoot', [], { want: [update.signatureCommitteeRoot] });
  call(`${prefix} period`, '@normal', 'currentPeriod', [], { want: [update.signaturePeriod] });
  reject(`${prefix} replay`, '@normal', 'beginUpdate', args[index]);
}

clock(826);
call('historical cursor requires catch-up', '@historical', 'status', [], { want: ['1'] });
reject('stale historical root cannot authorize accounting', '@historical', 'economicCheckpoint');
for (let index = 0; index < args.length; index++) {
  call(`historical_${index} begin`, '@historical', 'beginUpdate', args[index]);
  submit(`historical_${index}`, '@historical', index);
  call(`historical_${index} finalize`, '@historical', 'finalize', [ids[index]]);
  call(`historical_${index} deadline renews only with fresh root`, '@historical', 'trustAnchorSlot', [], { want: [index < 2 ? '640' : '808'] });
}
call('freshly caught up root authorizes accounting', '@historical', 'economicCheckpoint', [], { want: ['808', witness.updates[2].finalizedHeader.state_root] });
clock(4737);
for (const id of ['expiredPartial', 'expiredComplete']) {
  call(`${id} expired without privileged transaction`, `@${id}`, 'status', [], { want: ['2'] });
  reject(`${id} finalization cannot renew expired trust`, `@${id}`, 'finalize', [ids[0]]);
  reject(`${id} accounting fails closed`, `@${id}`, 'economicCheckpoint');
}
reject('late genuine vote cannot renew expired trust', '@expiredPartial', 'submit', [ids[0], [votes[0][85]]]);
call('anyone latches irreversible expiry', '@expiredComplete', 'expire');
reject('known valid update cannot restart expired verifier', '@expiredComplete', 'beginUpdate', args[1]);
call('expired proposal can be discarded', '@expiredPartial', 'discard', [ids[0]]);
call('discard never resets trust', '@expiredPartial', 'status', [], { want: ['2'] });
const plan = { origin, accounts: { [origin]: '1000000000000000000000000', [independent]: '1000000000000000000000000' }, time: timestamp(640), steps };
const planPath = path.join(output, 'finality-plan.json');
const reportPath = path.join(output, 'finality-execution.json');
fs.writeFileSync(planPath, `${JSON.stringify(plan)}\n`);
const runner = path.join(output, 'execution');
execFileSync('go', ['build', '-mod=readonly', '-p=2', '-o', runner, '.'], {
  cwd: path.join(root, 'native/testing/execution'), env: { ...process.env, GOWORK: 'off', GOMAXPROCS: '2', GOTOOLCHAIN: source.goBuildToolchain }, stdio: 'pipe' });
const log = execFileSync(runner, ['-plan', planPath, '-report', reportPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
fs.writeFileSync(path.join(output, 'finality-execution.log'), log);
const report = read(reportPath);
const costs = witness.updates.map((update, index) => {
  const selected = report.steps.filter(value => value.name.startsWith(`normal_${index} `) &&
    !value.expectedRevert && ['beginUpdate', 'submit', 'finalize'].includes(value.method));
  return { finalizedSlot: update.finalizedHeader.slot, committeePeriod: update.signaturePeriod, signatures: 86,
    uniqueKeys: new Set(update.votes.map(value => value.key)).size,
    transactions: selected.length, calldataBytes: selected.reduce((sum, value) => sum + value.calldataBytes, 0),
    gasBeforeRefund: selected.reduce((sum, value) => sum + value.gasBeforeRefund, 0),
    largestTransactionGas: Math.max(...selected.map(value => value.gasBeforeRefund)) };
});
const result = { steps: report.steps.length, expectedReverts: report.steps.filter(value => value.expectedRevert).length,
  costs, provenance, boundary: 'Actual current native verifier and genuine captured current-Qrysm certificates, including two committee transitions. VM clock and balances are synthetic; separate lifecycle receipts demonstrate mined updates.' };
const coldStep = report.steps.find(value => value.name === 'calibration uncached native key');
const warmStep = report.steps.find(value => value.name === 'calibration cached native key');
const coldPremium = Math.max(0, coldStep.gasBeforeRefund - coldStep.intrinsicGas -
  (warmStep.gasBeforeRefund - warmStep.intrinsicGas));
result.scale = {
  measuredColdKeyPremiumGas: coldPremium,
  conservativeAllUncached86SeatVmGas: costs.at(-1).gasBeforeRefund + 86 * coldPremium,
  signaturesPerAcceptedCertificate: 86,
  pinnedMainnetSecondsPerSlot: 60,
  pinnedMainnetSlotsPerEpoch: 128,
  committeePeriodSlots: 1024,
  caveat: 'Upper-bound projection from measured key-cache cost, not an executed 100000-validator network. Calldata and signature count stay positional; complete portfolio proof work grows with owned validators and elapsed occupied blocks. VM totals exclude signed-transaction envelope costs. Local 64-slot freshness is unsuitable for mainnet finality latency; production windows require separate review.'
};
fs.writeFileSync(path.join(output, 'finality-results.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
