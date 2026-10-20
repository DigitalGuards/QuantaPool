// Build executable go-qrl QRVM checks against canonical Qrysm SSZ fixture roots.
// Constructor-pinned synthetic checkpoints are the explicit trust anchor here.
// This suite does not claim live consensus execution or finality authentication.
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const origin = `Q${'11'.repeat(64)}`;
const independentCaller = `Q${'22'.repeat(64)}`;

const witnessFields = [
    'index',
    'publicKeyRoot',
    'withdrawalRecipient',
    'effectiveBalance',
    'slashed',
    'activationEligibilityEpoch',
    'activationEpoch',
    'exitEpoch',
    'withdrawableEpoch',
    'randaoCommitment',
    'validatorBranch',
    'balanceChunk',
    'balanceBranch'
];

function witness(value) {
    return Object.fromEntries(witnessFields.map(field => [field, structuredClone(value[field])]));
}

function changed(value, edits) {
    return Object.assign(structuredClone(value), edits);
}

function flipByte(hex) {
    const bytes = Buffer.from(hex.slice(2), 'hex');
    bytes[0] ^= 1;
    return `0x${bytes.toString('hex')}`;
}

function address(hex) {
    return hex.startsWith('0x') ? `Q${hex.slice(2)}` : hex;
}

function buildPlan(fixtures, artifactStem) {
    const expectedNames = ['initial', 'loss-and-reward', 'active-zero', 'terminal-zero', 'reward-withdrawn'];
    if (
        fixtures.schemaVersion !== 1 || fixtures.checkpoints.length !== expectedNames.length ||
        expectedNames.some((name, index) => fixtures.checkpoints[index].name !== name)
    ) throw new Error('Unexpected canonical accounting fixture schema or checkpoint order');

    const checkpoints = fixtures.checkpoints;
    const indices = fixtures.registeredIndices;
    const maxAgeSlots = 256;
    const timestamp = slot => {
        const value = BigInt(fixtures.genesisTime) + BigInt(slot) * BigInt(fixtures.secondsPerSlot);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Fixture timestamp exceeds safe integer');
        return Number(value);
    };
    const portfolio = checkpoint => indices.map(index => {
        const value = checkpoint.validators.find(item => item.index === index);
        if (!value) throw new Error(`Missing registered index ${index}`);
        return witness(value);
    });
    const constructorArgs = [
        checkpoints.map(checkpoint => checkpoint.stateRoot),
        checkpoints.map(checkpoint => checkpoint.slot),
        fixtures.genesisTime,
        fixtures.secondsPerSlot,
        fixtures.slotsPerEpoch,
        String(maxAgeSlots),
        address(fixtures.poolRecipient),
        indices,
        portfolio(checkpoints[0]).map(value => value.publicKeyRoot)
    ];
    const steps = [];
    const call = (name, method, args, extra = {}) => steps.push({
        name, op: 'call', target: '@proof', method, args, ...extra
    });
    const reject = (name, method, args, extra = {}) => call(name, method, args, { revert: '*', ...extra });
    const candidateArgs = (checkpointIndex, value = checkpoints[checkpointIndex].validators[0]) => [
        String(checkpointIndex), checkpoints[checkpointIndex].slotBranch, witness(value), value.publicKey
    ];
    const terminalArgs = (checkpointIndex, value = checkpoints[checkpointIndex].validators[0]) => [
        String(checkpointIndex), checkpoints[checkpointIndex].slotBranch, witness(value)
    ];
    const checkpointArgs = checkpointIndex => [
        String(checkpointIndex), checkpoints[checkpointIndex].slotBranch, portfolio(checkpoints[checkpointIndex])
    ];

    steps.push({
        name: 'deploy immutable synthetic-checkpoint proof harness',
        op: 'deploy', id: 'proof', artifact: artifactStem, args: constructorArgs
    });
    steps.push({
        name: 'deploy untouched harness for isolated stale-checkpoint rejection',
        op: 'deploy', id: 'staleProof', artifact: artifactStem, args: constructorArgs
    });
    call('constructor fixes intended pool recipient', 'poolRecipient', [], {
        want: [address(fixtures.poolRecipient)]
    });
    call('fixture harness begins with no accepted checkpoint', 'hasAcceptedCheckpoint', [], { want: [false] });

    for (const value of checkpoints[0].validators) {
        call(`SSZ public key root matches Qrysm for validator ${value.index}`, 'publicKeySSZRoot', [value.publicKey], {
            want: [value.publicKeyRoot]
        });
        call(`nine-field validator root matches Qrysm for validator ${value.index}`, 'validatorSSZRoot', [witness(value)], {
            want: [value.validatorRoot]
        });
    }
    call('canonical pool-recipient candidate passes complete proofs', 'verifyFundingCandidate', candidateArgs(0), {
        want: [checkpoints[0].validators[0].balance]
    });
    reject('incorrect public key length', 'publicKeySSZRoot', ['0x01']);
    const incorrectKey = candidateArgs(0);
    incorrectKey[3] = flipByte(incorrectKey[3]);
    reject('funding candidate public key must match its canonical SSZ identity', 'verifyFundingCandidate', incorrectKey);

    const existingForeign = checkpoints[0].validators[2];
    reject('existing validator authentic proof retains foreign canonical recipient', 'verifyFundingCandidate', candidateArgs(0, existingForeign));
    const forgedRecipient = candidateArgs(0, existingForeign);
    forgedRecipient[2].withdrawalRecipient = fixtures.poolRecipient;
    reject('substituting pool recipient into existing validator invalidates membership proof', 'verifyFundingCandidate', forgedRecipient);

    const wrongIndex = candidateArgs(0);
    wrongIndex[2].index = '1';
    reject('wrong canonical index rejects otherwise unchanged validator witness', 'verifyFundingCandidate', wrongIndex);
    const wrongValidatorLeaf = candidateArgs(0);
    wrongValidatorLeaf[2].effectiveBalance = String(BigInt(wrongValidatorLeaf[2].effectiveBalance) - 1n);
    reject('changed validator leaf rejects proof', 'verifyFundingCandidate', wrongValidatorLeaf);
    const wrongValidatorBranch = candidateArgs(0);
    wrongValidatorBranch[2].validatorBranch[0] = flipByte(wrongValidatorBranch[2].validatorBranch[0]);
    reject('changed validator branch rejects proof', 'verifyFundingCandidate', wrongValidatorBranch);
    const wrongBalanceLeaf = candidateArgs(0);
    wrongBalanceLeaf[2].balanceChunk = flipByte(wrongBalanceLeaf[2].balanceChunk);
    reject('changed balance chunk rejects proof', 'verifyFundingCandidate', wrongBalanceLeaf);
    const wrongBalanceBranch = candidateArgs(0);
    wrongBalanceBranch[2].balanceBranch[0] = flipByte(wrongBalanceBranch[2].balanceBranch[0]);
    reject('changed balance branch rejects proof', 'verifyFundingCandidate', wrongBalanceBranch);
    const malformedListLength = candidateArgs(0);
    malformedListLength[2].balanceBranch[38] = flipByte(malformedListLength[2].balanceBranch[38]);
    reject('validator and balance list lengths must agree', 'verifyFundingCandidate', malformedListLength);
    const nonCanonicalListLength = candidateArgs(0);
    nonCanonicalListLength[2].validatorBranch[40] = `${nonCanonicalListLength[2].validatorBranch[40].slice(0, -2)}01`;
    reject('list length rejects nonzero high padding', 'verifyFundingCandidate', nonCanonicalListLength);
    const wrongSlotProof = candidateArgs(0);
    wrongSlotProof[1] = [...wrongSlotProof[1]];
    wrongSlotProof[1][0] = flipByte(wrongSlotProof[1][0]);
    reject('checkpoint slot requires its own state membership proof', 'verifyFundingCandidate', wrongSlotProof);
    const shortBranch = candidateArgs(0);
    shortBranch[2].validatorBranch.pop();
    reject('truncated validator branch rejects proof', 'verifyFundingCandidate', shortBranch);
    const unknownRoot = candidateArgs(0);
    unknownRoot[0] = '100';
    reject('caller cannot introduce an unpinned checkpoint root', 'verifyFundingCandidate', unknownRoot);
    reject('future pinned checkpoint rejects before its slot time', 'verifyFundingCandidate', candidateArgs(1));
    reject('positive active balance cannot be terminal', 'verifyTerminal', terminalArgs(0));

    const omitted = checkpointArgs(0);
    omitted[2].pop();
    reject('complete portfolio rejects omitted registered validator', 'acceptCheckpoint', omitted);
    const duplicate = checkpointArgs(0);
    duplicate[2][1] = structuredClone(duplicate[2][0]);
    reject('complete portfolio rejects duplicate validator', 'acceptCheckpoint', duplicate);
    const reordered = checkpointArgs(0);
    reordered[2].reverse();
    reject('complete portfolio uses immutable registered order', 'acceptCheckpoint', reordered);
    const partialFailure = checkpointArgs(0);
    partialFailure[2][1].balanceChunk = flipByte(partialFailure[2][1].balanceChunk);
    reject('later invalid witness reverts earlier portfolio writes atomically', 'acceptCheckpoint', partialFailure);
    call('failed portfolio leaves first validator balance unchanged', 'verifiedBalanceShor', ['0'], { want: ['0'] });
    call('failed portfolio leaves checkpoint unaccepted', 'hasAcceptedCheckpoint', [], { want: [false] });

    for (let index = 0; index < checkpoints.length; index++) {
        const checkpoint = checkpoints[index];
        if (index > 0) steps.push({
            name: `advance synthetic block time to ${checkpoint.name}`,
            op: 'time', time: timestamp(checkpoint.slot)
        });
        if (checkpoint.name === 'active-zero') {
            reject('active zero balance cannot claim terminal completion', 'verifyTerminal', terminalArgs(index));
            reject('zero balance cannot satisfy bootstrap funding condition', 'verifyFundingCandidate', candidateArgs(index));
            const forgedTerminal = terminalArgs(index);
            forgedTerminal[2] = changed(forgedTerminal[2], { exitEpoch: '32', withdrawableEpoch: '34' });
            reject('invented exit lifecycle invalidates otherwise zero balance proof', 'verifyTerminal', forgedTerminal);
        }
        if (checkpoint.name === 'terminal-zero') {
            call('proven withdrawn epoch plus zero balance establishes fixture terminal state', 'verifyTerminal', terminalArgs(index), { want: [true] });
            reject('terminal validator cannot be funded again through candidate gate', 'verifyFundingCandidate', candidateArgs(index));
        }
        call(`accept complete ${checkpoint.name} portfolio permissionlessly`, 'acceptCheckpoint', checkpointArgs(index), { from: independentCaller });
        const values = indices.map(validatorIndex => checkpoint.validators.find(value => value.index === validatorIndex));
        call(`sum exact proven balances for ${checkpoint.name}`, 'totalValidatorBalanceShor', [], {
            want: [values.reduce((total, value) => total + BigInt(value.balance), 0n).toString()]
        });
        call(`record authenticated fixture slot for ${checkpoint.name}`, 'acceptedCheckpointSlot', [], { want: [checkpoint.slot] });
        for (const value of values) call(`record validator ${value.index} balance for ${checkpoint.name}`, 'verifiedBalanceShor', [value.index], { want: [value.balance] });
        call(`terminal count for ${checkpoint.name}`, 'terminalValidatorCount', [], { want: [index >= 3 ? '1' : '0'] });
        reject(`reject repeated ${checkpoint.name} accounting settlement`, 'acceptCheckpoint', checkpointArgs(index));
        if (index > 0) {
            reject(`reject earlier checkpoint after ${checkpoint.name}`, 'acceptCheckpoint', checkpointArgs(index - 1));
            reject(`funding cannot use an earlier accepted checkpoint after ${checkpoint.name}`, 'verifyFundingCandidate', candidateArgs(index - 1));
        }
    }

    const finalIndex = checkpoints.length - 1;
    const staleSlot = BigInt(checkpoints[finalIndex].slot) + BigInt(maxAgeSlots) + 1n;
    steps.push({ name: 'advance past explicit fixture freshness bound', op: 'time', time: timestamp(staleSlot) });
    reject('stale candidate proof rejects even if its SSZ branch is valid', 'verifyFundingCandidate', candidateArgs(finalIndex, checkpoints[finalIndex].validators[1]));
    reject('untouched harness rejects stale accounting root', 'acceptCheckpoint', checkpointArgs(finalIndex), { target: '@staleProof' });
    call('stale rejection leaves untouched harness unaccepted', 'hasAcceptedCheckpoint', [], { target: '@staleProof', want: [false] });
    steps.push({ name: 'proof harness holds no native QRL', op: 'balance', target: '@proof', value: '0' });
    steps.push({ name: 'untouched proof harness holds no native QRL', op: 'balance', target: '@staleProof', value: '0' });

    return {
        origin,
        accounts: { [origin]: '1000000000000000000000000', [independentCaller]: '1000000000000000000' },
        time: timestamp(checkpoints[0].slot),
        steps
    };
}

if (require.main === module) {
    const fixturePath = path.resolve(process.argv[2] || path.join(repoRoot, 'prototype/protocol/testdata/checkpoints.json'));
    const artifactDirectory = path.resolve(process.argv[3] || path.join(repoRoot, 'build/prototype'));
    const output = path.resolve(process.argv[4] || path.join(repoRoot, 'build/prototype/accounting-plan.json'));
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const artifactStem = path.relative(path.dirname(output), path.join(artifactDirectory, 'CheckpointProofHarness'));
    const plan = buildPlan(fixtures, artifactStem);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`Wrote ${plan.steps.length} actual-QRVM test steps using synthetic Qrysm ${fixtures.qrysmCommit} state roots.`);
    console.log('Trust anchor: constructor-pinned fixtures; live finality remains unimplemented.');
}

module.exports = { buildPlan };
