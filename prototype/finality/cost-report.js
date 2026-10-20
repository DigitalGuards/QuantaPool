// Derive measured execution budgets from successful actual-go-qrl VM steps.
// Unique-key and cadence scenarios are explicitly modeled, without fiat prices.
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '../..');
const round = value => Number(value.toFixed(9));
const sum = (values, field) => values.reduce((total, value) => total + value[field], 0);

function buildReport(execution, plan, metadata) {
    if (metadata.schemaVersion !== 1 || !Array.isArray(execution.steps) ||
        execution.steps.length !== plan.steps.length) throw new Error('Incomplete execution report');
    for (let i = 0; i < plan.steps.length; i++) {
        if (execution.steps[i].name !== plan.steps[i].name ||
            execution.steps[i].expectedRevert !== Boolean(plan.steps[i].revert)) {
            throw new Error(`Execution report does not match plan at step ${i}`);
        }
    }
    const metrics = execution.steps;
    const bounds = { blockGas: 20000000, conservativeCalldataBytes: 120 * 1024,
        ordinaryTransactionBytes: 128 * 1024, maximumVotePositionsPerCall: 12 };
    const groups = metadata.costGroups.map(group => {
        const transactions = metrics.filter(step => step.name.startsWith(`${group.prefix} `) &&
            !step.expectedRevert && ['beginUpdate', 'submit', 'finalize'].includes(step.method));
        if (!transactions.some(step => step.method === 'finalize')) throw new Error(`Missing finalization for ${group.prefix}`);
        const positions = plan.steps.filter(step => step.name.startsWith(`${group.prefix} `) &&
            !step.revert && step.method === 'submit').reduce((total, step) => total + step.args[1].length, 0);
        if (positions !== group.positions) throw new Error(`Unexpected position count for ${group.prefix}`);
        if (transactions.some(step => step.gasBeforeRefund >= bounds.blockGas ||
            step.calldataBytes > bounds.conservativeCalldataBytes)) throw new Error('A measured transaction exceeds test bounds');
        const gas = sum(transactions, 'gasBeforeRefund');
        const intrinsic = sum(transactions, 'intrinsicGas');
        return { ...group, transactions: transactions.length,
            gasBeforeRefund: gas, intrinsicGas: intrinsic, executionGasBeforeRefund: gas - intrinsic,
            calldataBytes: sum(transactions, 'calldataBytes'),
            maximumTransactionGas: Math.max(...transactions.map(step => step.gasBeforeRefund)),
            maximumTransactionCalldataBytes: Math.max(...transactions.map(step => step.calldataBytes)),
            transactionBreakdown: transactions.map(step => ({ method: step.method,
                calldataBytes: step.calldataBytes, intrinsicGas: step.intrinsicGas,
                gasBeforeRefund: step.gasBeforeRefund })) };
    });
    const calibrationCold = metrics.find(step => step.name === 'calibration cold key');
    const calibrationWarm = metrics.find(step => step.name === 'calibration cached key at another valid seat');
    if (!calibrationCold || !calibrationWarm) throw new Error('Missing captured-key cache calibration');
    const cachePremium = calibrationCold.gasBeforeRefund - calibrationCold.intrinsicGas -
        calibrationWarm.gasBeforeRefund + calibrationWarm.intrinsicGas;
    if (cachePremium <= 0) throw new Error('Unexpected public-key cache calibration');
    const measuredMinimum = groups.filter(group => group.kind === 'captured-quorum-update');
    const initial = measuredMinimum[0];
    const full = groups.find(group => group.kind === 'captured-full-committee');
    const warmGroups = measuredMinimum.filter(group => group.newKeys === 0);
    const warm = warmGroups.reduce((maximum, group) => group.gasBeforeRefund > maximum.gasBeforeRefund ? group : maximum);
    const modeled = [
        { name: '86 distinct keys, all initially uncached', positions: 86, uniqueKeys: 86,
            gasBeforeRefund: initial.gasBeforeRefund + (86 - initial.newKeys) * cachePremium,
            basis: 'Captured first 86-seat update plus one measured cache-miss premium per additional distinct key.' },
        { name: '128 distinct keys, all initially uncached', positions: 128, uniqueKeys: 128,
            gasBeforeRefund: full.gasBeforeRefund + (128 - full.uniqueKeys) * cachePremium,
            basis: 'Captured 128-seat update plus one measured cache-miss premium per additional distinct key.' },
        { name: '86 seats with cached keys and committee rotation', positions: 86,
            gasBeforeRefund: warm.gasBeforeRefund,
            basis: 'Largest measured fully cached 86-seat update; observed baseline, with future byte distributions and storage differences unmodeled.' }
    ].map(value => ({ ...value,
        epistemicStatus: value.uniqueKeys ? 'Extrapolation, not a 128-validator network execution or a formal gas upper bound.' : 'Measured captured-network baseline reused in a cadence model.' }));
    const cadences = [
        { name: 'retain committee continuity at one update per period', seconds: 60 * 128 * 8 },
        { name: 'refresh once per finalized epoch when available', seconds: 60 * 128 }
    ];
    const gasPrices = [0.1, 1, 10];
    const economics = modeled.map(model => ({ name: model.name,
        gasBeforeRefund: model.gasBeforeRefund,
        priceScenarios: gasPrices.map(gasPriceShor => ({ gasPriceShor,
            qrlPerUpdateBeforeRefund: round(model.gasBeforeRefund * gasPriceShor / 1e9),
            cadences: cadences.map(cadence => ({ name: cadence.name, seconds: cadence.seconds,
                updatesPerDay: 86400 / cadence.seconds,
                qrlPerDayBeforeRefund: round(model.gasBeforeRefund * gasPriceShor / 1e9 * 86400 / cadence.seconds),
                qrlPer30DaysBeforeRefund: round(model.gasBeforeRefund * gasPriceShor / 1e9 * 30 * 86400 / cadence.seconds) })) })) }));
    const deployment = metrics.find(step => step.name === 'deploy verifier');
    return {
        schemaVersion: 1,
        boundary: 'Measured QRVM execution and native intrinsic gas for captured network witnesses. Execution state and clock are fixtures. Gas is before refunds; transaction fees are not debited in this runner. Full signed transaction envelopes, inclusion, fee receipts and elapsed settlement latency require separate live-network evidence.',
        provenance: { qrysmCommit: metadata.qrysmCommit, witnessSha256: metadata.witnessSha256,
            bootstrapRoot: metadata.bootstrapRoot, bootstrapSlot: metadata.bootstrapSlot },
        tests: { total: metrics.length, expectedReverts: metrics.filter(step => step.expectedRevert).length,
            acceptedCapturedUpdates: measuredMinimum.length },
        limits: bounds,
        measuredDeployment: { calldataBytes: deployment.calldataBytes,
            intrinsicGas: deployment.intrinsicGas, gasBeforeRefund: deployment.gasBeforeRefund },
        measuredGroups: groups,
        cacheCalibration: { cold: calibrationCold, cached: calibrationWarm,
            additionalExecutionGasForNewKey: cachePremium,
            basis: 'Two actual single-vote calls with nonzero proposal counters. The second uses the same public key at another authenticated committee position. Each position still verifies its real ML-DSA signature.' },
        modeledKeyDistributions: modeled,
        modeledMainnetCadence: {
            secondsPerSlot: 60, slotsPerEpoch: 128, epochsPerCommitteePeriod: 8,
            epochSeconds: 7680, committeePeriodSeconds: 61440,
            nativeUnits: '1 QRL = 1,000,000,000 shor; scenario gas prices are illustrative and are not observed network quotes.',
            caveats: [
                '86-seat measured updates use an extra final single-seat transaction to demonstrate rejection at 85 seats. Packing 86 seats into eight batches would change costs.',
                'Committee continuity alone does not provide a fresh accounting checkpoint for every user action.',
                'Epoch refresh assumes finality and a supported occupied boundary are available; outages and missed slots can delay or reject updates.',
                'Total update gas spans several bounded transactions. A total above one block does not require a transaction above the block limit.',
                'Calldata totals exclude the signed transaction envelope. Live transaction size and inclusion remain separate checks.',
                'Public-key cache storage grows with newly encountered keys. Candidate storage and external relayer costs are excluded from the cadence model.',
                'The bootstrap root and chain configuration are independently trusted inputs. A full production verifier and recovery policy remain outside this component.'
            ], scenarios: economics }
    };
}

if (require.main === module) {
    const executionPath = path.resolve(process.argv[2] || path.join(repo, 'build/prototype/finality-execution.json'));
    const planPath = path.resolve(process.argv[3] || path.join(repo, 'build/prototype/finality-plan.json'));
    const metadataPath = path.resolve(process.argv[4] || planPath.replace(/\.json$/, '.meta.json'));
    const outputPath = path.resolve(process.argv[5] || path.join(repo, 'build/prototype/finality-costs.json'));
    const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const report = buildReport(read(executionPath), read(planPath), read(metadataPath));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Measured ${report.tests.acceptedCapturedUpdates} captured updates and a full 128-position certificate; generated explicit cache and cadence models.`);
    for (const group of report.measuredGroups) {
        console.log(`${group.prefix}: ${group.positions} positions, ${group.uniqueKeys} keys, ${group.transactions} transactions, ${group.gasBeforeRefund} gas before refunds, ${group.calldataBytes} calldata bytes.`);
    }
}

module.exports = { buildReport };
