/** Runtime checks shared by wallet, RPC and library boundaries. */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isArray(value);
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value))
    throw new InvalidInputError("Expected a response object");
  return value;
}

export function isUnsignedInteger(
  value: unknown,
): value is bigint | number | string {
  if (typeof value === "bigint") return value >= 0n;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && /^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(value);
}

export function readUnsignedInteger(value: unknown): bigint {
  if (!isUnsignedInteger(value))
    throw new InvalidInputError("Expected an unsigned integer response");
  return BigInt(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function readBoolean(value: unknown): boolean {
  if (!isBoolean(value))
    throw new InvalidInputError("Expected a boolean response");
  return value;
}

export function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

export function isTransactionHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function readTransactionHash(value: unknown): string {
  if (!isTransactionHash(value))
    throw new InvalidInputError("Wallet returned an invalid transaction hash");
  return value;
}

export function readReceiptStatus(value: unknown): boolean {
  const status = readUnsignedInteger(requireRecord(value).status);
  if (status !== 0n && status !== 1n)
    throw new InvalidInputError("RPC returned an invalid receipt status");
  return status === 1n;
}
