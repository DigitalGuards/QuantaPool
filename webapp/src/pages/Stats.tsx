import { observer } from 'mobx-react-lite';
import { ProtocolStats } from '../components/stats/ProtocolStats';
import { Card } from '../components/common/Card';
import { useProtocolStore, useTransactionStore } from '../stores/RootStore';
import { formatQRL } from '../utils/format';
import { DISPLAY_ADDRESSES } from '../config/contracts';

export const Stats = observer(function Stats() {
  const protocolStore = useProtocolStore();
  const txStore = useTransactionStore();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-white">
        Protocol <span className="text-qrl-cyan">Statistics</span>
      </h1>

      {/* Main Stats */}
      <ProtocolStats />

      {/* Charts placeholder */}
      <Card title="Exchange Rate History" accent="orange">
        <div className="h-48 flex items-center justify-center text-qrl-muted border border-qrl-border border-dashed rounded-xl">
          Chart coming soon - Exchange rate over time
        </div>
      </Card>

      {/* Transaction History */}
      <Card title="Your Recent Transactions" accent="cyan">
        {txStore.txHistory.length === 0 ? (
          <div className="text-center text-qrl-muted py-8">
            No transactions yet
          </div>
        ) : (
          <div className="space-y-3">
            {txStore.txHistory.slice(0, 10).map((tx) => (
              <div
                key={tx.hash}
                className="flex items-center justify-between bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border"
              >
                <div>
                  <span
                    className={`text-sm font-semibold ${
                      tx.type === 'deposit'
                        ? 'text-green-400'
                        : tx.type === 'withdraw'
                        ? 'text-qrl-orange'
                        : 'text-qrl-cyan'
                    }`}
                  >
                    {tx.type.toUpperCase()}
                  </span>
                  <span className="text-white ml-2">
                    {formatQRL(tx.amount, 4)} {tx.type === 'deposit' ? 'QRL' : 'stQRL'}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-qrl-muted text-sm">
                    {tx.timestamp.toLocaleTimeString()}
                  </div>
                  <a
                    href={`https://zondscan.com/tx/${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-qrl-cyan text-xs hover:text-qrl-cyan-hover"
                  >
                    {tx.hash.slice(0, 10)}...
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Contract Addresses */}
      <Card title="Contract Addresses" accent="orange">
        <div className="grid md:grid-cols-2 gap-4">
          {Object.entries(DISPLAY_ADDRESSES).map(([name, address]) => (
            <div key={name} className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
              <div className="text-qrl-muted text-sm capitalize mb-1">{name}</div>
              <a
                href={`https://zondscan.com/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-qrl-cyan font-mono text-sm hover:text-qrl-cyan-hover break-all"
              >
                {address}
              </a>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
});
