# QuantaPool Testing Webapp

A web interface for testing the QuantaPool liquid staking protocol on the QRL Zond testnet.

## Overview

This webapp provides a user interface for interacting with the QuantaPool smart contracts, allowing users to:

- **Deposit QRL** - Stake QRL and receive stQRL liquid staking tokens
- **Withdraw stQRL** - Redeem stQRL tokens back to QRL
- **View Queue Status** - Monitor the validator creation queue
- **Track Protocol Stats** - See TVL, exchange rates, and other protocol metrics

## Tech Stack

- **React 19** with TypeScript
- **Vite** for development and builds
- **MobX** for state management
- **Tailwind CSS** for styling
- **@theqrl/web3** for Zond blockchain interaction

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home - Overview with staking form and protocol stats |
| `/stake` | Stake - Deposit QRL or withdraw stQRL |
| `/queue` | Queue - View validator creation queue status |
| `/stats` | Stats - Detailed protocol statistics |

## Network

The webapp connects to the **Zond testnet** (Chain ID: 32382). You can use the Zond Chrome Extension wallet or send transactions manually to the contract addresses.

## Related

- [QuantaPool Contracts](../contracts/) - Smart contracts for the liquid staking protocol
- [QRL Zond Documentation](https://docs.theqrl.org/)
