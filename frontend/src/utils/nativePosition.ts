import { parseUnits } from "./format.ts";

export const MAX_NATIVE_REQUEST = (1n << 256n) - 1n;

/** A full request is repriced by the contract at its authenticated reservation cutoff. */
export function nativeRequestAmount(value: string, full = false): bigint {
  if (full) return MAX_NATIVE_REQUEST;
  const amount = parseUnits(value);
  if (amount <= 0n || amount >= MAX_NATIVE_REQUEST)
    throw new Error("Enter a positive QRL amount");
  return amount;
}

export function positionLoss(value: bigint, principalBasis: bigint): bigint {
  return principalBasis > value ? principalBasis - value : 0n;
}

export function readChainId(value: unknown): bigint {
  if (
    typeof value !== "bigint" &&
    typeof value !== "number" &&
    typeof value !== "string"
  )
    throw new Error("Invalid chain ID");
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Invalid chain ID");
  const text = String(value);
  if (!/^(?:[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(text))
    throw new Error("Invalid chain ID");
  const id = BigInt(text);
  if (id <= 0n) throw new Error("Invalid chain ID");
  return id;
}
