import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useStores } from '../../stores/RootStore';
import { Logger } from '../../services/logger';
import { Button } from '../common/Button';
import { CONTRACTS, DISPLAY_ADDRESSES } from '../../config/contracts';

export const DevToolsPanel = observer(function DevToolsPanel() {
  const stores = useStores();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'state' | 'logs' | 'contracts'>('state');

  const logs = Logger.getHistory();

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-qrl-orange text-white px-4 py-2 rounded-xl shadow-lg hover:bg-qrl-orange/80 transition-all duration-200 z-50"
      >
        DevTools
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 w-full md:w-[600px] h-[400px] bg-qrl-bg border-t border-l border-qrl-border shadow-xl z-50 flex flex-col backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-qrl-dark/80 border-b border-qrl-border">
        <div className="flex gap-1 bg-qrl-darker/50 p-1 rounded-xl">
          {(['state', 'logs', 'contracts'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
                activeTab === tab
                  ? 'bg-qrl-cyan text-qrl-darker'
                  : 'text-qrl-muted hover:text-white'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" fullWidth={false} onClick={() => stores.refreshAll()}>
            Refresh
          </Button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-qrl-muted hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        {activeTab === 'state' && <StateView stores={stores} />}
        {activeTab === 'logs' && <LogsView logs={logs} />}
        {activeTab === 'contracts' && <ContractsView />}
      </div>
    </div>
  );
});

const StateView = observer(function StateView({ stores }: { stores: ReturnType<typeof useStores> }) {
  const { walletStore, protocolStore, userStore, transactionStore } = stores;

  return (
    <div className="space-y-4">
      <StateSection title="Wallet">
        <StateRow label="Connected" value={walletStore.isConnected} />
        <StateRow label="Address" value={walletStore.displayAddress || 'null'} />
        <StateRow label="Method" value={walletStore.connectionMethod || 'null'} />
        <StateRow label="Chain ID" value={walletStore.chainId} />
        <StateRow label="QRL Balance" value={walletStore.formattedBalance + ' QRL'} />
      </StateSection>

      <StateSection title="Protocol">
        <StateRow label="Exchange Rate" value={protocolStore.exchangeRateFormatted} />
        <StateRow label="Total Assets" value={protocolStore.tvlFormatted + ' QRL'} />
        <StateRow label="Pending Deposits" value={(Number(protocolStore.pendingDeposits) / 1e18).toFixed(2) + ' QRL'} />
        <StateRow label="Queue %" value={protocolStore.thresholdPercent.toFixed(2) + '%'} />
        <StateRow label="Validators" value={protocolStore.validatorCount} />
        <StateRow label="Is Paused" value={protocolStore.isPaused} />
      </StateSection>

      <StateSection title="User Position">
        <StateRow label="stQRL Balance" value={userStore.stQRLFormatted + ' stQRL'} />
        <StateRow label="Value in QRL" value={userStore.stQRLValueFormatted + ' QRL'} />
        <StateRow label="Has Pending Withdrawal" value={userStore.hasPendingWithdrawal} />
        <StateRow label="Can Claim" value={userStore.canClaimWithdrawal} />
        <StateRow label="Blocks Until Claim" value={userStore.blocksUntilClaim} />
      </StateSection>

      <StateSection title="Transactions">
        <StateRow label="Is Submitting" value={transactionStore.isSubmitting} />
        <StateRow label="Current TX" value={transactionStore.currentTxHash || 'null'} />
        <StateRow label="Error" value={transactionStore.error || 'null'} />
        <StateRow label="History Count" value={transactionStore.txHistory.length} />
      </StateSection>
    </div>
  );
});

function StateSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-qrl-cyan font-semibold mb-2">{title}</h4>
      <div className="bg-qrl-dark/50 rounded-xl p-3 space-y-1 border border-qrl-border">{children}</div>
    </div>
  );
}

function StateRow({ label, value }: { label: string; value: unknown }) {
  const displayValue = typeof value === 'boolean'
    ? value ? 'true' : 'false'
    : String(value);

  const valueColor = typeof value === 'boolean'
    ? value ? 'text-green-400' : 'text-red-400'
    : 'text-white';

  return (
    <div className="flex justify-between">
      <span className="text-qrl-muted">{label}:</span>
      <span className={valueColor}>{displayValue}</span>
    </div>
  );
}

function LogsView({ logs }: { logs: import('../../services/logger').LogEntry[] }) {
  const [filter, setFilter] = useState('');

  const filteredLogs = filter
    ? logs.filter((log) =>
        log.prefix.toLowerCase().includes(filter.toLowerCase()) ||
        log.message.toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  const levelColors: Record<string, string> = {
    DEBUG: 'text-gray-500',
    INFO: 'text-blue-400',
    WARN: 'text-yellow-400',
    ERROR: 'text-red-400',
    TX: 'text-green-400',
  };

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Filter logs..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full bg-qrl-darker/50 border border-qrl-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-qrl-cyan transition-colors"
      />
      <div className="space-y-1 max-h-[280px] overflow-auto">
        {filteredLogs.slice(-100).reverse().map((log, i) => (
          <div key={i} className="text-xs">
            <span className="text-qrl-muted">{log.timestamp.split('T')[1].split('.')[0]}</span>
            <span className="text-qrl-muted mx-1">[{log.prefix}]</span>
            <span className={levelColors[log.level] || 'text-white'}>{log.level}:</span>
            <span className="text-white ml-1">{log.message}</span>
            {log.data !== undefined && (
              <pre className="text-qrl-muted ml-4 text-xs overflow-x-auto">
                {JSON.stringify(log.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {filteredLogs.length === 0 && (
          <div className="text-qrl-muted text-center py-4">No logs yet</div>
        )}
      </div>
    </div>
  );
}

function ContractsView() {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-3">
      <p className="text-qrl-muted text-xs mb-2">Click address to copy</p>
      {Object.entries(CONTRACTS).map(([name, address]) => (
        <div key={name} className="bg-qrl-dark/50 rounded-xl p-3 border border-qrl-border">
          <div className="text-qrl-cyan font-semibold">{name}</div>
          <div
            className="text-white text-xs cursor-pointer hover:text-qrl-cyan break-all transition-colors"
            onClick={() => copyToClipboard(address)}
            title="Click to copy"
          >
            {DISPLAY_ADDRESSES[name as keyof typeof DISPLAY_ADDRESSES]}
          </div>
        </div>
      ))}
      <div className="mt-4 text-qrl-muted text-xs">
        <p>Console shortcuts:</p>
        <code className="block bg-qrl-dark/50 p-3 rounded-xl mt-2 border border-qrl-border">
          window.__QUANTAPOOL__.stores<br />
          window.__QUANTAPOOL__.refresh()<br />
          window.__QUANTAPOOL__.formatQRL(bigint)<br />
          window.__QUANTAPOOL_LOGS__
        </code>
      </div>
    </div>
  );
}
