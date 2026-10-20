// Real finality/account captures run through pinned go-qrl QRVM bytecode.
// Synthetic trie/parser cases are independent test inputs without economic authority.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { encode } = require('@ethereumjs/rlp');
const { keccak256 } = require('@theqrl/web3-utils');
const { headerRoot, proposalId, votes } = require('../finality/make-plan');

const repo = path.resolve(__dirname, '../..');
const origin = `Q${'11'.repeat(64)}`;
const independent = `Q${'22'.repeat(64)}`;
const zeroAddress = `Q${'00'.repeat(64)}`;
const copy = value => structuredClone(value);
const bytes = value => Buffer.from(value.slice(2), 'hex');
const hex = value => `0x${Buffer.from(value).toString('hex')}`;
const rlp = value => Buffer.from(encode(value));
const hash = value => keccak256(hex(value));
const flip = (value, index = 0) => {
    const out = bytes(value);
    out[index] ^= 1;
    return hex(out);
};
const header = value => ({ slot: value.slot, proposerIndex: value.proposer_index,
    parentRoot: value.parent_root, stateRoot: value.state_root, bodyRoot: value.body_root });
const checkpoint = value => Object.fromEntries(['executionStateRoot', 'executionBlock',
    'executionDepositIndex', 'executionStateRootBranch', 'executionBlockBranch',
    'executionDepositIndexBranch', 'accountProof'].map(field => [field, copy(value[field])]));
const integer = value => {
    let encoded = BigInt(value).toString(16);
    if (encoded === '0') return Buffer.alloc(0);
    if (encoded.length % 2) encoded = `0${encoded}`;
    return Buffer.from(encoded, 'hex');
};
function compact(nibbles, leaf) {
    const odd = nibbles.length % 2;
    return Buffer.from((leaf ? 2 + odd : odd).toString(16) + (odd ? '' : '0') + nibbles.join(''), 'hex');
}

function syntheticFixtures() {
    const address = origin;
    const key = keccak256(`0x${address.slice(1)}`);
    const nibbles = key.slice(2).split('');
    const storageRoot = bytes(keccak256('0x80'));
    const codeHash = bytes(keccak256('0x'));
    const account = (balance, nonce = 1n) => rlp([integer(nonce), integer(balance), storageRoot, codeHash]);
    const wrap = (name, value, proof, entries, balance) => ({ name, account: address, key,
        root: hash(proof[0]), proof: proof.map(hex), entries, balance: String(balance), accountRLP: hex(value) });
    const leaf = (name, balance, nonce = 1n) => {
        const value = account(balance, nonce);
        return wrap(name, value, [rlp([compact(nibbles, true), value])], [{ key, value: hex(value) }], balance);
    };
    const fixtures = [0n, 1n, 127n, 128n, 255n, 256n, (1n << 256n) - 1n]
        .map(value => leaf(`single leaf balance ${value}`, value));
    fixtures.push(leaf('maximum uint64 nonce', 7n, (1n << 64n) - 1n));
    for (const prefix of [0, 1, 2, 5, 62, 63]) {
        const value = account(BigInt(1000 + prefix));
        const otherValue = account(37n);
        const other = copy(nibbles);
        other[prefix] = (parseInt(other[prefix], 16) ^ 1).toString(16);
        const targetLeaf = rlp([compact(nibbles.slice(prefix + 1), true), value]);
        const otherLeaf = rlp([compact(other.slice(prefix + 1), true), otherValue]);
        const branches = Array.from({ length: 17 }, () => Buffer.alloc(0));
        branches[parseInt(nibbles[prefix], 16)] = bytes(hash(targetLeaf));
        branches[parseInt(other[prefix], 16)] = bytes(hash(otherLeaf));
        const branch = rlp(branches);
        const proof = prefix ? [rlp([compact(nibbles.slice(0, prefix), false), bytes(hash(branch))]), branch, targetLeaf]
            : [branch, targetLeaf];
        fixtures.push(wrap(`branch with ${prefix}-nibble extension`, value, proof,
            [{ key, value: hex(value) }, { key: `0x${other.join('')}`, value: hex(otherValue) }], 1000 + prefix));
    }
    return { fixtures, key, nibbles, storageRoot, codeHash, account };
}

function buildCheckpointPlan(finality, pool, positive, network, artifactDirectory, output) {
    if (finality.schemaVersion !== 1 || finality.updates.length !== 1 ||
        finality.genesisValidatorsRoot !== network.beaconGenesis.genesis_validators_root) {
        throw new Error('Expected one paired actual update on the identified fixture');
    }
    const update = finality.updates[0];
    const config = network.beaconConfig;
    const genesis = network.beaconGenesis;
    if (!update.nativeSignatureVerification ||
        headerRoot(header(update.attestedHeader)) !== update.attestedRoot ||
        headerRoot(header(update.finalizedHeader)) !== update.finalizedRoot ||
        BigInt(update.signatureSlot) !== BigInt(update.attestedHeader.slot) + 1n ||
        config.SLOTS_PER_EPOCH !== '8' || config.EPOCHS_PER_SYNC_COMMITTEE_PERIOD !== '8') {
        throw new Error('Unexpected native certificate fields');
    }
    for (const witness of [pool, positive]) {
        if (!witness.nativeSSZVerified || !witness.nativeAccountProofVerified ||
            witness.slot !== update.finalizedHeader.slot ||
            witness.beaconStateRoot !== update.finalizedHeader.state_root ||
            witness.executionStateRoot !== pool.executionStateRoot ||
            witness.executionBlock !== pool.executionBlock ||
            witness.executionDepositIndex !== pool.executionDepositIndex) {
            throw new Error('Account proof differs from accepted certificate cutoff');
        }
    }
    if (pool.balanceBaseUnits !== '0' || BigInt(positive.balanceBaseUnits) <= 0n || pool.account === positive.account) {
        throw new Error('Expected real zero and separate positive account fixtures');
    }
    const timestamp = slot => {
        const value = BigInt(genesis.genesis_time) + BigInt(slot) * BigInt(config.SECONDS_PER_SLOT);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Timestamp exceeds safe integer');
        return Number(value);
    };
    const artifact = name => path.relative(path.dirname(output), path.join(artifactDirectory, name));
    const steps = [];
    const deploy = (id, name, args, extra = {}) => steps.push({ name: `deploy ${id}`, op: 'deploy',
        id, artifact: artifact(name), args: copy(args), ...extra });
    const call = (name, target, method, args = [], extra = {}) => steps.push({ name, op: 'call',
        target, method, args: copy(args), ...extra });
    const reject = (name, target, method, args = [], reason = '*') =>
        call(name, target, method, args, { revert: reason });
    const observe = (name, target, value, extra = {}) => call(name, target, 'observe', [checkpoint(value)], extra);
    const rejectObserve = (name, value, reason = '*', target = '@pool') =>
        observe(name, target, value, { revert: reason });
    const clock = slot => steps.push({ name: `fixture time advances to slot ${slot}`, op: 'time', time: timestamp(slot) });
    const bootstrap = header(finality.bootstrapHeader);
    deploy('verifier', 'RecoverableFinalityVerifier', [bootstrap, headerRoot(bootstrap),
        finality.bootstrapCurrentCommittee.root, finality.bootstrapCurrentCommittee.branch,
        finality.bootstrapNextCommittee.root, finality.bootstrapNextCommittee.branch,
        finality.genesisValidatorsRoot, genesis.genesis_fork_version, genesis.genesis_time,
        config.SECONDS_PER_SLOT, config.SLOTS_PER_EPOCH, '64', '256']);
    deploy('reject EOA verifier', 'FinalizedPoolCashProbe', [origin, pool.account], { revert: 'invalid configuration' });
    deploy('reject empty account', 'FinalizedPoolCashProbe', ['@verifier', zeroAddress], { revert: 'invalid configuration' });
    for (const id of ['pool', 'boundary', 'stale', 'expired']) deploy(id, 'FinalizedPoolCashProbe', ['@verifier', pool.account]);
    deploy('positive', 'FinalizedPoolCashProbe', ['@verifier', positive.account]);
    const otherAccount = `Q${flip(`0x${pool.account.slice(1)}`).slice(2)}`;
    deploy('wrongAccount', 'FinalizedPoolCashProbe', ['@verifier', otherAccount]);
    const truncated = `Q${'00'.repeat(32)}${pool.account.slice(-64)}`;
    deploy('truncatedAccount', 'FinalizedPoolCashProbe', ['@verifier', truncated]);
    deploy('harness', 'NativeAccountProofHarness', []);
    call('immutable account includes all 64 bytes', '@pool', 'account', [], { want: [pool.account] });
    call('immutable verifier configured', '@pool', 'verifier', [], { want: ['@verifier'] });
    call('initial account observation is absent', '@pool', 'hasObservation', [], { want: [false] });
    rejectObserve('future account checkpoint cannot replace trusted bootstrap', pool, 'invalid SSZ proof');

    const begin = [header(update.attestedHeader), header(update.finalizedHeader), copy(update.finalityBranch),
        update.finalizedNextCommittee.root, copy(update.finalizedNextCommittee.branch)];
    const id = proposalId(begin);
    call('stage actual Qrysm update', '@verifier', 'beginUpdate', begin, { from: independent, want: [id] });
    const selected = votes(update).slice(0, 86);
    for (let start = 0; start < 85; start += 12) {
        call(`actual native signatures ${start}-${Math.min(start + 12, 85) - 1}`, '@verifier', 'submit',
            [id, selected.slice(start, Math.min(start + 12, 85))], { from: independent });
    }
    reject('85 authenticated positions cannot finalize', '@verifier', 'finalize', [id]);
    rejectObserve('incomplete certificate cannot authorize execution cash', pool, 'invalid SSZ proof');
    call('complete real positional quorum', '@verifier', 'submit', [id, [selected[85]]], { from: independent });
    call('finalize actual Qrysm state', '@verifier', 'finalize', [id], { from: independent });
    call('economic checkpoint equals paired account root', '@verifier', 'economicCheckpoint', [],
        { want: [pool.slot, pool.beaconStateRoot] });

    const mutations = [
        ['forged execution root', value => { value.executionStateRoot = flip(value.executionStateRoot); }, 'invalid SSZ proof'],
        ['forged execution block cutoff', value => { value.executionBlock = String(BigInt(value.executionBlock) + 1n); }, 'invalid SSZ proof'],
        ['forged deposit consumption cursor', value => { value.executionDepositIndex = String(BigInt(value.executionDepositIndex) + 1n); }, 'invalid SSZ proof'],
        ...['executionStateRootBranch', 'executionBlockBranch', 'executionDepositIndexBranch'].flatMap(field => [
            [`wrong ${field}`, value => { value[field][0] = flip(value[field][0]); }, 'invalid SSZ proof'],
            [`missing ${field} sibling`, value => { value[field].pop(); }, 'invalid SSZ branch length'],
            [`extra ${field} sibling`, value => { value[field].push(value[field][0]); }, 'invalid SSZ branch length']
        ]),
        ['forged account leaf value', value => { value.accountProof[value.accountProof.length - 1] = flip(value.accountProof.at(-1), bytes(value.accountProof.at(-1)).length - 1); }, 'wrong trie node'],
        ['truncated account proof', value => { value.accountProof.pop(); }, 'missing trie node'],
        ['truncated encoded account node', value => { value.accountProof[0] = value.accountProof[0].slice(0, -2); }, 'wrong trie node'],
        ['reordered account proof', value => { value.accountProof.reverse(); }, 'wrong trie node'],
        ['extra account proof node', value => { value.accountProof.push(value.accountProof.at(-1)); }, 'incomplete leaf'],
        ['empty account proof', value => { value.accountProof = []; }, 'proof bound'],
        ['excess account proof nodes', value => { value.accountProof = Array(66).fill(value.accountProof[0]); }, 'proof bound'],
        ['foreign account proof under correct execution root', value => { value.accountProof = copy(positive.accountProof); }, '*']
    ];
    for (const [name, mutate, reason] of mutations) {
        const changed = copy(pool); mutate(changed); rejectObserve(name, changed, reason);
    }
    rejectObserve('first address half cannot be replaced', pool, '*', '@wrongAccount');
    rejectObserve('32-byte truncation and zero padding cannot identify pool', pool, '*', '@truncatedAccount');
    observe('nonpayable cash observer rejects transferred value', '@pool', pool, { value: '1', revert: '*' });
    call('rejected proofs leave observation absent', '@pool', 'hasObservation', [], { want: [false] });
    call('rejected proofs leave cash zero', '@pool', 'cashBalance', [], { want: ['0'] });
    call('pure harness matches real zero account RLP', '@harness', 'prove', [pool.executionStateRoot, pool.account, pool.accountProof], { want: ['0'] });
    call('pure harness matches real positive account RLP', '@harness', 'prove', [positive.executionStateRoot, positive.account, positive.accountProof], { want: [positive.balanceBaseUnits] });
    for (const [target, witness] of [['@pool', pool], ['@positive', positive]]) {
        observe(`${target} independent observation succeeds`, target, witness, { from: independent });
        call(`${target} observation recorded`, target, 'hasObservation', [], { want: [true] });
        call(`${target} exact finalized slot`, target, 'observedSlot', [], { want: [witness.slot] });
        call(`${target} exact execution cutoff`, target, 'observedExecutionBlock', [], { want: [witness.executionBlock] });
        call(`${target} exact deposit cursor`, target, 'observedDepositIndex', [], { want: [witness.executionDepositIndex] });
        call(`${target} exact proven base-unit balance`, target, 'cashBalance', [], { want: [witness.balanceBaseUnits] });
        rejectObserve(`${target} repeated slot cannot be observed`, witness, 'checkpoint did not advance', target);
        steps.push({ name: `${target} proof consumer holds no QRL`, op: 'balance', target, value: '0' });
    }

    const synthetic = syntheticFixtures();
    for (const fixture of synthetic.fixtures) {
        call(`synthetic canonical trie: ${fixture.name}`, '@harness', 'prove',
            [fixture.root, fixture.account, fixture.proof], { want: [fixture.balance] });
    }
    const makeLeaf = accountBytes => rlp([compact(synthetic.nibbles, true), accountBytes]);
    const parserCases = [
        ['zero integer encoded as byte zero', makeLeaf(rlp([integer(1), Buffer.from([0]), synthetic.storageRoot, synthetic.codeHash])), 'noncanonical integer'],
        ['balance integer with leading zero', makeLeaf(rlp([integer(1), Buffer.from([0, 1]), synthetic.storageRoot, synthetic.codeHash])), 'noncanonical integer'],
        ['balance beyond supported uint256', makeLeaf(synthetic.account(1n << 256n)), 'noncanonical integer'],
        ['nonce beyond canonical uint64', makeLeaf(synthetic.account(1n, 1n << 64n)), 'noncanonical integer'],
        ['short storage root', makeLeaf(rlp([integer(1), integer(2), Buffer.alloc(31), synthetic.codeHash])), 'invalid account'],
        ['extra account field', makeLeaf(rlp([integer(1), integer(2), synthetic.storageRoot, synthetic.codeHash, Buffer.alloc(0)])), 'invalid account'],
        ['account balance encoded as list', makeLeaf(rlp([integer(1), [], synthetic.storageRoot, synthetic.codeHash])), 'noncanonical integer'],
        ['compact flag above three', rlp([Buffer.concat([Buffer.from([0x40]), bytes(synthetic.key)]), synthetic.account(3n)]), 'invalid compact flag'],
        ['even compact padding nonzero', rlp([Buffer.concat([Buffer.from([0x21]), bytes(synthetic.key)]), synthetic.account(3n)]), 'invalid compact padding'],
        ['incomplete leaf path', rlp([compact(synthetic.nibbles.slice(0, -2), true), synthetic.account(3n)]), 'incomplete leaf'],
        ['empty extension', rlp([Buffer.from([0]), bytes(synthetic.fixtures[0].root)]), 'empty extension'],
        ['non-list node', Buffer.from([0x80]), 'invalid RLP list'],
        ['truncated RLP list payload', Buffer.from([0xc2, 0x80]), 'truncated RLP payload'],
        ['noncanonical long RLP list', Buffer.from([0xf8, 0x01, 0x80]), 'noncanonical long form'],
        ['RLP trailing byte', Buffer.concat([bytes(synthetic.fixtures[0].proof[0]), Buffer.from([0])]), 'invalid RLP list']
    ];
    for (const [name, node, reason] of parserCases) {
        reject(`synthetic malformed parser input: ${name}`, '@harness', 'prove', [hash(node), origin, [hex(node)]], reason);
    }
    const proof = copy(synthetic.fixtures[0].proof); proof.push(proof[0]);
    reject('synthetic canonical leaf rejects unused proof node', '@harness', 'prove', [synthetic.fixtures[0].root, origin, proof], 'incomplete leaf');
    reject('synthetic proof rejects zero state root', '@harness', 'prove', [`0x${'00'.repeat(32)}`, origin, synthetic.fixtures[0].proof], 'proof bound');

    const finalSlot = BigInt(pool.slot);
    clock(finalSlot + 64n);
    observe('economic age equal to64 remains available', '@boundary', pool, { from: independent });
    clock(finalSlot + 65n);
    call('verifier reports historical catch-up status', '@verifier', 'status', [], { want: ['1'] });
    rejectObserve('economically stale authentic account proof rejected', pool, '*', '@stale');
    call('stale rejection leaves observation absent', '@stale', 'hasObservation', [], { want: [false] });
    call('raw historical root remains readable for diagnostics', '@verifier', 'finalizedStateRoot', [], { want: [pool.beaconStateRoot] });
    clock(finalSlot + 257n);
    call('verifier reports implicit permanent expiry', '@verifier', 'status', [], { want: ['2'] });
    rejectObserve('expired authentic account proof rejected without expiry transaction', pool, '*', '@expired');
    call('independent caller records expiry', '@verifier', 'expire', [], { from: independent });
    rejectObserve('latched expiry cannot authorize account proof', pool, '*', '@expired');
    call('expiry rejection leaves observation absent', '@expired', 'hasObservation', [], { want: [false] });
    call('expiry preserves previously observed account value', '@positive', 'cashBalance', [], { want: [positive.balanceBaseUnits] });
    return { plan: { origin, accounts: { [origin]: '1000000000000000000', [independent]: '1000000000000000000' },
        time: timestamp(update.signatureSlot), steps }, synthetic: synthetic.fixtures,
    metadata: { schemaVersion: 1, qrysmCommit: finality.qrysmCommit,
        bootstrapSlot: bootstrap.slot, attestedSlot: update.attestedHeader.slot, signatureSlot: update.signatureSlot,
        finalizedSlot: pool.slot, beaconStateRoot: pool.beaconStateRoot, executionStateRoot: pool.executionStateRoot,
        executionBlock: pool.executionBlock, executionDepositIndex: pool.executionDepositIndex,
        realAccountProofs: [pool, positive].map(value => ({ account: value.account, balance: value.balanceBaseUnits,
            proofNodes: value.proofNodes, proofBytes: value.proofBytes })),
        syntheticCanonicalCases: synthetic.fixtures.length, syntheticMalformedCases: parserCases.length,
        boundary: 'Real captured signatures and paired account proofs in actual go-qrl QRVM. Execution state/time and separate parser trie roots are fixtures. Trusted bootstrap, bounded finality policy and a complete economic ledger remain separate requirements.' } };
}

if (require.main === module) {
    const input = path.resolve(process.argv[2] || path.join(repo, 'findings/native-qrl-checkpoint/paired'));
    const network = path.resolve(process.argv[3] || path.join(repo, 'findings/native-qrl-prototype/lifecycle/network.json'));
    const artifacts = path.resolve(process.argv[4] || path.join(repo, 'build/prototype'));
    const output = path.resolve(process.argv[5] || path.join(repo, 'build/prototype/checkpoint-plan.json'));
    const inputs = ['finality', 'pool', 'positive-account'].map(name => fs.readFileSync(path.join(input, name, 'witness.json')));
    const witnesses = inputs.map(value => JSON.parse(value));
    const lock = JSON.parse(fs.readFileSync(path.join(repo, 'prototype/source-lock.json'), 'utf8'));
    if (witnesses[0].qrysmCommit !== lock.repositories.qrysm.commit) throw new Error('Witness source revision mismatch');
    const result = buildCheckpointPlan(...witnesses, JSON.parse(fs.readFileSync(network, 'utf8')), artifacts, output);
    result.metadata.inputSHA256 = inputs.map(value => createHash('sha256').update(value).digest('hex'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result.plan, null, 2)}\n`);
    fs.writeFileSync(output.replace(/\.json$/, '.meta.json'), `${JSON.stringify(result.metadata, null, 2)}\n`);
    fs.writeFileSync(output.replace(/\.json$/, '.synthetic.json'), `${JSON.stringify(result.synthetic, null, 2)}\n`);
    console.log(`Wrote ${result.plan.steps.length} actual-QRVM checkpoint checks and ${result.synthetic.length} separately labelled canonical trie fixtures.`);
}

module.exports = { buildCheckpointPlan, syntheticFixtures };
