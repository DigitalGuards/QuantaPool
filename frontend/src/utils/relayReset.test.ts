import assert from "node:assert/strict";
import test from "node:test";
import {
  activateExtensionAfterRelayRetirement,
  ChannelTaskGuard,
  ConnectionAttemptGuard,
  RelayResetGuard,
  shouldIgnoreRelayResetEvent,
} from "./relayReset.ts";

test("SDK reset teardown events are ignored only while a rotation is active", () => {
  const guard = new RelayResetGuard();
  assert.equal(shouldIgnoreRelayResetEvent(guard, "accounts"), false);
  assert.equal(shouldIgnoreRelayResetEvent(guard, "disconnect"), false);

  const generation = guard.begin();
  assert.equal(shouldIgnoreRelayResetEvent(guard, "accounts"), true);
  assert.equal(shouldIgnoreRelayResetEvent(guard, "disconnect"), true);
  assert.equal(shouldIgnoreRelayResetEvent(guard, "status"), true);

  assert.equal(guard.finish(generation), true);
  assert.equal(shouldIgnoreRelayResetEvent(guard, "accounts"), false);
});

test("a stale reset completion cannot clear a newer rotation", () => {
  const guard = new RelayResetGuard();
  const first = guard.begin();
  const second = guard.begin();

  assert.equal(guard.finish(first), false);
  assert.equal(guard.isCurrent(second), true);
  assert.equal(shouldIgnoreRelayResetEvent(guard, "disconnect"), true);
  assert.equal(guard.finish(second), true);
});

test("invalidation makes late reset work stale", () => {
  const guard = new RelayResetGuard();
  const generation = guard.begin();
  guard.invalidate();

  assert.equal(guard.isCurrent(generation), false);
  assert.equal(guard.finish(generation), false);
  assert.equal(guard.active, false);
});

test("wallet selection attempts are serialized and generation-bound", () => {
  const guard = new ConnectionAttemptGuard();
  const extension = guard.begin("extension");
  assert.notEqual(extension, null);
  assert.equal(guard.isPending("extension"), true);
  assert.equal(guard.begin("relay"), null);

  assert.equal(guard.finish(extension as number), true);
  const relay = guard.begin("relay");
  assert.notEqual(relay, null);
  assert.equal(guard.finish(extension as number), false);
  assert.equal(guard.isCurrent(relay as number), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(relay as number), false);
});

test("relay retirement precedes extension approval and activation", async () => {
  const order: string[] = [];
  const result = await activateExtensionAfterRelayRetirement(
    async () => {
      order.push("retire relay");
      return null;
    },
    async () => {
      order.push("request approval");
      return ["account"];
    },
    (accounts) => {
      order.push("activate extension");
      return accounts[0];
    },
  );

  assert.deepEqual(order, ["retire relay", "request approval", "activate extension"]);
  assert.deepEqual(result, { ok: true, value: "account" });
});

test("failed relay retirement blocks extension approval and activation", async () => {
  const retirementError = new Error("relay still live");
  let requested = false;
  let activated = false;
  const result = await activateExtensionAfterRelayRetirement(
    async () => retirementError,
    async () => {
      requested = true;
      return ["account"];
    },
    () => {
      activated = true;
    },
  );

  assert.equal(requested, false);
  assert.equal(activated, false);
  assert.deepEqual(result, { ok: false, retirementError });
});

test("rejected extension approval cannot activate the extension transport", async () => {
  const order: string[] = [];
  await assert.rejects(
    activateExtensionAfterRelayRetirement(
      async () => {
        order.push("retire relay");
        return null;
      },
      async () => {
        order.push("request approval");
        throw new Error("user rejected");
      },
      () => {
        order.push("activate extension");
      },
    ),
    /user rejected/,
  );
  assert.deepEqual(order, ["retire relay", "request approval"]);
});

test("authorization work deduplicates per channel without blocking a replacement", async () => {
  const guard = new ChannelTaskGuard();
  let resolveOld!: () => void;
  let resolveNew!: () => void;
  let starts = 0;
  const oldTask = guard.run(
    "old-channel",
    () =>
      new Promise<void>((resolve) => {
        starts += 1;
        resolveOld = resolve;
      }),
  );
  assert.equal(
    guard.run("old-channel", async () => {
      starts += 1;
    }),
    oldTask,
  );

  const newTask = guard.run(
    "new-channel",
    () =>
      new Promise<void>((resolve) => {
        starts += 1;
        resolveNew = resolve;
      }),
  );
  assert.notEqual(newTask, oldTask);
  assert.equal(starts, 2);
  assert.equal(guard.isPending("new-channel"), true);

  resolveOld();
  await oldTask;
  assert.equal(guard.isPending("new-channel"), true);
  resolveNew();
  await newTask;
  assert.equal(guard.isPending(), false);
});
