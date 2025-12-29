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
| staking-deposit-cli | Key generation | `~/zond-testnetv1/qrysm/staking-deposit-cli` |

### Staking Requirements (Native Zond)

- **Minimum stake**: 40,000 QRL per validator
- **Key type**: Dilithium/ML-DSA-87 (post-quantum)
- **Epoch**: 128 slots (~128 minutes with 60s blocks)
- **Activation delay**: Up to 1 epoch after deposit

### QuantaPool Pooling Model

QuantaPool pools user deposits to create validators:
- **Threshold**: 40,000 QRL (matches native Zond requirement)
- **User gets**: stQRL tokens representing their share
- **Protocol handles**: Validator creation, key management, rewards

QuantaPool's threshold matches the native Zond validator requirement. The protocol aggregates deposits from multiple users until the 40,000 QRL threshold is reached, then creates a validator on behalf of all depositors.

> **Note**: The threshold is configured via the `VALIDATOR_THRESHOLD` constant in `DepositPool.sol`.

## Beacon Deposit Contract (VERIFIED)

### Contract Details

| Property | Value |
|----------|-------|
| Address | `Z4242424242424242424242424242424242424242` |
| Code size | 12,578 bytes |
| Current deposit count | 0 |
| Status | Deployed and operational |

### Interface (IDepositContract)

```solidity
interface IDepositContract {
    event DepositEvent(
        bytes pubkey,
        bytes withdrawal_credentials,
        bytes amount,
        bytes signature,
        bytes index
    );

    function deposit(
        bytes calldata pubkey,           // 2592 bytes - Dilithium public key
        bytes calldata withdrawal_credentials, // 32 bytes
        bytes calldata signature,        // 4595 bytes - Dilithium signature
        bytes32 deposit_data_root        // SHA-256 hash of SSZ-encoded DepositData
    ) external payable;

    function get_deposit_root() external view returns (bytes32);
    function get_deposit_count() external view returns (bytes memory);
}
```

### Deposit Constraints

- `pubkey.length == 2592` bytes (Dilithium public key)
- `withdrawal_credentials.length == 32` bytes
- `signature.length == 4595` bytes (Dilithium signature)
- `msg.value >= 1 ether` (minimum 1 QRL)
- `msg.value % 1 gwei == 0` (must be multiple of gwei)

### ABI Location

The deposit contract ABI is available at:
- `artifacts/DepositContract.json`
- Source: `~/zond-testnetv1/qrysm/contracts/deposit/contract.go`

## Validator Key Generation (VERIFIED)

### Building the CLI

```bash
cd ~/zond-testnetv1/qrysm
go build -o staking-deposit-cli ./cmd/staking-deposit-cli/deposit/
```

Binary size: ~23MB (includes Dilithium cryptography)

### CLI Commands

```bash
# Generate new validator keys with new seed
staking-deposit-cli new-seed \
  --num-validators 1 \
  --folder validator_keys \
  --chain-name testnet \
  --execution-address Z3C6927FDD1b9C81eb73a60AbE73DeDfFC65c8943 \
  --keystore-password-file keystore_password.txt

# Use existing seed
staking-deposit-cli existing-seed --seed <hex-seed> ...

# Submit deposit (uses CLI internally)
staking-deposit-cli submit \
  --validator-keys-dir validator_keys \
  --zond-seed-file seed.txt \
  --deposit-contract Z4242424242424242424242424242424242424242 \
  --http-web3provider https://qrlwallet.com/api/zond-rpc/testnet
```

### Generated Files

```
validator_keys/
├── deposit_data-<timestamp>.json    # Deposit data for beacon chain
└── keystore-m_12381_238_0_0_0-<timestamp>.json  # Encrypted validator keystore
```

### Deposit Data Format

```json
{
  "pubkey": "0x019a424c...",           // 2592 bytes hex
  "amount": 40000000000000,             // 40,000 QRL in gwei
  "withdrawal_credentials": "0x0087...", // 32 bytes
  "deposit_data_root": "0x599e358a...", // SHA-256 hash
  "signature": "0x4041546d...",         // 4595 bytes hex
  "fork_version": "0x20000089",         // Testnet fork version
  "network_name": "testnet"
}
```

## Integration Scripts

### Check Deposit Contract

```bash
node scripts/check-deposit-contract.js
```

Verifies the deposit contract exists and shows current state.

### Submit Deposit (Manual Testing)

```bash
# Preview only (no actual deposit)
node scripts/submit-deposit.js

# Actually submit (requires 40,000 QRL)
node scripts/submit-deposit.js --confirm
```

## Modify DepositPool Contract

### Required Changes

Update `fundValidator()` to accept deposit data and call the beacon deposit contract:

```solidity
// Updated interface
interface IDepositContract {
    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable;
}

// Contract storage
address public constant DEPOSIT_CONTRACT = 0x4242424242424242424242424242424242424242;

// Updated function
function fundValidator(
    bytes calldata pubkey,
    bytes calldata withdrawal_credentials,
    bytes calldata signature,
    bytes32 deposit_data_root
) external onlyOwner nonReentrant returns (uint256 validatorId) {
    require(pendingDeposits >= VALIDATOR_THRESHOLD, "DepositPool: below threshold");
    require(pubkey.length == 2592, "DepositPool: invalid pubkey length");
    require(withdrawal_credentials.length == 32, "DepositPool: invalid credentials length");
    require(signature.length == 4595, "DepositPool: invalid signature length");

    pendingDeposits -= VALIDATOR_THRESHOLD;
    validatorId = validatorCount++;

    // Call beacon deposit contract
    IDepositContract(DEPOSIT_CONTRACT).deposit{value: VALIDATOR_THRESHOLD}(
        pubkey,
        withdrawal_credentials,
        signature,
        deposit_data_root
    );

    emit ValidatorFunded(validatorId, VALIDATOR_THRESHOLD);
    return validatorId;
}
```

### Operator Key Management

Options:
1. **Pre-registered keys**: Operator adds deposit data to registry before needed
2. **On-demand generation**: Generate keys when threshold reached (centralization risk)
3. **Distributed operators**: Multiple operators with their own keys (Rocket Pool model)

Current OperatorRegistry has `addValidator(bytes pubkey)` but no keys registered.

### Oracle Integration

RewardsOracle needs to:
1. Query beacon chain for validator balances
2. Calculate total protocol assets
3. Update exchange rate: `stQRL:QRL = totalSupply / totalAssets`

## Implementation Roadmap

### Phase 1: Manual Staking (Testnet) ← Current
1. [x] Build staking-deposit-cli from qrysm source
2. [x] Find Zond testnet deposit contract address
3. [x] Generate test Dilithium validator keys
4. [x] Study deposit contract interface
5. [x] Create check/submit deposit scripts
6. [x] Modify DepositPool.sol to call deposit contract
7. [x] Deploy updated contract (V2)
8. [x] Test full staking flow - **BLOCKED** (beacon deposit contract issue)
9. [ ] Resolve beacon deposit contract issue with QRL team

### Phase 2: Semi-Automated
1. Create key generation workflow
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

### Local Files

```
~/zond-testnetv1/
├── gzond                 # Execution client binary
├── beacon-chain          # Consensus client binary
├── validator             # Validator client binary
├── qrysmctl              # Qrysm control utility
├── qrysm/                # Qrysm source code
│   ├── staking-deposit-cli  # Built CLI binary (23MB)
│   ├── cmd/staking-deposit-cli/  # CLI source
│   └── contracts/deposit/   # Deposit contract ABI & source
├── go-zond/              # Go-zond source code
├── gzonddata/            # Execution layer data
├── beacondata/           # Consensus layer data
├── genesis.ssz           # Genesis state
└── config.yml            # Network config (DEPOSIT_CONTRACT_ADDRESS)
```

### QuantaPool Scripts

```
scripts/
├── check-deposit-contract.js   # Verify beacon deposit contract status
├── submit-deposit.js           # Submit deposit to beacon chain (direct)
├── fund-validator.js           # Fund validator via DepositPool
├── upgrade-deposit-pool.js     # Upgrade DepositPool contract
└── integration-test.js         # Full integration test suite
```

## Deployment History

### V2 - Beacon Chain Integration (Dec 29, 2025)

| Contract | Address |
|----------|---------|
| DepositPool (v2) | `Z9E800e8271df4Ac91334C65641405b04584B57DC` |
| stQRL | `Z844A6eB87927780E938908743eA24a56A220Efe8` |
| RewardsOracle | `Z541b1f2c501956BCd7a4a6913180b2Fc27BdE17E` |
| OperatorRegistry | `ZD370e9505D265381e839f8289f46D02815d0FF95` |

**Changes in V2:**
- Added `fundValidator(pubkey, withdrawal_credentials, signature, deposit_data_root)` for real beacon deposits
- Added `fundValidatorMVP()` for accounting-only testing
- Added `DEPOSIT_CONTRACT` constant pointing to beacon deposit contract
- Added input validation for Dilithium key lengths (2592 bytes pubkey, 4595 bytes signature)

### V1 - MVP (Dec 28, 2025)
- DepositPool (v1): `Z3C6927FDD1b9C81eb73a60AbE73DeDfFC65c8943` (deprecated)

## Current Testnet State

As of Dec 29, 2025:
- **DepositPool**: V2 with beacon chain integration
- **Validator count**: 1 (via fundValidatorMVP - accounting only)
- **Pending deposits**: ~35,000 QRL (after testing)
- **Contract balance**: ~35,000 QRL
- **Beacon deposit count**: 0 (see Known Issues)
- **Exchange rate**: 1:1

### Testing Completed
- [x] Deposited 80,010 QRL to DepositPool
- [x] `fundValidatorMVP()` - works correctly
- [x] `fundValidator()` with beacon deposit data - contract reverts (see below)

### Known Issue: Beacon Deposit Contract Revert

Direct deposits to the beacon deposit contract (`Z4242424242424242424242424242424242424242`) are failing with:
```
Error: Error happened while trying to execute a function inside a smart contract
```

**Failed Transaction Hash:**
```
0xa473cab5725a997f9bb84b16e6ff2eeed306792324fa77c492f22c200479bd60
```

**Test Matrix:**

| Test Method | Result |
|-------------|--------|
| Official `staking-deposit-cli submit` | **FAILED** |
| Direct script to beacon deposit contract | **FAILED** |
| Via DepositPool.fundValidator() | **FAILED** |
| Precompile via `zond_call` (direct RPC) | **WORKS** |

**Key Finding:** The `depositroot` precompile at `Z0000000000000000000000000000000000000001` returns the correct hash when called directly via `zond_call`, but the beacon deposit contract fails when it calls the same precompile internally.

**Verified Correct:**
- Fork version: `0x20000089` (matches testnet config)
- Pubkey length: 2592 bytes (Dilithium)
- Signature length: 4595 bytes (Dilithium)
- Withdrawal credentials: 32 bytes
- Amount: 40,000 QRL (40000000000000 gwei)
- `deposit_data_root`: Matches precompile output exactly

**SSZ Input Format Verified:**
```
pubkey (2592 bytes) || credentials (32 bytes) || amount (8 bytes LE) || signature (4595 bytes)
Total: 7227 bytes
Amount encoding: 40000000000000 gwei = 0x0080ca3961240000 (little-endian)
```

**Root Cause Analysis:**
The precompile works correctly when called externally. The issue appears to be how the beacon deposit contract invokes the precompile internally, possibly:
1. Different call context or gas forwarding when called from contract
2. Hyperion compiler's `depositroot()` built-in encoding differs from expected
3. Testnet beacon deposit contract deployment issue

**Next Steps to Resolve:**
1. Report to QRL team with failed transaction hash and verification data
2. Request testnet beacon deposit contract bytecode verification
3. Test with a local testnet where we control the deployment
4. Compare beacon deposit contract bytecode with reference implementation

The V2 DepositPool contract is ready - the issue is with the testnet beacon deposit contract, not our implementation.

## Next Steps

1. [x] Modify DepositPool.sol to accept deposit data and call deposit contract
2. [x] Deploy updated contract to testnet (V2)
3. [x] Test full staking flow - **BLOCKED** by beacon deposit contract issue
4. [ ] **PRIORITY:** Report issue to QRL team with transaction hash and verification data
5. [ ] Set up validator binary with generated keys (once deposits work)
6. [ ] Implement oracle balance reporting
7. [ ] Test reward distribution and exchange rate updates
