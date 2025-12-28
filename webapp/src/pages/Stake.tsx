import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { DepositForm } from '../components/staking/DepositForm';
import { WithdrawForm, ClaimWithdrawal } from '../components/staking/WithdrawForm';
import { BalanceCard } from '../components/staking/BalanceCard';
import { ManualTransferInfo } from '../components/wallet/ConnectWallet';
import { useWalletStore, useUserStore } from '../stores/RootStore';

export const Stake = observer(function Stake() {
  const walletStore = useWalletStore();
  const userStore = useUserStore();
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Stake & Withdraw</h1>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left: Balance */}
        <div className="md:col-span-1">
          <BalanceCard />
        </div>

        {/* Right: Actions */}
        <div className="md:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setTab('deposit')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                tab === 'deposit'
                  ? 'bg-qrl-primary text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Deposit
            </button>
            <button
              onClick={() => setTab('withdraw')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                tab === 'withdraw'
                  ? 'bg-qrl-primary text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Withdraw
            </button>
          </div>

          {/* Form */}
          {tab === 'deposit' ? <DepositForm /> : <WithdrawForm />}

          {/* Pending Withdrawal */}
          {userStore.withdrawalRequest && <ClaimWithdrawal />}

          {/* Manual Transfer Option */}
          {!walletStore.isConnected && tab === 'deposit' && <ManualTransferInfo />}
        </div>
      </div>
    </div>
  );
});
