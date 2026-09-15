/**
 * BigInt-based fixed-point helpers for 18-decimal native QRL amounts.
 * Kept dependency-free on purpose - this app never needs arbitrary-precision
 * decimal math beyond unit conversion and display formatting.
 */

/** Convert a base-unit integer to a full-precision decimal string ("1.5"). */
export function formatUnits(value: bigint, decimals = 18): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Convert a user-typed decimal string to base units. Throws on invalid input. */
export function parseUnits(value: string, decimals = 18): bigint {
  const trimmed = value.trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || trimmed === "" || trimmed === ".") {
    throw new Error(`Invalid amount "${value}"`);
  }
  const whole = match[1] || "0";
  const fraction = match[2] || "";
  if (fraction.length > decimals) {
    throw new Error(
      `Amount "${value}" has more than ${decimals} decimal places`,
    );
  }
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}

/** Human-friendly display: thousands separators, fraction truncated. */
export function formatAmount(
  value: bigint,
  decimals = 18,
  maxFraction = 4,
): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fractionDigits = (abs % base).toString().padStart(decimals, "0");
  const fraction = fractionDigits.slice(0, maxFraction).replace(/0+$/, "");
  const grouped = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Basis points as an exact percentage string, for example 1000 becomes "10%". */
export function formatBasisPoints(basisPoints: bigint): string {
  const negative = basisPoints < 0n;
  const absolute = negative ? -basisPoints : basisPoints;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}%`;
}

/** USD display: "$1,234.56". */
export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/** Stable visual fingerprint for long QRL addresses. */
export function shortenAddress(address: string): string {
  if (!/^Q(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{128})$/.test(address)) return address;

  const body = address.slice(1);
  const segmentLength = 8;
  if (body.length < segmentLength * 3) return address;

  const middleStart = Math.floor((body.length - segmentLength) / 2);
  return [
    `Q${body.slice(0, segmentLength)}`,
    body.slice(middleStart, middleStart + segmentLength),
    body.slice(-segmentLength),
  ].join("...");
}
