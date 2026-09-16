import { isQrlAddress } from "./qrlAddress.ts";

/** Native VM64 topics: bytes32 signatures occupy the high bytes; addresses use all 64 bytes. */
export function nativeEventTopics(
  signature: string,
  beneficiary: string,
): [string, string] {
  if (!/^0x[0-9a-fA-F]{64}$/.test(signature) || !isQrlAddress(beneficiary))
    throw new Error("Invalid native event filter");
  return [
    signature.toLowerCase().padEnd(130, "0"),
    `0x${beneficiary.slice(1).toLowerCase()}`,
  ];
}

export function matchesNativeTopics(
  topics: unknown,
  expected: readonly string[],
): topics is string[] {
  return (
    Array.isArray(topics) &&
    topics.length >= expected.length &&
    topics.every(
      (topic) =>
        typeof topic === "string" && /^0x[0-9a-fA-F]{128}$/.test(topic),
    ) &&
    expected.every(
      (topic, index) => topics[index].toLowerCase() === topic.toLowerCase(),
    )
  );
}
