// Wallet connection state management

import { makeAutoObservable, runInAction } from 'mobx';
import { web3Provider } from '../services/web3/provider';
import { walletLogger as log } from '../services/logger';
import { CHAIN_ID } from '../config/contracts';
import type { ConnectionMethod } from '../types';
import type { RootStore } from './RootStore';

export class WalletStore {
  address: string | null = null;
  isConnecting = false;
  isConnected = false;
  connectionMethod: ConnectionMethod = null;
  chainId: number | null = null;
  qrlBalance: bigint = 0n;
  error: string | null = null;

  private rootStore: RootStore;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }

  get displayAddress(): string {
    if (!this.address) return '';
    return 'Z' + this.address.slice(2);
  }

  get shortAddress(): string {
    if (!this.address) return '';
    const display = this.displayAddress;
    return `${display.slice(0, 8)}...${display.slice(-6)}`;
  }

  get isCorrectNetwork(): boolean {
    return this.chainId === CHAIN_ID;
  }

  get formattedBalance(): string {
    if (this.qrlBalance === 0n) return '0';
    const wei = this.qrlBalance;
    const qrl = Number(wei) / 1e18;
    return qrl.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  async connectExtension(): Promise<void> {
    if (this.isConnecting) return;

    log.info('Initiating extension connection...');
    this.isConnecting = true;
    this.error = null;

    try {
      const { web3, address } = await web3Provider.connectExtension();

      const chainId = await web3.zond.getChainId();
      const balance = await web3.zond.getBalance(address);

      runInAction(() => {
        this.address = address;
        this.chainId = Number(chainId);
        this.qrlBalance = BigInt(balance.toString());
        this.isConnected = true;
        this.connectionMethod = 'extension';
        this.isConnecting = false;
      });

      log.info('Extension connected successfully', {
        address: this.shortAddress,
        chainId: this.chainId,
        balance: this.formattedBalance,
      });

      // Setup listeners for account/chain changes
      web3Provider.setupExtensionListeners(
        (accounts) => this.handleAccountsChanged(accounts),
        (chainId) => this.handleChainChanged(chainId)
      );

      // Trigger data refresh
      this.rootStore.refreshAll();
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Connection failed';
        this.isConnecting = false;
      });
      log.error('Extension connection failed', error);
    }
  }

  async setManualAddress(address: string): Promise<void> {
    log.info('Setting manual address...', { address });
    this.isConnecting = true;
    this.error = null;

    try {
      // Normalize address
      const normalizedAddress = address.startsWith('Z')
        ? '0x' + address.slice(1)
        : address.startsWith('0x')
        ? address
        : '0x' + address;

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedAddress)) {
        throw new Error('Invalid address format');
      }

      // Connect to RPC for read-only access
      const web3 = await web3Provider.connectRPC();

      const chainId = await web3.zond.getChainId();
      const balance = await web3.zond.getBalance(normalizedAddress);

      runInAction(() => {
        this.address = normalizedAddress;
        this.chainId = Number(chainId);
        this.qrlBalance = BigInt(balance.toString());
        this.isConnected = true;
        this.connectionMethod = 'manual';
        this.isConnecting = false;
      });

      log.info('Manual address set', {
        address: this.shortAddress,
        balance: this.formattedBalance,
      });

      // Trigger data refresh
      this.rootStore.refreshAll();
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Invalid address';
        this.isConnecting = false;
      });
      log.error('Manual address failed', error);
    }
  }

  disconnect(): void {
    log.info('Disconnecting wallet...');

    this.address = null;
    this.isConnected = false;
    this.connectionMethod = null;
    this.chainId = null;
    this.qrlBalance = 0n;
    this.error = null;

    log.info('Wallet disconnected');
  }

  async refreshBalance(): Promise<void> {
    if (!this.address) return;

    try {
      const balance = await web3Provider.getBalance(this.address);
      runInAction(() => {
        this.qrlBalance = balance;
      });
      log.debug('Balance refreshed', { balance: this.formattedBalance });
    } catch (error) {
      log.error('Failed to refresh balance', error);
    }
  }

  private handleAccountsChanged(accounts: string[]): void {
    log.info('Accounts changed event', { accounts });

    if (accounts.length === 0) {
      this.disconnect();
    } else {
      runInAction(() => {
        this.address = accounts[0];
      });
      this.refreshBalance();
      this.rootStore.refreshAll();
    }
  }

  private handleChainChanged(chainIdHex: string): void {
    const chainId = parseInt(chainIdHex, 16);
    log.info('Chain changed event', { chainId });

    runInAction(() => {
      this.chainId = chainId;
    });

    if (chainId !== CHAIN_ID) {
      log.warn('Wrong network detected', { expected: CHAIN_ID, got: chainId });
    }
  }
}
