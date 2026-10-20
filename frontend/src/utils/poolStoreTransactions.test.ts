import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";
import { Web3 } from "@theqrl/web3";
import { nativePoolMethods } from "./web3/nativePool.ts";
import { nativeEventTopics } from "./nativeLogs.ts";
import { requireRecord } from "./guards.ts";
import type { PoolStore, TxStatus } from "../stores/poolStore";
import type {
  ExtensionProvider,
  EIP6963ProviderDetail,
} from "./web3/extension";

// Compile the real store with the same TS alias and an unconfigured build env.
// Only its wallet and RPC boundaries are replaced below; no network is opened.
const compiled = buildSync({
  entryPoints: [
    fileURLToPath(new URL("../stores/poolStore.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  alias: { "@": fileURLToPath(new URL("..", import.meta.url)) },
  define: { "import.meta.env": "{}" },
});
const output = compiled.outputFiles[0];
assert(output);
const module = { exports: {} as { PoolStore: new () => PoolStore } };
new Function("require", "module", "exports", output.text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const Store = module.exports.PoolStore;
const address = `Q${"11".repeat(64)}`;
const secondAddress = `Q${"22".repeat(64)}`;
const poolAddress = `Q${"33".repeat(64)}`;
const oldHash = `0x${"aa".repeat(32)}`;
const newHash = `0x${"bb".repeat(32)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

interface Internals {
  onWalletConnected(
    address: string,
    provider: ExtensionProvider,
    kind: "extension" | "relay",
    name: string,
  ): void;
  resetWalletState(): void;
  runTx(
    label: string,
    build: () => Promise<{ to: string; data: string }>,
  ): Promise<boolean>;
  verifyReadNetwork(): Promise<void>;
  getWeb3(): Promise<unknown>;
  getContracts(): Promise<unknown>;
  refreshPool(): Promise<void>;
  refreshAccount(address: string): Promise<void>;
  onEip6963Announce(event: Event): void;
  wireExtensionEvents(detail: EIP6963ProviderDetail): void;
  queryNativeEvents(name: string, beneficiary: string): Promise<unknown[]>;
  fetchActivity(address: string): Promise<void>;
  waitForReceipt(hash: string): Promise<unknown>;
  refresh(): Promise<void>;
  qrlConnect: { disconnect(): Promise<void> } | null;
}

function fixture() {
  const store = new Store();
  const internal = store as unknown as Internals;
  const sendStarted = [deferred<void>(), deferred<void>()] as const;
  const sends = [deferred<unknown>(), deferred<unknown>()] as const;
  let sendCount = 0;
  const requests: Parameters<ExtensionProvider["request"]>[0][] = [];
  const provider: ExtensionProvider = {
    request: async (request): Promise<unknown> => {
      requests.push(request);
      const { method } = request;
      if (method === "qrl_chainId") return "0x539";
      assert.equal(method, "qrl_sendTransaction");
      const index = sendCount++;
      assert(index < sends.length, "unexpected duplicate send");
      const started = sendStarted[index];
      const send = sends[index];
      assert(started && send);
      started.resolve();
      return send.promise;
    },
  };
  store.network = {
    ...store.network,
    configured: true,
    chainId: 1337n,
    contracts: { nativePool: poolAddress },
  };
  internal.verifyReadNetwork = async () => {};
  internal.getWeb3 = async () => ({
    qrl: {
      estimateGas: async () => 100_000n,
      getBlock: async () => ({ gasLimit: 30_000_000n }),
    },
  });
  internal.waitForReceipt = async () => ({ status: 1n });
  internal.refresh = async () => {};
  const connect = (
    next = address,
    kind: "extension" | "relay" = "extension",
    wallet = provider,
  ) => {
    internal.onWalletConnected(next, wallet, kind, "Test wallet");
  };
  connect();
  const send = (label: string) =>
    internal.runTx(label, async () => ({
      to: poolAddress,
      data: "0x12345678",
    }));
  const snapshot = (): TxStatus => ({ ...store.tx });
  return {
    store,
    internal,
    provider,
    connect,
    send,
    snapshot,
    sends,
    sendStarted,
    requests,
    sendCount: () => sendCount,
  };
}

void test("older pending refunds become visible after the latest 64 deposits are cancelled", async () => {
  const f = fixture();
  const cancelled = new Set<bigint>();
  const reads: bigint[] = [];
  const depositLogs = Array.from({ length: 65 }, (_, index) => ({
    blockNumber: BigInt(index + 1),
    transactionHash: oldHash,
    returnValues: { id: BigInt(index), amount: 100n },
  }));
  f.internal.queryNativeEvents = async (name) =>
    name === "DepositQueued"
      ? depositLogs
      : name === "PendingCancelled"
        ? depositLogs.filter((log) => cancelled.has(log.returnValues.id))
        : [];
  f.internal.getContracts = async () => ({
    pool: {
      pendingHead: () => ({ call: async () => 0n }),
      getPending: (id: bigint) => ({
        call: async () => {
          reads.push(id);
          return {
            beneficiary: address,
            amount: 100n,
            requestedBlock: id + 1n,
            cancelled: cancelled.has(id),
          };
        },
      }),
    },
  });

  await f.internal.fetchActivity(address);
  assert.equal(f.store.pendingDeposits.length, 64);
  assert.equal(reads.length, 64);
  assert.equal(f.store.pendingDeposits[0]?.id, 1n);
  for (let id = 1n; id <= 64n; id++) cancelled.add(id);
  reads.length = 0;

  await f.internal.fetchActivity(address);
  assert.equal(f.store.activityError, null);
  assert.deepEqual(
    f.store.pendingDeposits.map((item) => item.id),
    [0n],
  );
  assert.deepEqual(reads, [0n]);
});

for (const outcome of ["hash", "error"] as const) {
  void test(`old wallet ${outcome} cannot replace a newer same-account request`, async () => {
    const f = fixture();
    const old = f.send("Old deposit");
    await f.sendStarted[0].promise;
    assert.equal(await f.store.disconnect(), true);
    f.connect();
    const current = f.send("New withdrawal");
    await f.sendStarted[1].promise;
    const pending = f.snapshot();
    if (outcome === "hash") f.sends[0].resolve(oldHash);
    else f.sends[0].reject(new Error("Old wallet rejected"));
    assert.equal(await old, false);
    assert.deepEqual(f.snapshot(), pending);
    assert.equal(await f.send("Duplicate"), false);
    assert.equal(f.sendCount(), 2);
    f.sends[1].resolve(newHash);
    assert.equal(await current, true);
    assert.deepEqual(f.snapshot(), {
      state: "confirmed",
      label: "New withdrawal",
      txHash: newHash,
      error: null,
    });
  });
}

for (const outcome of ["success", "revert", "error"] as const) {
  void test(`old receipt ${outcome} cannot complete or fail a newer transaction`, async () => {
    const f = fixture();
    const receiptStarted = deferred<void>();
    const receipt = deferred<{ status: bigint }>();
    f.internal.waitForReceipt = async (hash) => {
      if (hash === oldHash) {
        receiptStarted.resolve();
        return receipt.promise;
      }
      return { status: 1n };
    };
    const old = f.send("Old deposit");
    await f.sendStarted[0].promise;
    f.sends[0].resolve(oldHash);
    await receiptStarted.promise;
    await f.store.disconnect();
    f.connect(secondAddress);
    const current = f.send("New claim");
    await f.sendStarted[1].promise;
    const pending = f.snapshot();
    if (outcome === "error") receipt.reject(new Error("Old receipt failed"));
    else receipt.resolve({ status: outcome === "success" ? 1n : 0n });
    assert.equal(await old, false);
    assert.deepEqual(f.snapshot(), pending);
    f.sends[1].resolve(newHash);
    assert.equal(await current, true);
  });
}

for (const boundary of [
  "reset",
  "same account",
  "new account",
  "provider",
  "transport",
] as const) {
  void test(`${boundary} change retires a transaction still preparing gas`, async () => {
    const f = fixture();
    const started = deferred<void>();
    const estimate = deferred<bigint>();
    f.internal.getWeb3 = async () => ({
      qrl: {
        estimateGas: async () => {
          started.resolve();
          return estimate.promise;
        },
        getBlock: async () => ({ gasLimit: 30_000_000n }),
      },
    });
    const old = f.send("Preparing deposit");
    await started.promise;
    if (boundary === "reset") f.internal.resetWalletState();
    else if (boundary === "new account") f.connect(secondAddress);
    else if (boundary === "provider")
      f.connect(address, "extension", { ...f.provider });
    else if (boundary === "transport") f.connect(address, "relay");
    else f.connect();
    const expected = f.snapshot();
    estimate.resolve(100_000n);
    assert.equal(await old, false);
    assert.equal(f.sendCount(), 0);
    assert.deepEqual(f.snapshot(), expected);
  });
}

void test("disconnect retires the transaction before relay retirement completes", async () => {
  const f = fixture();
  const retired = deferred<void>();
  f.connect(address, "relay");
  f.internal.qrlConnect = { disconnect: () => retired.promise };
  const old = f.send("Old deposit");
  await f.sendStarted[0].promise;
  const disconnect = f.store.disconnect();
  const expected = f.snapshot();
  assert.equal(f.store.isDisconnecting, true);
  assert.equal(await f.send("During disconnect"), false);
  f.sends[0].resolve(oldHash);
  assert.equal(await old, false);
  assert.deepEqual(f.snapshot(), expected);
  retired.resolve();
  assert.equal(await disconnect, true);
});

void test("a current receipt failure retains only its own transaction hash", async () => {
  const f = fixture();
  f.internal.waitForReceipt = async () => {
    throw new Error("Receipt unavailable");
  };
  const result = f.send("Current claim");
  await f.sendStarted[0].promise;
  f.sends[0].resolve(newHash);
  assert.equal(await result, false);
  assert.deepEqual(f.snapshot(), {
    state: "failed",
    label: "Current claim",
    txHash: newHash,
    error: "Receipt unavailable",
  });
});

void test("dismiss cannot release the pending transaction guard", async () => {
  const f = fixture();
  const result = f.send("Current deposit");
  await f.sendStarted[0].promise;
  const pending = f.snapshot();
  f.store.clearTx();
  assert.deepEqual(f.snapshot(), pending);
  assert.equal(await f.send("Duplicate"), false);
  f.sends[0].resolve(newHash);
  assert.equal(await result, true);
  f.store.clearTx();
  assert.equal(f.store.tx.state, "idle");
});

const offlineWeb3 = new Web3();
const offlinePool = nativePoolMethods(offlineWeb3, poolAddress);
const amountWord = "11".padStart(128, "0");
const fullWord = "f".repeat(64).padStart(128, "0");
const actions: {
  name: string;
  send: (store: PoolStore) => Promise<boolean>;
  data: string;
  cashFlow: boolean;
  value: bigint;
}[] = [
  {
    name: "deposit",
    send: (s) => s.stake("0.000000000000000017"),
    data: "0xd0e30db0",
    cashFlow: true,
    value: 17n,
  },
  {
    name: "withdrawal",
    send: (s) => s.requestUnstake("0.000000000000000017"),
    data: `0x9ee679e8${amountWord}`,
    cashFlow: false,
    value: 0n,
  },
  {
    name: "rewards",
    send: (s) => s.requestRewards("0.000000000000000017"),
    data: `0xee0b4bee${amountWord}`,
    cashFlow: false,
    value: 0n,
  },
  {
    name: "full withdrawal",
    send: (s) => s.requestUnstake("", true),
    data: `0x9ee679e8${fullWord}`,
    cashFlow: false,
    value: 0n,
  },
  {
    name: "full rewards",
    send: (s) => s.requestRewards("", true),
    data: `0xee0b4bee${fullWord}`,
    cashFlow: false,
    value: 0n,
  },
  {
    name: "claim",
    send: (s) => s.claim(),
    data: "0x4e71d92d",
    cashFlow: true,
    value: 0n,
  },
  {
    name: "recovery claim",
    send: (s) => s.claimRecovery(),
    data: "0xfaefde97",
    cashFlow: true,
    value: 0n,
  },
  {
    name: "begin recovery",
    send: (s) => s.beginRecovery(),
    data: "0xba744fe6",
    cashFlow: false,
    value: 0n,
  },
  {
    name: "pending refund",
    send: (s) => s.cancelPending(17n),
    data: `0x5588fdf1${amountWord}`,
    cashFlow: true,
    value: 0n,
  },
  {
    name: "cancel request",
    send: (s) => s.cancelRequest(),
    data: "0x851b16f5",
    cashFlow: false,
    value: 0n,
  },
];

for (const transport of ["extension", "relay"] as const) {
  for (const action of actions) {
    void test(`${transport} ${action.name} retains the exact native wallet payload`, async () => {
      const f = fixture();
      f.connect(address, transport);
      f.internal.getContracts = async () => ({ pool: offlinePool });
      f.sends[0].resolve(newHash);
      assert.equal(await action.send(f.store), true);
      const gas = action.cashFlow ? 300_000 : 130_000;
      const common = {
        from: address,
        to: poolAddress,
        data: action.data,
        chainId: "0x539",
      };
      const expected =
        transport === "extension"
          ? {
              ...common,
              value: action.value.toString(),
              gas,
              gasLimit: gas,
              type: "0x2",
            }
          : {
              ...common,
              gas: `0x${gas.toString(16)}`,
              ...(action.value > 0n
                ? { value: `0x${action.value.toString(16)}` }
                : {}),
            };
      assert.deepEqual(f.requests, [
        { method: "qrl_chainId" },
        { method: "qrl_chainId" },
        { method: "qrl_sendTransaction", params: [expected] },
      ]);
      assert.equal(
        JSON.stringify(f.requests[2]),
        JSON.stringify({ method: "qrl_sendTransaction", params: [expected] }),
      );
    });
  }
}

void test("malformed wallet hashes fail before receipt polling", async () => {
  for (const hash of [null, {}, [], 7, "", "0x", "unexpected"]) {
    const f = fixture();
    let receiptReads = 0;
    f.internal.waitForReceipt = async () => {
      receiptReads++;
      return { status: 1n };
    };
    f.sends[0].resolve(hash);
    assert.equal(await f.send("Malformed hash"), false);
    assert.equal(f.store.tx.state, "failed");
    assert.equal(f.store.tx.txHash, null);
    assert.match(f.store.tx.error ?? "", /invalid transaction hash/);
    assert.equal(receiptReads, 0);
  }
});

void test("malformed receipts never confirm a wallet transaction", async () => {
  for (const receipt of [
    {},
    [],
    { status: true },
    { status: "" },
    { status: 2n },
  ]) {
    const f = fixture();
    f.internal.waitForReceipt = async () => receipt;
    f.sends[0].resolve(newHash);
    assert.equal(await f.send("Malformed receipt"), false);
    assert.equal(f.store.tx.state, "failed");
    assert.equal(f.store.tx.txHash, newHash);
  }
});

void test("malformed gas and block responses prevent wallet sends", async () => {
  for (const input of [
    null,
    undefined,
    {},
    [],
    true,
    "",
    -1n,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    for (const boundary of ["estimate", "block", "limit"]) {
      const f = fixture();
      f.internal.getWeb3 = async () => ({
        qrl: {
          estimateGas: async () => (boundary === "estimate" ? input : 100_000n),
          getBlock: async () =>
            boundary === "block"
              ? input
              : { gasLimit: boundary === "limit" ? input : 30_000_000n },
        },
      });
      assert.equal(await f.send("Invalid RPC value"), false);
      assert.equal(f.store.tx.state, "failed");
      assert.equal(f.sendCount(), 0);
    }
  }
});

void test("malformed and changed wallet chains reject before signing", async () => {
  for (const chain of [null, {}, [], "", true, 1.5, 1338n]) {
    for (const changedAt of [1, 2]) {
      const f = fixture();
      let calls = 0;
      f.provider.request = async ({ method }) => {
        assert.equal(method, "qrl_chainId");
        return ++calls === changedAt ? chain : "0x539";
      };
      assert.equal(await f.send("Invalid wallet chain"), false);
      assert.equal(f.store.tx.state, "failed");
      assert.equal(calls, changedAt);
    }
  }
});

void test("discovery drops malformed announcements and retains valid provider identity", () => {
  const f = fixture();
  const info = {
    uuid: "extension",
    name: "QRL wallet",
    icon: "",
    rdns: "theqrl.org",
  };
  for (const detail of [
    null,
    {},
    { info },
    { info, provider: {} },
    { info: { ...info, name: 42 }, provider: f.provider },
  ]) {
    f.internal.onEip6963Announce(
      new CustomEvent("eip6963:announceProvider", { detail }),
    );
    assert.deepEqual(f.store.discoveredWallets, []);
  }
  const detail = { info, provider: f.provider };
  f.internal.onEip6963Announce(
    new CustomEvent("eip6963:announceProvider", { detail }),
  );
  f.internal.onEip6963Announce(
    new CustomEvent("eip6963:announceProvider", { detail }),
  );
  assert.equal(f.store.discoveredWallets.length, 1);
  assert.equal(f.store.discoveredWallets[0]?.uuid, info.uuid);
});

void test("extension account events authorize valid accounts and retire malformed ones", () => {
  const f = fixture();
  let onAccounts: ((value: unknown) => void) | undefined;
  const provider: ExtensionProvider = {
    ...f.provider,
    on: (_event, listener) => {
      onAccounts = listener;
    },
  };
  f.connect(address, "extension", provider);
  f.internal.wireExtensionEvents({
    provider,
    info: {
      uuid: "extension",
      name: "QRL wallet",
      icon: "",
      rdns: "theqrl.org",
    },
  });
  assert(onAccounts);
  onAccounts([secondAddress]);
  assert.equal(f.store.account?.address, secondAddress);
  onAccounts([{}]);
  assert.equal(f.store.account, null);
  assert.equal(f.store.provider, null);
  assert.match(f.store.connectError ?? "", /invalid QRL account/);
});

const poolReads = [
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
];

void test("pool response guards reject missing numbers and boolean coercions", async () => {
  const f = fixture();
  const values: Record<string, unknown> = { FEE_BPS: 1000n, recovering: false };
  f.internal.getContracts = async () => ({
    pool: Object.fromEntries(
      poolReads.map((name) => [
        name,
        () => ({ call: async () => (name in values ? values[name] : 0n) }),
      ]),
    ),
  });
  await f.internal.refreshPool();
  assert(f.store.pool);
  assert.equal(f.store.pool.recovering, false);
  assert.equal(f.store.pool.feeBps, 1000n);
  for (const value of [undefined, null, true, "", {}, -1n]) {
    values.riskAssets = value;
    await assert.rejects(f.internal.refreshPool(), {
      name: "InvalidInputError",
    });
  }
  values.riskAssets = 0n;
  values.recovering = "false";
  await assert.rejects(f.internal.refreshPool(), { name: "InvalidInputError" });
});

void test("position and request response guards reject malformed fields", async () => {
  const f = fixture();
  const position: Record<string, unknown> = {
    shares: 100n,
    principalBasis: 90n,
    pending: 0n,
    recoveryClaimed: 0n,
    activeRequestPlusOne: 1n,
  };
  let response: unknown = position;
  let rewardsOnly: unknown = false;
  f.internal.fetchActivity = async () => {};
  f.internal.getWeb3 = async () => ({
    qrl: { getBalance: async () => 1000n, getBlockNumber: async () => 17n },
  });
  f.internal.getContracts = async () => ({
    pool: {
      getPosition: () => ({ call: async () => response }),
      positionValue: () => ({ call: async () => 100n }),
      rewardValue: () => ({ call: async () => 10n }),
      claimable: () => ({ call: async () => 0n }),
      getRequest: () => ({
        call: async () => ({ amount: 50n, requestedBlock: 16n, rewardsOnly }),
      }),
    },
  });
  await f.internal.refreshAccount(address);
  assert.equal(f.store.account?.qrlValue, 100n);
  assert.equal(f.store.withdrawals[0]?.rewardsOnly, false);
  for (const value of [
    undefined,
    null,
    [],
    {},
    { ...position, shares: "" },
    { ...position, principalBasis: true },
  ]) {
    response = value;
    await assert.rejects(f.internal.refreshAccount(address), {
      name: "InvalidInputError",
    });
  }
  response = position;
  rewardsOnly = "false";
  await assert.rejects(f.internal.refreshAccount(address), {
    name: "InvalidInputError",
  });
});

const eventSignature =
  "0xff465791f48805b0254fc0e26cc605e27ef7706d8ee0cf018f8696f58db83679";
const nativeLog = {
  address: poolAddress,
  topics: [
    ...nativeEventTopics(eventSignature, address),
    `0x${"7".padStart(128, "0")}`,
  ],
  data: `0x${"11".padStart(128, "0")}`,
  blockNumber: "0x11",
  transactionHash: newHash,
};

void test("native event RPC preserves complete topics and exact decoded values", async (t) => {
  const f = fixture();
  f.internal.getWeb3 = async () => offlineWeb3;
  let body: unknown;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: unknown) => {
    body = requireRecord(init).body;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: [nativeLog] }),
    );
  });
  const logs = await f.internal.queryNativeEvents("DepositQueued", address);
  assert.equal(logs.length, 1);
  const log = requireRecord(logs[0]);
  assert.equal(log.blockNumber, 17n);
  assert.equal(log.transactionHash, newHash);
  assert.equal(requireRecord(log.returnValues).amount, 17n);
  assert.equal(requireRecord(log.returnValues).id, 7n);
  assert.equal(
    body,
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "qrl_getLogs",
      params: [
        {
          address: poolAddress,
          fromBlock: "0x0",
          toBlock: "latest",
          topics: nativeLog.topics.slice(0, 2),
        },
      ],
    }),
  );
});

void test("native event RPC drops malformed envelopes, logs and decoded records", async (t) => {
  const f = fixture();
  f.internal.getWeb3 = async () => offlineWeb3;
  let payload: unknown;
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(payload)),
  );
  for (const value of [
    null,
    [],
    {},
    { result: {} },
    { result: [null] },
    { error: { message: "query rejected" } },
    ...[
      { ...nativeLog, topics: null },
      { ...nativeLog, address },
      { ...nativeLog, data: "0x1" },
      { ...nativeLog, transactionHash: {} },
      { ...nativeLog, blockNumber: null },
    ].map((log) => ({ result: [log] })),
  ]) {
    payload = value;
    await assert.rejects(
      f.internal.queryNativeEvents("DepositQueued", address),
    );
  }
  payload = { result: [nativeLog] };
  f.internal.getWeb3 = async () => ({
    qrl: {
      abi: {
        encodeEventSignature: () => eventSignature,
        decodeLog: () => null,
      },
    },
  });
  await assert.rejects(f.internal.queryNativeEvents("DepositQueued", address), {
    name: "InvalidInputError",
  });
});
