import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NATIVE_REQUEST,
  nativeRequestAmount,
  positionLoss,
  readChainId,
} from "./nativePosition.ts";
import { formatAmount, formatUnits, parseUnits } from "./format.ts";

test("native requests retain exact QRL amounts and smallest units", () => {
  assert.equal(
    nativeRequestAmount("10000.325400000000000001"),
    10000325400000000000001n,
  );
  assert.equal(nativeRequestAmount("0.000000000000000001"), 1n);
});

test("full requests use the explicit contract sentinel independently of displayed value", () => {
  assert.equal(nativeRequestAmount("", true), MAX_NATIVE_REQUEST);
  assert.equal(nativeRequestAmount("100", true), MAX_NATIVE_REQUEST);
  for (const value of ["", "0", "-1", "1e18", "0.0000000000000000001"])
    assert.throws(() => nativeRequestAmount(value));
});

test("value, principal shortfall and reward display never round into extra spendable QRL", () => {
  assert.equal(positionLoss(8500n, 10000n), 1500n);
  assert.equal(positionLoss(10325n, 10000n), 0n);
  const value = 325400000000000000001n;
  assert.equal(formatAmount(value), "325.4");
  assert.equal(parseUnits(formatUnits(value)), value);
});

test("wallet and RPC chain IDs normalize without floating-point loss", () => {
  assert.equal(readChainId("0x30182c"), 3151916n);
  assert.equal(readChainId("3151916"), 3151916n);
  assert.equal(readChainId(3151916), 3151916n);
  assert.equal(readChainId("9007199254740993"), 9007199254740993n);
  for (const value of [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    "foo",
    "0x0",
  ])
    assert.throws(() => readChainId(value));
});
