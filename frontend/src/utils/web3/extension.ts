/**
 * QRL Wallet extension discovery and connection via EIP-6963, matching the
 * pattern used by myqrlwallet-frontend.
 */

export interface ExtensionProvider {
  request: <T = unknown>(args: {
    method: string;
    params?: unknown[] | object;
  }) => Promise<T>;
  /** EIP-1193 event subscription - optional, not all providers support it. */
  on?: (event: string, listener: (payload: unknown) => void) => void;
}

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: ExtensionProvider;
}

interface EIP6963AnnounceProviderEvent extends CustomEvent {
  detail: EIP6963ProviderDetail;
}

// Injected QRL extensions: the upstream QRL Web3 Wallet and the MyQRLWallet
// Extension fork (com.qrlwallet.extension, minted 2026-07-09). Same API.
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
      const announceEvent = event as EIP6963AnnounceProviderEvent;
      if (QRL_WALLET_RDNS.has(announceEvent.detail.info.rdns)) {
        cachedDetail = announceEvent.detail;
        finish(cachedDetail);
      }
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Providers usually announce instantly; fall back to whatever we have.
    setTimeout(() => finish(cachedDetail), 1000);
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
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

export async function connectToExtension(): Promise<ConnectedWallet> {
  const detail = await findQrlProvider();
  if (!detail) throw new WalletNotFoundError();

  try {
    const accounts = await detail.provider.request<string[]>({
      method: "qrl_requestAccounts",
    });
    const address = accounts?.[0];
    if (!address) throw new ConnectionRejectedError();
    return { address, provider: detail.provider };
  } catch (error) {
    if (providerErrorCode(error) === 4001) throw new ConnectionRejectedError();
    throw error;
  }
}
