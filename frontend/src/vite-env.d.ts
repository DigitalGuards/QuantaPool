/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: string;
  readonly VITE_NETWORK_NAME?: string;
  readonly VITE_NETWORK_LABEL?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_NATIVE_POOL_ADDRESS?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_DEPLOYMENT_BLOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
