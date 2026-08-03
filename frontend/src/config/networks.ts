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
      depositPool: env.VITE_DEPOSIT_POOL_ADDRESS || "Q8e01Ea0bC7e337806154573A5B46Bb37F50Ea8fC",
      stQRL: env.VITE_STQRL_ADDRESS || "Q7d4cA4872502a1ab02bCA855C093449aaE2bee58",
      validatorManager:
        env.VITE_VALIDATOR_MANAGER_ADDRESS || "Qd84648a8F7314652B3E98D346645415eA03cce5f",
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

/** Display unit for native coin amounts. The asset/network name stays "QRL". */
export const NATIVE_UNIT = "Quanta";

/** QRL block time - used to translate withdrawal-delay blocks into wall time. */
export const BLOCK_TIME_SECONDS = 60;

/** DepositPool WITHDRAWAL_DELAY constant (blocks). */
export const WITHDRAWAL_DELAY_BLOCKS = 128;

/** DepositPool VALIDATOR_STAKE constant - QRL needed to fund one validator. */
export const VALIDATOR_STAKE_QRL = 40_000n * 10n ** 18n;
