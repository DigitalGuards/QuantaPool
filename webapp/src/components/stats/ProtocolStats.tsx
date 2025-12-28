import { observer } from 'mobx-react-lite';
import { useProtocolStore } from '../../stores/RootStore';
import { Card } from '../common/Card';
import { formatQRL } from '../../utils/format';

export const ProtocolStats = observer(function ProtocolStats() {
  const protocolStore = useProtocolStore();

  const stats = [
    {
      label: 'Total Value Locked',
      value: `${protocolStore.tvlFormatted} QRL`,
      highlight: true,
    },
    {
      label: 'Exchange Rate',
      value: `${protocolStore.exchangeRateFormatted} QRL/stQRL`,
    },
    {
      label: 'Total stQRL Supply',
      value: formatQRL(protocolStore.totalSupply, 2),
    },
    {
      label: 'Active Validators',
      value: protocolStore.validatorCount.toString(),
    },
    {
      label: 'Liquid Reserve',
      value: `${formatQRL(protocolStore.liquidReserve, 2)} QRL`,
    },
    {
      label: 'Estimated APY',
      value: `${protocolStore.estimatedAPY}%`,
      highlight: true,
    },
  ];

  return (
    <Card title="Protocol Statistics" accent="orange">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
            <div className="text-qrl-muted text-sm">{stat.label}</div>
            <div
              className={`text-lg font-semibold mt-1 ${
                stat.highlight ? 'text-qrl-cyan' : 'text-white'
              }`}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-4 mt-5 pt-4 border-t border-qrl-border">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              protocolStore.isPaused ? 'bg-red-500' : 'bg-green-500'
            } ${!protocolStore.isPaused ? 'animate-pulse' : ''}`}
          />
          <span className="text-sm text-qrl-muted">
            {protocolStore.isPaused ? 'Paused' : 'Active'}
          </span>
        </div>

        {protocolStore.lastUpdate && (
          <span className="text-sm text-qrl-muted">
            Updated: {protocolStore.lastUpdate.toLocaleTimeString()}
          </span>
        )}

        {protocolStore.isLoading && (
          <span className="text-sm text-qrl-muted">Refreshing...</span>
        )}
      </div>
    </Card>
  );
});

export const ProtocolStatsCompact = observer(function ProtocolStatsCompact() {
  const protocolStore = useProtocolStore();

  return (
    <div className="flex flex-wrap gap-6 text-sm bg-qrl-card backdrop-blur-sm border border-qrl-border rounded-xl p-4">
      <div>
        <span className="text-qrl-muted">TVL: </span>
        <span className="text-white font-semibold">{protocolStore.tvlFormatted} QRL</span>
      </div>
      <div>
        <span className="text-qrl-muted">Rate: </span>
        <span className="text-white">{protocolStore.exchangeRateFormatted}</span>
      </div>
      <div>
        <span className="text-qrl-muted">APY: </span>
        <span className="text-qrl-cyan font-semibold">{protocolStore.estimatedAPY}%</span>
      </div>
      <div>
        <span className="text-qrl-muted">Validators: </span>
        <span className="text-white">{protocolStore.validatorCount}</span>
      </div>
    </div>
  );
});
