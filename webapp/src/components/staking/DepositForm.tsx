import { observer } from 'mobx-react-lite';
import { useState, useEffect } from 'react';
import { useWalletStore, useProtocolStore, useTransactionStore } from '../../stores/RootStore';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Card } from '../common/Card';
import { parseQRL, formatQRL } from '../../utils/format';
import { MIN_DEPOSIT } from '../../config/contracts';
import { uiLogger as log } from '../../services/logger';

export const DepositForm = observer(function DepositForm() {
  const walletStore = useWalletStore();
  const protocolStore = useProtocolStore();
  const txStore = useTransactionStore();

  const [amount, setAmount] = useState('');
  const [previewShares, setPreviewShares] = useState(0n);
  const [error, setError] = useState('');

  // Preview shares when amount changes
  useEffect(() => {
    const fetchPreview = async () => {
      if (!amount || parseFloat(amount) <= 0) {
        setPreviewShares(0n);
        return;
      }

      try {
        const wei = parseQRL(amount);
        const shares = await protocolStore.previewDeposit(wei);
        setPreviewShares(shares);
      } catch (err) {
        log.error('Preview failed', err);
      }
    };

    const timer = setTimeout(fetchPreview, 300);
    return () => clearTimeout(timer);
  }, [amount, protocolStore]);

  const handleAmountChange = (value: string) => {
    // Only allow numbers and decimal point
    if (!/^[0-9]*\.?[0-9]*$/.test(value) && value !== '') return;
    setAmount(value);
    setError('');
  };

  const handleMaxClick = () => {
    if (walletStore.qrlBalance > 0n) {
      // Leave some for gas
      const maxAmount = walletStore.qrlBalance - parseQRL('1');
      if (maxAmount > 0n) {
        setAmount(formatQRL(maxAmount, 4));
      }
    }
  };

  const validateAmount = (): boolean => {
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter an amount');
      return false;
    }

    const wei = parseQRL(amount);

    if (wei < MIN_DEPOSIT) {
      setError('Minimum deposit is 1 QRL');
      return false;
    }

    if (wei > walletStore.qrlBalance) {
      setError('Insufficient balance');
      return false;
    }

    return true;
  };

  const handleDeposit = async () => {
    if (!validateAmount()) return;

    const wei = parseQRL(amount);
    log.info('Submitting deposit', { amount, wei: wei.toString() });

    const hash = await txStore.deposit(wei);
    if (hash) {
      setAmount('');
      setPreviewShares(0n);
    }
  };

  const isReadOnly = walletStore.connectionMethod === 'manual';
  const canDeposit = walletStore.isConnected && !isReadOnly && !txStore.isSubmitting && !protocolStore.isPaused;

  return (
    <Card title="Deposit QRL">
      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm text-gray-400">Amount</label>
            <button
              className="text-sm text-qrl-primary hover:underline"
              onClick={handleMaxClick}
              disabled={!walletStore.isConnected}
            >
              Max: {walletStore.formattedBalance} QRL
            </button>
          </div>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            suffix="QRL"
            error={error}
          />
        </div>

        {/* Preview */}
        {previewShares > 0n && (
          <div className="bg-qrl-darker p-3 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">You will receive</span>
              <span className="text-white">{formatQRL(previewShares, 4)} stQRL</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-400">Exchange rate</span>
              <span className="text-gray-300">1 stQRL = {protocolStore.exchangeRateFormatted} QRL</span>
            </div>
          </div>
        )}

        {/* Warnings */}
        {isReadOnly && walletStore.isConnected && (
          <p className="text-yellow-400 text-sm">
            Connect with wallet extension to deposit. View-only mode cannot send transactions.
          </p>
        )}

        {protocolStore.isPaused && (
          <p className="text-red-400 text-sm">
            Protocol is paused. Deposits are temporarily disabled.
          </p>
        )}

        {txStore.error && (
          <p className="text-red-400 text-sm">{txStore.error}</p>
        )}

        {/* Submit Button */}
        <Button
          className="w-full"
          size="lg"
          onClick={handleDeposit}
          disabled={!canDeposit || !amount}
          isLoading={txStore.isSubmitting}
        >
          {!walletStore.isConnected
            ? 'Connect Wallet'
            : isReadOnly
            ? 'View Only Mode'
            : 'Deposit'}
        </Button>
      </div>
    </Card>
  );
});
