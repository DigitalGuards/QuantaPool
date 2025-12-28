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
    <Card title="Withdraw stQRL" accent="orange">
      <div className="space-y-5">
        {/* Current stQRL Balance */}
        <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
          <div className="flex justify-between text-sm">
            <span className="text-qrl-muted">Your stQRL balance</span>
            <span className="text-white font-medium">{userStore.stQRLFormatted} stQRL</span>
          </div>
          <div className="flex justify-between text-sm mt-2">
            <span className="text-qrl-muted">Current value</span>
            <span className="text-qrl-cyan font-medium">{userStore.stQRLValueFormatted} QRL</span>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-white font-medium">Amount to withdraw</label>
            <button
              className="text-sm text-qrl-cyan hover:text-qrl-cyan-hover transition-colors"
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
          <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
            <div className="flex justify-between text-sm">
              <span className="text-qrl-muted">You will receive</span>
              <span className="text-white font-medium">{formatQRL(getQRLValue(), 4)} QRL</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-qrl-muted">Wait time</span>
              <span className="text-white">~128 blocks (~2 hours)</span>
            </div>
          </div>
        )}

        {/* Pending withdrawal info */}
        {userStore.hasPendingWithdrawal && (
          <div className="bg-qrl-orange/10 border border-qrl-orange/30 p-3 rounded-xl">
            <p className="text-qrl-orange text-sm">
              You have a pending withdrawal request. Claim it before making a new request.
            </p>
          </div>
        )}

        {isReadOnly && walletStore.isConnected && (
          <div className="bg-qrl-orange/10 border border-qrl-orange/30 p-3 rounded-xl">
            <p className="text-qrl-orange text-sm">
              Connect with wallet extension to withdraw.
            </p>
          </div>
        )}

        {txStore.error && (
          <p className="text-red-400 text-sm">{txStore.error}</p>
        )}

        {/* Submit Button */}
        <Button
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
    <Card title="Pending Withdrawal" accent="cyan">
      <div className="space-y-4">
        <div className="bg-qrl-darker/50 p-4 rounded-xl border border-qrl-border">
          <div className="flex justify-between text-sm">
            <span className="text-qrl-muted">Shares to burn</span>
            <span className="text-white font-medium">
              {formatQRL(userStore.withdrawalRequest.shares, 4)} stQRL
            </span>
          </div>
          <div className="flex justify-between text-sm mt-2">
            <span className="text-qrl-muted">QRL to receive</span>
            <span className="text-qrl-cyan font-medium">
              {formatQRL(userStore.withdrawalRequest.assets, 4)} QRL
            </span>
          </div>
          <div className="flex justify-between text-sm mt-2">
            <span className="text-qrl-muted">Status</span>
            <span className={userStore.canClaimWithdrawal ? 'text-green-400 font-medium' : 'text-qrl-orange font-medium'}>
              {userStore.canClaimWithdrawal ? 'Ready to claim' : userStore.timeUntilClaim}
            </span>
          </div>
        </div>

        {!userStore.canClaimWithdrawal && (
          <p className="text-qrl-muted text-sm">
            {userStore.blocksUntilClaim} blocks remaining until you can claim.
          </p>
        )}

        <Button
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
