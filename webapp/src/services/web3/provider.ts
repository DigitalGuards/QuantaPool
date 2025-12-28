// Web3 provider initialization for Zond

import { Web3 } from '@theqrl/web3';
import { web3Logger as log } from '../logger';
import { RPC_URL, CHAIN_ID } from '../../config/contracts';

class Web3Provider {
  private web3: Web3 | null = null;
  private isExtension = false;

  async connectRPC(): Promise<Web3> {
    log.info('Connecting to RPC provider...', { url: RPC_URL });

    try {
      this.web3 = new Web3(RPC_URL);
      this.isExtension = false;

      const chainId = await this.web3.zond.getChainId();
      log.info('Connected to chain', { chainId: Number(chainId) });

      if (Number(chainId) !== CHAIN_ID) {
        log.warn('Chain ID mismatch!', { expected: CHAIN_ID, got: Number(chainId) });
      }

      const blockNumber = await this.web3.zond.getBlockNumber();
      log.debug('Current block', { blockNumber: Number(blockNumber) });

      return this.web3;
    } catch (error) {
      log.error('Failed to connect to RPC', error);
      throw error;
    }
  }

  async connectExtension(): Promise<{ web3: Web3; address: string }> {
    log.info('Connecting to Zond Chrome Extension...');

    const zondExt = window.zond;
    if (!zondExt) {
      log.error('Zond extension not found');
      throw new Error('Zond Chrome Extension not installed. Please install it from the Chrome Web Store.');
    }

    try {
      // Request accounts
      const accounts = await zondExt.request({ method: 'zond_requestAccounts' }) as string[];
      log.info('Extension connected', { accounts });

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found. Please unlock your wallet.');
      }

      // Create Web3 instance with extension provider
      this.web3 = new Web3(zondExt as unknown as string);
      this.isExtension = true;

      const chainId = await this.web3.zond.getChainId();
      log.info('Extension chain', { chainId: Number(chainId) });

      if (Number(chainId) !== CHAIN_ID) {
        log.warn('Wrong network! Please switch to Zond Testnet', {
          expected: CHAIN_ID,
          got: Number(chainId),
        });
      }

      return { web3: this.web3, address: accounts[0] };
    } catch (error) {
      log.error('Extension connection failed', error);
      throw error;
    }
  }

  getWeb3(): Web3 {
    if (!this.web3) {
      throw new Error('Web3 not initialized. Call connect first.');
    }
    return this.web3;
  }

  isConnected(): boolean {
    return this.web3 !== null;
  }

  isExtensionConnected(): boolean {
    return this.isExtension;
  }

  async getBalance(address: string): Promise<bigint> {
    const web3 = this.getWeb3();
    const balance = await web3.zond.getBalance(address);
    log.debug('Balance fetched', { address: address.slice(0, 10) + '...', balance: balance.toString() });
    return BigInt(balance.toString());
  }

  async getBlockNumber(): Promise<number> {
    const web3 = this.getWeb3();
    const block = await web3.zond.getBlockNumber();
    return Number(block);
  }

  // Subscribe to extension events
  setupExtensionListeners(
    onAccountsChanged: (accounts: string[]) => void,
    onChainChanged: (chainId: string) => void
  ): void {
    const zondExt = window.zond;
    if (!zondExt) return;

    zondExt.on('accountsChanged', (accounts) => {
      log.info('Accounts changed', { accounts });
      onAccountsChanged(accounts as string[]);
    });

    zondExt.on('chainChanged', (chainId) => {
      log.info('Chain changed', { chainId });
      onChainChanged(chainId as string);
    });
  }
}

export const web3Provider = new Web3Provider();
