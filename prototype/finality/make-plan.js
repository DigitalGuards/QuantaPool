// Actual captured Qrysm signatures and SSZ witnesses executed by go-qrl QRVM.
// Bootstrap trust and fixed-fork, occupied-slot restrictions remain explicit.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { encodeParameters } = require('@theqrl/web3-qrl-abi');
const { keccak256 } = require('@theqrl/web3-utils');

const repo = path.resolve(__dirname, '../..');
const origin = `Q${'11'.repeat(64)}`;
const independent = `Q${'22'.repeat(64)}`;
const zero = `0x${'00'.repeat(32)}`;
const headerType = {
    type: 'tuple',
    components: [
        { name: 'slot', type: 'uint64' },
        { name: 'proposerIndex', type: 'uint64' },
        { name: 'parentRoot', type: 'bytes32' },
        { name: 'stateRoot', type: 'bytes32' },
        { name: 'bodyRoot', type: 'bytes32' }
    ]
};
const copy = value => structuredClone(value);
const flip = value => {
    const bytes = Buffer.from(value.slice(2), 'hex');
    bytes[0] ^= 1;
    return `0x${bytes.toString('hex')}`;
};
const sha = value => createHash('sha256').update(value).digest();
const header = value => ({
    slot: value.slot, proposerIndex: value.proposer_index,
    parentRoot: value.parent_root, stateRoot: value.state_root, bodyRoot: value.body_root
});
function headerRoot(value) {
    const integer = number => {
        const out = Buffer.alloc(32);
        out.writeBigUInt64LE(BigInt(number));
        return out;
    };
    let nodes = [integer(value.slot), integer(value.proposerIndex),
        ...[value.parentRoot, value.stateRoot, value.bodyRoot].map(hex => Buffer.from(hex.slice(2), 'hex')),
        Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)];
    while (nodes.length > 1) {
        nodes = Array.from({ length: nodes.length / 2 }, (_, i) => sha(Buffer.concat([nodes[2 * i], nodes[2 * i + 1]])));
    }
    return `0x${nodes[0].toString('hex')}`;
}
function proposalId(args) {
    return keccak256(encodeParameters([headerType, headerType, 'bytes32'], [args[0], args[1], args[3]]));
}
function votes(update) {
    const bits = Buffer.from(update.syncCommitteeBits.slice(2), 'hex');
    const committee = update.signatureCommittee;
    let signatureIndex = 0;
    const out = [];
    for (let seat = 0; seat < 128; seat++) {
        if (!(bits[Math.floor(seat / 8)] & (1 << (seat % 8)))) continue;
        out.push({ seat: String(seat), publicKeyRoot: committee.publicKeyRoots[seat],
            publicKey: committee.publicKeys[seat], signature: update.signatures[signatureIndex++],
            branch: copy(committee.seatBranches[seat]) });
    }
    if (out.length !== update.participants || signatureIndex !== update.signatures.length || out.length < 86) {
        throw new Error('Captured update does not contain a complete quorum of positional signatures');
    }
    return out;
}

function buildPlan(witness, network, artifact, options = {}) {
    const updates = witness.updates;
    const config = network.beaconConfig;
    const genesis = network.beaconGenesis;
    if (witness.schemaVersion !== 1 || updates.length < 3 ||
        genesis.genesis_validators_root !== witness.genesisValidatorsRoot ||
        config.SYNC_COMMITTEE_SIZE !== '128' || config.EPOCHS_PER_SYNC_COMMITTEE_PERIOD !== '8') {
        throw new Error('Unexpected captured witness or pinned network configuration');
    }
    for (const update of updates) {
        if (!update.nativeSignatureVerification ||
            headerRoot(header(update.attestedHeader)) !== update.attestedRoot ||
            headerRoot(header(update.finalizedHeader)) !== update.finalizedRoot ||
            BigInt(update.signatureSlot) !== BigInt(update.attestedHeader.slot) + 1n) {
            throw new Error('Witness is outside the verified occupied-slot feasibility subset');
        }
    }
    const maxAgeSlots = 64;
    const timestamp = slot => {
        const result = BigInt(genesis.genesis_time) + BigInt(slot) * BigInt(config.SECONDS_PER_SLOT);
        if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Timestamp exceeds safe integer');
        return Number(result);
    };
    const bootstrap = header(witness.bootstrapHeader);
    const constructor = [bootstrap, headerRoot(bootstrap), witness.bootstrapCurrentCommittee.root,
        witness.bootstrapCurrentCommittee.branch, witness.bootstrapNextCommittee.root,
        witness.bootstrapNextCommittee.branch, witness.genesisValidatorsRoot,
        genesis.genesis_fork_version, genesis.genesis_time, config.SECONDS_PER_SLOT,
        config.SLOTS_PER_EPOCH, String(maxAgeSlots)];
    const args = update => [header(update.attestedHeader), header(update.finalizedHeader),
        copy(update.finalityBranch), update.finalizedNextCommittee.root,
        copy(update.finalizedNextCommittee.branch)];
    const allVotes = updates.map(votes);
    const firstArgs = args(updates[0]);
    const firstId = proposalId(firstArgs);
    const steps = [];
    const costGroups = [];
    const call = (name, method, values, extra = {}) => steps.push({
        name, op: 'call', target: '@verifier', method, args: values, ...extra
    });
    const reject = (name, method, values, extra = {}) => call(name, method, values, { revert: '*', ...extra });
    const deploy = (id, values = constructor, extra = {}) => steps.push({
        name: `deploy ${id}`, op: 'deploy', id, artifact, args: copy(values), ...extra
    });
    const chunkSubmit = (prefix, target, id, values) => {
        for (let start = 0; start < values.length; start += 12) {
            call(`${prefix} submit ${start}-${Math.min(start + 12, values.length) - 1}`, 'submit',
                [id, values.slice(start, start + 12)], { target, from: independent });
        }
    };

    const badBootstrap = copy(constructor);
    badBootstrap[0].bodyRoot = flip(badBootstrap[0].bodyRoot);
    deploy('reject altered bootstrap header', badBootstrap, { revert: '*' });
    const badRoot = copy(constructor);
    badRoot[1] = flip(badRoot[1]);
    deploy('reject bootstrap header inconsistent with pinned root', badRoot, { revert: '*' });
    for (const index of [2, 4]) {
        const bad = copy(constructor);
        bad[index] = flip(bad[index]);
        deploy(`reject incorrect bootstrap committee ${index}`, bad, { revert: '*' });
    }
    const badBranch = copy(constructor);
    badBranch[3][0] = flip(badBranch[3][0]);
    deploy('reject incorrect bootstrap branch', badBranch, { revert: '*' });
    for (const id of ['verifier', 'stale', 'skip', 'delayed', 'full', 'calibration']) deploy(id);
    const wrongFork = copy(constructor);
    wrongFork[7] = flip(wrongFork[7]);
    deploy('wrongFork', wrongFork);
    const wrongGenesis = copy(constructor);
    wrongGenesis[6] = flip(wrongGenesis[6]);
    deploy('wrongGenesis', wrongGenesis);
    call('bootstrap header SSZ agrees with independent JavaScript calculation', 'headerRoot', [bootstrap], { want: [constructor[1]] });
    call('bootstrap finalized state is initially retained', 'finalizedStateRoot', [], { want: [bootstrap.stateRoot] });
    call('sync domain agrees with unmodified Qrysm signing domain', 'syncDomain', [], { want: [updates[0].domain] });
    call('QRL ABI proposal commitment agrees with contract', 'proposalId', [firstArgs[0], firstArgs[1], firstArgs[3]], { want: [firstId] });
    reject('future captured attested slot is rejected', 'beginUpdate', args(updates[1]));
    const futureSignature = copy(firstArgs);
    futureSignature[0].slot = updates[0].signatureSlot;
    reject('derived signature slot must already exist', 'beginUpdate', futureSignature);
    reject('unknown proposal cannot receive votes', 'submit', [zero, [allVotes[0][0]]]);
    reject('unknown proposal cannot finalize', 'finalize', [zero]);
    const changes = [
        ['incorrect finality branch', value => { value[2][1] = flip(value[2][1]); }],
        ['incorrect finalized header', value => { value[1].bodyRoot = flip(value[1].bodyRoot); }],
        ['incorrect next committee', value => { value[3] = flip(value[3]); }],
        ['incorrect next committee branch', value => { value[4][0] = flip(value[4][0]); }],
        ['incorrect finalized epoch witness', value => { value[2][0] = flip(value[2][0]); }],
        ['non-boundary finalized slot', value => { value[1].slot = String(BigInt(value[1].slot) + 1n); }],
        ['missing finality branch element', value => { value[2].pop(); }],
        ['missing next committee branch element', value => { value[4].pop(); }]
    ];
    for (const [name, change] of changes) {
        const changed = copy(firstArgs);
        change(changed);
        reject(name, 'beginUpdate', changed);
    }
    const competitor = copy(firstArgs);
    competitor[0].bodyRoot = flip(competitor[0].bodyRoot);
    const competingId = proposalId(competitor);
    call('unverified competing commitment may be staged independently', 'beginUpdate', competitor, { want: [competingId] });
    reject('genuine signature cannot authenticate changed header commitment', 'submit', [competingId, [allVotes[0][0]]]);
    call('failed competing signature leaves zero votes', 'proposalVotes', [competingId], { want: ['0'] });
    for (const id of ['wrongFork', 'wrongGenesis']) {
        call(`${id} can stage independently trusted checkpoint data`, 'beginUpdate', firstArgs, { target: `@${id}`, want: [firstId] });
        reject(`${id} domain rejects genuine signatures from captured chain`, 'submit', [firstId, [allVotes[0][0]]], { target: `@${id}` });
    }

    // Independent controls measure an all-seat certificate and stale quorum handling.
    for (const id of ['delayed', 'full']) {
        const prefix = `control[${id}]`;
        call(`${prefix} begin`, 'beginUpdate', firstArgs, { target: `@${id}`, want: [firstId] });
        chunkSubmit(prefix, `@${id}`, firstId, allVotes[0].slice(0, id === 'full' ? 128 : 86));
        if (id === 'full') {
            call(`${prefix} all captured positions counted`, 'proposalVotes', [firstId], { target: '@full', want: [String(allVotes[0].length)] });
            call(`${prefix} finalize`, 'finalize', [firstId], { target: '@full' });
            costGroups.push({ prefix, kind: 'captured-full-committee', positions: allVotes[0].length,
                uniqueKeys: new Set(allVotes[0].map(vote => vote.publicKeyRoot)).size });
        }
    }
    const seed = allVotes[0][0];
    const cold = allVotes[0].find(value => value.publicKeyRoot !== seed.publicKeyRoot &&
        allVotes[0].filter(other => other.publicKeyRoot === value.publicKeyRoot).length > 1);
    if (!cold) throw new Error('Captured committee does not support distinct-seat key-cache calibration');
    const warm = allVotes[0].find(value => value.publicKeyRoot === cold.publicKeyRoot && value.seat !== cold.seat);
    call('calibration begin', 'beginUpdate', firstArgs, { target: '@calibration', want: [firstId] });
    call('calibration seed nonzero counters', 'submit', [firstId, [seed]], { target: '@calibration' });
    call('calibration cold key', 'submit', [firstId, [cold]], { target: '@calibration' });
    const changedCachedKey = copy(warm);
    changedCachedKey.publicKey = flip(changedCachedKey.publicKey);
    reject('cached public-key root cannot authorize changed full key', 'submit', [firstId, [changedCachedKey]], { target: '@calibration' });
    call('calibration cached key at another valid seat', 'submit', [firstId, [warm]], { target: '@calibration' });

    const cached = new Set();
    for (let index = 0; index < updates.length; index++) {
        const update = updates[index];
        const values = args(update);
        const id = proposalId(values);
        const selected = allVotes[index].slice(0, 86);
        const prefix = `update[${index}]`;
        if (index) steps.push({ name: `${prefix} advance to captured signature slot`, op: 'time', time: timestamp(update.signatureSlot) });
        if (index === 2) reject('missing committee period cannot be skipped', 'beginUpdate', values, { target: '@skip' });
        call(`${prefix} attested header matches captured root`, 'headerRoot', [values[0]], { want: [update.attestedRoot] });
        call(`${prefix} finalized header matches captured root`, 'headerRoot', [values[1]], { want: [update.finalizedRoot] });
        call(`${prefix} begin`, 'beginUpdate', values, { want: [id], from: independent });
        reject(`${prefix} repeated begin rejected`, 'beginUpdate', values);
        reject(`${prefix} empty quorum cannot finalize`, 'finalize', [id]);
        if (index === 0) {
            const mutations = [
                ['wrong public key', vote => { vote.publicKey = flip(vote.publicKey); }],
                ['wrong public key root', vote => { vote.publicKeyRoot = flip(vote.publicKeyRoot); }],
                ['wrong committee membership branch', vote => { vote.branch[0] = flip(vote.branch[0]); }],
                ['wrong signature', vote => { vote.signature = flip(vote.signature); }],
                ['wrong signed message', vote => { vote.signature = allVotes[1][0].signature; }],
                ['invalid seat', vote => { vote.seat = '128'; }],
                ['wrong key length', vote => { vote.publicKey = '0x01'; }],
                ['wrong signature length', vote => { vote.signature = '0x01'; }],
                ['missing membership branch', vote => { vote.branch.pop(); }]
            ];
            for (const [name, mutate] of mutations) {
                const vote = copy(selected[0]);
                mutate(vote);
                reject(name, 'submit', [id, [vote]]);
            }
            reject('empty vote batch', 'submit', [id, []]);
            reject('batch exceeds twelve-position bound', 'submit', [id, selected.slice(0, 13)]);
            reject('duplicate position in atomic batch', 'submit', [id, [selected[0], selected[0]]]);
            call('failed atomic batch rolls back votes', 'proposalVotes', [id], { want: ['0'] });
            call('failed atomic batch rolls back key-cache insert', 'cachedKeyHash', [selected[0].publicKeyRoot], { want: [zero] });
            reject('incomplete proposal cannot be discarded early', 'discard', [id]);
        }
        chunkSubmit(prefix, '@verifier', id, selected.slice(0, 85));
        call(`${prefix} exact 85 distinct positions recorded`, 'proposalVotes', [id], { want: ['85'] });
        reject(`${prefix} 85 positions do not meet quorum`, 'finalize', [id]);
        reject(`${prefix} previously counted position cannot be replayed`, 'submit', [id, [selected[0]]]);
        call(`${prefix} submit final quorum position`, 'submit', [id, [selected[85]]], { from: independent });
        call(`${prefix} exact 86 distinct positions recorded`, 'proposalVotes', [id], { want: ['86'] });
        const bitmap = selected.reduce((value, vote) => value | (1n << BigInt(vote.seat)), 0n);
        call(`${prefix} bitmap records distinct seats including repeated keys`, 'proposalBitmap', [id], { want: [bitmap.toString()] });
        call(`${prefix} finalize`, 'finalize', [id], { from: independent });
        call(`${prefix} finalized slot advances`, 'finalizedSlot', [], { want: [update.finalizedHeader.slot] });
        call(`${prefix} finalized state matches captured Qrysm state`, 'finalizedStateRoot', [], { want: [update.finalizedHeader.state_root] });
        call(`${prefix} current period follows verified committee transitions`, 'currentPeriod', [], { want: [update.signaturePeriod] });
        call(`${prefix} current committee authenticated by predecessor`, 'currentCommitteeRoot', [], { want: [update.signatureCommittee.root] });
        call(`${prefix} next committee comes from finalized state`, 'nextCommitteeRoot', [], { want: [update.finalizedNextCommittee.root] });
        reject(`${prefix} finalized proposal cannot replay`, 'finalize', [id]);
        reject(`${prefix} old finalized checkpoint cannot restart`, 'beginUpdate', values);
        const unique = new Set(selected.map(vote => vote.publicKeyRoot));
        const newKeys = [...unique].filter(root => !cached.has(root));
        for (const root of unique) cached.add(root);
        costGroups.push({ prefix, kind: 'captured-quorum-update', update: index,
            attestedSlot: update.attestedHeader.slot, finalizedSlot: update.finalizedHeader.slot,
            period: update.signaturePeriod, positions: 86, uniqueKeys: unique.size,
            newKeys: newKeys.length, cachedKeysAfter: cached.size });
        if (index === 0) {
            reject('unfinished competing commitment cannot overwrite finalized root', 'finalize', [competingId]);
            call('independent caller discards obsolete competing commitment', 'discard', [competingId], { from: independent });
        }
    }
    const endSlot = BigInt(updates.at(-1).signatureSlot) + BigInt(maxAgeSlots) + 1n;
    steps.push({ name: 'advance beyond captured freshness window', op: 'time', time: timestamp(endSlot) });
    reject('stale authenticated attested slot cannot start update', 'beginUpdate', firstArgs, { target: '@stale' });
    reject('completed quorum must remain fresh at finalization', 'finalize', [firstId], { target: '@delayed' });
    reject('stale quorum cannot accept more signatures', 'submit', [firstId, [allVotes[0][86]]], { target: '@delayed' });
    call('expired partial or completed proposal can be discarded independently', 'discard', [firstId], { target: '@delayed', from: independent });
    call('stale rejected update leaves bootstrap finalized slot', 'finalizedSlot', [], { target: '@delayed', want: [bootstrap.slot] });
    deploy('reject stale bootstrap deployment', constructor, { revert: '*' });

    return {
        plan: { origin, accounts: { [origin]: '1000000000000000000', [independent]: '1000000000000000000' },
            time: timestamp(updates[0].signatureSlot), steps },
        metadata: { schemaVersion: 1, qrysmCommit: witness.qrysmCommit, bootstrapRoot: constructor[1],
            bootstrapSlot: bootstrap.slot, maxAgeSlots, costGroups,
            witnessSha256: options.witnessSha256 || null,
            boundary: 'Actual go-qrl QRVM verification of captured Qrysm SSZ and ML-DSA signatures; independently trusted bootstrap and fixed-fork occupied-slot subset; synthetic execution time and state, no network transaction submission.' }
    };
}

if (require.main === module) {
    const witnessPath = path.resolve(process.argv[2] || path.join(repo, 'findings/native-qrl-finality/capture/witness.json'));
    const networkPath = path.resolve(process.argv[3] || path.join(repo, 'findings/native-qrl-prototype/network.json'));
    const artifacts = path.resolve(process.argv[4] || path.join(repo, 'build/prototype'));
    const output = path.resolve(process.argv[5] || path.join(repo, 'build/prototype/finality-plan.json'));
    const bytes = fs.readFileSync(witnessPath);
    const witness = JSON.parse(bytes);
    const lock = JSON.parse(fs.readFileSync(path.join(repo, 'prototype/source-lock.json'), 'utf8'));
    if (witness.qrysmCommit !== lock.repositories.qrysm.commit) throw new Error('Captured witness does not match pinned prototype Qrysm source');
    const result = buildPlan(witness, JSON.parse(fs.readFileSync(networkPath, 'utf8')),
        path.relative(path.dirname(output), path.join(artifacts, 'FinalityFeasibilityVerifier')),
        { witnessSha256: sha(bytes).toString('hex') });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result.plan, null, 2)}\n`);
    fs.writeFileSync(output.replace(/\.json$/, '.meta.json'), `${JSON.stringify(result.metadata, null, 2)}\n`);
    console.log(`Wrote ${result.plan.steps.length} actual-QRVM finality component checks for ${result.metadata.costGroups.length - 1} captured updates. Bootstrap trust and restricted update support remain explicit.`);
}

module.exports = { buildPlan, headerRoot, proposalId, votes };
