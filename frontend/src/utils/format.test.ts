import assert from "node:assert/strict";
import test from "node:test";
import { formatBasisPoints, shortenAddress } from "./format.ts";

const Q128 = `Q${"11111111"}${"2".repeat(52)}${"33333333"}${"4".repeat(52)}${"55555555"}`;
const Q40 = `Q${"11111111"}${"2".repeat(8)}${"33333333"}${"4".repeat(8)}${"55555555"}`;

test("QRL address fingerprints show first, middle, and final 8 hex characters", () => {
  assert.equal(shortenAddress(Q128), "Q11111111...33333333...55555555");
  assert.equal(shortenAddress(Q40), "Q11111111...33333333...55555555");
});

test("QRL address fingerprints preserve checksum case", () => {
  const address = `QaBcDeF01${"2".repeat(52)}AbCdEf09${"4".repeat(52)}FfEeDdCc`;
  assert.equal(shortenAddress(address), "QaBcDeF01...AbCdEf09...FfEeDdCc");
});

test("invalid, short, and unsupported-width values remain unchanged", () => {
  for (const address of [
    "",
    "not-an-address",
    "Q1234",
    `q${"1".repeat(128)}`,
    `Q${"1".repeat(127)}`,
    `Q${"1".repeat(129)}`,
  ]) {
    assert.equal(shortenAddress(address), address);
  }
});

test("basis points format as exact percentages without floating-point conversion", () => {
  assert.equal(formatBasisPoints(1000n), "10%");
  assert.equal(formatBasisPoints(1250n), "12.5%");
  assert.equal(formatBasisPoints(100n), "1%");
  assert.equal(formatBasisPoints(1n), "0.01%");
  assert.equal(formatBasisPoints(0n), "0%");
});
