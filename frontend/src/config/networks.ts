export type NetworkId = "TEST_NET" | "MAIN_NET";

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  shortName: string;
  rpcUrl: string;
  explorer: string;
  contracts: {
    depositPool: string;
    stQRL: string;
    validatorManager: string;
  };
}

const env = import.meta.env;

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  TEST_NET: {
    id: "TEST_NET",
    name: "QRL 2.0 Testnet",
    shortName: "Testnet",
    rpcUrl: env.VITE_RPC_URL_TESTNET || "https://qrlwallet.com/api/qrl-rpc/testnet",
    explorer: env.VITE_EXPLORER_URL || "https://zondscan.com",
    contracts: {
      // Defaults mirror config/testnet-hyperion.json at the repo root
      depositPool: env.VITE_DEPOSIT_POOL_ADDRESS || "Q109d7C528a67b80eb638D4C85e7C4545ef9Bb9aC",
      stQRL: env.VITE_STQRL_ADDRESS || "QA2f23388d1e3986416A36d2Ef113850D6900b69C",
      validatorManager:
        env.VITE_VALIDATOR_MANAGER_ADDRESS || "QA5b6e85B7713670589e4eAf2F039380Ec2792c8C",
    },
  },
  MAIN_NET: {
    id: "MAIN_NET",
    name: "QRL 2.0 Mainnet",
    shortName: "Mainnet",
    rpcUrl: env.VITE_RPC_URL_MAINNET || "https://qrlwallet.com/api/qrl-rpc/mainnet",
    explorer: env.VITE_EXPLORER_URL || "https://zondscan.com",
    contracts: {
      // Not deployed to mainnet yet
      depositPool: env.VITE_DEPOSIT_POOL_ADDRESS || "",
      stQRL: env.VITE_STQRL_ADDRESS || "",
      validatorManager: env.VITE_VALIDATOR_MANAGER_ADDRESS || "",
    },
  },
};

const requestedNetwork = (env.VITE_NETWORK || "TEST_NET") as NetworkId;
export const ACTIVE_NETWORK: NetworkConfig =
  NETWORKS[requestedNetwork] ?? NETWORKS.TEST_NET;

export const getExplorerTxUrl = (txHash: string): string =>
  `${ACTIVE_NETWORK.explorer}/tx/${txHash}`;

export const getExplorerAddressUrl = (address: string): string =>
  `${ACTIVE_NETWORK.explorer}/address/${address}`;

/** QRL block time — used to translate withdrawal-delay blocks into wall time. */
export const BLOCK_TIME_SECONDS = 60;

/** DepositPool WITHDRAWAL_DELAY constant (blocks). */
export const WITHDRAWAL_DELAY_BLOCKS = 128;

/** DepositPool VALIDATOR_STAKE constant — QRL needed to fund one validator. */
export const VALIDATOR_STAKE_QRL = 40_000n * 10n ** 18n;
