import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useWalletStore } from '../../stores/RootStore';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { DISPLAY_ADDRESSES } from '../../config/contracts';

export const ConnectWallet = observer(function ConnectWallet() {
  const walletStore = useWalletStore();
  const [showManual, setShowManual] = useState(false);
  const [manualAddress, setManualAddress] = useState('');

  const handleExtensionConnect = () => {
    walletStore.connectExtension();
  };

  const handleManualConnect = () => {
    if (manualAddress.trim()) {
      walletStore.setManualAddress(manualAddress.trim());
    }
  };

  if (walletStore.isConnected) {
    return (
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-sm text-gray-400">
            {walletStore.connectionMethod === 'extension' ? 'Extension' : 'View Only'}
          </div>
          <div className="text-white font-mono">{walletStore.shortAddress}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-400">Balance</div>
          <div className="text-white">{walletStore.formattedBalance} QRL</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => walletStore.disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {!showManual ? (
        <>
          <Button
            onClick={handleExtensionConnect}
            isLoading={walletStore.isConnecting}
          >
            Connect Wallet
          </Button>
          <Button variant="secondary" onClick={() => setShowManual(true)}>
            Enter Address
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Z... or 0x..."
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            className="w-64"
          />
          <Button
            onClick={handleManualConnect}
            isLoading={walletStore.isConnecting}
            disabled={!manualAddress.trim()}
          >
            View
          </Button>
          <Button variant="secondary" onClick={() => setShowManual(false)}>
            Cancel
          </Button>
        </div>
      )}

      {walletStore.error && (
        <span className="text-red-400 text-sm">{walletStore.error}</span>
      )}
    </div>
  );
});

export const ManualTransferInfo = observer(function ManualTransferInfo() {
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(DISPLAY_ADDRESSES.depositPool);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-qrl-dark border border-gray-700 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-gray-200 mb-2">Manual Deposit</h3>
      <p className="text-gray-400 text-sm mb-3">
        Send QRL directly to the DepositPool contract address:
      </p>
      <div className="flex items-center gap-2 bg-qrl-darker p-3 rounded">
        <code className="text-qrl-primary font-mono text-sm flex-1 break-all">
          {DISPLAY_ADDRESSES.depositPool}
        </code>
        <Button size="sm" variant="secondary" onClick={copyAddress}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <p className="text-yellow-400 text-xs mt-2">
        Note: You'll receive stQRL tokens at the sender address after the transaction confirms.
      </p>
    </div>
  );
});
