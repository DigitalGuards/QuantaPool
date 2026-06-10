import { makeAutoObservable, runInAction } from "mobx";
import type { ContractAbi } from "@theqrl/web3";
import { DepositPoolV2ABI } from "@/abi/DepositPoolV2";
import { StQRLV2ABI } from "@/abi/StQRLV2";
import { ValidatorManagerABI } from "@/abi/ValidatorManager";
import { ACTIVE_NETWORK, type NetworkConfig } from "@/config/networks";
import { getQrlWeb3, type Web3Instance } from "@/utils/web3/web3Lazy";
import {
  connectToExtension,
  ConnectionRejectedError,
  WalletNotFoundError,
  type ExtensionProvider,
} from "@/utils/web3/extension";
import { formatUnits, parseUnits } from "@/utils/format";

export interface PoolStats {
  totalPooled: bigint;
  totalShares: bigint;
  buffered: bigint;
  validators: bigint;
  pendingWithdrawalShares: bigint;
  reserveBalance: bigint;
  /** QRL per stQRL share, 1e18-scaled (1e18 = 1:1). */
  exchangeRate: bigint;
  minDeposit: bigint;
  totalRewards: bigint;
  totalSlashing: bigint;
  netRewards: bigint;
  activeValidators: bigint;
  pendingValidators: bigint;
  paused: boolean;
}

export interface AccountState {
  address: string;
  qrlBalance: bigint;
  /** stQRL share balance (stable; balanceOf semantics). */
  shares: bigint;
  /** Shares locked by pending withdrawal requests. */
  lockedShares: bigint;
  /** Current QRL value of all shares. */
  qrlValue: bigint;
  /**
   * Number of withdrawal requests already processed (claimed or cancelled).
   * Equals the contract's nextWithdrawalIndex (total - pending); lets us show
   * a completed count without fetching the immutable historical requests.
   */
  completedWithdrawalsCount: number;
}

export interface WithdrawalRequestView {
  id: number;
  shares: bigint;
  /**
   * Exact QRL payout, snapshotted by the contract at request time.
   * claimWithdrawal() pays this amount — not the current share value.
   */
  qrlPayout: bigint;
  requestBlock: bigint;
  canClaim: boolean;
  blocksRemaining: bigint;
  claimed: boolean;
}

export type TxState = "idle" | "pending" | "confirmed" | "failed";

export type ActivityType = "deposit" | "request" | "claim" | "cancel";

export interface StakingActivity {
  type: ActivityType;
  /** QRL amount involved (absent for cancellations). */
  qrlAmount: bigint | null;
  shares: bigint | null;
  blockNumber: bigint;
  txHash: string;
}

export interface TxStatus {
  state: TxState;
  label: string;
  txHash: string | null;
  error: string | null;
}

const IDLE_TX: TxStatus = { state: "idle", label: "", txHash: null, error: null };

/**
 * Typed views over `contract.methods`. The ABI JSON literals don't satisfy
 * @theqrl/web3's method-signature inference (same limitation myqrlwallet
 * works around), so we assert to these hand-written shapes instead.
 */
interface ContractCall<R> {
  call(): Promise<R>;
  encodeABI(): string;
}

interface DepositPoolMethods {
  deposit(): ContractCall<unknown>;
  requestWithdrawal(shares: bigint): ContractCall<unknown>;
  claimWithdrawal(): ContractCall<unknown>;
  cancelWithdrawal(requestId: number): ContractCall<unknown>;
  getPoolStatus(): ContractCall<Record<string, unknown>>;
  getRewardStats(): ContractCall<Record<string, unknown>>;
  minDeposit(): ContractCall<unknown>;
  paused(): ContractCall<unknown>;
  getWithdrawalRequestCount(address: string): ContractCall<Record<string, unknown>>;
  getWithdrawalRequest(address: string, requestId: number): ContractCall<Record<string, unknown>>;
  /** Auto-generated public-mapping getter; returns the stored request struct. */
  withdrawalRequests(address: string, requestId: number): ContractCall<Record<string, unknown>>;
}

interface StQrlMethods {
  balanceOf(address: string): ContractCall<unknown>;
  lockedSharesOf(address: string): ContractCall<unknown>;
  getQRLValue(address: string): ContractCall<unknown>;
}

interface ValidatorManagerMethods {
  getStats(): ContractCall<Record<string, unknown>>;
}

/** Minimal typed view over the contract instance for event queries. */
interface PoolEventSource {
  getPastEvents(
    event: string,
    options: { filter?: Record<string, unknown>; fromBlock?: unknown; toBlock?: unknown },
  ): Promise<unknown[]>;
}

interface PastEventLog {
  blockNumber?: unknown;
  transactionHash?: string;
  returnValues?: Record<string, unknown>;
}

interface Contracts {
  pool: DepositPoolMethods;
  poolEvents: PoolEventSource;
  stqrl: StQrlMethods;
  validators: ValidatorManagerMethods;
}

const RATE_BASE = 10n ** 18n;

/** Native QRL kept aside for gas when computing the max stakeable balance. */
export const GAS_RESERVE = 5n * 10n ** 15n; // 0.005 QRL

const asBig = (value: unknown): bigint =>
  typeof value === "bigint" ? value : BigInt(String(value ?? 0));

function errorMessage(error: unknown): string {
  if (error instanceof ConnectionRejectedError) return "Request rejected in wallet";
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

  /** QRL/USD from the zondscan explorer API — cosmetic, may be unavailable. */
  qrlPrice: number | null = null;
  qrlPriceChange24h: number | null = null;

  isConnecting = false;
  connectError: string | null = null;
  provider: ExtensionProvider | null = null;
  account: AccountState | null = null;
  withdrawals: WithdrawalRequestView[] = [];
  /** The account's staking history, newest first (from DepositPool events). */
  activity: StakingActivity[] = [];
  activityError: string | null = null;

  tx: TxStatus = IDLE_TX;

  private web3Instance: Web3Instance | null = null;
  private contracts: Contracts | null = null;
  private initStarted = false;
  /**
   * Claimed/cancelled requests are immutable on-chain — cache them so the
   * periodic refresh only refetches requests that can still change.
   */
  private finalizedRequests = new Map<number, WithdrawalRequestView>();

  constructor() {
    makeAutoObservable(this, {
      provider: false,
      web3Instance: false,
      contracts: false,
      initStarted: false,
      finalizedRequests: false,
    } as Parameters<typeof makeAutoObservable>[1]);
  }

  get pendingWithdrawals(): WithdrawalRequestView[] {
    return this.withdrawals.filter((w) => !w.claimed);
  }

  get claimableWithdrawals(): WithdrawalRequestView[] {
    return this.withdrawals.filter((w) => !w.claimed && w.canClaim);
  }

  /** Max QRL the connected account can stake, keeping a little back for gas. */
  get stakeableBalance(): bigint | null {
    if (!this.account) return null;
    return this.account.qrlBalance > GAS_RESERVE
      ? this.account.qrlBalance - GAS_RESERVE
      : 0n;
  }

  /** Convert a QRL amount into stQRL shares at the current rate (approximate). */
  sharesForQrl(amount: bigint): bigint {
    if (!this.pool || this.pool.exchangeRate === 0n) return amount;
    return (amount * RATE_BASE) / this.pool.exchangeRate;
  }

  /** Convert stQRL shares into their current QRL value (approximate). */
  qrlForShares(shares: bigint): bigint {
    if (!this.pool) return shares;
    return (shares * this.pool.exchangeRate) / RATE_BASE;
  }

  async init(): Promise<void> {
    if (this.initStarted) return;
    this.initStarted = true;
    await this.refresh();
    // The store is a singleton living for the whole app session, so the
    // interval is intentionally never cleared.
    setInterval(() => {
      // Skip background refreshes while the tab is hidden — the first
      // interval tick after the user returns picks up fresh data.
      if (typeof document !== "undefined" && document.hidden) return;
      void this.refresh();
    }, 30_000);
  }

  /** USD value of a QRL base-unit amount, or null when no price is known. */
  usdValue(amount: bigint): number | null {
    if (this.qrlPrice === null) return null;
    return Number(formatUnits(amount)) * this.qrlPrice;
  }

  async refresh(): Promise<void> {
    void this.fetchQrlPrice();
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

  async connect(): Promise<void> {
    this.isConnecting = true;
    this.connectError = null;
    try {
      const { address, provider } = await connectToExtension();
      this.provider = provider;
      this.watchAccountChanges(provider);
      runInAction(() => {
        this.account = {
          address,
          qrlBalance: 0n,
          shares: 0n,
          lockedShares: 0n,
          qrlValue: 0n,
          completedWithdrawalsCount: 0,
        };
      });
      this.finalizedRequests.clear();
      await this.refreshAccount(address);
    } catch (error) {
      this.provider = null;
      runInAction(() => {
        this.account = null;
        this.connectError =
          error instanceof WalletNotFoundError
            ? "QRL Wallet extension not detected. Install it or open QuantaPool from the MyQRLWallet app."
            : errorMessage(error);
      });
    } finally {
      runInAction(() => {
        this.isConnecting = false;
      });
    }
  }

  disconnect(): void {
    this.provider = null;
    this.account = null;
    this.withdrawals = [];
    this.activity = [];
    this.activityError = null;
    this.connectError = null;
    this.finalizedRequests.clear();
    this.tx = IDLE_TX;
  }

  dismissConnectError(): void {
    this.connectError = null;
  }

  clearTx(): void {
    this.tx = IDLE_TX;
  }

  /** Stake QRL: DepositPool.deposit() with msg.value. */
  async stake(amount: string): Promise<boolean> {
    return this.runTx("Stake", async () => {
      const value = parseUnits(amount);
      const { pool } = await this.getContracts();
      return { to: this.network.contracts.depositPool, value, data: pool.deposit().encodeABI() };
    });
  }

  /** Request withdrawal of stQRL shares (starts the 128-block delay). */
  async requestUnstake(shares: string): Promise<boolean> {
    return this.runTx("Request withdrawal", async () => {
      const amount = parseUnits(shares);
      const { pool } = await this.getContracts();
      return {
        to: this.network.contracts.depositPool,
        data: pool.requestWithdrawal(amount).encodeABI(),
      };
    });
  }

  /** Claim the oldest ready withdrawal request (FIFO). */
  async claim(): Promise<boolean> {
    return this.runTx("Claim withdrawal", async () => {
      const { pool } = await this.getContracts();
      return { to: this.network.contracts.depositPool, data: pool.claimWithdrawal().encodeABI() };
    });
  }

  /** Cancel a pending withdrawal request and unlock its shares. */
  async cancel(requestId: number): Promise<boolean> {
    return this.runTx("Cancel withdrawal", async () => {
      const { pool } = await this.getContracts();
      return {
        to: this.network.contracts.depositPool,
        data: pool.cancelWithdrawal(requestId).encodeABI(),
      };
    });
  }

  /**
   * Handle account switches made inside the wallet extension. The provider
   * may not support events — the listener is best-effort.
   */
  private watchAccountChanges(provider: ExtensionProvider): void {
    provider.on?.("accountsChanged", (accounts) => {
      const next = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
      if (!next) {
        this.disconnect();
        return;
      }
      if (this.account && next !== this.account.address) {
        runInAction(() => {
          this.account = {
            address: next,
            qrlBalance: 0n,
            shares: 0n,
            lockedShares: 0n,
            qrlValue: 0n,
            completedWithdrawalsCount: 0,
          };
          this.withdrawals = [];
          this.activity = [];
        });
        this.finalizedRequests.clear();
        void this.refreshAccount(next);
      }
    });
  }

  /** Same endpoint myqrlwallet-frontend uses for its USD figures. */
  private async fetchQrlPrice(): Promise<void> {
    try {
      const res = await fetch(`${this.network.explorer}/api/overview`);
      const data = (await res.json()) as {
        currentPrice?: unknown;
        priceChange24h?: unknown;
      };
      if (typeof data.currentPrice === "number" && data.currentPrice > 0) {
        runInAction(() => {
          this.qrlPrice = data.currentPrice as number;
          this.qrlPriceChange24h =
            typeof data.priceChange24h === "number" ? data.priceChange24h : null;
        });
      }
    } catch {
      // Price is cosmetic — keep the last known value on failure.
    }
  }

  private async getWeb3(): Promise<Web3Instance> {
    if (!this.web3Instance) {
      const { default: Web3 } = await getQrlWeb3();
      this.web3Instance = new Web3(
        new Web3.providers.HttpProvider(this.network.rpcUrl),
      );
    }
    return this.web3Instance;
  }

  private async getContracts(): Promise<Contracts> {
    if (!this.contracts) {
      const web3 = await this.getWeb3();
      const { contracts } = this.network;
      const poolContract = new web3.qrl.Contract(
        DepositPoolV2ABI as unknown as ContractAbi,
        contracts.depositPool,
      );
      this.contracts = {
        pool: poolContract.methods as unknown as DepositPoolMethods,
        poolEvents: poolContract as unknown as PoolEventSource,
        stqrl: new web3.qrl.Contract(
          StQRLV2ABI as unknown as ContractAbi,
          contracts.stQRL,
        ).methods as unknown as StQrlMethods,
        validators: new web3.qrl.Contract(
          ValidatorManagerABI as unknown as ContractAbi,
          contracts.validatorManager,
        ).methods as unknown as ValidatorManagerMethods,
      };
    }
    return this.contracts;
  }

  private async refreshPool(): Promise<void> {
    const { pool, validators } = await this.getContracts();
    const [status, rewards, minDeposit, paused, validatorStats] = await Promise.all([
      pool.getPoolStatus().call(),
      pool.getRewardStats().call(),
      pool.minDeposit().call(),
      pool.paused().call(),
      validators.getStats().call(),
    ]);

    runInAction(() => {
      this.pool = {
        totalPooled: asBig(status.totalPooled),
        totalShares: asBig(status.totalShares),
        buffered: asBig(status.buffered),
        validators: asBig(status.validators),
        pendingWithdrawalShares: asBig(status.pendingWithdrawalShares),
        reserveBalance: asBig(status.reserveBalance),
        exchangeRate: asBig(status.exchangeRate),
        minDeposit: asBig(minDeposit),
        totalRewards: asBig(rewards.totalRewards),
        totalSlashing: asBig(rewards.totalSlashing),
        netRewards: asBig(rewards.netRewards),
        activeValidators: asBig(validatorStats.active),
        pendingValidators: asBig(validatorStats.pending),
        paused: Boolean(paused),
      };
    });
  }

  private async fetchWithdrawalRequest(
    pool: DepositPoolMethods,
    address: string,
    id: number,
  ): Promise<WithdrawalRequestView> {
    const cached = this.finalizedRequests.get(id);
    if (cached) return cached;

    const [live, stored] = await Promise.all([
      pool.getWithdrawalRequest(address, id).call(),
      pool.withdrawalRequests(address, id).call(),
    ]);
    const view: WithdrawalRequestView = {
      id,
      shares: asBig(live.shares),
      qrlPayout: asBig(stored.qrlAmount),
      requestBlock: asBig(live.requestBlock),
      canClaim: Boolean(live.canClaim),
      blocksRemaining: asBig(live.blocksRemaining),
      claimed: Boolean(live.claimed),
    };
    // Claimed requests (and cancelled ones, zeroed with shares=0) never change.
    if (view.claimed || view.shares === 0n) this.finalizedRequests.set(id, view);
    return view;
  }

  /**
   * Build the account's staking history from DepositPool events (all four
   * user-facing events index the user address). Each entry links to zondscan.
   */
  private async fetchActivity(address: string): Promise<void> {
    try {
      const { poolEvents } = await this.getContracts();
      const query = (event: string) =>
        poolEvents.getPastEvents(event, {
          filter: { user: address },
          fromBlock: 0,
          toBlock: "latest",
        });
      const [deposits, requests, claims, cancels] = await Promise.all([
        query("Deposited"),
        query("WithdrawalRequested"),
        query("WithdrawalClaimed"),
        query("WithdrawalCancelled"),
      ]);

      const toActivity = (type: ActivityType) => (raw: unknown): StakingActivity => {
        const log = raw as PastEventLog;
        const values = log.returnValues ?? {};
        return {
          type,
          qrlAmount: "qrlAmount" in values ? asBig(values.qrlAmount) : null,
          shares:
            "shares" in values
              ? asBig(values.shares)
              : "sharesReceived" in values
                ? asBig(values.sharesReceived)
                : null,
          blockNumber: asBig(log.blockNumber),
          txHash: log.transactionHash ?? "",
        };
      };

      const merged = [
        ...deposits.map(toActivity("deposit")),
        ...requests.map(toActivity("request")),
        ...claims.map(toActivity("claim")),
        ...cancels.map(toActivity("cancel")),
      ].sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1));

      runInAction(() => {
        if (!this.account || this.account.address !== address) return;
        this.activity = merged;
        this.activityError = null;
      });
    } catch (error) {
      // Some RPC proxies don't expose log queries — degrade gracefully.
      runInAction(() => {
        this.activityError = errorMessage(error);
      });
    }
  }

  private async refreshAccount(address: string): Promise<void> {
    const web3 = await this.getWeb3();
    const { pool, stqrl } = await this.getContracts();
    void this.fetchActivity(address);

    const [qrlBalance, shares, lockedShares, qrlValue, counts] = await Promise.all([
      web3.qrl.getBalance(address),
      stqrl.balanceOf(address).call(),
      stqrl.lockedSharesOf(address).call(),
      stqrl.getQRLValue(address).call(),
      pool.getWithdrawalRequestCount(address).call(),
    ]);

    const total = Number(asBig(counts.total));
    const pending = Number(asBig(counts.pending));
    // Requests at indices [0, nextIndex) are already processed (claimed or
    // cancelled-and-skipped) and immutable, so only fetch the live tail
    // [nextIndex, total). This keeps the fan-out bounded by pending requests
    // rather than a user's entire withdrawal history.
    const nextIndex = total - pending;
    const requests = await Promise.all(
      Array.from({ length: pending }, (_, i) =>
        this.fetchWithdrawalRequest(pool, address, nextIndex + i),
      ),
    );

    runInAction(() => {
      // The user may have disconnected or switched accounts while we were
      // fetching — don't resurrect stale state.
      if (!this.account || this.account.address !== address) return;
      this.account = {
        address,
        qrlBalance: asBig(qrlBalance),
        shares: asBig(shares),
        lockedShares: asBig(lockedShares),
        qrlValue: asBig(qrlValue),
        completedWithdrawalsCount: nextIndex,
      };
      // Cancelled requests are zeroed on-chain — hide them.
      this.withdrawals = requests.filter((w) => w.shares > 0n);
    });
  }

  /** Build and send a transaction, owning the shared tx-status slot. */
  private async runTx(
    label: string,
    build: () => Promise<{ to: string; value?: bigint; data: string }>,
  ): Promise<boolean> {
    if (this.tx.state === "pending") return false; // one transaction at a time

    const provider = this.provider;
    const from = this.account?.address;
    if (!provider || !from) {
      this.tx = { state: "failed", label, txHash: null, error: "Connect a wallet first" };
      return false;
    }

    this.tx = { state: "pending", label, txHash: null, error: null };
    try {
      const params = await build();
      const web3 = await this.getWeb3();
      const value = params.value ?? 0n;

      let gasLimit = 1_500_000;
      try {
        const estimated = await web3.qrl.estimateGas({
          from,
          to: params.to,
          value,
          data: params.data,
        });
        gasLimit = Number((asBig(estimated) * 130n) / 100n);
      } catch {
        // Estimation can fail on some RPC proxies — fall back to a safe limit.
      }
      const gasPrice = asBig(await web3.qrl.getGasPrice());

      const txHash = await provider.request<string>({
        method: "qrl_sendTransaction",
        params: [
          {
            from,
            to: params.to,
            value: value.toString(),
            data: params.data,
            gasLimit,
            gasPrice: gasPrice.toString(),
          },
        ],
      });
      if (!txHash) throw new Error("Wallet returned no transaction hash");
      runInAction(() => {
        this.tx = { ...this.tx, txHash };
      });

      const receipt = await this.waitForReceipt(txHash);
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
      runInAction(() => {
        this.tx = {
          state: "failed",
          label,
          txHash: this.tx.txHash,
          error: errorMessage(error),
        };
      });
      return false;
    }
  }

  private async waitForReceipt(txHash: string): Promise<unknown | null> {
    const web3 = await this.getWeb3();
    // QRL blocks are ~60 s; poll every 10 s for up to 10 minutes.
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
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
