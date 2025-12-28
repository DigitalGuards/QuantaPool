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
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          Post-Quantum Liquid Staking
        </h1>
        <p className="text-gray-400">
          Stake QRL, receive stQRL, earn rewards while staying liquid
        </p>
      </div>

      {/* Stats Bar */}
      <Card>
        <ProtocolStatsCompact />
      </Card>

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
      <Card title="How It Works">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="text-center p-4">
            <div className="text-3xl mb-2">1️⃣</div>
            <h3 className="font-semibold text-white mb-1">Deposit QRL</h3>
            <p className="text-gray-400 text-sm">
              Send QRL to receive stQRL tokens at the current exchange rate
            </p>
          </div>
          <div className="text-center p-4">
            <div className="text-3xl mb-2">2️⃣</div>
            <h3 className="font-semibold text-white mb-1">Earn Rewards</h3>
            <p className="text-gray-400 text-sm">
              Validators earn staking rewards, increasing the stQRL exchange rate
            </p>
          </div>
          <div className="text-center p-4">
            <div className="text-3xl mb-2">3️⃣</div>
            <h3 className="font-semibold text-white mb-1">Withdraw Anytime</h3>
            <p className="text-gray-400 text-sm">
              Redeem stQRL for more QRL than you deposited (after ~2 hour wait)
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
});
