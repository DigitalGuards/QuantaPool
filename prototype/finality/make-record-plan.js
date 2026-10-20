// Consume actual finalized Qrysm record proofs after real sync-certificate checks.
// This no-funds probe records observations and makes no pooled-asset entitlement.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { headerRoot, proposalId, votes } = require('./make-plan');

const repo = path.resolve(__dirname, '../..');
const origin = `Q${'11'.repeat(64)}`;
const independent = `Q${'22'.repeat(64)}`;
const zero = `0x${'00'.repeat(32)}`;
const future = (2n ** 64n - 1n).toString();
const fields = ['index', 'publicKeyRoot', 'withdrawalRecipient', 'effectiveBalance', 'slashed',
    'activationEligibilityEpoch', 'activationEpoch', 'exitEpoch', 'withdrawableEpoch',
    'randaoCommitment', 'validatorBranch', 'balanceChunk', 'balanceBranch'];
const copy = value => structuredClone(value);
const header = value => ({ slot: value.slot, proposerIndex: value.proposer_index,
    parentRoot: value.parent_root, stateRoot: value.state_root, bodyRoot: value.body_root });
const record = value => Object.fromEntries(fields.map(field => [field, copy(value[field])]));
const flip = (value, offset = 0) => {
    const bytes = Buffer.from(value.slice(2), 'hex');
    bytes[offset] ^= 1;
    return `0x${bytes.toString('hex')}`;
};
function uint64Root(value) {
    const bytes = Buffer.alloc(32);
    bytes.writeBigUInt64LE(BigInt(value));
    return `0x${bytes.toString('hex')}`;
}

function buildRecordPlan(witness, network, artifacts, output) {
    if (witness.schemaVersion !== 1 || witness.updates.length < 1 ||
        witness.finalizedValidatorWitnesses?.length !== witness.updates.length ||
        witness.genesisValidatorsRoot !== network.beaconGenesis.genesis_validators_root) {
        throw new Error('Expected canonical finalized validator witnesses on the identified chain');
    }
    const records = witness.finalizedValidatorWitnesses;
    const first = records[0].validators[0];
    if (records.some(item => item.validators.length !== 1 || item.validators[0].index !== first.index ||
        item.validators[0].publicKeyRoot !== first.publicKeyRoot ||
        item.validators[0].withdrawalRecipient !== first.withdrawalRecipient)) {
        throw new Error('Probe requires exactly one immutable registered validator identity');
    }
    const config = network.beaconConfig;
    const genesis = network.beaconGenesis;
    const bootstrap = header(witness.bootstrapHeader);
    const timestamp = slot => {
        const value = BigInt(genesis.genesis_time) + BigInt(slot) * BigInt(config.SECONDS_PER_SLOT);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Timestamp exceeds safe integer');
        return Number(value);
    };
    const artifact = name => path.relative(path.dirname(output), path.join(artifacts, name));
    const steps = [];
    const deploy = (id, name, args, extra = {}) => steps.push({ name: `deploy ${id}`,
        op: 'deploy', id, artifact: artifact(name), args: copy(args), ...extra });
    const call = (name, target, method, args, extra = {}) => steps.push({ name, op: 'call',
        target, method, args: copy(args), ...extra });
    const reject = (name, args, reason, target = '@probe', extra = {}) =>
        call(name, target, 'observe', args, { revert: reason, ...extra });
    const observeArgs = item => [record(item.validators[0]), copy(item.slotBranch)];
    deploy('verifier', 'FinalityFeasibilityVerifier', [bootstrap, headerRoot(bootstrap),
        witness.bootstrapCurrentCommittee.root, witness.bootstrapCurrentCommittee.branch,
        witness.bootstrapNextCommittee.root, witness.bootstrapNextCommittee.branch,
        witness.genesisValidatorsRoot, genesis.genesis_fork_version, genesis.genesis_time,
        config.SECONDS_PER_SLOT, config.SLOTS_PER_EPOCH, '64']);
    const probeArgs = ['@verifier', first.index, first.publicKeyRoot, `Q${first.withdrawalRecipient.slice(2)}`, '64'];
    const invalid = [
        ['EOA verifier', 0, origin], ['validator beyond registry limit', 1, (2n ** 40n).toString()],
        ['empty registered key root', 2, zero], ['zero freshness window', 4, '0']
    ];
    for (const [name, index, value] of invalid) {
        const args = copy(probeArgs);
        args[index] = value;
        deploy(`reject ${name}`, 'FinalizedValidatorRecordProbe', args, { revert: 'invalid configuration' });
    }
    for (const id of ['probe', 'stale']) deploy(id, 'FinalizedValidatorRecordProbe', probeArgs);
    const tooYoung = copy(probeArgs);
    tooYoung[4] = '1';
    deploy('tooYoung', 'FinalizedValidatorRecordProbe', tooYoung);
    const otherRecipient = copy(probeArgs);
    otherRecipient[3] = origin;
    if (otherRecipient[3] === probeArgs[3]) otherRecipient[3] = independent;
    deploy('otherRecipient', 'FinalizedValidatorRecordProbe', otherRecipient);
    const count = Buffer.from(first.validatorBranch[40].slice(2), 'hex').readBigUInt64LE();
    const outside = copy(probeArgs);
    outside[1] = count.toString();
    deploy('outsideRegistry', 'FinalizedValidatorRecordProbe', outside);
    call('probe fixes verifier address', '@probe', 'verifier', [], { want: ['@verifier'] });
    call('probe fixes intended observation recipient including existing zero recipient', '@probe', 'poolRecipient', [], { want: [probeArgs[3]] });
    call('probe initially has no observation', '@probe', 'hasObservation', [], { want: [false] });
    reject('unaccepted future finalized record cannot be substituted into bootstrap', observeArgs(records[0]), 'invalid Merkle proof');

    const observations = [];
    for (let index = 0; index < witness.updates.length; index++) {
        const update = witness.updates[index];
        const observation = records[index];
        const value = observation.validators[0];
        if (!update.nativeSignatureVerification || observation.slot !== update.finalizedHeader.slot ||
            observation.stateRoot !== update.finalizedHeader.state_root ||
            headerRoot(header(update.attestedHeader)) !== update.attestedRoot ||
            headerRoot(header(update.finalizedHeader)) !== update.finalizedRoot) {
            throw new Error('Record proof state differs from captured certificate finality');
        }
        const prefix = `record[${index}]`;
        if (index) steps.push({ name: `${prefix} captured signature time`, op: 'time', time: timestamp(update.signatureSlot) });
        const begin = [header(update.attestedHeader), header(update.finalizedHeader), update.finalityBranch,
            update.finalizedNextCommittee.root, update.finalizedNextCommittee.branch];
        const id = proposalId(begin);
        call(`${prefix} begin authentic finality update`, '@verifier', 'beginUpdate', begin, { want: [id] });
        const selected = votes(update).slice(0, 86);
        for (let start = 0; start < selected.length; start += 12) {
            call(`${prefix} verify genuine committee positions ${start}-${Math.min(start + 12, 86) - 1}`,
                '@verifier', 'submit', [id, selected.slice(start, start + 12)], { from: independent });
        }
        call(`${prefix} finalize authenticated state`, '@verifier', 'finalize', [id], { from: independent });
        call(`${prefix} accepted state equals record proof source`, '@verifier', 'finalizedStateRoot', [], { want: [observation.stateRoot] });
        if (index === 0) {
            const mutations = [
                ['wrong validator index', args => { args[0].index = String(BigInt(first.index) + 1n); }, 'wrong registered identity'],
                ['wrong registered public key', args => { args[0].publicKeyRoot = flip(args[0].publicKeyRoot); }, 'wrong registered identity'],
                ['changed canonical recipient', args => { args[0].withdrawalRecipient = flip(args[0].withdrawalRecipient); }, 'wrong withdrawal recipient'],
                ['truncated recipient', args => { args[0].withdrawalRecipient = '0x01'; }, 'wrong withdrawal recipient'],
                ['wrong validator record branch', args => { args[0].validatorBranch[0] = flip(args[0].validatorBranch[0]); }, 'invalid Merkle proof'],
                ['wrong balance branch', args => { args[0].balanceBranch[0] = flip(args[0].balanceBranch[0]); }, 'invalid Merkle proof'],
                ['wrong balance at registered chunk offset', args => { args[0].balanceChunk = flip(args[0].balanceChunk, Number(BigInt(first.index) % 4n) * 8); }, 'invalid Merkle proof'],
                ['wrong effective balance', args => { args[0].effectiveBalance = String(BigInt(args[0].effectiveBalance) + 1n); }, 'invalid Merkle proof'],
                ['wrong slashed flag', args => { args[0].slashed = !args[0].slashed; }, 'invalid Merkle proof'],
                ['wrong activation epoch', args => { args[0].activationEpoch = String(BigInt(args[0].activationEpoch) + 1n); }, 'invalid Merkle proof'],
                ['wrong exit epoch', args => { args[0].exitEpoch = args[0].exitEpoch === future ? '1' : future; }, 'invalid Merkle proof'],
                ['wrong withdrawable epoch', args => { args[0].withdrawableEpoch = args[0].withdrawableEpoch === future ? '1' : future; }, 'invalid Merkle proof'],
                ['wrong RANDAO commitment', args => { args[0].randaoCommitment = flip(args[0].randaoCommitment); }, 'invalid Merkle proof'],
                ['wrong slot branch', args => { args[1][0] = flip(args[1][0]); }, 'invalid Merkle proof'],
                ['missing slot branch element', args => { args[1].pop(); }, 'invalid slot proof'],
                ['missing validator branch element', args => { args[0].validatorBranch.pop(); }, 'invalid branch length'],
                ['missing balance branch element', args => { args[0].balanceBranch.pop(); }, 'invalid branch length'],
                ['different validator and balance list lengths', args => { args[0].balanceBranch[38] = uint64Root(count + 1n); }, 'invalid list length'],
                ['noncanonical list length padding', args => { args[0].validatorBranch[40] = flip(args[0].validatorBranch[40], 31); }, 'invalid list length'],
                ['registry length above protocol maximum', args => { args[0].validatorBranch[40] = uint64Root(2n ** 40n + 1n); args[0].balanceBranch[38] = args[0].validatorBranch[40]; }, 'invalid list length']
            ];
            for (const [name, change, reason] of mutations) {
                const args = observeArgs(observation);
                change(args);
                reject(name, args, reason);
            }
            reject('authentic foreign-recipient record cannot satisfy configured recipient', observeArgs(observation), 'wrong withdrawal recipient', '@otherRecipient');
            reject('authenticated state must meet consumer age policy', observeArgs(observation), 'stale or future state', '@tooYoung');
            const outsideArgs = observeArgs(observation);
            outsideArgs[0].index = count.toString();
            reject('fixed index must exist inside authenticated registry length', outsideArgs, 'invalid list length', '@outsideRegistry');
            reject('observation contract rejects native funds', observeArgs(observation), '*', '@probe', { value: '1' });
            call('all rejected observations leave state unset', '@probe', 'hasObservation', [], { want: [false] });
        } else {
            reject(`${prefix} old record proof cannot replace current authenticated state`, observeArgs(records[index - 1]), 'invalid Merkle proof');
        }
        const epoch = BigInt(observation.slot) / BigInt(config.SLOTS_PER_EPOCH);
        const terminal = value.balance === '0' && value.activationEpoch !== future &&
            value.exitEpoch !== future && BigInt(value.exitEpoch) <= epoch &&
            value.withdrawableEpoch !== future && BigInt(value.withdrawableEpoch) <= epoch;
        call(`${prefix} independent caller authenticates actual validator observation`, '@probe', 'observe', observeArgs(observation), { from: independent });
        call(`${prefix} observation flag set`, '@probe', 'hasObservation', [], { want: [true] });
        call(`${prefix} exact finalized slot recorded`, '@probe', 'observedSlot', [], { want: [observation.slot] });
        call(`${prefix} exact native-shor balance recorded`, '@probe', 'balanceShor', [], { want: [value.balance] });
        call(`${prefix} terminal flag follows authenticated zero and exit state`, '@probe', 'terminal', [], { want: [terminal] });
        reject(`${prefix} same checkpoint cannot be observed twice`, observeArgs(observation), 'checkpoint did not advance');
        observations.push({ slot: observation.slot, index: value.index, balanceShor: value.balance,
            terminal, exitEpoch: value.exitEpoch, withdrawableEpoch: value.withdrawableEpoch });
    }
    const last = records.at(-1);
    steps.push({ name: 'advance beyond consumer finalized-state age limit', op: 'time', time: timestamp(BigInt(last.slot) + 65n) });
    reject('stale finalized record rejected even without prior observation', observeArgs(last), 'stale or future state', '@stale');
    call('stale rejection leaves observation unset', '@stale', 'hasObservation', [], { want: [false] });
    steps.push({ name: 'observation consumer retains no native QRL', op: 'balance', target: '@probe', value: '0' });
    return { plan: { origin, accounts: { [origin]: '1000000000000000000', [independent]: '1000000000000000000' },
        time: timestamp(witness.updates[0].signatureSlot), steps },
        metadata: { schemaVersion: 1, qrysmCommit: witness.qrysmCommit, observations,
            boundary: 'Actual captured validator records authenticated after real committee signatures in go-qrl QRVM. Bootstrap trust and synthetic execution clock/state remain explicit. No funds, admission, reward/loss classification or execution-cash reconciliation.' } };
}

if (require.main === module) {
    const input = path.resolve(process.argv[2] || path.join(repo, 'findings/native-qrl-finality/fresh/witness-with-validator63.json'));
    const networkPath = path.resolve(process.argv[3] || path.join(repo, 'findings/native-qrl-prototype/network.json'));
    const artifacts = path.resolve(process.argv[4] || path.join(repo, 'build/prototype'));
    const output = path.resolve(process.argv[5] || path.join(repo, 'build/prototype/finality-record-plan.json'));
    const bytes = fs.readFileSync(input);
    const witness = JSON.parse(bytes);
    const lock = JSON.parse(fs.readFileSync(path.join(repo, 'prototype/source-lock.json'), 'utf8'));
    if (witness.qrysmCommit !== lock.repositories.qrysm.commit) throw new Error('Record witness does not match pinned Qrysm revision');
    const result = buildRecordPlan(witness, JSON.parse(fs.readFileSync(networkPath, 'utf8')), artifacts, output);
    result.metadata.witnessSha256 = createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result.plan, null, 2)}\n`);
    fs.writeFileSync(output.replace(/\.json$/, '.meta.json'), `${JSON.stringify(result.metadata, null, 2)}\n`);
    console.log(`Wrote ${result.plan.steps.length} actual-QRVM checks for ${result.metadata.observations.length} authenticated validator observations.`);
}

module.exports = { buildRecordPlan };
