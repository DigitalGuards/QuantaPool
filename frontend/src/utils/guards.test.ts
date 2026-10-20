import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidInputError,
  isArray,
  isRecord,
  readBoolean,
  readReceiptStatus,
  readTransactionHash,
  readUnsignedInteger,
} from "./guards.ts";
import { isProviderDetail } from "./web3/extension.ts";

void test("unsigned responses preserve decimal, hex and full bigint precision", () => {
  for (const value of [0n, 0, "0", "000", "0x0"])
    assert.equal(readUnsignedInteger(value), 0n);
  for (const value of [17n, 17, "17", "0x11"])
    assert.equal(readUnsignedInteger(value), 17n);
  assert.equal(readUnsignedInteger("9007199254740993"), 9007199254740993n);
  assert.equal(readUnsignedInteger((1n << 256n) - 1n), (1n << 256n) - 1n);
});

void test("malformed numeric responses fail without coercion or zero defaults", () => {
  const coercible = {
    toString: () => {
      throw new Error("coercion invoked");
    },
  };
  for (const value of [
    undefined,
    null,
    true,
    false,
    {},
    [],
    coercible,
    "",
    " ",
    "1e3",
    "0x",
    "-1",
    -1,
    -1n,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => readUnsignedInteger(value), InvalidInputError);
  }
});

void test("wire booleans reject truthy and falsy substitutes", () => {
  assert.equal(readBoolean(true), true);
  assert.equal(readBoolean(false), false);
  for (const value of [undefined, null, 0, 1, "true", "false", "0", {}, []])
    assert.throws(() => readBoolean(value), InvalidInputError);
});

void test("receipt statuses accept only explicit success or revert", () => {
  for (const status of [0n, 0, "0", "0x0"])
    assert.equal(readReceiptStatus({ status }), false);
  for (const status of [1n, 1, "1", "0x1"])
    assert.equal(readReceiptStatus({ status }), true);
  for (const value of [
    null,
    [],
    {},
    { status: true },
    { status: 2n },
    { status: "" },
  ])
    assert.throws(() => readReceiptStatus(value), InvalidInputError);
});

void test("transaction hashes retain casing and require complete bytes", () => {
  const hash = `0x${"aB".repeat(32)}`;
  assert.equal(readTransactionHash(hash), hash);
  for (const value of [
    null,
    undefined,
    {},
    [],
    42,
    "",
    "0x",
    "0x12",
    hash + "00",
  ])
    assert.throws(() => readTransactionHash(value), InvalidInputError);
});

void test("object and array guards keep their wire shapes separate", () => {
  assert(isArray([null, {}]));
  assert(!isArray({ 0: "value", length: 1 }));
  assert(isRecord({ value: null }));
  assert(!isRecord(null));
  assert(!isRecord([]));
});

void test("provider announcements require complete metadata and callable hooks", () => {
  const info = { uuid: "wallet", name: "Wallet", icon: "", rdns: "theqrl.org" };
  const provider = { request: () => Promise.resolve([]) };
  assert(isProviderDetail({ info, provider }));
  for (const value of [
    null,
    [],
    {},
    { info },
    { info, provider: null },
    { info, provider: { request: true } },
    { info, provider: { ...provider, on: false } },
  ])
    assert(!isProviderDetail(value));
  for (const key of ["uuid", "name", "icon", "rdns"])
    assert(!isProviderDetail({ info: { ...info, [key]: 42 }, provider }));
  assert(!isProviderDetail({ info: { ...info, uuid: "" }, provider }));
});
