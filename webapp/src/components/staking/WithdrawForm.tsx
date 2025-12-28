import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useWalletStore, useUserStore, useProtocolStore, useTransactionStore } from '../../stores/RootStore';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Card } from '../common/Card';
import { parseQRL, formatQRL } from '../../utils/format';
import { uiLogger as log } from '../../services/logger';

export const WithdrawForm = observer(function WithdrawForm() {
  const walletStore = useWalletStore();
  const userStore = useUserStore();
  const protocolStore = useProtocolStore();
  const txStore = useTransactionStore();

  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const handleAmountChange = (value: string) => {
    if (!/^[0-9]*\.?[0-9]*$/.test(value) && value !== '') return;
    setAmount(value);
    setError('');
  };

  const handleMaxClick = () => {
    if (userStore.stQRLBalance > 0n) {
      setAmount(formatQRL(userStore.stQRLBalance, 4));
    }
  };

  // Calculate QRL value for entered stQRL amount
  const getQRLValue = (): bigint => {
    if (!amount || parseFloat(amount) <= 0) return 0n;
    const shares = parseQRL(amount);
    // Use exchange rate to calculate
    return (shares * protocolStore.exchangeRate) / BigInt('1000000000000000000');
  };

  const validateAmount = (): boolean => {
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter an amount');
      return false;
    }

    const shares = parseQRL(amount);

    if (shares > userStore.stQRLBalance) {
      setError('Insufficient stQRL balance');
      return false;
    }

    return true;
  };

  const handleWithdraw = async () => {
    if (!validateAmount()) return;

    const shares = parseQRL(amount);
    log.info('Submitting withdrawal request', { shares: shares.toString() });

    const hash = await txStore.requestWithdrawal(shares);
    if (hash) {
      setAmount('');
    }
  };

  const isReadOnly = walletStore.connectionMethod === 'manual';
  const canWithdraw = walletStore.isConnected && !isReadOnly && !txStore.isSubmitting && userStore.stQRLBalance > 0n;

  return (
    <Card title="Withdraw stQRL">
      <div className="space-y-4">
        {/* Current stQRL Balance */}
        <div className="bg-qrl-darker p-3 rounded-lg">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Your stQRL balance</span>
            <span className="text-white">{userStore.stQRLFormatted} stQRL</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-400">Current value</span>
            <span className="text-qrl-accent">{userStore.stQRLValueFormatted} QRL</span>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm text-gray-400">Amount to withdraw</label>
            <button
              className="text-sm text-qrl-primary hover:underline"
              onClick={handleMaxClick}
              disabled={userStore.stQRLBalance === 0n}
            >
              Max
            </button>
          </div>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            suffix="stQRL"
            error={error}
          />
        </div>

        {/* Preview */}
        {amount && parseFloat(amount) > 0 && (
          <div className="bg-qrl-darker p-3 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">You will receive</span>
              <span className="text-white">{formatQRL(getQRLValue(), 4)} QRL</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-400">Wait time</span>
              <span className="text-gray-300">~128 blocks (~2 hours)</span>
            </div>
          </div>
        )}

        {/* Pending withdrawal info */}
        {userStore.hasPendingWithdrawal && (
          <div className="bg-yellow-900/30 border border-yellow-700 p-3 rounded-lg">
            <p className="text-yellow-400 text-sm">
              You have a pending withdrawal request. Claim it before making a new request.
            </p>
          </div>
        )}

        {isReadOnly && walletStore.isConnected && (
          <p className="text-yellow-400 text-sm">
            Connect with wallet extension to withdraw.
          </p>
        )}

        {txStore.error && (
          <p className="text-red-400 text-sm">{txStore.error}</p>
        )}

        {/* Submit Button */}
        <Button
          className="w-full"
          size="lg"
          onClick={handleWithdraw}
          disabled={!canWithdraw || !amount || userStore.hasPendingWithdrawal}
          isLoading={txStore.isSubmitting}
        >
          {userStore.hasPendingWithdrawal ? 'Pending Withdrawal' : 'Request Withdrawal'}
        </Button>
      </div>
    </Card>
  );
});

export const ClaimWithdrawal = observer(function ClaimWithdrawal() {
  const walletStore = useWalletStore();
  const userStore = useUserStore();
  const txStore = useTransactionStore();

  if (!userStore.withdrawalRequest) return null;

  const handleClaim = async () => {
    await txStore.claimWithdrawal();
  };

  const isReadOnly = walletStore.connectionMethod === 'manual';
  const canClaim = !isReadOnly && userStore.canClaimWithdrawal && !txStore.isSubmitting;

  return (
    <Card title="Pending Withdrawal">
      <div className="space-y-3">
        <div className="bg-qrl-darker p-3 rounded-lg">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Shares to burn</span>
            <span className="text-white">
              {formatQRL(userStore.withdrawalRequest.shares, 4)} stQRL
            </span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-400">QRL to receive</span>
            <span className="text-qrl-accent">
              {formatQRL(userStore.withdrawalRequest.assets, 4)} QRL
            </span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-400">Status</span>
            <span className={userStore.canClaimWithdrawal ? 'text-green-400' : 'text-yellow-400'}>
              {userStore.canClaimWithdrawal ? 'Ready to claim' : userStore.timeUntilClaim}
            </span>
          </div>
        </div>

        {!userStore.canClaimWithdrawal && (
          <p className="text-gray-400 text-sm">
            {userStore.blocksUntilClaim} blocks remaining until you can claim.
          </p>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={handleClaim}
          disabled={!canClaim}
          isLoading={txStore.isSubmitting}
        >
          {userStore.canClaimWithdrawal ? 'Claim QRL' : `Wait ${userStore.timeUntilClaim}`}
        </Button>
      </div>
    </Card>
  );
});
