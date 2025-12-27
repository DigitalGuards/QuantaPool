# Building QuantaPool: A Roadmap for Post-Quantum Liquid Staking on QRL Zond

**QuantaPool can become the world's first post-quantum secure liquid staking protocol**, leveraging QRL Zond's EVM compatibility and NIST-approved cryptography. The **40,000 QRL minimum stake** creates a significant barrier for retail holders—much higher than Ethereum's 32 ETH equivalent—making pooled staking essential for broader network participation. With Zond's Testnet V1 now live and mainnet expected after Q1 2026 audits, there's a strategic window to build, test, and position for ecosystem support through QRL Foundation grants of up to 30,000 CHF.

The Rocket Pool architecture provides an excellent template—its minipool system, rETH exchange-rate model, and modular contract design can be adapted for Zond's quantum-resistant environment. Zond's ~95-98% Solidity compatibility via the Hyperion compiler means most Ethereum liquid staking patterns port directly, though the 60-second block times and larger post-quantum signatures require thoughtful UX adjustments.

---

## QRL Zond Staking Mechanics

The Zond proof-of-stake system shares Ethereum's conceptual model but diverges in key parameters. Each **40,000 QRL stake creates one validator**, with a maximum of 100 validators (4,000,000 QRL) per address. This high threshold creates natural demand for pooled staking among retail holders who can't meet the minimum.

### Validator Operation and Timing

Zond uses a dual-client architecture: **go-zond** (execution client/ZVM) and **qrysm** (consensus/beacon node, a quantum-resistant Prysm fork). Validators are randomly assigned as block proposers or attestors each epoch. The timing model significantly impacts pool design:

| Parameter | QRL Zond | Ethereum |
|-----------|----------|----------|
| Minimum Stake | **40,000 QRL** | 32 ETH |
| Block time | 60 seconds | 12 seconds |
| Epoch size | 128 slots (~128 min) | 32 slots (~6.4 min) |
| Finalization | 4-6 hours | ~16 minutes |
| Withdrawal unlock | End of current epoch (~50-100 min) | Variable queue |

Withdrawals work via sending a stake transaction with 0 amount—funds unlock at epoch end rather than joining a lengthy queue. This faster, more predictable unlock model simplifies pool withdrawal UX compared to Ethereum.

### Post-Quantum Cryptography Considerations

All validators **must use ML-DSA-87 (Dilithium)** for consensus operations—no alternative. The SPHINCS+ integration planned post-mainnet will add stateless hash-based signatures for wallets, but pools will work with Dilithium. Key implications for smart contracts:

- **No `ecrecover`** function—replaced with quantum-safe verification primitives
- **Larger transaction sizes** (~2.5KB signatures vs 64 bytes)—affects gas calculations
- **Native signature verification** in Hyperion compiler for on-chain validation
- Smart contracts can verify quantum-secure signatures directly

---

## Rocket Pool's Architecture Provides the Blueprint

Rocket Pool's minipool system elegantly solves the pooled staking coordination problem through smart contracts rather than trust. Understanding its mechanics is essential for adapting to Zond.

### The Minipool Economic Model for QuantaPool

Adapting Rocket Pool's model to QRL's 40,000 QRL validator requirement:

| Minipool Type | Operator Bond | Pooled from Users | Your Commission |
|---------------|---------------|-------------------|-----------------|
| Quarter Bond | 10,000 QRL | 30,000 QRL | 10-15% on pooled rewards |
| Half Bond | 20,000 QRL | 20,000 QRL | 10-15% on pooled rewards |

**The Quarter Bond model** is most attractive for capital efficiency—operators stake 10k QRL and borrow 30k from the pool, earning commission on the pooled portion's rewards. This creates strong incentives for node operators while keeping the barrier reasonable.

**Commission economics example** (Quarter Bond at 10% commission):
- Validator earns 1,000 QRL annually in rewards
- 250 QRL goes to operator (their 10k bond's share)
- 750 QRL goes to pooled portion, minus 75 QRL (10%) commission to operator
- Operator total: 325 QRL on 10k investment (3.25% + commission)
- Pool depositors: 675 QRL on 30k pooled (2.25%)

### rETH's Exchange Rate Model

Rocket Pool's liquid staking token uses an **exchange rate model** rather than rebasing—your token balance stays constant while its QRL value increases over time. This provides tax advantages and simpler DeFi integrations:

```
stQRL:QRL ratio = total QRL staked / total stQRL supply
```

For Zond, implement as a standard ZRC20 with a **`getExchangeRate()`** function that returns the current QRL-per-stQRL ratio.

### Smart Contract Architecture Patterns Worth Adopting

Rocket Pool's **Eternal Storage pattern** separates persistent state from logic, enabling upgrades without data migration. **For QuantaPool MVP**, simplify to: one upgradeable proxy contract using OpenZeppelin's proxy pattern, with a path to modular architecture as complexity grows.

---

## Zond Development Environment

Zond achieves **95-98% Solidity compatibility** through the Hyperion compiler (a Solidity fork) and Zond Virtual Machine. Most Ethereum smart contracts deploy with minimal changes, but the tooling ecosystem is still maturing.

### What Works Now

| Tool | Status | Notes |
|------|--------|-------|
| **@theqrl/web3** | ✅ Production | Official web3.js fork, primary SDK |
| **Hyperion (hypc)** | ✅ Available | Compiles Solidity-like syntax |
| **Zond Chrome Extension** | ✅ Available | MetaMask-like wallet, EIP-6963 |
| **Vortex IDE** | 🔄 Development | Remix fork with Hyperion support |
| **ZondScan** | ✅ Live | Block explorer at zondscan.com |

### What Doesn't Work Yet

Hardhat and Foundry lack native support—deployment currently requires raw Node.js scripts with @theqrl/web3. The recommended deployment flow:

```javascript
// config.json
{
  "provider": "http://localhost:8545",
  "hexseed": "0xa76b9cac...",  // Dilithium key, not ECDSA
  "tx_required_confirmations": 12
}

// Deploy with @theqrl/web3
const Web3 = require('@theqrl/web3');
const web3 = new Web3(config.provider);
```

**Chain ID is 32382** for testnet. Contract addresses use `Z` prefix for display (e.g., `Zecf54b758c2793466FD48517E5E84313Dc5C89ee`) but work with `0x` internally.

### Critical Code Changes for Zond

```solidity
// Change first line
pragma hyperion ^0.8.0;  // Instead of pragma solidity

// No ecrecover - use Zond's PQ signature verification
// Address format differences (internal handling)
// Larger gas estimates for signature operations
```

---

## MVP Contract Architecture

Based on analysis of Lido, Rocket Pool, and Frax patterns, the **ERC-4626 vault pattern** is the simplest architecture for a solo developer MVP.

### Four Core Contracts in Priority Order

**1. Liquid Staking Token (stQRL)** — Week 1-2
```solidity
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract StakedQRL is ERC4626, Ownable, ReentrancyGuard {
    function totalAssets() public view override returns (uint256) {
        return _asset.balanceOf(address(this)) + pendingRewards;
    }
}
```

**2. Deposit Pool Contract** — Week 3-4
Entry point that accepts QRL, mints stQRL, and manages the queue for validator creation. Accumulates deposits until reaching the **40,000 QRL threshold**.

**3. Rewards Oracle** — Week 5-6
Initially centralized: operator submits validator balances off-chain, contract updates exchange rate. Decentralize later with multiple oracle nodes.

**4. Operator Registry** — Week 7-8 (simplified)
For MVP, use a single trusted operator (yourself). Track validator public keys and their associated minipool contracts.

### Testing Strategy

Since Foundry doesn't work natively on Zond, use a hybrid approach:

1. **Develop and unit test locally** using Hardhat with standard Solidity
2. **Deploy to Zond testnet** via @theqrl/web3 scripts after porting to Hyperion
3. **Integration test on testnet** with real staking flows
4. **Use Slither and Mythril** for security analysis

---

## Grant Strategy and Ecosystem Positioning

The QRL Foundation actively funds ecosystem development. QuantaPool is an ideal candidate under "open source infrastructure" and "community public goods."

### Grant Application Approach

**Small grants (up to 30,000 CHF)** are available year-round. Submit to **hello@qrl.foundation** with:

- Project outline emphasizing "first post-quantum liquid staking protocol"
- Roadmap with testnet deployment milestones
- Budget breakdown and clear deliverables
- How it benefits decentralization (lowering the 40k barrier for participation)

Key contacts: Jack Matier (@jackalyst), James Gordon (@fr1t2), JP Lomas (@jplomas).

### myqrlwallet Integration Path

**Primary integration**: Zond Chrome Extension Wallet supports EIP-6963 standard—users connect like MetaMask.

**Secondary integration**: Your myqrlwallet can add a dedicated staking tab that interacts with QuantaPool contracts directly, keeping users in a self-custodial flow throughout.

---

## Prioritized Development Roadmap

### Phase 1: Testnet Foundation (Now - Q1 2026)

**Weeks 1-4: Learn and Setup**
- Complete CryptoZombies + Cyfrin Updraft Foundry course
- Set up Zond node locally (go-zond + qrysm)
- Deploy simple ZRC20 token to Zond testnet
- Get testnet QRL from Discord

**Weeks 5-8: Core Contracts**
- Implement stQRL vault token using ERC-4626 pattern
- Build deposit pool with **40,000 QRL threshold** tracking
- Add withdrawal functionality with epoch timing
- Create simplified operator registry (single operator)

**Weeks 9-12: Integration and Testing**
- Deploy full contract suite to testnet
- Build basic web interface connecting to Zond wallet
- Run automated security tools (Slither, Mythril)
- Get peer review from QRL Discord community

### Phase 2: Pre-Mainnet Preparation (Q1-Q2 2026)

- Submit QRL Foundation grant application with working testnet demo
- Security hardening and audit preparation
- Design operator commission structure (10-15% recommended)
- Plan node operator onboarding flow

### Phase 3: Mainnet Launch (Post-Zond Mainnet)

- Soft launch with TVL cap ($10,000-50,000)
- Progressive decentralization: admin → multisig → governance
- Expand to permissionless operator model

### Testnet vs Mainnet Requirements

| Component | Testnet Now | Needs Mainnet |
|-----------|-------------|---------------|
| Core staking contracts | ✅ Build and test | Audit before deployment |
| Liquid staking token | ✅ Full implementation | Exchange integrations |
| Web interface | ✅ Full implementation | Production security |
| Oracle system | ✅ Centralized prototype | Decentralized oracle network |
| Operator registry | ✅ Single operator | Multi-operator permissionless |

---

## Key Risks and Mitigations

**Smart contract risk**: Use battle-tested OpenZeppelin patterns, minimize custom logic, get audit before significant TVL. Start with deposit caps.

**Validator slashing**: Implement operator collateral requirements—operators stake additional QRL (e.g., 5,000 QRL bond) that can be slashed to compensate pool losses.

**Oracle manipulation**: Start with trusted single-operator oracle, upgrade to multi-party threshold signatures (3-of-5 minimum) before scaling.

**40,000 QRL threshold**: The high validator minimum means longer wait times for pool deposits to activate. Communicate expected activation times clearly in UX.

---

## Conclusion

QuantaPool is technically feasible using proven Ethereum liquid staking patterns adapted for Zond's quantum-resistant environment. The **40,000 QRL validator minimum** creates genuine, strong demand for pooled staking—this is a bigger barrier than Ethereum's 32 ETH, making your service more valuable.

Start immediately with testnet development—the ~95% Solidity compatibility means your skills transfer directly from Ethereum tutorials. Target a grant application once you have a working testnet demo, positioning as the "world's first post-quantum liquid staking protocol."

**Realistic timeline: 12-17 weeks to testnet MVP**, followed by security hardening during Testnet V2 (Q1 2026). This positions QuantaPool for mainnet launch alongside Zond itself.
