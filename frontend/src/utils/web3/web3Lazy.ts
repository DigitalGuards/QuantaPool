// Lazy singleton for @theqrl/web3 - keeps the ~600 KB post-quantum crypto
// bundle out of the initial parse graph and loads it only once.
type QrlWeb3Module = typeof import("@theqrl/web3");

let _mod: QrlWeb3Module | null = null;

export async function getQrlWeb3(): Promise<QrlWeb3Module> {
  if (!_mod) _mod = await import("@theqrl/web3");
  return _mod;
}

export type Web3Instance = InstanceType<QrlWeb3Module["default"]>;
