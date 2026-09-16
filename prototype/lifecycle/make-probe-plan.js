// Isolated actual-QRVM regressions. Public deposit bytes are replayed in fresh
// synthetic execution state. Native withdrawal payloads are artificial fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const UNIT = 10n ** 18n;
const SHOR = 10n ** 9n;
const PRINCIPAL = 40000n * UNIT;
const origin = `Q${'11'.repeat(64)}`;
const independent = `Q${'22'.repeat(64)}`;
const normalize = value => value.replace(/^(?:0x|Q)/, '').toLowerCase();

function buildPlan(probe, deposit, artifactDirectory, output, callback = false) {
    assert.equal(BigInt(deposit.amount), 40000n * 10n ** 9n, 'public deposit amount must be 40,000 QRL');
    assert.equal(normalize(deposit.withdrawal_recipient), normalize(probe.address), 'signed recipient must equal probe');
    assert.equal(normalize(deposit.pubkey), normalize(probe.validatorPubkey), 'public validator identity differs');
    const beneficiary = probe.beneficiary;
    const feeRecipient = callback ? '@feeCallback' : probe.feeRecipient;
    const artifact = name => path.relative(path.dirname(output), path.join(artifactDirectory, name));
    const steps = [];
    const call = (name, target, method, args = [], extra = {}) => steps.push({
        name, op: 'call', target, method, args, ...extra
    });
    const balance = (name, target, value) => steps.push({ name, op: 'balance', target, value: String(value) });
    const assertValue = (name, method, value) => call(name, '@probe', method, [], { want: [String(value)] });
    const fundArgs = [deposit.pubkey, deposit.randao_commitment, deposit.signature, deposit.deposit_data_root];
    const rewards = [1n, 8n, 1n, 9n, 1n, 15n].map(value => value * SHOR).concat(3254n * UNIT / 10n);
    const credits = callback ? [PRINCIPAL + 10n * SHOR, ...rewards] : [10000n * UNIT + SHOR, 30000n * UNIT - SHOR, ...rewards];
    const totalCredits = credits.reduce((sum, value) => sum + value, 0n);
    let returned = 0n;
    let principalPaid = 0n;
    let rewardsPaid = 0n;
    let feesPaid = 0n;
    let creditIndex = 0;
    let callbackPayments = 0n;
    const model = () => {
        const principal = returned < PRINCIPAL ? returned : PRINCIPAL;
        const surplus = returned - principal;
        const fee = surplus / 10n;
        return [returned, principal, surplus - fee, fee];
    };
    const check = label => {
        const expected = model();
        call(`${label}: cumulative cash partition`, '@probe', 'accounting', [], { want: expected.map(String) });
        assertValue(`${label}: principal paid counter`, 'principalPaid', principalPaid);
        assertValue(`${label}: rewards paid counter`, 'rewardsPaid', rewardsPaid);
        assertValue(`${label}: fees paid counter`, 'feesPaid', feesPaid);
        balance(`${label}: probe cash equals returned less actual payments`, '@probe', returned - principalPaid - rewardsPaid - feesPaid);
        balance(`${label}: immutable beneficiary receives principal plus user rewards`, beneficiary, PRINCIPAL + principalPaid + rewardsPaid);
        balance(`${label}: immutable fee receiver receives only earned fees`, feeRecipient, feesPaid);
        balance(`${label}: canonical beacon keeps original funded principal`, '@beacon', PRINCIPAL);
        balance(`${label}: fixture caller receives no withdrawal cash`, origin, totalCredits);
    };
    const credit = value => {
        creditIndex++;
        steps.push({ name: `apply synthetic native withdrawal of ${value / SHOR} shor through actual go-qrl Finalize`,
            op: 'withdrawal-credit', target: '@probe', value: String(value) });
        returned += value;
    };
    const claim = (kind, from = independent) => {
        const [, principal, reward, fee] = model();
        const current = { Principal: principalPaid, Rewards: rewardsPaid, Fees: feesPaid }[kind];
        const earned = { Principal: principal, Rewards: reward, Fees: fee }[kind];
        call(`permissionless ${kind.toLowerCase()} claim pays its immutable recipient`, '@probe', `claim${kind}`, [], {
            from, ...(earned === current ? { revert: '*' } : {})
        });
        if (earned === current) return;
        if (kind === 'Principal') principalPaid = earned;
        if (kind === 'Rewards') rewardsPaid = earned;
        if (kind === 'Fees') {
            feesPaid = earned;
            if (callback) callbackPayments++;
        }
    };

    steps.push({ name: 'deploy unchanged pinned Qrysm deposit contract', op: 'deploy', id: 'beacon', artifact: artifact('DepositContract'), args: [] });
    if (callback) steps.push({ name: 'deploy test-only fee callback receiver', op: 'deploy', id: 'feeCallback', artifact: artifact('ProbeFeeCallback'), args: [] });
    steps.push({ name: 'deploy probe at public fixture beneficiary nonce zero', op: 'deploy', id: 'probe', from: beneficiary,
        artifact: artifact('NativeReturnProbe'), args: ['@beacon', feeRecipient] });
    call('beneficiary is the constructor caller', '@probe', 'beneficiary', [], { want: [beneficiary] });
    call('operator fee destination is immutable', '@probe', 'feeRecipient', [], { want: [feeRecipient] });
    if (callback) call('configure test callback target once', '@feeCallback', 'configure', ['@probe']);
    call('an unrelated caller cannot select or fund the validator', '@probe', 'fund', fundArgs, {
        from: origin, value: String(PRINCIPAL), revert: 'invalid fixture funding'
    });
    call('funding must equal one exact native validator amount', '@probe', 'fund', fundArgs, {
        from: beneficiary, value: String(PRINCIPAL - UNIT), revert: 'invalid fixture funding'
    });
    call('incorrect deposit data root rolls back the entire funding operation', '@probe', 'fund',
        [...fundArgs.slice(0, 3), `0x${'00'.repeat(32)}`], {
            from: beneficiary, value: String(PRINCIPAL), revert: 'reconstructed DepositData'
        });
    assertValue('failed deposit preserves unfunded state', 'fundedPrincipal', 0n);
    balance('failed deposit preserves beneficiary capital', beneficiary, PRINCIPAL * 2n);
    balance('failed deposit leaves canonical beacon empty', '@beacon', 0n);
    call('real five-field signed deposit transfers 40,000 native QRL', '@probe', 'fund', fundArgs, {
        from: beneficiary, value: String(PRINCIPAL)
    });
    assertValue('funded principal recorded exactly', 'fundedPrincipal', PRINCIPAL);
    call('deposit count reflects one actual QRVM execution', '@beacon', 'get_deposit_count', [], { want: ['0x0100000000000000'] });
    call('one-shot funding rejects a second validator deposit', '@probe', 'fund', fundArgs, {
        from: beneficiary, value: String(PRINCIPAL), revert: 'invalid fixture funding'
    });
    check('after funding');
    claim('Principal');
    claim('Rewards');
    claim('Fees');

    for (const amount of credits) {
        credit(amount);
        check(`after artificial cash credit ${creditIndex}`);
        if (callback && creditIndex === 1) {
            call('rejecting fee receiver is a controlled rollback fixture', '@feeCallback', 'setRejectPayment', [true]);
            call('failed fee payout preserves principal and fee entitlement', '@probe', 'claimFees', [], { from: independent, revert: 'payment failed' });
            check('after reverted fee transfer');
            call('rolled-back callback made no recorded nested attempts', '@feeCallback', 'attempts', [], { want: ['0'] });
            call('allow the fee receiver to accept its earned payout', '@feeCallback', 'setRejectPayment', [false]);
            claim('Fees');
            assertValue('fee callback cannot claim available principal', 'principalPaid', 0n);
            assertValue('fee callback cannot claim available user rewards', 'rewardsPaid', 0n);
            balance('fee callback leaves all principal plus user reward cash', '@probe', PRINCIPAL + 9n * SHOR);
        }
        if (creditIndex % 2 === 0) claim('Rewards');
        claim('Fees');
        claim('Principal', callback ? independent : feeRecipient);
        claim('Rewards');
        check(`after payouts ${creditIndex}`);
        claim('Principal');
        claim('Rewards');
        claim('Fees');
        balance('repeated claims create no additional native cash', '@probe', 0n);
    }
    if (callback) {
        call('callback receives exactly cumulative earned operator fees', '@feeCallback', 'received', [], { want: [String(feesPaid)] });
        call('all three nested claim entry points were attempted per fee payment', '@feeCallback', 'attempts', [], { want: [String(callbackPayments * 3n)] });
        call('every nested claim failed specifically at the reentrancy guard', '@feeCallback', 'guardedCalls', [], { want: [String(callbackPayments * 3n)] });
    }
    check('final complete cash drain');
    balance('independent executor obtains no user cash', independent, 1n);
    return { origin, time: 1, accounts: {
        [origin]: String(totalCredits), [beneficiary]: String(PRINCIPAL * 2n), [probe.feeRecipient]: '0', [independent]: '1'
    }, steps };
}

function main(args) {
    const directory = path.resolve(args[0] || path.join(repo, 'findings/native-qrl-prototype/lifecycle'));
    const artifacts = path.resolve(args[1] || path.join(repo, 'build/prototype'));
    const runner = path.resolve(args[2] || path.join(repo, 'build/prototype-execution'));
    const probe = JSON.parse(fs.readFileSync(path.join(directory, 'probe.json'), 'utf8'));
    const deposits = JSON.parse(fs.readFileSync(path.join(directory, 'deposit-data.json'), 'utf8'));
    assert.equal(deposits.length, 1, 'exactly one public lifecycle deposit required');
    const prediction = spawnSync(runner, ['-predict', probe.beneficiary], { encoding: 'utf8' });
    assert.equal(prediction.status, 0, 'pinned runner CREATE prediction failed');
    assert.equal(normalize(prediction.stdout.split('\n')[0].split(' ')[1]), normalize(probe.address), 'beneficiary nonce0 recipient mismatch');
    for (const callback of [false, true]) {
        const name = callback ? 'probe-callback' : 'probe-cash';
        const output = path.join(artifacts, `${name}-plan.json`);
        const plan = buildPlan(probe, deposits[0], artifacts, output, callback);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
        console.log(`Wrote ${plan.steps.length} ${name} steps; artificial credits, isolated state, no network activity.`);
    }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { buildPlan };
