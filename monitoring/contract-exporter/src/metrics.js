const { Gauge } = require('prom-client');
const definitions = {
    riskAssets: ['risk_assets_qrl', 'Verified unreserved principal and gains exposed to native losses'],
    freeCash: ['free_cash_qrl', 'Actual cash available after fixed reserves'],
    pendingTotal: ['pending_deposits_qrl', 'Cash-backed deposits awaiting future checkpoint admission'],
    claimReserve: ['claim_reserve_qrl', 'Cash reserved for immutable user beneficiaries'],
    feeReserve: ['earned_fee_reserve_qrl', 'Earned operator fees awaiting fixed-recipient payout'],
    totalFeesPaid: ['fees_paid_qrl', 'Cumulative earned operator fees paid'],
    consensusLossCarry: ['consensus_loss_carry_qrl', 'Unrecovered consensus losses before further eligible fee income'],
    eligibleConsensusRewardBudget: ['eligible_reward_budget_qrl', 'Verified net consensus gain not yet used as a fee base'],
    FEE_BPS: ['fee_bps', 'Immutable operator fee rate in basis points'],
    recovering: ['recovering', 'Irreversible recovery active'],
    poolStatus: ['pool_status', 'Pool state: 0 normal, 1 verification catch-up, 2 irreversible recovery eligible'],
    poolRecoveryDeadlineSlot: ['pool_recovery_deadline_slot', 'Deadline renewed only by applied complete pool accounting'],
    lastCheckpointBlock: ['checkpoint_execution_block', 'Execution cutoff used by the native ledger'],
    appliedSlot: ['checkpoint_slot', 'Beacon slot used by the native ledger'],
    finalityStatus: ['finality_status', 'Verifier state: 0 fresh, 1 catch-up, 2 permanently expired'],
    finalizedSlot: ['finalized_slot', 'Latest authenticated finalized slot'],
    trustDeadlineSlot: ['trust_deadline_slot', 'Immutable-rule recovery deadline'],
    validatorCount: ['validator_count', 'Complete registered pool validator count'],
    executionBlock: ['execution_block', 'Common execution block sampled by the exporter'],
    lastSuccess: ['last_success_timestamp_seconds', 'Time of last complete successful scrape'],
    scrapeSuccess: ['scrape_success', 'Whether the last complete scrape succeeded']
};
function setupMetrics(register) {
    const metrics = { qrlFields: new Set(Object.entries(definitions).filter(([, [name]]) => name.endsWith('_qrl')).map(([key]) => key)) };
    for (const [key, [name, help]] of Object.entries(definitions)) metrics[key] = new Gauge({ name: `quantapool_native_${name}`, help, registers: [register] });
    return metrics;
}
module.exports = { setupMetrics };
