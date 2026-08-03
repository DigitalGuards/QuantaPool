# QuantaPool v2 Architecture

## Overview

QuantaPool is a decentralized liquid staking protocol for QRL. Users deposit QRL and receive stQRL tokens representing their stake. The protocol uses a **fixed-balance token model** (like Lido's wstETH) where share balances remain constant and QRL value grows with rewards.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         User                                │
└───────────────────────────┬─────────────────────────────────┘
                            │ deposit() / requestWithdrawal()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    DepositPool-v2.sol                       │
│  - Accepts QRL deposits, mints stQRL shares                 │
│  - Manages withdrawal queue (128-block delay)               │
│  - Trustless reward sync via balance checking               │
│  - Funds validators via beacon deposit contract             │
└───────────────────────────┬─────────────────────────────────┘
                            │ mintShares() / burnShares()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      stQRL-v2.sol                           │
│  - Fixed-balance QRC-20 token (shares-based)                │
│  - balanceOf() = shares (stable, tax-friendly)              │
│  - getQRLValue() = QRL equivalent (grows with rewards)      │
│  - Virtual shares prevent first-depositor attacks           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  ValidatorManager.sol                       │
│  - Tracks validator lifecycle (Pending → Active → Exited)   │
│  - Stores Dilithium pubkeys (2592 bytes)                    │
│  - MVP: single trusted operator model                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               QRL Beacon Deposit Contract                  │
│  - 40,000 QRL per validator                                 │
│  - Withdrawal credentials → DepositPool                     │
└─────────────────────────────────────────────────────────────┘
```

## Core Contracts

### stQRL-v2.sol - Liquid Staking Token

**Fixed-balance model** where `balanceOf()` returns shares (stable) and `getQRLValue()` returns QRL equivalent (fluctuates with rewards/slashing).

| Function | Returns | Changes When |
|----------|---------|--------------|
| `balanceOf(user)` | Shares | Only on deposit/withdraw/transfer |
| `getQRLValue(user)` | QRL equivalent | Rewards accrue or slashing occurs |
| `getExchangeRate()` | QRL per share (1e18 scaled) | Rewards/slashing |

**Key Features:**
- Virtual shares/assets (1e3) prevent first-depositor inflation attacks
- All QRC-20 operations work with shares, not QRL amounts
- Tax-friendly: balance only changes on explicit user actions

**Example:**
```
1. User deposits 100 QRL when pool has 1000 QRL / 1000 shares
2. User receives 100 shares, balanceOf() = 100
3. Validators earn 50 QRL rewards (pool now 1050 QRL)
4. User's balanceOf() still = 100 shares (unchanged)
5. User's getQRLValue() = 100 × 1050 / 1000 = 105 QRL
```

### DepositPool-v2.sol - User Entry Point

Handles deposits, withdrawals, and reward synchronization.

**Deposit Flow:**
1. User calls `deposit()` with QRL
2. Contract reconciles the balance that existed before `msg.value` arrived
3. Shares calculated at current exchange rate
4. `stQRL.mintShares()` called, shares minted to user
5. `totalPooledQRL` updated

**Withdrawal Flow:**
1. User calls `requestWithdrawal(shares)`
2. Shares lock and the contract returns an informational QRL estimate
3. Request queued with 128-block delay (~2 hours)
4. The owner earmarks liquid QRL in `withdrawalReserve`; those assets remain in
   `totalPooledQRL` while the queued shares remain in total supply
5. User calls `claimWithdrawal()` after the delay and settled accounting
6. The contract calculates the current QRL value, then atomically burns shares,
   reduces `totalPooledQRL`, reduces the reserve, and transfers QRL
7. If a funded request is cancelled or needs less QRL after settlement, the
   owner releases the unused earmark with `releaseWithdrawalReserve(amount)`

Queued shares continue receiving rewards and bearing slashing losses until they
are burned. Reserve funding cannot change the exchange rate because the assets
and their corresponding shares leave the conversion totals together at claim.

**Trustless Reward Sync:**
- No oracle needed for reward detection
- `_syncRewards()` reconciles `address(this).balance + stakedQRL` against `totalPooledQRL`
- `withdrawalReserve` is a liquid subset of `totalPooledQRL`, not an additional
  liability outside pooled accounting
- Balance increase = rewards, decrease = slashing
- EIP-4895 withdrawals automatically credit the contract
- `stakedQRL` tracks principal forwarded to the beacon deposit contract by the
  real `fundValidator()` path, so the outgoing 40k stake is not misread as a
  slashing event. When exit proceeds return, the owner calls
  `recordValidatorExit(amount)` to settle that principal back into the
  on-contract balance. Observed returned principal refills `bufferedQRL`, capped
  at the nominal stake retired, so a slashed exit cannot create unsupported
  validator-funding credit and unused exit proceeds can be staked again.
- Permissionless while all principal is on-contract (`stakedQRL == 0`): anyone
  may call `syncRewards()`. Once principal is staked off-contract
  (`stakedQRL > 0`), reward sync - including the implicit sync inside
  `requestWithdrawal`/`claimWithdrawal` - is restricted to the owner. This
  closes a front-running window: an exit sweep lands principal in the balance a
  block before the owner can `recordValidatorExit()`, and an unrestricted sync
  in that window would book the principal as a phantom reward and spike the
  rate. Claims with unsettled on-chain deltas revert. With sync owner-gated
  during that window, settlement and reward recognition are sequenced by the
  operator and cannot be front-run.

> **Known limitation (production):** the balance-diff sync is fully trustless
> only while staked QRL sits in the contract (`fundValidatorMVP`). Once
> `fundValidator()` moves principal off-contract, reward sync becomes
> owner-driven (see above) and cannot observe a *live* validator's accruing
> beacon balance, inactivity leak, or slashing until those amounts are swept
> on-chain via EIP-4895 - and the principal/reward split on return depends on
> the owner calling `recordValidatorExit()`. A fully self-custodial production
> reward mechanism over live beacon balances will require either periodic
> beacon-state input or an automated exit-settlement path. This is acceptable
> for the MVP/testnet trust model (single trusted operator) but must be
> hardened before mainnet.

**Key Parameters:**
- `WITHDRAWAL_DELAY`: 128 blocks (~2 hours on QRL v2 testnet at ~60s/block, verified)
- `minDeposit`: 100 QRL default (configurable by owner, down to `ABSOLUTE_MIN_DEPOSIT = 0.001 QRL`)
- `VALIDATOR_STAKE`: 40,000 QRL

### ValidatorManager.sol - Validator Lifecycle

Tracks validators through their lifecycle:

```
None → Pending → Active → Exiting → Exited
                    ↓
                 Slashed
```

**State Transitions:**
- `registerValidator(pubkey)` → Pending
- `activateValidator(id)` → Active (confirmed on beacon chain)
- `requestValidatorExit(id)` → Exiting
- `markValidatorExited(id)` → Exited
- `markValidatorSlashed(id)` → Slashed (from Active or Exiting)

**Access Control:**
- Owner can perform all operations (trusted operator MVP)
- DepositPool can register validators

## Security Model

### Access Control

| Contract | Role | Capabilities |
|----------|------|--------------|
| stQRL | Owner | Set depositPool (once), pause/unpause |
| stQRL | DepositPool | Mint/burn shares, update totalPooledQRL |
| DepositPool | Owner | Pause, set parameters, emergency withdraw excess |
| ValidatorManager | Owner | All validator state transitions |

### Attack Mitigations

| Attack | Mitigation |
|--------|------------|
| First depositor inflation | Virtual shares/assets (1e3 offset) |
| Reentrancy | CEI pattern, no external calls before state changes |
| Withdrawal front-running | 128-block delay, FIFO queue |
| Reserve-funded share dilution | Reserve and queued shares remain in the rate until atomic claim settlement |
| Unsynced reward capture | Deposits reconcile pre-deposit assets before minting |
| Reserved QRL sent to validators | Funding requires both buffer and liquid balance net of reserve |
| Withdrawal slashing evasion | Claims use the settled share value rather than the request estimate |
| Emergency fund drain | emergencyWithdraw limited to excess balance only |

### Slashing Protection

When slashing occurs:
1. `_syncRewards()` detects balance decrease
2. `totalPooledQRL` reduced proportionally
3. All stQRL holders share the loss via reduced `getQRLValue()`
4. Share balances unchanged (loss is implicit)

## QRL-Specific Adaptations

| Parameter | Ethereum | QRL |
|-----------|----------|----------|
| Validator stake | 32 ETH | 40,000 QRL |
| Block time | ~12s | ~60s |
| Signature scheme | ECDSA | Dilithium (ML-DSA-87) |
| Pubkey size | 48 bytes | 2,592 bytes |
| Signature size | 96 bytes | 4,627 bytes |

## Test Coverage

**Unit (Foundry, `contracts/test/`):** 226 tests, all green.
- `stQRL-v2.t.sol`: 68 tests (shares, conversions, rewards, slashing, minimum stake lock)
- `DepositPool-v2.t.sol`: 103 tests (deposits, withdrawals, reserve invariants, sync, off-contract stake accounting, front-run protection, access control)
- `ValidatorManager.t.sol`: 55 tests (lifecycle, slashing, batch operations)

**Integration (live testnet, `scripts/integration-test-v2.js`):** 16 phases, all verified against the deployed contracts on chainId 1337. Covers deposit/mint, reward sync via EIP-4895-style balance donation, withdrawal request → 128-block delay → reserve funding → claim, pause/unpause, revert paths, validator lifecycle, QRC-20 allowance, batch activation, cancel. See `docs/V2-DEPLOYMENT-STATUS.md` for the phase matrix and current live state.

## Deployment Checklist

Automated by `node scripts/deploy-hyperion.js` in a single run. For reference, the sequence it performs:

The deploy script refuses to submit transactions unless the connected chain matches the configured
`chainId` and `HYPERION_DEPLOY_CONFIRM` exactly matches
`DEPLOY:<chainId>:<deployer address>:<deployment fingerprint>`. The fingerprint binds the provider,
chain, deployer, existing addresses, confirmation depth, pending starting nonce, predicted CREATE
addresses, ABIs, and the exact in-memory bytecode snapshot used for deployment. Replacing non-empty
contract addresses also requires `HYPERION_REPLACE_EXISTING=true`. Set these values only after
checking the printed provider endpoint, chain, deployer, nonce, predicted addresses, fingerprint,
and existing deployment. A chain-and-deployer lock serializes local runs. The script rechecks both
the pending nonce and the original config digest before its first transaction, uses explicit
consecutive nonces, and rejects any deployed address that differs from the confirmed prediction.
Before updating the address config, it waits for the final nonce-ordered wiring transaction to reach
the configured `txConfirmations` depth, verifies that its receipt remains in the same canonical
block, verifies all links, owners, and paused states, and rechecks the config digest. Persistence uses
a randomized exclusive temporary file, file and directory syncs, and an atomic rename.

1. Deploy `stQRLv2` (no constructor args)
2. Deploy `DepositPoolV2` (no constructor args; sets `minDeposit = 100 QRL`, `lastSyncBlock = block.number`)
3. Deploy `ValidatorManager` (no constructor args)
4. Pause `DepositPoolV2` and `stQRLv2` before wiring enables deposits
5. `pool.setStQRL(stQRL)` (**one-shot, irreversible**)
6. `stQRL.setDepositPool(pool)` (**one-shot, irreversible**)
7. `vm.setDepositPool(pool)` (reversible by owner)
8. Wait for confirmation depth, then verify all links, owners, and paused states
9. Transfer ownership to multisig (optional for mainnet)

Fresh deployments remain paused until a separate operator action completes read-only verification,
seed-liquidity planning, and address publication.

The two one-shot steps mean that wiring to the wrong address requires full redeploy. `deploy-hyperion.js` deploys in one tx each and wires immediately afterward using the contract instances returned by `.deploy().send()` (the wallet is pre-bound on those; see `contracts/hyperion/README.md` for the `@theqrl/web3` wallet-binding notes).

## Future Improvements

- [ ] Multi-operator support (permissionless registration)
- [ ] Two-step ownership transfer pattern
- [ ] Pagination for `getValidatorsByStatus()`
- [ ] On-chain integration between DepositPool and ValidatorManager
