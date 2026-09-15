import assert from "node:assert/strict";
import test from "node:test";
import { Web3 } from "@theqrl/web3";
import { nativeEventTopics, matchesNativeTopics } from "./nativeLogs.ts";
import { NativeQrlPoolABI } from "../abi/NativeQrlPool.ts";

const signature =
  "0xff465791f48805b0254fc0e26cc605e27ef7706d8ee0cf018f8696f58db83679";
const beneficiary = "Q" + "12".repeat(32) + "ab".repeat(32);

test("native event filters retain complete 64-byte addresses and high-aligned signature hashes", () => {
  const topics = nativeEventTopics(signature, beneficiary);
  assert.equal(topics[0], signature + "00".repeat(32));
  assert.equal(topics[1], "0x" + "12".repeat(32) + "ab".repeat(32));
  assert(!matchesNativeTopics([signature, topics[1]], topics));
  assert(
    !matchesNativeTopics(
      ["0x" + "00".repeat(32) + signature.slice(2), topics[1]],
      topics,
    ),
  );
  assert(
    !matchesNativeTopics(
      [topics[0], "0x" + "34".repeat(32) + "ab".repeat(32)],
      topics,
    ),
  );
  assert(matchesNativeTopics([...topics, "0x" + "00".repeat(64)], topics));
});

test("native ABI decoder reads the deployed DepositQueued word layout without narrowing topics", () => {
  const web3 = new Web3("http://127.0.0.1:1");
  const event = NativeQrlPoolABI.find(
    (item) => item.type === "event" && item.name === "DepositQueued",
  );
  assert(event && event.type === "event");
  assert.equal(
    web3.qrl.abi.encodeEventSignature("DepositQueued(address,uint256,uint256)"),
    signature,
  );
  const words = nativeEventTopics(signature, beneficiary);
  const data = "0x" + (20000n * 10n ** 18n).toString(16).padStart(128, "0");
  const decoded = web3.qrl.abi.decodeLog([...event.inputs], data, [
    words[1],
    "0x" + "0".repeat(127) + "7",
  ]);
  assert.equal(
    String(decoded.beneficiary).toLowerCase(),
    beneficiary.toLowerCase(),
  );
  assert.equal(decoded.id, 7n);
  assert.equal(decoded.amount, 20000n * 10n ** 18n);
});

test("legacy-width and malformed native log filters reject before RPC", () => {
  assert.throws(() => nativeEventTopics(signature, "Q" + "11".repeat(20)));
  assert.throws(() =>
    nativeEventTopics(signature + "00", "Q" + "11".repeat(64)),
  );
  assert(!matchesNativeTopics(null, []));
  assert(!matchesNativeTopics(["0x"], []));
});
