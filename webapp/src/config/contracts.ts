// Contract addresses and ABIs for Zond testnet

export const CHAIN_ID = 32382;
export const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://localhost:8545';

// Contract addresses (Z-prefix for display, 0x internally)
export const CONTRACTS = {
  stQRL: '0x844A6eB87927780E938908743eA24a56A220Efe8',
  depositPool: '0x3C6927FDD1b9C81eb73a60AbE73DeDfFC65c8943',
  rewardsOracle: '0x541b1f2c501956BCd7a4a6913180b2Fc27BdE17E',
  operatorRegistry: '0xD370e9505D265381e839f8289f46D02815d0FF95',
} as const;

// Display addresses with Z prefix
export const DISPLAY_ADDRESSES = {
  stQRL: 'Z844A6eB87927780E938908743eA24a56A220Efe8',
  depositPool: 'Z3C6927FDD1b9C81eb73a60AbE73DeDfFC65c8943',
  rewardsOracle: 'Z541b1f2c501956BCd7a4a6913180b2Fc27BdE17E',
  operatorRegistry: 'ZD370e9505D265381e839f8289f46D02815d0FF95',
} as const;

// JSON ABIs for @theqrl/web3 compatibility
export const STQRL_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getExchangeRate', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'convertToShares', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'paused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

export const DEPOSIT_POOL_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'requestWithdrawal', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'claimWithdrawal', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getQueueStatus', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { name: 'pending', type: 'uint256' },
    { name: 'threshold', type: 'uint256' },
    { name: 'remaining', type: 'uint256' },
    { name: 'validatorsReady', type: 'uint256' }
  ]},
  { name: 'getWithdrawalRequest', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [
    { name: 'shares', type: 'uint256' },
    { name: 'assets', type: 'uint256' },
    { name: 'requestBlock', type: 'uint256' },
    { name: 'canClaim', type: 'bool' }
  ]},
  { name: 'previewDeposit', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'getTVL', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'pendingDeposits', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'liquidReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'validatorCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'minDeposit', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export const REWARDS_ORACLE_ABI = [
  { name: 'getStatus', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { name: 'lastReport', type: 'uint256' },
    { name: 'cooldownRemaining', type: 'uint256' },
    { name: 'lastBalance', type: 'uint256' },
    { name: 'canReport', type: 'bool' }
  ]},
  { name: 'lastReportTimestamp', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'lastReportedBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// Protocol constants
export const VALIDATOR_THRESHOLD = BigInt('40000000000000000000000'); // 40,000 QRL in wei
export const MIN_DEPOSIT = BigInt('1000000000000000000'); // 1 QRL in wei
export const WITHDRAWAL_DELAY_BLOCKS = 128;
export const BLOCK_TIME_SECONDS = 60; // Zond block time
