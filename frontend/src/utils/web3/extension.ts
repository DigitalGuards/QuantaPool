/**
 * QRL Wallet extension discovery and connection via EIP-6963, matching the
 * pattern used by myqrlwallet-frontend.
 */

import { requireQrlAccount } from "../qrlAddress.ts";
import { isRecord } from "../guards.ts";

export interface ExtensionProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  /** Optional EIP-1193 event subscription. */
  on?: (event: "accountsChanged", listener: (payload: unknown) => void) => void;
}

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: ExtensionProvider;
}

export function isExtensionProvider(
  value: unknown,
): value is ExtensionProvider {
  return (
    isRecord(value) &&
    typeof value.request === "function" &&
    (value.on === undefined || typeof value.on === "function")
  );
}

export function isProviderDetail(
  value: unknown,
): value is EIP6963ProviderDetail {
  if (!isRecord(value) || !isRecord(value.info)) return false;
  const info = value.info;
  return (
    typeof info.uuid === "string" &&
    info.uuid.length > 0 &&
    typeof info.name === "string" &&
    typeof info.icon === "string" &&
    typeof info.rdns === "string" &&
    isExtensionProvider(value.provider)
  );
}

// Injected QRL extensions: the upstream QRL Web3 Wallet and the MyQRLWallet
// Extension fork (com.qrlwallet.extension, released 2026-07-09). Same API.
const QRL_WALLET_RDNS = new Set(["theqrl.org", "com.qrlwallet.extension"]);

let cachedDetail: EIP6963ProviderDetail | null = null;

export function findQrlProvider(): Promise<EIP6963ProviderDetail | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (detail: EIP6963ProviderDetail | null) => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(detail);
    };

    const onAnnounce = (event: Event) => {
      // Any page script can dispatch this event; never assume the shape.
      if (!("detail" in event) || !isProviderDetail(event.detail)) return;
      if (QRL_WALLET_RDNS.has(event.detail.info.rdns)) {
        cachedDetail = event.detail;
        finish(cachedDetail);
      }
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Providers usually announce instantly; fall back to whatever we have.
    setTimeout(() => {
      finish(cachedDetail);
    }, 1000);
  });
}

export interface ConnectedWallet {
  address: string;
  provider: ExtensionProvider;
}

export class WalletNotFoundError extends Error {
  constructor() {
    super("QRL Wallet extension not detected");
    this.name = "WalletNotFoundError";
  }
}

export class ConnectionRejectedError extends Error {
  constructor() {
    super("Connection request rejected");
    this.name = "ConnectionRejectedError";
  }
}

function providerErrorCode(error: unknown): number | undefined {
  if (isRecord(error)) {
    const code = error.code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

export async function connectToExtension(): Promise<ConnectedWallet> {
  const detail = await findQrlProvider();
  if (!detail) throw new WalletNotFoundError();

  try {
    const accounts = await detail.provider.request({
      method: "qrl_requestAccounts",
    });
    const address = requireQrlAccount(accounts);
    return { address, provider: detail.provider };
  } catch (error) {
    if (providerErrorCode(error) === 4001) throw new ConnectionRejectedError();
    throw error;
  }
}
