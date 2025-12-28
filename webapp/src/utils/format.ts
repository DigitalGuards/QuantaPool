// Formatting utilities

const WEI_PER_QRL = BigInt('1000000000000000000'); // 10^18

/**
 * Format wei to QRL with specified decimals
 */
export function formatQRL(wei: bigint, decimals = 4): string {
  if (wei === 0n) return '0';

  const whole = wei / WEI_PER_QRL;
  const remainder = wei % WEI_PER_QRL;

  if (remainder === 0n || decimals === 0) {
    return whole.toLocaleString();
  }

  // Calculate decimal part
  const decimalStr = remainder.toString().padStart(18, '0');
  const truncated = decimalStr.slice(0, decimals);

  // Remove trailing zeros
  const cleaned = truncated.replace(/0+$/, '');

  if (cleaned === '') {
    return whole.toLocaleString();
  }

  return `${whole.toLocaleString()}.${cleaned}`;
}

/**
 * Parse QRL string to wei
 */
export function parseQRL(qrl: string): bigint {
  const cleaned = qrl.replace(/,/g, '').trim();

  if (!cleaned || cleaned === '0') {
    return 0n;
  }

  const parts = cleaned.split('.');
  const whole = BigInt(parts[0] || '0');

  if (parts.length === 1) {
    return whole * WEI_PER_QRL;
  }

  // Handle decimals
  const decimalPart = parts[1].slice(0, 18).padEnd(18, '0');
  const decimal = BigInt(decimalPart);

  return whole * WEI_PER_QRL + decimal;
}

/**
 * Format exchange rate (scaled by 10^18)
 */
export function formatExchangeRate(rate: bigint, decimals = 6): string {
  return formatQRL(rate, decimals);
}

/**
 * Format address for display (truncate middle)
 */
export function formatAddress(address: string, chars = 6): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 2) return address;

  // Handle Z-prefix addresses
  const prefix = address.startsWith('Z') ? 'Z' : address.slice(0, 2);
  const start = address.startsWith('Z') ? address.slice(1, 1 + chars) : address.slice(2, 2 + chars);
  const end = address.slice(-chars);

  return `${prefix}${start}...${end}`;
}

/**
 * Convert 0x address to Z-prefix display format
 */
export function toZAddress(address: string): string {
  if (address.startsWith('Z')) return address;
  if (address.startsWith('0x')) return 'Z' + address.slice(2);
  return 'Z' + address;
}

/**
 * Convert Z-prefix address to 0x format for transactions
 */
export function to0xAddress(address: string): string {
  if (address.startsWith('0x')) return address;
  if (address.startsWith('Z')) return '0x' + address.slice(1);
  return '0x' + address;
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format time remaining
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Ready';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Calculate percentage of threshold reached
 */
export function calculateThresholdPercent(pending: bigint, threshold: bigint): number {
  if (threshold === 0n) return 0;
  return Number((pending * 10000n) / threshold) / 100;
}
