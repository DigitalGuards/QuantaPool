import { isQrlAddress } from "./qrlAddress.ts";
import { isArray } from "./guards.ts";

/**
 * Native VM64 topics: an event signature topic holds the 32-byte keccak hash
 * in its high bytes and zeros in its low 32 bytes, the 64-byte form that
 * `abi.encodeEventSignature` returns since @theqrl/web3 2.0.0 (1.x returned
 * the bare 32-byte hash). Addresses use all 64 bytes.
 */
export function nativeEventTopics(
  signatureTopic: string,
  beneficiary: string,
): [string, string] {
  if (
    !/^0x[0-9a-fA-F]{64}0{64}$/.test(signatureTopic) ||
    !isQrlAddress(beneficiary)
  )
    throw new Error("Invalid native event filter");
  return [
    signatureTopic.toLowerCase(),
    `0x${beneficiary.slice(1).toLowerCase()}`,
  ];
}

export function matchesNativeTopics(
  topics: unknown,
  expected: readonly string[],
): topics is string[] {
  return (
    isArray(topics) &&
    topics.length >= expected.length &&
    topics.every(
      (topic): topic is string =>
        typeof topic === "string" && /^0x[0-9a-fA-F]{128}$/.test(topic),
    ) &&
    expected.every(
      (topic, index) => topics[index]?.toLowerCase() === topic.toLowerCase(),
    )
  );
}
