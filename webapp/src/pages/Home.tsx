import { observer } from 'mobx-react-lite';
import { useWalletStore } from '../stores/RootStore';
import { BalanceCard } from '../components/staking/BalanceCard';
import { DepositForm } from '../components/staking/DepositForm';
import { ClaimWithdrawal } from '../components/staking/WithdrawForm';
import { QueueStatusCompact } from '../components/stats/QueueStatus';
import { ProtocolStatsCompact } from '../components/stats/ProtocolStats';
import { ManualTransferInfo } from '../components/wallet/ConnectWallet';
import { Card } from '../components/common/Card';

export const Home = observer(function Home() {
  const walletStore = useWalletStore();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-3">
          Post-Quantum <span className="text-qrl-cyan">Liquid Staking</span>
        </h1>
        <p className="text-qrl-muted text-lg">
          Stake QRL, receive stQRL, earn rewards while staying liquid
        </p>
      </div>

      {/* Stats Bar */}
      <ProtocolStatsCompact />

      {/* Main Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <BalanceCard />
          <ClaimWithdrawal />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <DepositForm />
          <QueueStatusCompact />
          {!walletStore.isConnected && <ManualTransferInfo />}
        </div>
      </div>

      {/* How it works */}
      <Card title="How It Works" accent="orange">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="text-center p-4 bg-qrl-darker/30 rounded-xl border border-qrl-border">
            <div className="w-12 h-12 bg-qrl-orange/20 rounded-xl flex items-center justify-center mx-auto mb-4">
              <span className="text-qrl-orange text-xl font-bold">1</span>
            </div>
            <h3 className="font-semibold text-white mb-2">Deposit QRL</h3>
            <p className="text-qrl-muted text-sm">
              Send QRL to receive stQRL tokens at the current exchange rate
            </p>
          </div>
          <div className="text-center p-4 bg-qrl-darker/30 rounded-xl border border-qrl-border">
            <div className="w-12 h-12 bg-qrl-cyan/20 rounded-xl flex items-center justify-center mx-auto mb-4">
              <span className="text-qrl-cyan text-xl font-bold">2</span>
            </div>
            <h3 className="font-semibold text-white mb-2">Earn Rewards</h3>
            <p className="text-qrl-muted text-sm">
              Validators earn staking rewards, increasing the stQRL exchange rate
            </p>
          </div>
          <div className="text-center p-4 bg-qrl-darker/30 rounded-xl border border-qrl-border">
            <div className="w-12 h-12 bg-qrl-orange/20 rounded-xl flex items-center justify-center mx-auto mb-4">
              <span className="text-qrl-orange text-xl font-bold">3</span>
            </div>
            <h3 className="font-semibold text-white mb-2">Withdraw Anytime</h3>
            <p className="text-qrl-muted text-sm">
              Redeem stQRL for more QRL than you deposited (after ~2 hour wait)
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
});
