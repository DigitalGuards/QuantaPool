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
import { parseUnits } from "@/utils/format";

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
}

export interface WithdrawalRequestView {
  id: number;
  shares: bigint;
  /** Current QRL value of the locked shares. */
  qrlValue: bigint;
  requestBlock: bigint;
  canClaim: boolean;
  blocksRemaining: bigint;
  claimed: boolean;
}

export type TxState = "idle" | "pending" | "confirmed" | "failed";

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
}

interface StQrlMethods {
  balanceOf(address: string): ContractCall<unknown>;
  lockedSharesOf(address: string): ContractCall<unknown>;
  getQRLValue(address: string): ContractCall<unknown>;
}

interface ValidatorManagerMethods {
  getStats(): ContractCall<Record<string, unknown>>;
}

const RATE_BASE = 10n ** 18n;

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

  isInitializing = true;
  rpcError: string | null = null;

  pool: PoolStats | null = null;

  isConnecting = false;
  connectError: string | null = null;
  provider: ExtensionProvider | null = null;
  account: AccountState | null = null;
  withdrawals: WithdrawalRequestView[] = [];

  tx: TxStatus = IDLE_TX;

  private web3Instance: Web3Instance | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    makeAutoObservable(this, {
      provider: false,
      web3Instance: false,
      refreshTimer: false,
    } as Parameters<typeof makeAutoObservable>[1]);
  }

  get isConnected(): boolean {
    return this.account !== null;
  }

  get pendingWithdrawals(): WithdrawalRequestView[] {
    return this.withdrawals.filter((w) => !w.claimed);
  }

  get claimableWithdrawals(): WithdrawalRequestView[] {
    return this.withdrawals.filter((w) => !w.claimed && w.canClaim);
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
    try {
      await this.refreshPool();
      runInAction(() => {
        this.rpcError = null;
      });
    } catch (error) {
      runInAction(() => {
        this.rpcError = errorMessage(error);
      });
    } finally {
      runInAction(() => {
        this.isInitializing = false;
      });
    }
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        void this.refresh();
      }, 30_000);
    }
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

  async connect(): Promise<void> {
    this.isConnecting = true;
    this.connectError = null;
    try {
      const { address, provider } = await connectToExtension();
      this.provider = provider;
      runInAction(() => {
        this.account = {
          address,
          qrlBalance: 0n,
          shares: 0n,
          lockedShares: 0n,
          qrlValue: 0n,
        };
      });
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
    this.connectError = null;
    this.tx = IDLE_TX;
  }

  clearTx(): void {
    this.tx = IDLE_TX;
  }

  /** Stake QRL: DepositPool.deposit() with msg.value. */
  async stake(amount: string): Promise<boolean> {
    const value = parseUnits(amount);
    const { pool } = await this.getContracts();
    const data = pool.deposit().encodeABI();
    return this.sendTx("Stake", {
      to: this.network.contracts.depositPool,
      value,
      data,
    });
  }

  /** Request withdrawal of stQRL shares (starts the 128-block delay). */
  async requestUnstake(shares: string): Promise<boolean> {
    const amount = parseUnits(shares);
    const { pool } = await this.getContracts();
    const data = pool.requestWithdrawal(amount).encodeABI();
    return this.sendTx("Request withdrawal", {
      to: this.network.contracts.depositPool,
      data,
    });
  }

  /** Claim the oldest ready withdrawal request (FIFO). */
  async claim(): Promise<boolean> {
    const { pool } = await this.getContracts();
    const data = pool.claimWithdrawal().encodeABI();
    return this.sendTx("Claim withdrawal", {
      to: this.network.contracts.depositPool,
      data,
    });
  }

  /** Cancel a pending withdrawal request and unlock its shares. */
  async cancel(requestId: number): Promise<boolean> {
    const { pool } = await this.getContracts();
    const data = pool.cancelWithdrawal(requestId).encodeABI();
    return this.sendTx("Cancel withdrawal", {
      to: this.network.contracts.depositPool,
      data,
    });
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

  private async getContracts() {
    const web3 = await this.getWeb3();
    const { contracts } = this.network;
    return {
      pool: new web3.qrl.Contract(
        DepositPoolV2ABI as unknown as ContractAbi,
        contracts.depositPool,
      ).methods as unknown as DepositPoolMethods,
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

  private async refreshPool(): Promise<void> {
    const { pool, validators } = await this.getContracts();
    const [status, rewards, minDeposit, paused, validatorStats] = await Promise.all([
      pool.getPoolStatus().call() as Promise<Record<string, unknown>>,
      pool.getRewardStats().call() as Promise<Record<string, unknown>>,
      pool.minDeposit().call(),
      pool.paused().call(),
      validators.getStats().call() as Promise<Record<string, unknown>>,
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

  private async refreshAccount(address: string): Promise<void> {
    const web3 = await this.getWeb3();
    const { pool, stqrl } = await this.getContracts();

    const [qrlBalance, shares, lockedShares, qrlValue, counts] = await Promise.all([
      web3.qrl.getBalance(address),
      stqrl.balanceOf(address).call(),
      stqrl.lockedSharesOf(address).call(),
      stqrl.getQRLValue(address).call(),
      pool.getWithdrawalRequestCount(address).call() as Promise<
        Record<string, unknown>
      >,
    ]);

    const total = Number(asBig(counts.total));
    const requests = await Promise.all(
      Array.from({ length: total }, (_, id) =>
        (pool.getWithdrawalRequest(address, id).call() as Promise<
          Record<string, unknown>
        >).then((r) => ({ id, r })),
      ),
    );

    runInAction(() => {
      this.account = {
        address,
        qrlBalance: asBig(qrlBalance),
        shares: asBig(shares),
        lockedShares: asBig(lockedShares),
        qrlValue: asBig(qrlValue),
      };
      this.withdrawals = requests
        .map(({ id, r }) => ({
          id,
          shares: asBig(r.shares),
          qrlValue: asBig(r.currentQRLValue),
          requestBlock: asBig(r.requestBlock),
          canClaim: Boolean(r.canClaim),
          blocksRemaining: asBig(r.blocksRemaining),
          claimed: Boolean(r.claimed),
        }))
        // Cancelled requests are zeroed out on-chain — hide them.
        .filter((w) => w.shares > 0n);
    });
  }

  private async sendTx(
    label: string,
    params: { to: string; value?: bigint; data: string },
  ): Promise<boolean> {
    const provider = this.provider;
    const from = this.account?.address;
    if (!provider || !from) {
      this.tx = { state: "failed", label, txHash: null, error: "Connect a wallet first" };
      return false;
    }

    this.tx = { state: "pending", label, txHash: null, error: null };
    try {
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
    // QRL blocks are ~60 s; poll every 5 s for up to 10 minutes.
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
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
