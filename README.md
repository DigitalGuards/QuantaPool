# QuantaPool - Decentralized QRL Liquid Staking Protocol

QuantaPool is the world's first post-quantum secure liquid staking protocol, built on QRL Zond. It democratizes QRL staking by lowering the barrier to entry while leveraging NIST-approved quantum-resistant cryptography.

## Overview

QuantaPool is a next-generation liquid staking solution for QRL that:

- **For Stakers**: Stake any amount of QRL without running validator infrastructure. Receive stQRL tokens that accrue staking rewards and remain liquid for use across DeFi.

- **For Node Operators**: Run validators with reduced capital requirements. Operators provide a bond (e.g., 10,000-20,000 QRL) and borrow the remainder from the pool to create full 40,000 QRL validators, earning commission on pooled rewards.

## Key Features

- **Post-Quantum Security**: Built on QRL Zond using ML-DSA-87 (Dilithium) signatures - the same NIST-approved cryptography protecting against quantum computer attacks

- **Lower Entry Barrier**: Traditional QRL staking requires 40,000 QRL per validator. QuantaPool enables participation with any amount

- **Liquid Staking Token (stQRL)**: Receive stQRL representing your stake. Use it across DeFi while continuing to earn staking rewards

- **Decentralized**: Permissionless node operator participation with on-chain governance

- **Exchange Rate Model**: stQRL uses an exchange rate model (not rebasing) for seamless DeFi integration and simpler tax treatment

## How It Works

### For Stakers

1. Deposit QRL into QuantaPool smart contracts
2. Receive stQRL tokens at the current exchange rate
3. stQRL value increases over time as validators earn rewards
4. Withdraw anytime by burning stQRL for underlying QRL

### For Node Operators

1. Deposit your operator bond (portion of 40,000 QRL stake)
2. Protocol matches with pooled deposits to create validators
3. Run validator infrastructure (go-zond + qrysm)
4. Earn commission (10-15%) on rewards from pooled deposits

## Technical Specifications

| Parameter | Value |
|-----------|-------|
| Validator stake | 40,000 QRL |
| Block time | 60 seconds |
| Epoch size | 128 slots (~128 min) |
| Withdrawal unlock | End of current epoch |
| Cryptography | ML-DSA-87 (Dilithium) |
| EVM Compatibility | ~95-98% via Hyperion compiler |

## Development

### Prerequisites

- Node.js 18+
- Local Zond node (go-zond + qrysm)
- @theqrl/web3 package

### Getting Started

```bash
# Clone the repository
git clone git@github.com:DigitalGuards/QuantaPool.git
cd QuantaPool

# Install dependencies
npm install

# Run tests
npm test
```

### Check Local Node Status

```bash
systemctl --user status gzond.service beacon-chain.service
```

## Roadmap

**Phase 1: Testnet Foundation** (Current)
- Core smart contract development
- stQRL token implementation (ERC-4626)
- Basic deposit pool and withdrawal functionality
- Testnet deployment

**Phase 2: Pre-Mainnet**
- Security audits
- Multi-operator support
- Oracle decentralization
- QRL Foundation grant application

**Phase 3: Mainnet Launch**
- Controlled launch with TVL caps
- Progressive decentralization
- DeFi integrations

## Wallet Integration

**Primary**: Zond Chrome Extension Wallet supports EIP-6963 standard—users connect like MetaMask on Ethereum.

**Secondary**: [myqrlwallet.com](https://myqrlwallet.com) integration with a dedicated staking tab, allowing users to interact with QuantaPool contracts directly in a self-custodial flow.

## Community

Join the QRL Discord for support, feature suggestions, and research discussions.

## License

GPL-3.0 - see [LICENSE](LICENSE)

---

*QuantaPool is not affiliated with the QRL Foundation. Always do your own research before staking.*
