import { shake256 } from "@noble/hashes/sha3.js";

const QRL_ADDRESS_RE = /^Q[0-9a-fA-F]{128}$/;

const textEncoder = new TextEncoder();

/** QIP-55 checksum casing: SHAKE-256 over the ASCII lowercase hex body,
 * one nibble per character; a hex letter is uppercase exactly when its
 * nibble is >= 8 (mirrors go-qrl and the workspace reference parsers). */
function checksummedHex(lowerHex: string): string {
  const hash = shake256(textEncoder.encode(lowerHex), { dkLen: 64 });
  let result = "";
  for (let index = 0; index < lowerHex.length; index += 1) {
    const char = lowerHex.charAt(index);
    if (char >= "a" && char <= "f") {
      const byte = hash[index >> 1] ?? 0;
      const nibble = (index & 1) === 0 ? byte >> 4 : byte & 0x0f;
      result += nibble >= 8 ? char.toUpperCase() : char;
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Accept only native QIP-55 accounts: uppercase Q + 128 hex. Uniform-case
 * bodies are valid; a mixed-case body must match the SHAKE-256 checksum.
 * Legacy Q40 addresses belong to the abandoned pre-reset chain and are
 * display-only (see utils/format.ts) - they never authorize.
 */
export function isQrlAddress(value: unknown): value is string {
  if (typeof value !== "string" || !QRL_ADDRESS_RE.test(value)) return false;
  const body = value.slice(1);
  const lower = body.toLowerCase();
  return (
    body === lower ||
    body === body.toUpperCase() ||
    body === checksummedHex(lower)
  );
}

export function requireQrlAccount(accounts: unknown): string {
  if (
    !Array.isArray(accounts) ||
    accounts.length !== 1 ||
    !accounts.every(isQrlAddress)
  ) {
    throw new Error("Wallet returned an invalid QRL account");
  }
  return accounts[0];
}
