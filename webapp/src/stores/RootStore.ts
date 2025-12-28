// Root store combining all MobX stores

import { makeAutoObservable } from 'mobx';
import { WalletStore } from './WalletStore';
import { ProtocolStore } from './ProtocolStore';
import { UserStore } from './UserStore';
import { TransactionStore } from './TransactionStore';
import { storeLogger as log } from '../services/logger';
import { formatQRL, parseQRL } from '../utils/format';

export class RootStore {
  walletStore: WalletStore;
  protocolStore: ProtocolStore;
  userStore: UserStore;
  transactionStore: TransactionStore;

  isInitialized = false;

  constructor() {
    this.walletStore = new WalletStore(this);
    this.protocolStore = new ProtocolStore(this);
    this.userStore = new UserStore(this);
    this.transactionStore = new TransactionStore(this);

    makeAutoObservable(this);

    // Expose to window for debugging
    this.exposeToWindow();

    log.info('RootStore initialized');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    log.info('Initializing stores...');

    // Start protocol polling
    this.protocolStore.startPolling(30000);

    this.isInitialized = true;
    log.info('Stores initialized');
  }

  async refreshAll(): Promise<void> {
    log.info('Refreshing all data...');

    await Promise.all([
      this.protocolStore.fetchAll(),
      this.userStore.fetchAll(),
      this.walletStore.refreshBalance(),
    ]);
  }

  cleanup(): void {
    this.protocolStore.stopPolling();
    log.info('Stores cleaned up');
  }

  private exposeToWindow(): void {
    const debugObj = {
      stores: {
        wallet: this.walletStore,
        protocol: this.protocolStore,
        user: this.userStore,
        transaction: this.transactionStore,
      },
      web3: null as unknown,
      contracts: null as unknown,
      formatQRL: (wei: bigint) => formatQRL(wei),
      parseQRL: (qrl: string) => parseQRL(qrl),
      refresh: () => this.refreshAll(),
    };

    (window as Window & { __QUANTAPOOL__?: typeof debugObj }).__QUANTAPOOL__ = debugObj;

    log.debug('Debug objects exposed to window.__QUANTAPOOL__');
  }
}

// Create singleton instance
export const rootStore = new RootStore();

// React context for store access
import { createContext, useContext } from 'react';

export const StoreContext = createContext<RootStore>(rootStore);

export const useStores = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStores must be used within StoreProvider');
  }
  return context;
};

export const useWalletStore = () => useStores().walletStore;
export const useProtocolStore = () => useStores().protocolStore;
export const useUserStore = () => useStores().userStore;
export const useTransactionStore = () => useStores().transactionStore;
