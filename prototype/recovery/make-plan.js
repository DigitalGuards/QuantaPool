// Historical sync-certificate catch-up with a separate economic freshness gate.
// Real captured Qrysm witnesses; execution state/time are explicit QRVM fixtures.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { headerRoot, proposalId, votes } = require('../finality/make-plan');

const repo = path.resolve(__dirname, '../..');
const origin = `Q${'11'.repeat(64)}`;
const independent = `Q${'22'.repeat(64)}`;
const zero = `0x${'00'.repeat(32)}`;
const copy = value => structuredClone(value);
const header = value => ({ slot: value.slot, proposerIndex: value.proposer_index,
    parentRoot: value.parent_root, stateRoot: value.state_root, bodyRoot: value.body_root });
const flip = value => {
    const bytes = Buffer.from(value.slice(2), 'hex');
    bytes[0] ^= 1;
    return `0x${bytes.toString('hex')}`;
};

function buildPlan(witness, network, artifact) {
    if (witness.schemaVersion !== 1 || witness.bootstrapHeader.slot !== '80' ||
        witness.updates.length !== 4 || witness.genesisValidatorsRoot !== network.beaconGenesis.genesis_validators_root ||
        network.beaconConfig.SECONDS_PER_SLOT !== '6' || network.beaconConfig.SLOTS_PER_EPOCH !== '8') {
        throw new Error('Expected the pinned four-update historical capture and local timing');
    }
    const expected = [['112', '96'], ['144', '128'], ['208', '192'], ['288', '272']];
    witness.updates.forEach((update, index) => {
        if (!update.nativeSignatureVerification || update.attestedHeader.slot !== expected[index][0] ||
            update.finalizedHeader.slot !== expected[index][1] ||
            headerRoot(header(update.attestedHeader)) !== update.attestedRoot ||
            headerRoot(header(update.finalizedHeader)) !== update.finalizedRoot ||
            BigInt(update.signatureSlot) !== BigInt(update.attestedHeader.slot) + 1n) {
            throw new Error('Unexpected captured roots, slots or native verification status');
        }
    });
    const genesis = network.beaconGenesis;
    const bootstrap = header(witness.bootstrapHeader);
    const constructor = [bootstrap, headerRoot(bootstrap), witness.bootstrapCurrentCommittee.root,
        witness.bootstrapCurrentCommittee.branch, witness.bootstrapNextCommittee.root,
        witness.bootstrapNextCommittee.branch, witness.genesisValidatorsRoot,
        genesis.genesis_fork_version, genesis.genesis_time, '6', '8', '64', '256'];
    const updateArgs = witness.updates.map(update => [header(update.attestedHeader), header(update.finalizedHeader),
        copy(update.finalityBranch), update.finalizedNextCommittee.root, copy(update.finalizedNextCommittee.branch)]);
    const identifiers = updateArgs.map(proposalId);
    const selected = witness.updates.map(update => votes(update).slice(0, 86));
    const timestamp = slot => {
        const result = BigInt(genesis.genesis_time) + BigInt(slot) * 6n;
        if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Timestamp exceeds safe integer');
        return Number(result);
    };
    const steps = [];
    const call = (name, target, method, args = [], extra = {}) => steps.push({
        name, op: 'call', target, method, args: copy(args), ...extra
    });
    const reject = (name, target, method, args = [], extra = {}) => call(name, target, method, args, { revert: '*', ...extra });
    const deploy = (id, args = constructor, extra = {}) => steps.push({
        name: `deploy ${id}`, op: 'deploy', id, artifact, args: copy(args), ...extra
    });
    const clock = slot => steps.push({ name: `advance fixture clock to slot ${slot}`, op: 'time', time: timestamp(slot) });
    const begin = (name, target, index) => call(name, target, 'beginUpdate', updateArgs[index], { want: [identifiers[index]], from: independent });
    const submit = (name, target, index, count = 86) => {
        for (let start = 0; start < count; start += 12) {
            call(`${name} positions ${start}-${Math.min(start + 12, count) - 1}`, target, 'submit',
                [identifiers[index], selected[index].slice(start, Math.min(start + 12, count))], { from: independent });
        }
    };
    const anchor = (name, target, slot, deadline) => {
        call(`${name} anchor`, target, 'trustAnchorSlot', [], { want: [String(slot)] });
        call(`${name} deadline`, target, 'trustDeadlineSlot', [], { want: [String(deadline)] });
    };
    const status = (name, target, value) => call(name, target, 'status', [], { want: [String(value)] });
    const economic = (name, target, slot, stateRoot) => call(name, target, 'economicCheckpoint', [], { want: [String(slot), stateRoot] });

    for (const recovery of ['0', '63', '64']) {
        const args = copy(constructor);
        args[12] = recovery;
        deploy(`reject recovery window ${recovery}`, args, { revert: '*' });
    }
    const badRoot = copy(constructor);
    badRoot[1] = flip(badRoot[1]);
    deploy('reject bootstrap root mismatch', badRoot, { revert: '*' });
    const badCommittee = copy(constructor);
    badCommittee[2] = flip(badCommittee[2]);
    deploy('reject bootstrap committee mismatch', badCommittee, { revert: '*' });
    const badBranch = copy(constructor);
    badBranch[5][0] = flip(badBranch[5][0]);
    deploy('reject bootstrap next-committee branch mismatch', badBranch, { revert: '*' });
    for (const id of ['recovery', 'boundary']) deploy(id);
    const short = copy(constructor);
    short[12] = '65';
    for (const id of ['shortRenew', 'shortBegin', 'shortSubmit', 'shortFinalize']) deploy(id, short);
    call('immutable recovery window configured', '@recovery', 'recoveryWindowSlots', [], { want: ['256'] });
    call('immutable economic age configured separately', '@recovery', 'maxAgeSlots', [], { want: ['64'] });
    status('fresh bootstrap starts Live', '@recovery', 0);
    economic('fresh bootstrap economic root', '@recovery', 80, bootstrap.stateRoot);
    anchor('initial policy', '@recovery', 80, 336);
    reject('expiry cannot be forced early', '@recovery', 'expire');
    reject('future authentic certificate cannot start early', '@recovery', 'beginUpdate', updateArgs[1]);
    reject('unknown proposal cannot submit', '@recovery', 'submit', [zero, [selected[0][0]]]);

    // Authentic period-2 data remains fresh at slot 146, but the prior anchor's
    // 65-slot deadline was 145. Its signatures must not resurrect that trust.
    clock(145);
    for (const id of ['shortRenew', 'shortSubmit', 'shortFinalize']) {
        const target = `@${id}`;
        begin(`${id} authentic update at exact previous deadline`, target, 1);
        submit(`${id} actual signatures`, target, 1, id === 'shortSubmit' ? 85 : 86);
    }
    call('fresh quorum renews at exact old deadline', '@shortRenew', 'finalize', [identifiers[1]], { from: independent });
    anchor('successful boundary renewal', '@shortRenew', 128, 193);
    economic('renewed boundary checkpoint is economic', '@shortRenew', 128, witness.updates[1].finalizedHeader.state_root);
    status('deadline itself remains unexpired despite economic staleness', '@shortBegin', 1);
    reject('cannot expire at the exact deadline', '@shortBegin', 'expire');
    reject('economic stale bootstrap remains unavailable before expiry', '@shortBegin', 'economicCheckpoint');
    clock(146);
    status('deadline lapse reports Expired without keeper transaction', '@shortBegin', 2);
    call('implicit expiry needs no latched flag', '@shortBegin', 'expired', [], { want: [false] });
    reject('fresh authentic certificate cannot begin after old deadline', '@shortBegin', 'beginUpdate', updateArgs[1]);
    reject('last genuine vote cannot arrive after old deadline', '@shortSubmit', 'submit', [identifiers[1], [selected[1][85]]]);
    call('expired final vote leaves quorum at 85', '@shortSubmit', 'proposalVotes', [identifiers[1]], { want: ['85'] });
    reject('complete genuine quorum cannot finalize after old deadline', '@shortFinalize', 'finalize', [identifiers[1]]);
    anchor('expired complete quorum cannot renew', '@shortFinalize', 80, 145);
    reject('expired economic checkpoint is inaccessible', '@shortBegin', 'economicCheckpoint');
    call('independent caller latches expiry', '@shortBegin', 'expire', [], { from: independent });
    call('expiry flag permanently latched', '@shortBegin', 'expired', [], { want: [true] });
    reject('expired instance cannot be latched twice', '@shortBegin', 'expire');
    reject('fresh authentic data cannot resurrect latched instance', '@shortBegin', 'beginUpdate', updateArgs[1]);
    call('expired partial candidate can be discarded without expiry latch', '@shortSubmit', 'discard', [identifiers[1]], { from: independent });
    call('discard clears expired candidate votes', '@shortSubmit', 'proposalVotes', [identifiers[1]], { want: ['0'] });
    status('discard cannot restore trust', '@shortSubmit', 2);
    anchor('discard preserves expired deadline', '@shortSubmit', 80, 145);
    status('timely renewed instance remains Live', '@shortRenew', 0);

    clock(209);
    status('historical cursor enters CatchingUp', '@recovery', 1);
    reject('historical cursor cannot authorize economics', '@recovery', 'economicCheckpoint');
    reject('missing committee period still cannot be skipped', '@recovery', 'beginUpdate', updateArgs[2]);
    for (const [name, mutate] of [
        ['bad finality branch', args => { args[2][1] = flip(args[2][1]); }],
        ['bad finalized header root', args => { args[1].stateRoot = flip(args[1].stateRoot); }],
        ['bad next committee root', args => { args[3] = flip(args[3]); }],
        ['bad next committee branch', args => { args[4][0] = flip(args[4][0]); }],
        ['wrong checkpoint epoch', args => { args[2][0] = flip(args[2][0]); }]
    ]) {
        const args = copy(updateArgs[0]);
        mutate(args);
        reject(`historical catch-up rejects ${name}`, '@recovery', 'beginUpdate', args);
    }
    const competitor = copy(updateArgs[0]);
    competitor[0].bodyRoot = flip(competitor[0].bodyRoot);
    const competitorId = proposalId(competitor);
    call('independent pending commitment does not reserve global progress', '@recovery', 'beginUpdate', competitor, { want: [competitorId] });
    reject('genuine signatures cannot authenticate changed commitment', '@recovery', 'submit', [competitorId, [selected[0][0]]]);

    for (let index = 0; index < 4; index++) {
        if (index === 3) clock(289);
        const prefix = `history[${index}]`;
        begin(`${prefix} begin real captured update`, '@recovery', index);
        reject(`${prefix} duplicate candidate rejected`, '@recovery', 'beginUpdate', updateArgs[index]);
        reject(`${prefix} empty quorum cannot finalize`, '@recovery', 'finalize', [identifiers[index]]);
        if (index === 0) {
            reject('economic staleness cannot discard active historical proposal', '@recovery', 'discard', [identifiers[index]]);
            for (const [name, mutate] of [
                ['wrong membership branch', vote => { vote.branch[0] = flip(vote.branch[0]); }],
                ['wrong key root', vote => { vote.publicKeyRoot = flip(vote.publicKeyRoot); }],
                ['wrong full key', vote => { vote.publicKey = flip(vote.publicKey); }],
                ['wrong signature', vote => { vote.signature = flip(vote.signature); }],
                ['wrong signature message', vote => { vote.signature = selected[1][0].signature; }]
            ]) {
                const vote = copy(selected[0][0]);
                mutate(vote);
                reject(`historical authentication rejects ${name}`, '@recovery', 'submit', [identifiers[0], [vote]]);
            }
            reject('duplicate seats revert atomic historical batch', '@recovery', 'submit', [identifiers[0], [selected[0][0], selected[0][0]]]);
            call('failed batch rolls back historical vote count', '@recovery', 'proposalVotes', [identifiers[0]], { want: ['0'] });
            call('failed batch rolls back cached key insert', '@recovery', 'cachedKeyHash', [selected[0][0].publicKeyRoot], { want: [zero] });
            reject('thirteen-position historical batch exceeds bound', '@recovery', 'submit', [identifiers[0], votes(witness.updates[0]).slice(0, 13)]);
        }
        submit(`${prefix} authentic historical votes`, '@recovery', index, 85);
        reject(`${prefix} 85 positions remain insufficient`, '@recovery', 'finalize', [identifiers[index]]);
        reject(`${prefix} position cannot count twice`, '@recovery', 'submit', [identifiers[index], [selected[index][0]]]);
        call(`${prefix} complete 86-position quorum`, '@recovery', 'submit', [identifiers[index], [selected[index][85]]], { from: independent });
        call(`${prefix} accept verified checkpoint`, '@recovery', 'finalize', [identifiers[index]], { from: independent });
        call(`${prefix} historical state getter matches authentic root`, '@recovery', 'finalizedStateRoot', [], { want: [witness.updates[index].finalizedHeader.state_root] });
        call(`${prefix} period advances only by authenticated chain`, '@recovery', 'currentPeriod', [], { want: [witness.updates[index].signaturePeriod] });
        call(`${prefix} next committee proved from finalized state`, '@recovery', 'nextCommitteeRoot', [], { want: [witness.updates[index].finalizedNextCommittee.root] });
        if (index < 2) {
            anchor(`${prefix} historical progress cannot extend trust`, '@recovery', 80, 336);
            status(`${prefix} remains CatchingUp`, '@recovery', 1);
            reject(`${prefix} stale finalized root unavailable economically`, '@recovery', 'economicCheckpoint');
        } else {
            const slot = Number(witness.updates[index].finalizedHeader.slot);
            anchor(`${prefix} fresh finalized root renews trust`, '@recovery', slot, slot + 256);
            status(`${prefix} is Live`, '@recovery', 0);
            economic(`${prefix} fresh economic checkpoint available`, '@recovery', slot, witness.updates[index].finalizedHeader.state_root);
        }
        reject(`${prefix} finalized proposal cannot replay`, '@recovery', 'finalize', [identifiers[index]]);
        if (index === 0) call('superseded competing candidate can be removed', '@recovery', 'discard', [competitorId], { from: independent });
    }

    clock(336);
    begin('historical certificate starts at exact recovery boundary', '@boundary', 0);
    submit('boundary historical signatures', '@boundary', 0);
    call('historical quorum finalizes at exact recovery boundary', '@boundary', 'finalize', [identifiers[0]]);
    anchor('historical boundary acceptance does not renew', '@boundary', 80, 336);
    reject('exact recovery deadline cannot be expired early', '@boundary', 'expire');
    economic('economic age equal to limit remains usable', '@recovery', 272, witness.updates[3].finalizedHeader.state_root);
    clock(337);
    status('historical boundary instance expires next slot', '@boundary', 2);
    reject('historical next period cannot progress after boundary', '@boundary', 'beginUpdate', updateArgs[1]);
    status('economic age over limit enters CatchingUp before expiry', '@recovery', 1);
    reject('economic age over limit rejects economic getter', '@recovery', 'economicCheckpoint');
    anchor('economic staleness does not alter renewed trust anchor', '@recovery', 272, 528);
    clock(528);
    status('renewed exact deadline is still CatchingUp', '@recovery', 1);
    reject('renewed exact deadline cannot expire early', '@recovery', 'expire');
    clock(529);
    status('renewed trust expires without anyone calling expire', '@recovery', 2);
    reject('expired renewed instance offers no economic root', '@recovery', 'economicCheckpoint');
    call('any caller latches renewed-instance expiry', '@recovery', 'expire', [], { from: independent });
    anchor('expiry cannot extend or replace final trust anchor', '@recovery', 272, 528);
    call('renewed expiry is latched', '@recovery', 'expired', [], { want: [true] });
    steps.push({ name: 'recovery verifier holds no QRL', op: 'balance', target: '@recovery', value: '0' });
    return { plan: { origin, accounts: { [origin]: '1000000000000000000', [independent]: '1000000000000000000' },
        time: timestamp(113), steps },
        metadata: { schemaVersion: 1, qrysmCommit: witness.qrysmCommit,
            mainFreshnessSlots: 64, mainRecoverySlots: 256, boundaryRecoverySlots: 65,
            boundary: 'Actual QRVM execution of captured native signatures and SSZ proofs with synthetic clock/state. Recovery-window values are explicit test policy, not protocol-derived security guarantees. No user funds or economic pool accounting.' } };
}

if (require.main === module) {
    const witnessPath = path.resolve(process.argv[2] || path.join(repo, 'findings/native-qrl-finality/capture/witness.json'));
    const networkPath = path.resolve(process.argv[3] || path.join(repo, 'findings/native-qrl-prototype/network.json'));
    const artifacts = path.resolve(process.argv[4] || path.join(repo, 'build/prototype'));
    const output = path.resolve(process.argv[5] || path.join(repo, 'build/prototype/recovery-plan.json'));
    const bytes = fs.readFileSync(witnessPath);
    const witness = JSON.parse(bytes);
    const lock = JSON.parse(fs.readFileSync(path.join(repo, 'prototype/source-lock.json'), 'utf8'));
    if (witness.qrysmCommit !== lock.repositories.qrysm.commit) throw new Error('Capture does not match pinned Qrysm revision');
    const result = buildPlan(witness, JSON.parse(fs.readFileSync(networkPath, 'utf8')),
        path.relative(path.dirname(output), path.join(artifacts, 'RecoverableFinalityVerifier')));
    result.metadata.witnessSha256 = createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result.plan, null, 2)}\n`);
    fs.writeFileSync(output.replace(/\.json$/, '.meta.json'), `${JSON.stringify(result.metadata, null, 2)}\n`);
    console.log(`Wrote ${result.plan.steps.length} recovery checks with real captured certificates and explicit fixture time.`);
}

module.exports = { buildPlan };
