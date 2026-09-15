import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeGasLimit,
  prepareNativeWalletRequest,
  type NativeEstimateRequest,
  type NativeWalletTransport,
} from "./nativeGas.ts";

const blockLimit = 20_000_000n;
const from = `Q${"11".repeat(64)}`;
const to = `Q${"22".repeat(64)}`;

test("cash-flow allowance covers the observed same-block claim underestimate", () => {
  assert.equal(nativeGasLimit(85_687n, blockLimit, true), 300_000n);
  assert.equal(nativeGasLimit(85_687n, blockLimit, false), 111_394n);
  assert.equal(nativeGasLimit(400_001n, blockLimit, true), 620_002n);
});

test("gas margins reject invalid or over-block results without clipping", () => {
  for (const estimate of [0n, -1n])
    assert.throws(
      () => nativeGasLimit(estimate, blockLimit, true),
      /invalid gas estimate/,
    );
  assert.throws(
    () => nativeGasLimit(85_687n, 0n, true),
    /invalid block gas limit/,
  );
  assert.throws(
    () => nativeGasLimit(85_687n, 299_999n, true),
    /block gas limit/,
  );
  assert.throws(
    () => nativeGasLimit(20_000_000n, blockLimit, false),
    /block gas limit/,
  );
  assert.throws(
    () => nativeGasLimit(1n << 54n, 1n << 60n, true),
    /wallet precision/,
  );
  assert.equal(nativeGasLimit(85_687n, 300_000n, true), 300_000n);
});

for (const transport of ["extension", "relay"] as NativeWalletTransport[]) {
  test(`${transport} preserves exact native call and deposit fields with explicit gas`, async () => {
    const estimates: NativeEstimateRequest[] = [];
    for (const value of [0n, 123456789012345678900001n]) {
      const request = {
        from,
        to,
        value,
        data: "0x12345678",
        chainId: 3151916n,
        transport,
        cashFlow: true,
      };
      const tx = await prepareNativeWalletRequest(request, {
        estimateGas: async (input) => {
          estimates.push(input);
          return 85_687n;
        },
        blockGasLimit: async () => blockLimit,
      });
      assert.equal(tx.from, from);
      assert.equal(tx.to, to);
      assert.equal(tx.data, request.data);
      assert.equal(tx.chainId, "0x30182c");
      assert.equal(BigInt(tx.gas as string | number), 300_000n);
      if (transport === "relay") {
        assert.equal(tx.gas, "0x493e0");
        assert.equal(
          tx.value,
          value === 0n ? undefined : `0x${value.toString(16)}`,
        );
        assert.equal(tx.gasLimit, undefined);
        assert.equal(tx.type, undefined);
      } else {
        assert.equal(tx.gas, 300_000);
        assert.equal(tx.gasLimit, 300_000);
        assert.equal(tx.type, "0x2");
        assert.equal(tx.value, value.toString());
      }
    }
    assert.deepEqual(
      estimates.map((x) => x.value),
      [0n, 123456789012345678900001n],
    );
    assert(estimates.every((x) => x.from === from && x.to === to));
  });

  test(`${transport} estimator rejection reaches the caller without a fallback or retry`, async () => {
    let attempts = 0;
    let walletRequests = 0;
    await assert.rejects(async () => {
      await prepareNativeWalletRequest(
        {
          from,
          to,
          value: 0n,
          data: "0x12345678",
          chainId: 3151916n,
          transport,
          cashFlow: true,
        },
        {
          estimateGas: async () => {
            attempts++;
            throw new Error("recipient reverted");
          },
          blockGasLimit: async () => blockLimit,
        },
      );
      walletRequests++;
    }, /recipient reverted/);
    assert.equal(attempts, 1);
    assert.equal(walletRequests, 0);
  });
}
