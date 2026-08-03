/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: string;
  readonly VITE_RPC_URL_TESTNET?: string;
  readonly VITE_RPC_URL_MAINNET?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_DEPOSIT_POOL_ADDRESS?: string;
  readonly VITE_STQRL_ADDRESS?: string;
  readonly VITE_VALIDATOR_MANAGER_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
