import { observer } from 'mobx-react-lite';
import { useWalletStore, useUserStore, useProtocolStore } from '../../stores/RootStore';
import { Card } from '../common/Card';

export const BalanceCard = observer(function BalanceCard() {
  const walletStore = useWalletStore();
  const userStore = useUserStore();
  const protocolStore = useProtocolStore();

  if (!walletStore.isConnected) {
    return (
      <Card>
        <div className="text-center py-8 text-gray-400">
          Connect your wallet to view your position
        </div>
      </Card>
    );
  }

  // Calculate profit/loss
  const deposited = userStore.stQRLBalance; // Assuming 1:1 at deposit
  const currentValue = userStore.stQRLValueInQRL;
  const profit = currentValue - deposited;
  const profitPercent = deposited > 0n
    ? (Number(profit) / Number(deposited)) * 100
    : 0;

  return (
    <Card title="Your Position">
      <div className="space-y-4">
        {/* QRL Balance */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Available QRL</span>
          <span className="text-xl font-semibold text-white">
            {walletStore.formattedBalance} QRL
          </span>
        </div>

        {/* stQRL Balance */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Staked (stQRL)</span>
          <span className="text-xl font-semibold text-white">
            {userStore.stQRLFormatted} stQRL
          </span>
        </div>

        {/* Current Value */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Current Value</span>
          <span className="text-xl font-semibold text-qrl-accent">
            {userStore.stQRLValueFormatted} QRL
          </span>
        </div>

        {/* Profit/Rewards */}
        {userStore.hasStake && (
          <div className="border-t border-gray-700 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Rewards Earned</span>
              <span className={`text-lg font-semibold ${profit >= 0n ? 'text-green-400' : 'text-red-400'}`}>
                {profit >= 0n ? '+' : ''}{(Number(profit) / 1e18).toFixed(4)} QRL
                <span className="text-sm ml-1">
                  ({profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Exchange Rate Info */}
        <div className="bg-qrl-darker p-3 rounded-lg">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Exchange Rate</span>
            <span className="text-gray-300">
              1 stQRL = {protocolStore.exchangeRateFormatted} QRL
            </span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-400">Est. APY</span>
            <span className="text-qrl-primary">{protocolStore.estimatedAPY}%</span>
          </div>
        </div>

        {/* Loading indicator */}
        {userStore.isLoading && (
          <div className="text-center text-gray-400 text-sm">
            Updating...
          </div>
        )}
      </div>
    </Card>
  );
});
