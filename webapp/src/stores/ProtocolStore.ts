// Protocol state management

import { makeAutoObservable, runInAction } from 'mobx';
import { web3Provider } from '../services/web3/provider';
import { contractLogger as log } from '../services/logger';
import { CONTRACTS, STQRL_ABI, DEPOSIT_POOL_ABI, VALIDATOR_THRESHOLD } from '../config/contracts';
import type { QueueStatus, ProtocolStats } from '../types';
import type { RootStore } from './RootStore';

export class ProtocolStore {
  // Exchange rate (scaled by 10^18, so 1.0 = 10^18)
  exchangeRate: bigint = BigInt('1000000000000000000');
  totalAssets: bigint = 0n;
  totalSupply: bigint = 0n;

  // Queue status
  pendingDeposits: bigint = 0n;
  liquidReserve: bigint = 0n;
  validatorCount = 0;

  // Protocol state
  isPaused = false;
  lastUpdate: Date | null = null;
  isLoading = false;
  error: string | null = null;

  private rootStore: RootStore;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }

  get queueStatus(): QueueStatus {
    return {
      pending: this.pendingDeposits,
      threshold: VALIDATOR_THRESHOLD,
      remaining: this.pendingDeposits >= VALIDATOR_THRESHOLD
        ? 0n
        : VALIDATOR_THRESHOLD - this.pendingDeposits,
      validatorsReady: Number(this.pendingDeposits / VALIDATOR_THRESHOLD),
    };
  }

  get thresholdPercent(): number {
    if (VALIDATOR_THRESHOLD === 0n) return 0;
    return Number((this.pendingDeposits * 10000n) / VALIDATOR_THRESHOLD) / 100;
  }

  get tvlFormatted(): string {
    const qrl = Number(this.totalAssets) / 1e18;
    return qrl.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  get exchangeRateFormatted(): string {
    const rate = Number(this.exchangeRate) / 1e18;
    return rate.toFixed(6);
  }

  get estimatedAPY(): number {
    // Simple estimation based on Zond staking rewards (~4-5% annual)
    // This would be calculated from historical rate changes in production
    return 4.5;
  }

  get stats(): ProtocolStats {
    return {
      totalAssets: this.totalAssets,
      totalSupply: this.totalSupply,
      exchangeRate: this.exchangeRate,
      pendingDeposits: this.pendingDeposits,
      liquidReserve: this.liquidReserve,
      validatorCount: this.validatorCount,
      isPaused: this.isPaused,
    };
  }

  async fetchAll(): Promise<void> {
    log.info('Fetching protocol state...');
    this.isLoading = true;
    this.error = null;

    try {
      const web3 = web3Provider.getWeb3();

      // Create contract instances
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stQRL = new web3.zond.Contract(STQRL_ABI as any, CONTRACTS.stQRL);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const depositPool = new web3.zond.Contract(DEPOSIT_POOL_ABI as any, CONTRACTS.depositPool);

      // Fetch all data in parallel
      const [
        exchangeRate,
        totalAssets,
        totalSupply,
        queueStatus,
        liquidReserve,
        validatorCount,
        isPaused,
      ] = await Promise.all([
        stQRL.methods.getExchangeRate().call() as Promise<string>,
        stQRL.methods.totalAssets().call() as Promise<string>,
        stQRL.methods.totalSupply().call() as Promise<string>,
        depositPool.methods.getQueueStatus().call() as Promise<{
          pending: string;
          threshold: string;
          remaining: string;
          validatorsReady: string;
        }>,
        depositPool.methods.liquidReserve().call() as Promise<string>,
        depositPool.methods.validatorCount().call() as Promise<string>,
        stQRL.methods.paused().call() as Promise<boolean>,
      ]);

      runInAction(() => {
        this.exchangeRate = BigInt(exchangeRate);
        this.totalAssets = BigInt(totalAssets);
        this.totalSupply = BigInt(totalSupply);
        this.pendingDeposits = BigInt(queueStatus.pending);
        this.liquidReserve = BigInt(liquidReserve);
        this.validatorCount = Number(validatorCount);
        this.isPaused = isPaused;
        this.lastUpdate = new Date();
        this.isLoading = false;
      });

      log.info('Protocol state fetched', {
        exchangeRate: this.exchangeRateFormatted,
        tvl: this.tvlFormatted,
        queuePercent: this.thresholdPercent.toFixed(1) + '%',
        validators: this.validatorCount,
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to fetch protocol state';
        this.isLoading = false;
      });
      log.error('Failed to fetch protocol state', error);
    }
  }

  async previewDeposit(amount: bigint): Promise<bigint> {
    try {
      const web3 = web3Provider.getWeb3();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const depositPool = new web3.zond.Contract(DEPOSIT_POOL_ABI as any, CONTRACTS.depositPool);

      const shares = await (depositPool.methods as any).previewDeposit(amount.toString()).call() as string;
      log.debug('Preview deposit', {
        amount: (Number(amount) / 1e18).toFixed(4),
        shares: (Number(shares) / 1e18).toFixed(4),
      });

      return BigInt(shares);
    } catch (error) {
      log.error('Preview deposit failed', error);
      return 0n;
    }
  }

  startPolling(intervalMs = 30000): void {
    if (this.pollInterval) return;

    log.info('Starting protocol polling', { interval: intervalMs });

    this.fetchAll();
    this.pollInterval = setInterval(() => {
      this.fetchAll();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      log.info('Stopped protocol polling');
    }
  }
}
