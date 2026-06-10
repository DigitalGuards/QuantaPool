# Upstream QRL v2 Findings

Facts read directly from the cloned upstream repos at:
- `/home/waterfall/myqrlwallet/qrysm` (QRL consensus client)
- `/home/waterfall/myqrlwallet/go-qrl` (QRL execution client)

Captured here because the official staking documentation is still in QA (per QRL team, Discord, 2026-04-13). **Verify against the official docs once published** - this file is a diff baseline, not a spec.

---

## 1. Beacon deposit contract address - **confirmed `Q4242…`**

| Env | Address | Source |
|-----|---------|--------|
| Testnet (e2e) | `Q4242424242424242424242424242424242424242` | `qrysm/config/params/testnet_e2e_config.go:8`, `qrysm/config/params/testdata/e2e_config.yaml:57` |
| Mainnet | `Q00000000219ab540356cBB839Cbe05303d7705Fa` | `qrysm/config/params/mainnet_config.go:101` |
| Minimal (placeholder) | `Q1234567890123456789012345678901234567890` | |

Bytecode is **pre-deployed at genesis** via `qrysm/runtime/interop/genesis.go` - no runtime deployment step needed. The contract is present at `Q4242…` from block 0 on testnet.

**QuantaPool impact:** `DepositPool.DEPOSIT_CONTRACT` (currently `Q4242…`) is correct for testnet. For mainnet deploy, it will need to be `Q00000000219ab540356cBB839Cbe05303d7705Fa`.

---

## 2. Withdrawal credentials prefix byte - **QRL uses `0x00`, not `0x01`**

**qrysm:** `ExecutionAddressWithdrawalPrefixByte = byte(0)` (`mainnet_config.go:74`, `minimal_config.go:32`).

Used in three load-bearing places:
- `qrysm/contracts/deposit/deposit.go:71` - builds credentials for staking-deposit-cli
- `qrysm/beacon-chain/state/state-native/getters_withdrawal.go:90` - gates whether a validator is withdrawable
- `qrysm/cmd/staking-deposit-cli/stakingdeposit/generatekeys.go:111` - validates deposit JSON input

**Spec rationale:** Ethereum uses `0x01` for "withdrawable to an execution address" vs `0x00` for "withdrawable to a BLS key". QRL v2 has no BLS-key-withdrawal path (all validators are ML-DSA-87 and withdraw to addresses), so the prefix distinction collapses - QRL just uses `0x00` uniformly.

**QuantaPool bug (found 2026-04-14, fixed same commit as this doc):** `DepositPool-v2.sol:559` hardcoded `bytes1(0x01)` based on Ethereum spec assumption. Real `staking-deposit-cli` output uses `0x00`, so `pool.fundValidator()` would have reverted with `InvalidWithdrawalCredentials` and left any attempted staking deposit stuck. Fixed; the live-testnet deployment at `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` still has the pre-fix bytecode - redeploy required before the real beacon path can be exercised.

---

## 3. Staking-deposit-cli flow map

Source: `qrysm/cmd/staking-deposit-cli/`.

### Subcommands
- `existing-seed` (alias `exst-seed`) - derive validator keys from an existing 48-byte hex-encoded ML-DSA-87 extended seed.
- `new-seed` (alias `ns`) - generate a fresh seed + derive validator keys.
- `submit` - broadcast the deposit transaction(s) from a generated `deposit_data-*.json`.

### Required flags (post-rebrand, no `zond-*` prefixes)
| Flag | Purpose |
|------|---------|
| `--extended-seed` | Hex-encoded ML-DSA-87 seed (48 bytes incl. descriptor header) |
| `--execution-address` | The 20-byte Q-address that receives withdrawals (for us: the `DepositPool` address) |
| `--num-validators` | How many keys to derive |
| `--chain-name` | `betanet` / `testnet` (default varies) |
| `--validator-keys-dir` | Defaults to `validator_keys/` |
| `--seed-file` | ML-DSA-87 wallet seed used by `submit` to sign the deposit tx |

### Output files
- `validator_keys/keystore-m_12381_238_{i}_0-{ts}.json` - password-encrypted signing seed per validator
- `validator_keys/deposit_data-{ts}.json` - array of deposit objects

### deposit_data-*.json fields (direct match for `pool.fundValidator` signature)
```json
{
  "pubkey":                  "0x...",  // 2592 bytes → PUBKEY_LENGTH ✓
  "withdrawal_credentials":  "0x...",  // 32 bytes → CREDENTIALS_LENGTH ✓
  "signature":               "0x...",  // 4595 bytes → SIGNATURE_LENGTH ✓
  "deposit_data_root":       "0x...",  // 32 bytes, SSZ hash root
  "amount":                  <uint64>, // in Planck (not used by our contract - VALIDATOR_STAKE is constant)
  "message_root":            "0x...",
  "fork_version":            "0x...",
  "network_name":            "<string>",
  "deposit_cli_version":     "<string>"
}
```

### Key-derivation path
BIP32-style: `m/12381/238/<validator-index>/0`. Descriptor byte of the extended seed validated as ML-DSA-87 only.

### Submit path
`submit` decodes the JSON, calls `deposit(pubkey, withdrawal_credentials, signature, deposit_data_root)` on the beacon deposit contract with `msg.value = amount * 1e9` (Planck). Function selector: `0x22895118`.

**QuantaPool impact:** Once our `DepositPool` is redeployed with the `0x00` prefix fix, feeding the JSON straight into `pool.fundValidator(...)` should work. Do **not** use the `submit` subcommand directly - it bypasses our pool's accounting. Use only the key-generation half of the CLI.

---

## 4. Slashing constants snapshot (placeholders, per QRL team 2026-01-25)

All in `qrysm/config/params/mainnet_config.go`. Record these so we can diff later when the QRL team publishes the production values.

| Constant | Value | Meaning | Line |
|---|---|---|---|
| `MinSlashingPenaltyQuotient` | 32 | Minimum slash = balance / 32 | 198 |
| `ProportionalSlashingMultiplier` | 3 | Additional penalty = 3× (sum of slashings across correlated window) | 199 |
| `InactivityPenaltyQuotient` | 65536 (1 << 16) | Inactivity leak drain rate | 200 |
| `WhistleBlowerRewardQuotient` | 512 | Reward to whistleblower = slashed balance / 512 | 123 |
| `ProposerRewardQuotient` | 8 | Proposer reward share = 1/8 | 124 |
| `BaseRewardFactor` | 2048 | Per-slot interest basis (not slashing but reward scaling) | 122 |
| `MaxEffectiveBalance` | 40_000 * 10^18 Planck | Validator stake cap = 40,000 QRL | 69 |
| `EjectionBalance` | 20_000 * 10^18 Planck | Validator force-exited when balance falls below this | 70 |
| `EffectiveBalanceIncrement` | 1 * 10^18 Planck | Stake-quantization step = 1 QRL | 71 |

### Adjacent TODOs (likely to change)
- Line 57 `MinPerEpochChurnLimit = 10` - `TODO (cyyber): Re-evaluate the value`
- Line 189 `SyncCommitteeSubnetCount = 1` - `TODO (cyyber) finalize, was 4`
- Line 192 `SyncCommitteeSize = 128` - `TODO (cyyber) finalize, was 512`
- Line 195 `EpochsPerSyncCommitteePeriod = 8` - `TODO (cyyber) finalize, was 512`

No TODO markers adjacent to the slashing constants specifically, but per the Discord conversation those values are not final either.

### Diffing later
When the QRL team publishes the official slashing parameters, diff against this table and update the QuantaPool risk model accordingly (especially `MinSlashingPenaltyQuotient` and `ProportionalSlashingMultiplier` - those directly affect the expected loss a stQRL holder faces during a slashing event).
