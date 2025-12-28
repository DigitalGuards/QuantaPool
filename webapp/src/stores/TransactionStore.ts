// Transaction tracking state management

import { makeAutoObservable, runInAction } from 'mobx';
import { web3Provider } from '../services/web3/provider';
import { txLogger as log } from '../services/logger';
import { CONTRACTS, DEPOSIT_POOL_ABI } from '../config/contracts';
import type { PendingTransaction } from '../types';
import type { RootStore } from './RootStore';

export class TransactionStore {
  pendingTxs: Map<string, PendingTransaction> = new Map();
  txHistory: PendingTransaction[] = [];
  currentTxHash: string | null = null;
  isSubmitting = false;
  error: string | null = null;

  private rootStore: RootStore;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }

  get hasPendingTx(): boolean {
    return this.pendingTxs.size > 0;
  }

  get pendingTxList(): PendingTransaction[] {
    return Array.from(this.pendingTxs.values());
  }

  async deposit(amount: bigint): Promise<string | null> {
    const address = this.rootStore.walletStore.address;
    if (!address) {
      this.error = 'No wallet connected';
      return null;
    }

    if (this.rootStore.walletStore.connectionMethod !== 'extension') {
      this.error = 'Deposits require wallet extension connection';
      return null;
    }

    log.tx('Initiating deposit...', { amount: (Number(amount) / 1e18).toFixed(4) });
    this.isSubmitting = true;
    this.error = null;

    try {
      const web3 = web3Provider.getWeb3();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const depositPool = new web3.zond.Contract(DEPOSIT_POOL_ABI as any, CONTRACTS.depositPool);

      // Estimate gas
      const gasEstimate = await depositPool.methods.deposit().estimateGas({
        from: address,
        value: amount.toString(),
      });
      log.tx('Gas estimated', { gas: Number(gasEstimate) });

      // Send transaction
      const receipt = await depositPool.methods.deposit().send({
        from: address,
        value: amount.toString(),
        gas: Math.floor(Number(gasEstimate) * 1.2).toString(),
      });

      const hash = receipt.transactionHash as string;

      log.tx('Deposit confirmed!', {
        hash,
        gasUsed: receipt.gasUsed?.toString(),
        status: receipt.status,
      });

      // Add to history
      const tx: PendingTransaction = {
        hash,
        type: 'deposit',
        amount,
        timestamp: new Date(),
        status: 'confirmed',
      };

      runInAction(() => {
        this.txHistory.unshift(tx);
        this.isSubmitting = false;
        this.currentTxHash = hash;
      });

      // Refresh data
      this.rootStore.refreshAll();

      return hash;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      runInAction(() => {
        this.error = message;
        this.isSubmitting = false;
      });
      log.error('Deposit failed', error);
      return null;
    }
  }

  async requestWithdrawal(shares: bigint): Promise<string | null> {
    const address = this.rootStore.walletStore.address;
    if (!address) {
      this.error = 'No wallet connected';
      return null;
    }

    if (this.rootStore.walletStore.connectionMethod !== 'extension') {
      this.error = 'Withdrawals require wallet extension connection';
      return null;
    }

    log.tx('Initiating withdrawal request...', { shares: (Number(shares) / 1e18).toFixed(4) });
    this.isSubmitting = true;
    this.error = null;

    try {
      const web3 = web3Provider.getWeb3();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const depositPool = new web3.zond.Contract(DEPOSIT_POOL_ABI as any, CONTRACTS.depositPool);

      const gasEstimate = await (depositPool.methods as any).requestWithdrawal(shares.toString()).estimateGas({
        from: address,
      });

      const receipt = await (depositPool.methods as any).requestWithdrawal(shares.toString()).send({
        from: address,
        gas: Math.floor(Number(gasEstimate) * 1.2).toString(),
      });

      const hash = receipt.transactionHash as string;

      log.tx('Withdrawal requested!', {
        hash,
        shares: (Number(shares) / 1e18).toFixed(4),
      });

      const tx: PendingTransaction = {
        hash,
        type: 'withdraw',
        amount: shares,
        timestamp: new Date(),
        status: 'confirmed',
      };

      runInAction(() => {
        this.txHistory.unshift(tx);
        this.isSubmitting = false;
        this.currentTxHash = hash;
      });

      this.rootStore.refreshAll();
      return hash;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      runInAction(() => {
        this.error = message;
        this.isSubmitting = false;
      });
      log.error('Withdrawal request failed', error);
      return null;
    }
  }

  async claimWithdrawal(): Promise<string | null> {
    const address = this.rootStore.walletStore.address;
    if (!address) {
      this.error = 'No wallet connected';
      return null;
    }

    if (this.rootStore.walletStore.connectionMethod !== 'extension') {
      this.error = 'Claims require wallet extension connection';
      return null;
    }

    log.tx('Initiating withdrawal claim...');
    this.isSubmitting = true;
    this.error = null;

    try {
      const web3 = web3Provider.getWeb3();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const depositPool = new web3.zond.Contract(DEPOSIT_POOL_ABI as any, CONTRACTS.depositPool);

      const gasEstimate = await depositPool.methods.claimWithdrawal().estimateGas({
        from: address,
      });

      const receipt = await depositPool.methods.claimWithdrawal().send({
        from: address,
        gas: Math.floor(Number(gasEstimate) * 1.2).toString(),
      });

      const hash = receipt.transactionHash as string;

      log.tx('Withdrawal claimed!', { hash });

      const tx: PendingTransaction = {
        hash,
        type: 'claim',
        amount: this.rootStore.userStore.withdrawalRequest?.assets ?? 0n,
        timestamp: new Date(),
        status: 'confirmed',
      };

      runInAction(() => {
        this.txHistory.unshift(tx);
        this.isSubmitting = false;
        this.currentTxHash = hash;
      });

      this.rootStore.refreshAll();
      return hash;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      runInAction(() => {
        this.error = message;
        this.isSubmitting = false;
      });
      log.error('Claim failed', error);
      return null;
    }
  }

  clearError(): void {
    this.error = null;
  }
}
