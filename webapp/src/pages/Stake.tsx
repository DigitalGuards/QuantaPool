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
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-white">
        Stake & <span className="text-qrl-cyan">Withdraw</span>
      </h1>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left: Balance */}
        <div className="md:col-span-1">
          <BalanceCard />
        </div>

        {/* Right: Actions */}
        <div className="md:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex gap-2 bg-qrl-darker/50 p-1 rounded-xl w-fit">
            <button
              onClick={() => setTab('deposit')}
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
                tab === 'deposit'
                  ? 'bg-qrl-cyan text-qrl-darker'
                  : 'text-qrl-muted hover:text-white'
              }`}
            >
              Deposit
            </button>
            <button
              onClick={() => setTab('withdraw')}
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
                tab === 'withdraw'
                  ? 'bg-qrl-orange text-white'
                  : 'text-qrl-muted hover:text-white'
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
