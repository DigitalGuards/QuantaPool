// Type definitions for QuantaPool webapp

export interface QueueStatus {
  pending: bigint;
  threshold: bigint;
  remaining: bigint;
  validatorsReady: number;
}

export interface WithdrawalRequest {
  shares: bigint;
  assets: bigint;
  requestBlock: number;
  canClaim: boolean;
}

export interface ProtocolStats {
  totalAssets: bigint;
  totalSupply: bigint;
  exchangeRate: bigint;
  pendingDeposits: bigint;
  liquidReserve: bigint;
  validatorCount: number;
  isPaused: boolean;
}

export interface UserPosition {
  qrlBalance: bigint;
  stQRLBalance: bigint;
  stQRLValueInQRL: bigint;
  withdrawalRequest: WithdrawalRequest | null;
}

export interface PendingTransaction {
  hash: string;
  type: 'deposit' | 'withdraw' | 'claim';
  amount: bigint;
  timestamp: Date;
  status: 'pending' | 'confirmed' | 'failed';
}

export type ConnectionMethod = 'extension' | 'manual' | null;

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

// Web3 types
export interface ZondExtension {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    zond?: ZondExtension;
    __QUANTAPOOL__?: {
      stores: unknown;
      web3: unknown;
      contracts: unknown;
      formatQRL: (wei: bigint) => string;
      parseQRL: (qrl: string) => bigint;
    };
    __QUANTAPOOL_LOGS__?: import('../services/logger').LogEntry[];
  }
}
