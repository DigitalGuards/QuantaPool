import { observer } from 'mobx-react-lite';
import { useProtocolStore } from '../../stores/RootStore';
import { Card } from '../common/Card';
import { formatQRL } from '../../utils/format';
import { VALIDATOR_THRESHOLD } from '../../config/contracts';

export const QueueStatus = observer(function QueueStatus() {
  const protocolStore = useProtocolStore();
  const { queueStatus, thresholdPercent } = protocolStore;

  return (
    <Card title="Deposit Queue" accent="cyan">
      <div className="space-y-5">
        {/* Progress Bar */}
        <div>
          <div className="flex justify-between text-sm mb-3">
            <span className="text-qrl-muted">Progress to next validator</span>
            <span className="text-white font-medium">{thresholdPercent.toFixed(1)}%</span>
          </div>
          <div className="h-4 bg-qrl-darker/50 rounded-full overflow-hidden border border-qrl-border">
            <div
              className="h-full bg-gradient-to-r from-qrl-orange to-qrl-cyan transition-all duration-500"
              style={{ width: `${Math.min(thresholdPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
            <div className="text-qrl-muted text-sm">Pending</div>
            <div className="text-white text-lg font-semibold mt-1">
              {formatQRL(queueStatus.pending, 0)} QRL
            </div>
          </div>
          <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
            <div className="text-qrl-muted text-sm">Remaining</div>
            <div className="text-white text-lg font-semibold mt-1">
              {formatQRL(queueStatus.remaining, 0)} QRL
            </div>
          </div>
        </div>

        {/* Threshold Info */}
        <div className="text-center text-sm text-qrl-muted">
          Validator created at {formatQRL(VALIDATOR_THRESHOLD, 0)} QRL
          {queueStatus.validatorsReady > 0 && (
            <span className="text-qrl-cyan font-medium ml-2">
              ({queueStatus.validatorsReady} ready to fund!)
            </span>
          )}
        </div>
      </div>
    </Card>
  );
});

export const QueueStatusCompact = observer(function QueueStatusCompact() {
  const protocolStore = useProtocolStore();
  const { queueStatus, thresholdPercent } = protocolStore;

  return (
    <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
      <div className="flex justify-between items-center mb-3">
        <span className="text-qrl-muted text-sm">Queue Progress</span>
        <span className="text-white text-sm font-medium">{thresholdPercent.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-qrl-bg rounded-full overflow-hidden border border-qrl-border">
        <div
          className="h-full bg-gradient-to-r from-qrl-orange to-qrl-cyan transition-all duration-500"
          style={{ width: `${Math.min(thresholdPercent, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-qrl-muted mt-2">
        <span>{formatQRL(queueStatus.pending, 0)}</span>
        <span>{formatQRL(VALIDATOR_THRESHOLD, 0)} QRL</span>
      </div>
    </div>
  );
});
