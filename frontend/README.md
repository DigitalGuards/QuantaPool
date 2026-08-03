# QuantaPool Frontend

Minimal web app for the QuantaPool liquid staking protocol. Stake QRL, receive
stQRL, track the pool, and manage withdrawals.

Built to match the [MyQRLWallet](https://qrlwallet.com) design system:
Vite 7, React 19, TypeScript, MobX, TailwindCSS 4, Radix primitives.

## Development

```bash
cd frontend
npm install
npm run dev       # http://127.0.0.1:5173
npm run build     # type-check + production build
npm run lint      # ESLint, zero-warnings policy
```

Configuration is optional - testnet defaults are baked in. Copy `.env.example`
to `.env` to override the RPC endpoint, explorer, or contract addresses.

## Architecture

```
src/
├── abi/              # Contract ABIs (generated from contracts/solidity)
├── components/
│   ├── Layout/       # Header (nav + connect), Footer
│   ├── UI/           # Shadcn-style primitives (Button, Card, Input, Tabs…)
│   ├── AmountInput   # Amount field with 25/50/75/Max quick buttons
│   ├── StatsBar      # Protocol stats row
│   └── TxBanner      # Floating transaction status
├── config/networks.ts  # RPC endpoints + contract addresses per network
├── pages/            # Stake (home), Withdrawals (request/claim), Stats
├── stores/           # MobX: poolStore drives all chain state + actions
└── utils/
    ├── format.ts     # BigInt unit conversion + display formatting
    ├── nativeApp.ts  # MyQRLWallet app WebView detection
    └── web3/         # Lazy @theqrl/web3 loader, EIP-6963 extension connect
```

### Wallet connectivity

- **QRL Wallet extension** via EIP-6963 discovery (`theqrl.org` rdns) and the
  `qrl_requestAccounts` / `qrl_sendTransaction` provider methods - the same
  flow myqrlwallet-frontend uses.
- **MyQRLWallet mobile app**: detected via User-Agent. Designed so the
  myqrlwallet-connect SDK can slot in as an additional provider source later.

### Contract flows

| Action | Contract call |
|---|---|
| Stake | `DepositPool.deposit()` (payable) |
| Request withdrawal | `DepositPool.requestWithdrawal(shares)` - locks shares, 128-block delay |
| Claim | `DepositPool.claimWithdrawal()` - FIFO, oldest request first |
| Cancel | `DepositPool.cancelWithdrawal(requestId)` |
| Pool data | `getPoolStatus()`, `getRewardStats()`, `ValidatorManager.getStats()` |

Regenerate ABIs after contract changes:

```bash
node scripts/compile.js   # from the repo root, then copy abi arrays into frontend/src/abi
```
