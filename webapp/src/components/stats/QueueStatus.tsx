import { observer } from 'mobx-react-lite';
import { useProtocolStore } from '../../stores/RootStore';
import { Card } from '../common/Card';
import { formatQRL } from '../../utils/format';
import { VALIDATOR_THRESHOLD } from '../../config/contracts';

export const QueueStatus = observer(function QueueStatus() {
  const protocolStore = useProtocolStore();
  const { queueStatus, thresholdPercent } = protocolStore;

  return (
    <Card title="Deposit Queue">
      <div className="space-y-4">
        {/* Progress Bar */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Progress to next validator</span>
            <span className="text-white">{thresholdPercent.toFixed(1)}%</span>
          </div>
          <div className="h-4 bg-qrl-darker rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-qrl-primary to-qrl-accent transition-all duration-500"
              style={{ width: `${Math.min(thresholdPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-qrl-darker p-3 rounded-lg">
            <div className="text-gray-400 text-sm">Pending</div>
            <div className="text-white text-lg font-semibold">
              {formatQRL(queueStatus.pending, 0)} QRL
            </div>
          </div>
          <div className="bg-qrl-darker p-3 rounded-lg">
            <div className="text-gray-400 text-sm">Remaining</div>
            <div className="text-white text-lg font-semibold">
              {formatQRL(queueStatus.remaining, 0)} QRL
            </div>
          </div>
        </div>

        {/* Threshold Info */}
        <div className="text-center text-sm text-gray-400">
          Validator created at {formatQRL(VALIDATOR_THRESHOLD, 0)} QRL
          {queueStatus.validatorsReady > 0 && (
            <span className="text-qrl-accent ml-2">
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
    <div className="bg-qrl-darker p-3 rounded-lg">
      <div className="flex justify-between items-center mb-2">
        <span className="text-gray-400 text-sm">Queue Progress</span>
        <span className="text-white text-sm">{thresholdPercent.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-qrl-primary transition-all duration-500"
          style={{ width: `${Math.min(thresholdPercent, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>{formatQRL(queueStatus.pending, 0)}</span>
        <span>{formatQRL(VALIDATOR_THRESHOLD, 0)} QRL</span>
      </div>
    </div>
  );
});
