import { isQrlAddress } from "../utils/qrlAddress";
import { readChainId } from "../utils/nativePosition";

export type NetworkId = "TEST_NET" | "MAIN_NET";
export interface NetworkConfig {
  id: NetworkId;
  name: string;
  shortName: string;
  rpcUrl: string;
  chainId: bigint | null;
  explorer: string;
  deploymentBlock: bigint;
  contracts: { nativePool: string };
  configured: boolean;
}

const env = import.meta.env;
const rpcUrl = env.VITE_RPC_URL || "";
const nativePool = env.VITE_NATIVE_POOL_ADDRESS || "";
let chainId: bigint | null = null;
try {
  chainId = readChainId(env.VITE_CHAIN_ID);
} catch {
  /* Unconfigured builds cannot send. */
}
function httpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
const explorer = httpUrl(env.VITE_EXPLORER_URL || "")
  ? (env.VITE_EXPLORER_URL || "").replace(/\/$/, "")
  : "";
export const ACTIVE_NETWORK: NetworkConfig = {
  id: env.VITE_NETWORK === "MAIN_NET" ? "MAIN_NET" : "TEST_NET",
  name: env.VITE_NETWORK_NAME || "Native QRL pool",
  shortName: env.VITE_NETWORK_LABEL || "Development",
  rpcUrl,
  chainId,
  explorer,
  deploymentBlock: /^\d+$/.test(env.VITE_DEPLOYMENT_BLOCK || "")
    ? BigInt(env.VITE_DEPLOYMENT_BLOCK || "0")
    : 0n,
  contracts: { nativePool },
  configured: httpUrl(rpcUrl) && chainId !== null && isQrlAddress(nativePool),
};
export const getExplorerTxUrl = (hash: string): string | undefined =>
  explorer ? `${explorer}/tx/${encodeURIComponent(hash)}` : undefined;
export const getExplorerAddressUrl = (address: string): string | undefined =>
  explorer ? `${explorer}/address/${encodeURIComponent(address)}` : undefined;
export const NATIVE_UNIT = "QRL";
