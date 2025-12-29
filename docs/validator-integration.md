# Validator Integration Guide

## Current State (MVP)

The current QuantaPool implementation handles **accounting only** - it does not actually stake on the Zond beacon chain.

### What Works
- User deposits QRL → receives stQRL tokens
- Deposits accumulate in queue until 40,000 QRL threshold
- `fundValidator()` updates internal accounting
- Withdrawal requests with 128-block waiting period
- Exchange rate calculations (currently 1:1)

### What's Missing
- Actual beacon chain deposit
- Dilithium validator key generation/management
- Real validator creation
- Oracle reporting real validator balances
- Automated reward distribution

## The Gap: `fundValidator()` is a Stub

From `contracts/DepositPool.sol` lines 267-268:

```solidity
// In production, this would transfer to validator deposit contract
// For MVP, funds stay in this contract
```

Currently `fundValidator()`:
1. Decrements `pendingDeposits` by 40,000 QRL
2. Increments `validatorCount`
3. Emits `ValidatorFunded` event
4. **Does NOT call beacon deposit contract**
5. **Does NOT create real validator**

## Zond Staking Architecture

### Components

| Component | Purpose | Location |
|-----------|---------|----------|
| gzond | Execution client | `~/zond-testnetv1/gzond` |
| beacon-chain (qrysm) | Consensus client | `~/zond-testnetv1/beacon-chain` |
| validator | Validator client | `~/zond-testnetv1/validator` |
| staking-deposit-cli | Key generation | `~/zond-testnetv1/qrysm/cmd/staking-deposit-cli/` |

### Staking Requirements (Native Zond)

- **Minimum stake**: 40,000 QRL per validator
- **Key type**: Dilithium/ML-DSA-87 (post-quantum)
- **Epoch**: 100 blocks (~100 minutes with 60s blocks)
- **Activation delay**: Up to 1 epoch after deposit

### QuantaPool Pooling Model

QuantaPool pools user deposits to create validators:
- **Threshold**: 40,000 QRL (matches native Zond requirement)
- **User gets**: stQRL tokens representing their share
- **Protocol handles**: Validator creation, key management, rewards

QuantaPool's threshold matches the native Zond validator requirement. The protocol aggregates deposits from multiple users until the 40,000 QRL threshold is reached, then creates a validator on behalf of all depositors.

> **Note**: The threshold is configured via the `VALIDATOR_THRESHOLD` constant in `DepositPool.sol`.

## Integration Requirements

### 1. Beacon Deposit Contract

Zond has a deposit contract similar to Ethereum's. Need to find:
- Deposit contract address on testnet
- Required function signature
- Deposit data format

Likely location: Check `~/zond-testnetv1/go-zond/core/vm/testdata/precompiles/depositroot.json`

### 2. Validator Key Generation

The staking-deposit-cli generates Dilithium keys:

```go
// Key functions in qrysm/cmd/staking-deposit-cli/stakingdeposit/
GenerateKeys(validatorStartIndex, numValidators, seed, folder, chain, keystorePassword, executionAddress)
ExportKeystores(password, folder)
ExportDepositDataJSON(folder)
```

**To build the CLI:**
```bash
cd ~/zond-testnetv1/qrysm
go build -o staking-deposit-cli ./cmd/staking-deposit-cli
```

### 3. Modify DepositPool Contract

Update `fundValidator()` to:

```solidity
// Pseudocode - needs actual implementation
function fundValidator(bytes calldata validatorPubkey) external onlyOwner {
    require(pendingDeposits >= VALIDATOR_THRESHOLD, "Below threshold");

    pendingDeposits -= VALIDATOR_THRESHOLD;
    validatorCount++;

    // Call beacon deposit contract
    IDepositContract(DEPOSIT_CONTRACT).deposit{value: VALIDATOR_THRESHOLD}(
        validatorPubkey,
        withdrawalCredentials,
        signature,
        depositDataRoot
    );

    emit ValidatorFunded(validatorCount, VALIDATOR_THRESHOLD);
}
```

### 4. Operator Key Management

Options:
1. **Pre-registered keys**: Operator adds keys to registry before needed
2. **On-demand generation**: Generate keys when threshold reached (centralization risk)
3. **Distributed operators**: Multiple operators with their own keys (Rocket Pool model)

Current OperatorRegistry has `addValidator(bytes pubkey)` but no keys registered.

### 5. Oracle Integration

RewardsOracle needs to:
1. Query beacon chain for validator balances
2. Calculate total protocol assets
3. Update exchange rate: `stQRL:QRL = totalSupply / totalAssets`

## Implementation Roadmap

### Phase 1: Manual Staking (Testnet)
1. Build staking-deposit-cli
2. Generate test validator keys manually
3. Register keys in OperatorRegistry
4. Modify `fundValidator()` to use keys
5. Run validator binary with generated keys

### Phase 2: Semi-Automated
1. Create key generation script
2. Automate deposit contract calls
3. Set up oracle to report balances
4. Test full cycle: deposit → validator → rewards

### Phase 3: Production Ready
1. Multi-operator support
2. Distributed key generation
3. Automated validator lifecycle
4. Slashing protection
5. Security audit

## Resources

### QRL/Zond Documentation
- Testnet docs: https://test-zond.theqrl.org/
- Qrysm repo: https://github.com/theQRL/qrysm
- Go-zond repo: https://github.com/theQRL/go-zond

### Staking Deposit CLI Package
- Go docs: https://pkg.go.dev/github.com/theQRL/qrysm/v4/cmd/staking-deposit-cli/stakingdeposit

### Key Functions
```go
// Generate validator keys from seed
NewCredentialsFromSeed(seed, numKeys, amounts, chainSettings, startIndex, withdrawalAddress)

// Export encrypted keystores
ExportKeystores(password, folder)

// Generate deposit data JSON
ExportDepositDataJSON(folder)

// Verify generated files
VerifyDepositDataJSON(folder, credentials)
VerifyKeystores(folders, password)
```

## Files on This Machine

```
~/zond-testnetv1/
├── gzond                 # Execution client binary
├── beacon-chain          # Consensus client binary
├── validator             # Validator client binary
├── qrysmctl              # Qrysm control utility
├── qrysm/                # Qrysm source code
│   └── cmd/
│       └── staking-deposit-cli/  # Key generation CLI source
├── go-zond/              # Go-zond source code
├── gzonddata/            # Execution layer data
├── beacondata/           # Consensus layer data
├── genesis.ssz           # Genesis state
└── config.yml            # Network config
```

## Current Testnet State

As of last test run:
- **Validator count**: 1 (accounting only, not real)
- **Total stQRL**: 40,000
- **Total assets**: 40,000 QRL
- **Exchange rate**: 1:1
- **Pending deposits**: 0
- **Liquid reserve**: 0

The 40,000 QRL is in the DepositPool contract but not actually staked on beacon chain.

## Next Steps

1. [ ] Build staking-deposit-cli from qrysm source
2. [ ] Find Zond testnet deposit contract address
3. [ ] Generate test Dilithium validator keys
4. [ ] Study deposit contract interface
5. [ ] Modify DepositPool.sol to call deposit contract
6. [ ] Deploy updated contract
7. [ ] Test full staking flow
8. [ ] Set up validator binary with generated keys
9. [ ] Implement oracle balance reporting
