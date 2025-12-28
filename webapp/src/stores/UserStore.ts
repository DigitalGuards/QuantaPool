// User position state management

import { makeAutoObservable, runInAction } from 'mobx';
import { web3Provider } from '../services/web3/provider';
import { contractLogger as log } from '../services/logger';
import { CONTRACTS, STQRL_ABI, DEPOSIT_POOL_ABI, WITHDRAWAL_DELAY_BLOCKS, BLOCK_TIME_SECONDS } from '../config/contracts';
import type { WithdrawalRequest, UserPosition } from '../types';
import type { RootStore } from './RootStore';

export class UserStore {
  stQRLBalance: bigint = 0n;
  stQRLValueInQRL: bigint = 0n;
  withdrawalRequest: WithdrawalRequest | null = null;
  currentBlock = 0;

  isLoading = false;
  error: string | null = null;

  private rootStore: RootStore;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }

  get hasStake(): boolean {
    return this.stQRLBalance > 0n;
  }

  get hasPendingWithdrawal(): boolean {
    return this.withdrawalRequest !== null && !this.withdrawalRequest.canClaim;
  }

  get canClaimWithdrawal(): boolean {
    return this.withdrawalRequest?.canClaim ?? false;
  }

  get stQRLFormatted(): string {
    const qrl = Number(this.stQRLBalance) / 1e18;
    return qrl.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  get stQRLValueFormatted(): string {
    const qrl = Number(this.stQRLValueInQRL) / 1e18;
    return qrl.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  get blocksUntilClaim(): number {
    if (!this.withdrawalRequest || this.withdrawalRequest.canClaim) return 0;
    const remaining = this.withdrawalRequest.requestBlock + WITHDRAWAL_DELAY_BLOCKS - this.currentBlock;
    return Math.max(0, remaining);
  }

  get timeUntilClaim(): string {
    const blocks = this.blocksUntilClaim;
    if (blocks === 0) return 'Ready';

    const seconds = blocks * BLOCK_TIME_SECONDS;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `~${hours}h ${minutes}m`;
    }
    return `~${minutes}m`;
  }

  get position(): UserPosition {
    return {
      qrlBalance: this.rootStore.walletStore.qrlBalance,
      stQRLBalance: this.stQRLBalance,
      stQRLValueInQRL: this.stQRLValueInQRL,
      withdrawalRequest: this.withdrawalRequest,
    };
  }

  async fetchAll(): Promise<void> {
    const address = this.rootStore.walletStore.address;
    if (!address) {
      log.debug('No address, skipping user fetch');
      return;
    }

    log.info('Fetching user position...', { address: address.slice(0, 10) + '...' });
    this.isLoading = true;
    this.error = null;

    try {
      const web3 = web3Provider.getWeb3();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stQRL = new web3.zond.Contract(STQRL_ABI as any, CONTRACTS.stQRL);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const depositPool = new web3.zond.Contract(DEPOSIT_POOL_ABI as any, CONTRACTS.depositPool);

      const [stQRLBalance, withdrawalReq, currentBlock] = await Promise.all([
        (stQRL.methods as any).balanceOf(address).call() as Promise<string>,
        (depositPool.methods as any).getWithdrawalRequest(address).call() as Promise<{
          shares: string;
          assets: string;
          requestBlock: string;
          canClaim: boolean;
        }>,
        web3.zond.getBlockNumber(),
      ]);

      // Calculate stQRL value in QRL
      let stQRLValue = 0n;
      if (BigInt(stQRLBalance) > 0n) {
        const value = await (stQRL.methods as any).convertToAssets(stQRLBalance).call() as string;
        stQRLValue = BigInt(value);
      }

      // Parse withdrawal request
      let withdrawal: WithdrawalRequest | null = null;
      if (BigInt(withdrawalReq.shares) > 0n) {
        withdrawal = {
          shares: BigInt(withdrawalReq.shares),
          assets: BigInt(withdrawalReq.assets),
          requestBlock: Number(withdrawalReq.requestBlock),
          canClaim: withdrawalReq.canClaim,
        };
      }

      runInAction(() => {
        this.stQRLBalance = BigInt(stQRLBalance);
        this.stQRLValueInQRL = stQRLValue;
        this.withdrawalRequest = withdrawal;
        this.currentBlock = Number(currentBlock);
        this.isLoading = false;
      });

      log.info('User position fetched', {
        stQRL: this.stQRLFormatted,
        valueQRL: this.stQRLValueFormatted,
        pendingWithdrawal: this.hasPendingWithdrawal,
        canClaim: this.canClaimWithdrawal,
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to fetch user data';
        this.isLoading = false;
      });
      log.error('Failed to fetch user position', error);
    }
  }

  reset(): void {
    this.stQRLBalance = 0n;
    this.stQRLValueInQRL = 0n;
    this.withdrawalRequest = null;
    this.currentBlock = 0;
    this.error = null;
  }
}
