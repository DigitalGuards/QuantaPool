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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Protocol Statistics</h1>

      {/* Main Stats */}
      <ProtocolStats />

      {/* Charts placeholder */}
      <Card title="Exchange Rate History">
        <div className="h-48 flex items-center justify-center text-gray-500">
          Chart coming soon - Exchange rate over time
        </div>
      </Card>

      {/* Transaction History */}
      <Card title="Your Recent Transactions">
        {txStore.txHistory.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No transactions yet
          </div>
        ) : (
          <div className="space-y-2">
            {txStore.txHistory.slice(0, 10).map((tx) => (
              <div
                key={tx.hash}
                className="flex items-center justify-between bg-qrl-darker p-3 rounded-lg"
              >
                <div>
                  <span
                    className={`text-sm font-medium ${
                      tx.type === 'deposit'
                        ? 'text-green-400'
                        : tx.type === 'withdraw'
                        ? 'text-yellow-400'
                        : 'text-blue-400'
                    }`}
                  >
                    {tx.type.toUpperCase()}
                  </span>
                  <span className="text-gray-300 ml-2">
                    {formatQRL(tx.amount, 4)} {tx.type === 'deposit' ? 'QRL' : 'stQRL'}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-gray-400 text-sm">
                    {tx.timestamp.toLocaleTimeString()}
                  </div>
                  <a
                    href={`https://zondscan.com/tx/${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-qrl-primary text-xs hover:underline"
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
      <Card title="Contract Addresses">
        <div className="grid md:grid-cols-2 gap-4">
          {Object.entries(DISPLAY_ADDRESSES).map(([name, address]) => (
            <div key={name} className="bg-qrl-darker p-3 rounded-lg">
              <div className="text-gray-400 text-sm capitalize">{name}</div>
              <a
                href={`https://zondscan.com/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-qrl-primary font-mono text-sm hover:underline break-all"
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
