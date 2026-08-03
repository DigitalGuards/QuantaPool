const QRL_ADDRESS_RE = /^Q[0-9a-fA-F]{40}$/;

export function isQrlAddress(value: unknown): value is string {
  return typeof value === "string" && QRL_ADDRESS_RE.test(value);
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
