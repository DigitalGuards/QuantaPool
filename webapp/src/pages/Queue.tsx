import { observer } from 'mobx-react-lite';
import { QueueStatus } from '../components/stats/QueueStatus';
import { Card } from '../components/common/Card';
import { useProtocolStore } from '../stores/RootStore';
import { formatQRL } from '../utils/format';
import { VALIDATOR_THRESHOLD, WITHDRAWAL_DELAY_BLOCKS, BLOCK_TIME_SECONDS } from '../config/contracts';

export const Queue = observer(function Queue() {
  const protocolStore = useProtocolStore();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-white">
        Deposit <span className="text-qrl-orange">Queue</span>
      </h1>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Queue Status */}
        <QueueStatus />

        {/* Info */}
        <Card title="How the Queue Works" accent="orange">
          <div className="space-y-4 text-white">
            <p>
              QuantaPool aggregates deposits from multiple users to create validators.
              Each validator requires exactly{' '}
              <span className="text-qrl-cyan font-semibold">
                {formatQRL(VALIDATOR_THRESHOLD, 0)} QRL
              </span>
              .
            </p>

            <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border space-y-2">
              <h4 className="text-white font-semibold">Timeline</h4>
              <ul className="text-sm space-y-1 text-qrl-muted">
                <li>• Deposit: Instant stQRL minting</li>
                <li>• Queue: Funds wait until threshold reached</li>
                <li>• Validator creation: When 40k QRL accumulated</li>
                <li>• Rewards: Start accruing after validator active</li>
              </ul>
            </div>

            <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border space-y-2">
              <h4 className="text-white font-semibold">Withdrawals</h4>
              <ul className="text-sm space-y-1 text-qrl-muted">
                <li>
                  • Request withdrawal: Burns stQRL, queues claim
                </li>
                <li>
                  • Wait time: {WITHDRAWAL_DELAY_BLOCKS} blocks (~
                  {Math.round((WITHDRAWAL_DELAY_BLOCKS * BLOCK_TIME_SECONDS) / 60)} minutes)
                </li>
                <li>• Claim: Receive QRL to your wallet</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>

      {/* Validator Info */}
      <Card title="Validators" accent="cyan">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border text-center">
            <div className="text-3xl font-bold text-white">
              {protocolStore.validatorCount}
            </div>
            <div className="text-qrl-muted text-sm mt-1">Active Validators</div>
          </div>
          <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border text-center">
            <div className="text-3xl font-bold text-qrl-cyan">
              {protocolStore.queueStatus.validatorsReady}
            </div>
            <div className="text-qrl-muted text-sm mt-1">Ready to Fund</div>
          </div>
          <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border text-center">
            <div className="text-3xl font-bold text-white">
              {formatQRL(VALIDATOR_THRESHOLD, 0)}
            </div>
            <div className="text-qrl-muted text-sm mt-1">QRL per Validator</div>
          </div>
          <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border text-center">
            <div className="text-3xl font-bold text-white">
              {formatQRL(protocolStore.liquidReserve, 0)}
            </div>
            <div className="text-qrl-muted text-sm mt-1">Liquid Reserve</div>
          </div>
        </div>
      </Card>
    </div>
  );
});
