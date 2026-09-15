import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";
import type { PoolStore, TxStatus } from "../stores/poolStore";
import type { ExtensionProvider } from "./web3/extension";

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
const module = { exports: {} as { PoolStore: new () => PoolStore } };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(
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
  waitForReceipt(hash: string): Promise<unknown>;
  refresh(): Promise<void>;
  qrlConnect: { disconnect(): Promise<void> } | null;
}

function fixture() {
  const store = new Store();
  const internal = store as unknown as Internals;
  const sendStarted = [deferred<void>(), deferred<void>()];
  const sends = [deferred<string>(), deferred<string>()];
  let sendCount = 0;
  const provider: ExtensionProvider = {
    request: async <T>({ method }: { method: string }): Promise<T> => {
      if (method === "qrl_chainId") return "0x539" as T;
      assert.equal(method, "qrl_sendTransaction");
      const index = sendCount++;
      assert(index < sends.length, "unexpected duplicate send");
      sendStarted[index].resolve();
      return (await sends[index].promise) as T;
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
  ) => internal.onWalletConnected(next, wallet, kind, "Test wallet");
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
    sendCount: () => sendCount,
  };
}

for (const outcome of ["hash", "error"] as const) {
  test(`old wallet ${outcome} cannot replace a newer same-account request`, async () => {
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
  test(`old receipt ${outcome} cannot complete or fail a newer transaction`, async () => {
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
  test(`${boundary} change retires a transaction still preparing gas`, async () => {
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

test("disconnect retires the transaction before relay retirement completes", async () => {
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

test("a current receipt failure retains only its own transaction hash", async () => {
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

test("dismiss cannot release the pending transaction guard", async () => {
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
