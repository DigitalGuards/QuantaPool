import { makeAutoObservable, runInAction } from "mobx";
import {
  QRLConnect,
  QRL_CONNECT_PROVIDER_INFO,
  attemptWalletRedirect,
  getAppStoreUrl,
} from "@qrlwallet/connect";
import type { ContractAbi } from "@theqrl/web3";
import { NativeQrlPoolABI } from "@/abi/NativeQrlPool";
import { ACTIVE_NETWORK, type NetworkConfig } from "@/config/networks";
import { getQrlWeb3, type Web3Instance } from "@/utils/web3/web3Lazy";
import {
  ConnectionRejectedError,
  type ExtensionProvider,
} from "@/utils/web3/extension";

import { parseUnits } from "@/utils/format";
import { nativeEventTopics, matchesNativeTopics } from "@/utils/nativeLogs";
import { prepareNativeWalletRequest } from "@/utils/nativeGas";
import {
  nativeRequestAmount,
  positionLoss,
  readChainId,
  MAX_NATIVE_REQUEST,
} from "@/utils/nativePosition";
import { requireQrlAccount } from "@/utils/qrlAddress";
import {
  activateExtensionAfterRelayRetirement,
  ChannelTaskGuard,
  ConnectionAttemptGuard,
  RelayResetGuard,
  shouldIgnoreRelayResetEvent,
} from "@/utils/relayReset";

/** EIP-6963 rdns for the two QRL-capable wallets we surface in the picker. */
const QRL_EXTENSION_RDNS = new Set(["theqrl.org", "com.qrlwallet.extension"]);
const QRL_CONNECT_RDNS = QRL_CONNECT_PROVIDER_INFO.rdns;

/** EIP-6963 provider announcement (info + injected provider). */
interface EIP6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: ExtensionProvider;
}

/** A wallet shown in the picker. `kind` drives the connect path. */
export interface DiscoveredWallet {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  kind: "extension" | "relay";
}

/** Which transport the active provider uses (drives the tx param shape). */
type ProviderKind = "extension" | "relay";

export interface PoolStats {
  riskAssets: bigint;
  freeCash: bigint;
  claimReserve: bigint;
  pendingTotal: bigint;
  feeReserve: bigint;
  minDeposit: bigint;
  feeBps: bigint;
  lastCheckpointBlock: bigint;
  recovering: boolean;
  poolStatus: bigint;
  poolRecoveryDeadlineSlot: bigint;
  stage: bigint;
  pendingHead: bigint;
  queueHead: bigint;
  totalShares: bigint;
  recoveryPaid: bigint;
  frozenShares: bigint;
}

export interface AccountState {
  address: string;
  qrlBalance: bigint;
  qrlValue: bigint;
  principalBasis: bigint;
  rewards: bigint;
  loss: bigint;
  claimable: bigint;
  pending: bigint;
  hasPosition: boolean;
  recoveryClaimable: bigint;
  recoveryClaimed: bigint;
}

export interface WithdrawalRequestView {
  id: bigint;
  amount: bigint;
  requestBlock: bigint;
  rewardsOnly: boolean;
}

export interface PendingDepositView {
  id: bigint;
  amount: bigint;
  requestBlock: bigint;
}

export type TxState = "idle" | "pending" | "confirmed" | "failed";

export type ActivityType =
  | "deposit"
  | "request"
  | "claim"
  | "cancel"
  | "admitted"
  | "recovery"
  | "completed";

export interface StakingActivity {
  type: ActivityType;
  /** QRL amount involved (absent for cancellations). */
  qrlAmount: bigint | null;
  blockNumber: bigint;
  txHash: string;
}

export interface TxStatus {
  state: TxState;
  label: string;
  txHash: string | null;
  error: string | null;
}

const IDLE_TX: TxStatus = {
  state: "idle",
  label: "",
  txHash: null,
  error: null,
};

/**
 * Typed views over `contract.methods`. The ABI JSON literals don't satisfy
 * @theqrl/web3's method-signature inference (same limitation myqrlwallet
 * works around), so we assert to these hand-written shapes instead.
 */
interface ContractCall<R> {
  call(): Promise<R>;
  encodeABI(): string;
}

interface NativePoolMethods {
  deposit(): ContractCall<unknown>;
  requestWithdrawal(amount: bigint): ContractCall<unknown>;
  requestRewards(amount: bigint): ContractCall<unknown>;
  claim(): ContractCall<unknown>;
  claimRecovery(): ContractCall<unknown>;
  beginRecovery(): ContractCall<unknown>;
  cancelPending(id: bigint): ContractCall<unknown>;
  cancelRequest(): ContractCall<unknown>;
  riskAssets(): ContractCall<unknown>;
  freeCash(): ContractCall<unknown>;
  claimReserve(): ContractCall<unknown>;
  pendingTotal(): ContractCall<unknown>;
  feeReserve(): ContractCall<unknown>;
  FEE_BPS(): ContractCall<unknown>;
  minDeposit(): ContractCall<unknown>;
  lastCheckpointBlock(): ContractCall<unknown>;
  recovering(): ContractCall<unknown>;
  poolStatus(): ContractCall<unknown>;
  poolRecoveryDeadlineSlot(): ContractCall<unknown>;
  stage(): ContractCall<unknown>;
  pendingHead(): ContractCall<unknown>;
  queueHead(): ContractCall<unknown>;
  totalShares(): ContractCall<unknown>;
  recoveryPaid(): ContractCall<unknown>;
  frozenShares(): ContractCall<unknown>;
  getPosition(address: string): ContractCall<Record<string, unknown>>;
  positionValue(address: string): ContractCall<unknown>;
  rewardValue(address: string): ContractCall<unknown>;
  claimable(address: string): ContractCall<unknown>;
  getPending(id: bigint): ContractCall<Record<string, unknown>>;
  getRequest(id: bigint): ContractCall<Record<string, unknown>>;
}

interface PastEventLog {
  blockNumber?: unknown;
  transactionHash?: string;
  returnValues?: Record<string, unknown>;
}

interface Contracts {
  pool: NativePoolMethods;
}

/** Native QRL kept aside for gas when computing the max stakeable balance. */
export const GAS_RESERVE = 5n * 10n ** 15n; // 0.005 QRL

const asBig = (value: unknown): bigint =>
  typeof value === "bigint" ? value : BigInt(String(value ?? 0));

function errorMessage(error: unknown): string {
  if (error instanceof ConnectionRejectedError)
    return "Request rejected in wallet";
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (code === 4001) return "Request rejected in wallet";
    if (typeof message === "string" && message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

export class PoolStore {
  network: NetworkConfig = ACTIVE_NETWORK;

  rpcError: string | null = null;

  pool: PoolStats | null = null;

  isConnecting = false;
  isDisconnecting = false;
  connectError: string | null = null;
  provider: ExtensionProvider | null = null;
  /** Wallets EIP-6963 discovered (QRL extension + MyQRLWallet relay). */
  discoveredWallets: DiscoveredWallet[] = [];
  /** Whether the wallet picker modal is open. */
  walletPickerOpen = false;
  /** Active qrlconnect:// URI awaiting a scan (relay pairing); null when none. */
  pairingUri: string | null = null;
  /** Relay pairing status string for the QR modal ("waiting", etc.). */
  pairingStatus = "";
  /** Display name of the connected wallet (e.g. "MyQRLWallet"). */
  activeWalletName: string | null = null;
  account: AccountState | null = null;
  withdrawals: WithdrawalRequestView[] = [];
  pendingDeposits: PendingDepositView[] = [];
  /** The account's native staking history, newest first. */
  activity: StakingActivity[] = [];
  activityError: string | null = null;

  /** Latest known chain block number, updated on each account refresh (0n when unknown). */
  currentBlock: bigint = 0n;

  tx: TxStatus = IDLE_TX;
  private transactionGeneration = 0;

  private web3Instance: Web3Instance | null = null;
  private contracts: Contracts | null = null;
  private initStarted = false;
  /** Relay SDK singleton; announces itself via EIP-6963 on construction. */
  private qrlConnect: QRLConnect | null = null;
  /** uuid -> EIP-6963 detail, so the picker can resolve a click to a provider. */
  private discoveredMap = new Map<string, EIP6963Detail>();
  private providerKind: ProviderKind | null = null;
  /** Distinguishes a user-initiated relay disconnect from a wallet-side drop. */
  private relayUserDisconnected = false;
  /**
   * True once a relay session actually reached "connected". A failed startup
   * auto-reconnect of a stale stored session also emits disconnect; without
   * this gate that would pop an unsolicited QR the user never asked for.
   */
  private relayEstablished = false;
  private relayAuthorization = new ChannelTaskGuard();
  private relayResetGuard = new RelayResetGuard();
  private connectionAttemptGuard = new ConnectionAttemptGuard();
  private walletsInitialized = false;
  /** Extension providers already wired for EIP-1193 events (avoid duplicates). */
  private wiredExtensionProviders = new WeakSet<ExtensionProvider>();
  constructor() {
    makeAutoObservable(this, {
      provider: false,
      web3Instance: false,
      contracts: false,
      initStarted: false,
      qrlConnect: false,
      discoveredMap: false,
      providerKind: false,
      relayUserDisconnected: false,
      relayEstablished: false,
      relayAuthorization: false,
      relayResetGuard: false,
      connectionAttemptGuard: false,
      walletsInitialized: false,
      wiredExtensionProviders: false,
      transactionGeneration: false,
      onEip6963Announce: false,
    } as Parameters<typeof makeAutoObservable>[1]);
  }

  get canTransact(): boolean {
    return (
      this.network.configured &&
      this.rpcError === null &&
      this.pool !== null &&
      !this.isConnecting &&
      !this.isDisconnecting &&
      this.tx.state !== "pending"
    );
  }
  get normalOpen(): boolean {
    return (
      this.canTransact &&
      this.pool?.poolStatus === 0n &&
      !this.pool.recovering &&
      this.pool.stage === 0n
    );
  }

  /** Max QRL the connected account can stake, keeping a little back for gas. */
  get stakeableBalance(): bigint | null {
    if (!this.account) return null;
    return this.account.qrlBalance > GAS_RESERVE
      ? this.account.qrlBalance - GAS_RESERVE
      : 0n;
  }

  async init(): Promise<void> {
    if (this.initStarted) return;
    this.initStarted = true;
    this.setupWallets();
    await this.refresh();
    // The store is a singleton living for the whole app session, so the
    // interval is intentionally never cleared.
    setInterval(() => {
      // Skip background refreshes while the tab is hidden - the first
      // interval tick after the user returns picks up fresh data.
      if (typeof document !== "undefined" && document.hidden) return;
      void this.refresh();
    }, 30_000);
  }

  async refresh(): Promise<void> {
    try {
      await this.refreshPool();
      if (this.account) await this.refreshAccount(this.account.address);
      runInAction(() => {
        this.rpcError = null;
      });
    } catch (error) {
      runInAction(() => {
        this.rpcError = errorMessage(error);
      });
    }
  }

  /** Connect button entry point: open the wallet picker. */
  connect(): void {
    this.openWalletPicker();
  }

  openWalletPicker(): void {
    // Re-announce so a wallet that loaded after our initial scan shows up.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    }
    runInAction(() => {
      this.connectError = null;
      this.walletPickerOpen = true;
    });
  }

  closeWalletPicker(): void {
    runInAction(() => {
      this.walletPickerOpen = false;
    });
  }

  /**
   * Construct the relay SDK (which announces itself over EIP-6963) and start
   * listening for wallet announcements. Idempotent; runs once from init().
   */
  private setupWallets(): void {
    if (this.walletsInitialized || typeof window === "undefined") return;
    this.walletsInitialized = true;

    const qrl = new QRLConnect({
      dappMetadata: {
        name: "QuantaPool",
        url: window.location.origin,
        // Peer redirect: after approving on mobile the wallet returns here.
        redirectUrl: window.location.href,
      },
      autoReconnect: true,
    });
    this.qrlConnect = qrl;
    this.wireRelayEvents(qrl);

    window.addEventListener("eip6963:announceProvider", this.onEip6963Announce);
    // Spec: dispatch AFTER listening so wallets that announced early re-announce.
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Resume a stored relay session if one is still within its TTL. The SDK's
    // constructor already kicked off reconnect(); reflect its live status and
    // let the connect/accountsChanged handlers promote it to a full session.
    if (qrl.hasStoredSession()) {
      this.providerKind = "relay";
      this.provider = qrl as unknown as ExtensionProvider;
      runInAction(() => {
        this.activeWalletName = QRL_CONNECT_PROVIDER_INFO.name;
        this.pairingStatus = String(qrl.getStatus());
      });
    }
  }

  private onEip6963Announce = (event: Event): void => {
    const detail = (event as CustomEvent<EIP6963Detail>).detail;
    const info = detail?.info;
    if (!info?.uuid) return;
    // Only surface QRL-capable wallets: the QRL extension and MyQRLWallet.
    // A MetaMask-style provider cannot sign QRL transactions.
    const isRelay = info.rdns === QRL_CONNECT_RDNS;
    if (!isRelay && !QRL_EXTENSION_RDNS.has(info.rdns)) return;
    if (this.discoveredMap.has(info.uuid)) return;
    this.discoveredMap.set(info.uuid, detail);
    runInAction(() => {
      this.discoveredWallets = Array.from(this.discoveredMap.values()).map(
        (d) => ({
          uuid: d.info.uuid,
          name: d.info.name,
          icon: d.info.icon,
          rdns: d.info.rdns,
          kind: d.info.rdns === QRL_CONNECT_RDNS ? "relay" : "extension",
        }),
      );
    });
  };

  /** Connect the wallet the user clicked in the picker. */
  async connectWallet(uuid: string): Promise<void> {
    const detail = this.discoveredMap.get(uuid);
    if (!detail || this.relayResetGuard.active) return;
    const kind = detail.info.rdns === QRL_CONNECT_RDNS ? "relay" : "extension";
    const attemptGeneration = this.connectionAttemptGuard.begin(kind);
    if (attemptGeneration === null) return;
    this.invalidateTransactions();
    runInAction(() => {
      this.walletPickerOpen = false;
      this.connectError = null;
    });
    try {
      if (kind === "relay") {
        await this.connectViaRelay(attemptGeneration);
      } else {
        await this.connectViaExtension(detail, attemptGeneration);
      }
    } finally {
      this.connectionAttemptGuard.finish(attemptGeneration);
    }
  }

  /** Relay pairing: generate a URI, show the QR (or deep-link on mobile). */
  private async connectViaRelay(attemptGeneration: number): Promise<void> {
    const qrl = this.qrlConnect;
    if (!qrl) return;
    const previousChannelId = qrl.getChannelId();
    const resetGeneration = this.relayResetGuard.begin();
    let uri: string;
    try {
      uri = await qrl.getConnectionURI();
      if (
        !this.connectionAttemptGuard.isCurrent(attemptGeneration) ||
        !this.relayResetGuard.isCurrent(resetGeneration)
      ) {
        return;
      }
      this.provider = qrl as unknown as ExtensionProvider;
      this.providerKind = "relay";
      this.relayEstablished = false;
      runInAction(() => {
        this.activeWalletName = QRL_CONNECT_PROVIDER_INFO.name;
        this.account = null;
        this.withdrawals = [];
        this.activity = [];
        this.activityError = null;
        this.pairingUri = null;
      });
      this.pendingDeposits = [];
      this.tx = IDLE_TX;
    } catch (error) {
      if (
        !this.connectionAttemptGuard.isCurrent(attemptGeneration) ||
        !this.relayResetGuard.isCurrent(resetGeneration)
      ) {
        return;
      }
      const channelChanged = qrl.getChannelId() !== previousChannelId;
      if (channelChanged) this.resetWalletState();
      runInAction(() => {
        this.connectError = errorMessage(error);
        if (!channelChanged && this.providerKind === "relay") {
          this.pairingStatus = errorMessage(error);
        }
      });
      return;
    } finally {
      this.relayResetGuard.finish(resetGeneration);
    }

    if (!this.connectionAttemptGuard.isCurrent(attemptGeneration)) return;
    runInAction(() => {
      this.pairingUri = uri;
      this.pairingStatus = String(qrl.getStatus());
    });
    if (qrl.isMobile()) {
      // Deep-link into the app; if nothing handles the protocol (app not
      // installed, or chooser dismissed) fall back to the pairing modal
      // instead of dead-ending on an unknown-protocol navigation.
      const opened = await attemptWalletRedirect(uri).catch(() => false);
      if (opened) return;
      runInAction(() => {
        this.connectError = `MyQRLWallet app not detected. Install it (${getAppStoreUrl()}) or use the copy-code option with the wallet at qrlwallet.com.`;
      });
    }
    // The 'connect'/'accountsChanged' relay events finish the handshake.
  }

  /** Extension: request accounts directly from the injected provider. */
  private async connectViaExtension(
    detail: EIP6963Detail,
    attemptGeneration: number,
  ): Promise<void> {
    runInAction(() => {
      this.isConnecting = true;
      this.connectError = null;
    });
    try {
      const activation = await activateExtensionAfterRelayRetirement(
        async () => {
          const qrl = this.qrlConnect;
          if (qrl) {
            this.isDisconnecting = true;
            this.relayUserDisconnected = true;
            try {
              await qrl.disconnect();
            } catch (error) {
              return error;
            } finally {
              this.relayUserDisconnected = false;
              this.isDisconnecting = false;
            }
          }

          // Relay retirement succeeded. Forget the old local transport before
          // asking an injected wallet to expose its account.
          this.resetWalletState();
          return null;
        },
        async () => {
          if (!this.connectionAttemptGuard.isCurrent(attemptGeneration)) {
            throw new Error("Wallet connection attempt changed");
          }
          return detail.provider.request<string[]>({
            method: "qrl_requestAccounts",
          });
        },
        (accounts) => {
          if (!this.connectionAttemptGuard.isCurrent(attemptGeneration)) {
            throw new Error("Wallet connection attempt changed");
          }
          const address = requireQrlAccount(accounts);
          this.wireExtensionEvents(detail);
          this.onWalletConnected(
            address,
            detail.provider,
            "extension",
            detail.info.name,
          );
        },
      );

      if (!this.connectionAttemptGuard.isCurrent(attemptGeneration)) return;
      if (!activation.ok) {
        const message = `Could not retire relay session: ${errorMessage(activation.retirementError)}`;
        runInAction(() => {
          this.connectError = message;
          if (this.pairingUri) this.pairingStatus = message;
        });
        return;
      }
    } catch (error) {
      if (!this.connectionAttemptGuard.isCurrent(attemptGeneration)) return;
      runInAction(() => {
        this.connectError = errorMessage(error);
      });
    } finally {
      runInAction(() => {
        this.isConnecting = false;
      });
    }
  }

  /** Relay-only: tear down the pairing and rotate to a fresh channel/keys. */
  async newConnection(): Promise<void> {
    const qrl = this.qrlConnect;
    if (!qrl) return;
    if (this.relayResetGuard.active || this.connectionAttemptGuard.isPending())
      return;
    this.invalidateTransactions();
    const previousChannelId = qrl.getChannelId();
    const resetGeneration = this.relayResetGuard.begin();
    runInAction(() => {
      this.connectError = null;
      this.pairingStatus = "Rotating connection...";
    });
    let uri: string;
    try {
      uri = await qrl.newConnection();
      if (!this.relayResetGuard.isCurrent(resetGeneration)) return;
      this.provider = qrl as unknown as ExtensionProvider;
      this.providerKind = "relay";
      this.relayEstablished = false;
      runInAction(() => {
        this.activeWalletName = QRL_CONNECT_PROVIDER_INFO.name;
        this.account = null;
        this.withdrawals = [];
        this.activity = [];
        this.activityError = null;
        this.pairingUri = null;
      });
      this.pendingDeposits = [];
      this.tx = IDLE_TX;
    } catch (error) {
      if (!this.relayResetGuard.isCurrent(resetGeneration)) return;
      const channelChanged = qrl.getChannelId() !== previousChannelId;
      if (channelChanged) this.resetWalletState();
      const message = errorMessage(error);
      runInAction(() => {
        this.connectError = message;
        if (!channelChanged) this.pairingStatus = message;
      });
      return;
    } finally {
      this.relayResetGuard.finish(resetGeneration);
    }

    runInAction(() => {
      this.pairingUri = uri;
      this.pairingStatus = String(qrl.getStatus());
    });
    if (qrl.isMobile()) {
      // Same fallback as connectViaRelay: an unhandled deep link (app not
      // installed) must not dead-end the rotation flow either.
      const opened = await attemptWalletRedirect(uri).catch(() => false);
      if (opened) return;
      runInAction(() => {
        this.connectError = `MyQRLWallet app not detected. Install it (${getAppStoreUrl()}) or use the copy-code option with the wallet at qrlwallet.com.`;
      });
    }
  }

  /** Retire the pending relay channel before reopening the wallet picker. */
  async cancelPairing(): Promise<void> {
    const qrl = this.qrlConnect;
    if (this.providerKind !== "relay" || !qrl) {
      runInAction(() => {
        this.pairingUri = null;
        this.pairingStatus = "";
        this.walletPickerOpen = true;
      });
      return;
    }
    if (
      this.isDisconnecting ||
      this.relayResetGuard.active ||
      this.connectionAttemptGuard.isPending()
    ) {
      return;
    }

    this.isDisconnecting = true;
    this.invalidateTransactions();
    this.relayUserDisconnected = true;
    runInAction(() => {
      this.pairingStatus = "Cancelling...";
      this.connectError = null;
    });
    try {
      await qrl.disconnect();
      this.relayUserDisconnected = false;
      this.resetWalletState();
      runInAction(() => {
        this.walletPickerOpen = true;
      });
    } catch (error) {
      this.relayUserDisconnected = false;
      const message = `Could not cancel pairing: ${errorMessage(error)}`;
      runInAction(() => {
        this.connectError = message;
        this.pairingStatus = message;
      });
    } finally {
      this.isDisconnecting = false;
    }
  }

  /** Unified post-connect: adopt the provider, seed the account, refresh. */
  private onWalletConnected(
    address: string,
    provider: ExtensionProvider,
    kind: ProviderKind,
    name: string,
  ): void {
    // A fresh authorization can reuse the same provider and address.
    this.invalidateTransactions();
    this.provider = provider;
    this.providerKind = kind;
    if (kind === "relay") this.relayEstablished = true;
    const isNewAddress = !this.account || this.account.address !== address;
    runInAction(() => {
      this.activeWalletName = name;
      this.walletPickerOpen = false;
      this.pairingUri = null;
      this.connectError = null;
      if (isNewAddress) {
        this.account = {
          address,
          qrlBalance: 0n,
          qrlValue: 0n,
          principalBasis: 0n,
          rewards: 0n,
          loss: 0n,
          claimable: 0n,
          pending: 0n,
          hasPosition: false,
          recoveryClaimable: 0n,
          recoveryClaimed: 0n,
        };
        this.withdrawals = [];
        this.activity = [];
      }
    });
    if (isNewAddress) this.pendingDeposits = [];
    void this.refresh();
  }

  async disconnect(): Promise<boolean> {
    if (
      this.isDisconnecting ||
      this.relayResetGuard.active ||
      this.connectionAttemptGuard.isPending()
    ) {
      return false;
    }
    this.invalidateTransactions();
    if (this.providerKind !== "relay" || !this.qrlConnect) {
      this.resetWalletState();
      return true;
    }

    this.isDisconnecting = true;
    this.relayUserDisconnected = true;
    runInAction(() => {
      this.connectError = null;
    });
    try {
      await this.qrlConnect.disconnect();
      this.relayUserDisconnected = false;
      this.resetWalletState();
      return true;
    } catch (error) {
      this.relayUserDisconnected = false;
      const message = `Could not disconnect wallet: ${errorMessage(error)}`;
      runInAction(() => {
        this.connectError = message;
        if (this.pairingUri) this.pairingStatus = message;
      });
      return false;
    } finally {
      this.isDisconnecting = false;
    }
  }

  /** Clear all wallet/account/tx state back to disconnected. */
  private resetWalletState(): void {
    this.invalidateTransactions();
    this.relayResetGuard.invalidate();
    this.provider = null;
    this.providerKind = null;
    this.relayUserDisconnected = false;
    this.relayEstablished = false;
    runInAction(() => {
      this.account = null;
      this.withdrawals = [];
      this.activity = [];
      this.activityError = null;
      this.connectError = null;
      this.pairingUri = null;
      this.pairingStatus = "";
      this.activeWalletName = null;
      this.walletPickerOpen = false;
    });
    this.pendingDeposits = [];
    this.tx = IDLE_TX;
  }

  dismissConnectError(): void {
    this.connectError = null;
  }

  clearTx(): void {
    if (this.tx.state !== "pending") this.invalidateTransactions();
  }

  private invalidateTransactions(): void {
    this.transactionGeneration += 1;
    this.tx = IDLE_TX;
  }

  async stake(amount: string): Promise<boolean> {
    return this.runTx("Deposit QRL", async () => {
      const value = parseUnits(amount);
      if (value <= 0n) throw new Error("Enter a positive QRL amount");
      const { pool } = await this.getContracts();
      return {
        to: this.network.contracts.nativePool,
        value,
        data: pool.deposit().encodeABI(),
        cashFlow: true,
      };
    });
  }
  async requestUnstake(amount: string, full = false): Promise<boolean> {
    return this.nativeCall("Request native withdrawal", (pool) =>
      pool.requestWithdrawal(nativeRequestAmount(amount, full)),
    );
  }
  async requestRewards(amount: string, full = false): Promise<boolean> {
    return this.nativeCall("Request native rewards", (pool) =>
      pool.requestRewards(nativeRequestAmount(amount, full)),
    );
  }
  async claim(): Promise<boolean> {
    return this.nativeCall("Claim QRL", (pool) => pool.claim(), true);
  }
  async claimRecovery(): Promise<boolean> {
    return this.nativeCall(
      "Claim recovered QRL",
      (pool) => pool.claimRecovery(),
      true,
    );
  }

  async beginRecovery(): Promise<boolean> {
    return this.nativeCall("Begin permanent cash recovery", (pool) =>
      pool.beginRecovery(),
    );
  }
  async cancelRequest(): Promise<boolean> {
    return this.nativeCall("Cancel request", (pool) => pool.cancelRequest());
  }
  async cancelPending(id: bigint): Promise<boolean> {
    return this.nativeCall(
      "Refund pending deposit",
      (pool) => pool.cancelPending(id),
      true,
    );
  }
  private async nativeCall(
    label: string,
    select: (pool: NativePoolMethods) => ContractCall<unknown>,
    cashFlow = false,
  ): Promise<boolean> {
    return this.runTx(label, async () => {
      const { pool } = await this.getContracts();
      return {
        to: this.network.contracts.nativePool,
        data: select(pool).encodeABI(),
        cashFlow,
      };
    });
  }

  /** Wire the relay SDK's EIP-1193 events into store state. */
  private wireRelayEvents(qrl: QRLConnect): void {
    qrl.on("connect", () => {
      if (
        this.providerKind !== "relay" ||
        this.relayUserDisconnected ||
        this.relayResetGuard.active ||
        this.connectionAttemptGuard.isPending("extension")
      ) {
        return;
      }
      void this.authorizeRelayAccount(qrl);
    });

    qrl.on("accountsChanged", (accounts: string[]) => {
      if (this.providerKind !== "relay" || this.relayUserDisconnected) return;
      if (this.connectionAttemptGuard.isPending("extension")) return;
      if (shouldIgnoreRelayResetEvent(this.relayResetGuard, "accounts")) return;
      if (Array.isArray(accounts) && accounts.length === 0) {
        void this.disconnect();
        return;
      }
      let next: string;
      try {
        next = requireQrlAccount(accounts);
      } catch (error) {
        void this.disconnect().then((retired) => {
          if (retired) {
            runInAction(() => {
              this.connectError = errorMessage(error);
            });
          }
        });
        return;
      }
      this.onWalletConnected(
        next,
        qrl as unknown as ExtensionProvider,
        "relay",
        QRL_CONNECT_PROVIDER_INFO.name,
      );
    });

    qrl.on("statusChanged", (status) => {
      if (this.providerKind !== "relay") return;
      if (this.connectionAttemptGuard.isPending("extension")) return;
      if (shouldIgnoreRelayResetEvent(this.relayResetGuard, "status")) return;
      runInAction(() => {
        this.pairingStatus = String(status);
      });
    });

    qrl.on("disconnect", () => {
      if (this.providerKind !== "relay") return;
      if (this.connectionAttemptGuard.isPending("extension")) return;
      if (shouldIgnoreRelayResetEvent(this.relayResetGuard, "disconnect"))
        return;
      if (this.relayUserDisconnected) {
        this.relayUserDisconnected = false;
        this.resetWalletState();
        return;
      }
      // The SDK also emits 'disconnect' when its reconnect probe gives up on
      // a wallet that is merely backgrounded (routine on mobile). The stored
      // session survives that and any request revives it: relay-buffered and,
      // on SDK >= 3.3.0, deep-linked awake. Rotating to a fresh QR here would
      // orphan the wallet side's session and could strand an approval already
      // in flight, so keep account/UI state and stay paired.
      if (qrl.hasStoredSession()) {
        return;
      }
      // A stale stored session whose startup auto-reconnect fails also emits
      // disconnect. Only re-pair when a live session actually dropped; otherwise
      // fall back to the Connect button rather than popping an unsolicited QR.
      if (!this.relayEstablished) {
        this.resetWalletState();
        return;
      }
      // Wallet-initiated terminate of a live session (stored session gone):
      // auto-regenerate a QR so the user can re-pair. Clear the flag so a
      // follow-up drop before the re-pair completes takes the reset path
      // instead of looping fresh QRs.
      this.relayEstablished = false;
      void this.regenerateRelayQr();
    });
  }

  /** Adopt an authorized cache on reconnect, or prompt on a fresh pairing. */
  private authorizeRelayAccount(qrl: QRLConnect): Promise<void> {
    const channelId = qrl.getChannelId();
    return this.relayAuthorization.run(channelId, () =>
      this.authorizeRelayAccountOnce(qrl, channelId),
    );
  }

  private async authorizeRelayAccountOnce(
    qrl: QRLConnect,
    channelId: string,
  ): Promise<void> {
    try {
      const cached = qrl.getAccounts();
      if (!Array.isArray(cached))
        throw new Error("Wallet returned an invalid QRL account cache");
      const accounts = cached.length
        ? cached
        : await qrl.request({ method: "qrl_requestAccounts" });
      const address = requireQrlAccount(accounts);
      if (
        this.providerKind !== "relay" ||
        qrl.getChannelId() !== channelId ||
        this.relayResetGuard.active ||
        this.connectionAttemptGuard.isPending("extension")
      ) {
        return;
      }
      this.onWalletConnected(
        address,
        qrl as unknown as ExtensionProvider,
        "relay",
        QRL_CONNECT_PROVIDER_INFO.name,
      );
    } catch (error) {
      if (
        this.providerKind !== "relay" ||
        qrl.getChannelId() !== channelId ||
        this.relayUserDisconnected ||
        this.isDisconnecting ||
        this.relayResetGuard.active
      ) {
        return;
      }
      this.isDisconnecting = true;
      this.invalidateTransactions();
      this.relayUserDisconnected = true;
      try {
        await qrl.disconnect();
        this.relayUserDisconnected = false;
        this.resetWalletState();
        runInAction(() => {
          this.connectError = `Could not authorize wallet account: ${errorMessage(error)}`;
        });
      } catch (disconnectError) {
        this.relayUserDisconnected = false;
        const message = `Could not authorize wallet account: ${errorMessage(error)}. Could not retire pairing: ${errorMessage(disconnectError)}`;
        runInAction(() => {
          this.connectError = message;
          if (this.pairingUri) this.pairingStatus = message;
        });
      } finally {
        this.isDisconnecting = false;
      }
    }
  }

  /** After a wallet-side drop, show a fresh QR to reconnect. */
  private async regenerateRelayQr(): Promise<void> {
    const qrl = this.qrlConnect;
    if (!qrl) {
      this.resetWalletState();
      return;
    }
    if (this.relayResetGuard.active || this.connectionAttemptGuard.isPending())
      return;
    this.invalidateTransactions();
    const resetGeneration = this.relayResetGuard.begin();
    runInAction(() => {
      this.account = null;
      this.withdrawals = [];
      this.activity = [];
    });
    this.pendingDeposits = [];
    let uri: string;
    try {
      uri = await qrl.getConnectionURI();
      if (!this.relayResetGuard.isCurrent(resetGeneration)) return;
    } catch (error) {
      if (!this.relayResetGuard.isCurrent(resetGeneration)) return;
      // The old channel is gone and a fresh one failed: fall back to fully
      // disconnected rather than leaving a dead QR on screen.
      this.resetWalletState();
      runInAction(() => {
        this.connectError = `Could not create replacement pairing: ${errorMessage(error)}`;
      });
      return;
    } finally {
      this.relayResetGuard.finish(resetGeneration);
    }

    runInAction(() => {
      this.pairingUri = uri;
      this.pairingStatus = String(qrl.getStatus());
    });
  }

  /**
   * Wire an extension provider's account events once. Extension provider
   * objects are long-lived singletons, so a WeakSet stops duplicate handlers
   * stacking across reconnects.
   */
  private wireExtensionEvents(detail: EIP6963Detail): void {
    const provider = detail.provider;
    if (typeof provider.on !== "function") return;
    if (this.wiredExtensionProviders.has(provider)) return;
    this.wiredExtensionProviders.add(provider);

    provider.on("accountsChanged", (accounts) => {
      if (this.provider !== provider) return;
      if (Array.isArray(accounts) && accounts.length === 0) {
        void this.disconnect();
        return;
      }
      let next: string;
      try {
        next = requireQrlAccount(accounts);
      } catch (error) {
        this.resetWalletState();
        runInAction(() => {
          this.connectError = errorMessage(error);
        });
        return;
      }
      this.onWalletConnected(next, provider, "extension", detail.info.name);
    });
  }

  private async getWeb3(): Promise<Web3Instance> {
    if (!this.network.configured)
      throw new Error("No native pool deployment is configured for this app.");
    if (!this.web3Instance) {
      const { default: Web3 } = await getQrlWeb3();
      this.web3Instance = new Web3(
        new Web3.providers.HttpProvider(this.network.rpcUrl),
      );
    }
    return this.web3Instance;
  }

  private async verifyReadNetwork(): Promise<void> {
    const web3 = await this.getWeb3();
    if (asBig(await web3.qrl.getChainId()) !== this.network.chainId)
      throw new Error(
        "The RPC chain does not match this native pool deployment.",
      );
  }

  private async getContracts(): Promise<Contracts> {
    if (!this.contracts) {
      await this.verifyReadNetwork();
      const web3 = await this.getWeb3();
      const code = await web3.qrl.getCode(this.network.contracts.nativePool);
      if (!code || code === "0x")
        throw new Error("The configured native pool has no contract code.");
      const instance = new web3.qrl.Contract(
        NativeQrlPoolABI as unknown as ContractAbi,
        this.network.contracts.nativePool,
      );
      this.contracts = {
        pool: instance.methods as unknown as NativePoolMethods,
      };
    }
    return this.contracts;
  }

  private async refreshPool(): Promise<void> {
    await this.verifyReadNetwork();
    const { pool } = await this.getContracts();
    const names = [
      "riskAssets",
      "freeCash",
      "claimReserve",
      "pendingTotal",
      "feeReserve",
      "minDeposit",
      "FEE_BPS",
      "lastCheckpointBlock",
      "recovering",
      "poolStatus",
      "poolRecoveryDeadlineSlot",
      "stage",
      "pendingHead",
      "queueHead",
      "totalShares",
      "recoveryPaid",
      "frozenShares",
    ] as const;
    const values = await Promise.all(names.map((name) => pool[name]().call()));
    const data = Object.fromEntries(
      names.map((name, index) => [name, values[index]]),
    );
    if (asBig(data.FEE_BPS) !== 1000n)
      throw new Error("The configured pool has an unexpected fee policy.");
    runInAction(() => {
      this.pool = {
        riskAssets: asBig(data.riskAssets),
        freeCash: asBig(data.freeCash),
        claimReserve: asBig(data.claimReserve),
        pendingTotal: asBig(data.pendingTotal),
        feeReserve: asBig(data.feeReserve),
        minDeposit: asBig(data.minDeposit),
        feeBps: asBig(data.FEE_BPS),
        lastCheckpointBlock: asBig(data.lastCheckpointBlock),
        recovering: Boolean(data.recovering),
        poolStatus: asBig(data.poolStatus),
        poolRecoveryDeadlineSlot: asBig(data.poolRecoveryDeadlineSlot),
        stage: asBig(data.stage),
        pendingHead: asBig(data.pendingHead),
        queueHead: asBig(data.queueHead),
        totalShares: asBig(data.totalShares),
        recoveryPaid: asBig(data.recoveryPaid),
        frozenShares: asBig(data.frozenShares),
      };
    });
  }

  private async queryNativeEvents(
    name: string,
    beneficiary: string,
  ): Promise<PastEventLog[]> {
    const event = NativeQrlPoolABI.find(
      (item) => item.type === "event" && item.name === name,
    );
    if (!event || event.type !== "event")
      throw new Error("Unknown native pool event");
    const web3 = await this.getWeb3();
    const signature = web3.qrl.abi.encodeEventSignature(
      `${event.name}(${event.inputs.map((input) => input.type).join(",")})`,
    );
    const topics = nativeEventTopics(signature, beneficiary);
    // The SDK's getPastEvents filter still assumes narrower log topics. The
    // unmodified native node uses VM64 topics; keep its native ABI decoder.
    const response = await fetch(this.network.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "qrl_getLogs",
        params: [
          {
            address: this.network.contracts.nativePool,
            fromBlock: `0x${this.network.deploymentBlock.toString(16)}`,
            toBlock: "latest",
            topics,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("Native event RPC is unavailable");
    const payload = (await response.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (payload.error)
      throw new Error(
        payload.error.message || "Native event RPC rejected the query",
      );
    if (!Array.isArray(payload.result))
      throw new Error("Invalid native event response");
    return payload.result.map((value: unknown) => {
      const log = value as {
        address?: string;
        topics?: unknown;
        data?: string;
        blockNumber?: unknown;
        transactionHash?: string;
      };
      if (
        typeof log.address !== "string" ||
        log.address.toLowerCase() !==
          this.network.contracts.nativePool.toLowerCase() ||
        !matchesNativeTopics(log.topics, topics) ||
        typeof log.data !== "string" ||
        !/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data)
      )
        throw new Error(
          "Native event response does not match the pool and beneficiary",
        );
      return {
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        returnValues: web3.qrl.abi.decodeLog(
          [...event.inputs],
          log.data,
          log.topics.slice(1),
        ),
      };
    });
  }

  private async fetchActivity(address: string): Promise<void> {
    try {
      const { pool } = await this.getContracts();
      const entries = [
        ["DepositQueued", "deposit"],
        ["DepositAdmitted", "admitted"],
        ["WithdrawalQueued", "request"],
        ["Claimed", "claim"],
        ["PendingCancelled", "cancel"],
        ["RequestCancelled", "cancel"],
        ["RecoveryClaimed", "recovery"],
        ["ZeroValueRequestCompleted", "completed"],
      ] as const;
      const groups = await Promise.all(
        entries.map(async ([event, type]) => ({
          event,
          type,
          logs: await this.queryNativeEvents(event, address),
        })),
      );
      const activity = groups
        .flatMap((group) =>
          group.logs.map((raw) => {
            const log = raw as PastEventLog,
              values = log.returnValues ?? {};
            const amount = "amount" in values ? asBig(values.amount) : null;
            return {
              type: group.type,
              qrlAmount: amount === MAX_NATIVE_REQUEST ? null : amount,
              blockNumber: asBig(log.blockNumber),
              txHash: log.transactionHash ?? "",
            };
          }),
        )
        .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1));
      const head = asBig(await pool.pendingHead().call());
      // Cancelled history must not occupy the bounded refund list forever.
      const cancelled = new Set(
        groups
          .filter((group) => group.event === "PendingCancelled")
          .flatMap((group) =>
            group.logs.map((log) => asBig(log.returnValues?.id)),
          ),
      );
      const ids = groups[0].logs
        .map((raw) => asBig((raw as PastEventLog).returnValues?.id))
        .filter((id) => id >= head && !cancelled.has(id))
        .slice(-64);
      const pending = await Promise.all(
        ids.map(async (id) => ({
          id,
          record: await pool.getPending(id).call(),
        })),
      );
      runInAction(() => {
        if (this.account?.address !== address) return;
        this.activity = activity;
        this.pendingDeposits = pending
          .filter(
            ({ record }) =>
              !record.cancelled &&
              String(record.beneficiary).toLowerCase() ===
                address.toLowerCase(),
          )
          .map(({ id, record }) => ({
            id,
            amount: asBig(record.amount),
            requestBlock: asBig(record.requestedBlock),
          }));
        this.activityError = null;
      });
    } catch (error) {
      runInAction(() => {
        if (this.account?.address === address) {
          this.activityError = errorMessage(error);
          this.pendingDeposits = [];
        }
      });
    }
  }

  private async refreshAccount(address: string): Promise<void> {
    const web3 = await this.getWeb3();
    const { pool } = await this.getContracts();
    const [qrlBalance, position, value, rewards, claimable, block] =
      await Promise.all([
        web3.qrl.getBalance(address),
        pool.getPosition(address).call(),
        pool.positionValue(address).call(),
        pool.rewardValue(address).call(),
        pool.claimable(address).call(),
        web3.qrl.getBlockNumber(),
      ]);
    const active = asBig(position.activeRequestPlusOne);
    const request =
      active > 0n ? await pool.getRequest(active - 1n).call() : null;
    runInAction(() => {
      if (this.account?.address !== address) return;
      const state = this.pool;
      const recovered =
        state?.recovering && state.frozenShares > 0n
          ? ((state.freeCash + state.recoveryPaid) * asBig(position.shares)) /
              state.frozenShares -
            asBig(position.recoveryClaimed)
          : 0n;
      this.account = {
        address,
        qrlBalance: asBig(qrlBalance),
        qrlValue: asBig(value),
        principalBasis: asBig(position.principalBasis),
        rewards: asBig(rewards),
        loss: positionLoss(asBig(value), asBig(position.principalBasis)),
        claimable: asBig(claimable),
        pending: asBig(position.pending),
        hasPosition: asBig(position.shares) > 0n,
        recoveryClaimable: recovered > 0n ? recovered : 0n,
        recoveryClaimed: asBig(position.recoveryClaimed),
      };
      this.currentBlock = asBig(block);
      this.withdrawals = request
        ? [
            {
              id: active - 1n,
              amount: asBig(request.amount),
              requestBlock: asBig(request.requestedBlock),
              rewardsOnly: Boolean(request.rewardsOnly),
            },
          ]
        : [];
    });
    void this.fetchActivity(address);
  }

  /** Build and send a transaction, owning the shared tx-status slot. */
  private async runTx(
    label: string,
    build: () => Promise<{
      to: string;
      value?: bigint;
      data: string;
      cashFlow?: boolean;
    }>,
  ): Promise<boolean> {
    if (
      this.tx.state === "pending" ||
      this.isDisconnecting ||
      this.relayResetGuard.active ||
      this.connectionAttemptGuard.isPending()
    )
      return false;

    const provider = this.provider;
    const from = this.account?.address;
    const transport = this.providerKind;
    if (!provider || !from || !transport) {
      this.tx = {
        state: "failed",
        label,
        txHash: null,
        error: "Connect a wallet first",
      };
      return false;
    }

    const generation = ++this.transactionGeneration;
    const isCurrent = () =>
      this.transactionGeneration === generation &&
      this.provider === provider &&
      this.account?.address === from &&
      this.providerKind === transport;
    let txHash: string | null = null;
    this.tx = { state: "pending", label, txHash, error: null };
    try {
      await this.verifyReadNetwork();
      if (!isCurrent()) return false;
      const initialChain = readChainId(
        await provider.request({ method: "qrl_chainId" }),
      );
      if (!isCurrent()) return false;
      if (initialChain !== this.network.chainId)
        throw new Error(
          "Switch your wallet to the chain configured for this native pool.",
        );
      const params = await build();
      if (!isCurrent()) return false;
      const value = params.value ?? 0n;

      const web3 = await this.getWeb3();
      if (!isCurrent()) return false;
      const txParams = await prepareNativeWalletRequest(
        {
          from,
          to: params.to,
          data: params.data,
          value,
          chainId: this.network.chainId!,
          transport,
          cashFlow: params.cashFlow ?? false,
        },
        {
          estimateGas: async (transaction) =>
            asBig(await web3.qrl.estimateGas(transaction)),
          blockGasLimit: async () =>
            asBig((await web3.qrl.getBlock("latest")).gasLimit),
        },
      );
      if (!isCurrent()) return false;
      const signingChain = readChainId(
        await provider.request({ method: "qrl_chainId" }),
      );
      if (!isCurrent()) return false;
      if (signingChain !== this.network.chainId)
        throw new Error(
          "Switch your wallet to the chain configured for this native pool.",
        );

      txHash = await provider.request<string>({
        method: "qrl_sendTransaction",
        params: [txParams],
      });
      if (!isCurrent()) return false;
      if (!txHash) throw new Error("Wallet returned no transaction hash");
      runInAction(() => {
        this.tx = { ...this.tx, txHash };
      });

      const receipt = await this.waitForReceipt(txHash, isCurrent);
      if (!isCurrent()) return false;
      if (!receipt) throw new Error("Timed out waiting for confirmation");
      const ok = asBig((receipt as { status?: unknown }).status) === 1n;
      runInAction(() => {
        this.tx = {
          state: ok ? "confirmed" : "failed",
          label,
          txHash,
          error: ok ? null : "Transaction reverted",
        };
      });
      void this.refresh();
      return ok;
    } catch (error) {
      if (!isCurrent()) return false;
      runInAction(() => {
        this.tx = {
          state: "failed",
          label,
          txHash,
          error: errorMessage(error),
        };
      });
      return false;
    }
  }

  private async waitForReceipt(
    txHash: string,
    isCurrent: () => boolean,
  ): Promise<unknown | null> {
    const web3 = await this.getWeb3();
    // QRL blocks are ~60 s; poll every 10 s for up to 10 minutes.
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!isCurrent()) return null;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      if (!isCurrent()) return null;
      try {
        const receipt = await web3.qrl.getTransactionReceipt(txHash);
        if (receipt) return receipt;
      } catch {
        // Not mined yet (some nodes throw instead of returning null).
      }
    }
    return null;
  }
}
