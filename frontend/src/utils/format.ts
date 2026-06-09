/**
 * BigInt-based fixed-point helpers for 18-decimal QRL / stQRL amounts.
 * Kept dependency-free on purpose — this app never needs arbitrary-precision
 * decimal math beyond unit conversion and display formatting.
 */

/** Convert a base-unit integer to a full-precision decimal string ("1.5"). */
export function formatUnits(value: bigint, decimals = 18): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
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
    throw new Error(`Amount "${value}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Human-friendly display: thousands separators, fraction truncated. */
export function formatAmount(value: bigint, decimals = 18, maxFraction = 4): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fractionDigits = (abs % base).toString().padStart(decimals, "0");
  const fraction = fractionDigits.slice(0, maxFraction).replace(/0+$/, "");
  const grouped = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Exchange rate (1e18-scaled QRL-per-share) as a display string like "1.0482". */
export function formatRate(rate: bigint, fractionDigits = 4): string {
  const base = 10n ** 18n;
  const whole = rate / base;
  const fraction = (rate % base)
    .toString()
    .padStart(18, "0")
    .slice(0, fractionDigits);
  return `${whole}.${fraction}`;
}

/** Shorten a Q-address for display: "Q109d…b9aC". */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, chars + 1)}…${address.slice(-chars)}`;
}

/** "≈ 2h 8m" style countdown from a number of blocks. */
export function blocksToTime(blocks: bigint | number, blockTimeSeconds: number): string {
  const totalSeconds = Number(blocks) * blockTimeSeconds;
  if (totalSeconds <= 0) return "now";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);
  if (hours > 0) return `≈ ${hours}h ${minutes}m`;
  return `≈ ${minutes}m`;
}
