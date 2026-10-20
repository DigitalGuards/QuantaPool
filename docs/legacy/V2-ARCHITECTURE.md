# Archived v2 testnet architecture

Retired on 2026-09-15. This is the previous token architecture. Its operator reporting, token accounting, release plans and suggested upstream changes are historical. Current work follows the [native-QRL architecture](../architecture.md) against unmodified QRL.

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
│                    DepositPool-v2.hyp                       │
│  - Accepts QRL deposits, mints stQRL shares                 │
│  - Manages withdrawal queue (128-block delay)               │
│  - Permissionless normal-state reward sync                  │
│  - Atomic validator registration and beacon funding         │
│  - Fixed performance fee settled after complete cohort exit │
└───────────────────────────┬─────────────────────────────────┘
                            │ mintShares() / burnShares()
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      stQRL-v2.hyp                           │
│  - Fixed-balance QRC-20 token (shares-based)                │
│  - balanceOf() = shares (stable, tax-friendly)              │
│  - getQRLValue() = QRL equivalent (grows with rewards)      │
│  - Virtual shares prevent first-depositor attacks           │
│  - Mints dilution-priced protocol fee shares                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  ValidatorManager.hyp                       │
│  - Tracks canonical validator identity and principal         │
│  - Stores Dilithium pubkeys (2592 bytes)                    │
│  - Immutable DepositPool authority                          │
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

### stQRL-v2.hyp - Liquid Staking Token

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
1. The pool has 1000 QRL / 1000 shares; a user owns 100 shares
2. Validators earn gross rewards and the protocol fee settles as shares
3. The user's balanceOf() remains 100 shares
4. The user's getQRLValue() rises at the final fee-adjusted exchange rate
```

### DepositPool-v2.hyp - User Entry Point

Handles deposits, withdrawals, and reward synchronization.

**Deposit Flow:**
1. User calls `deposit()` with QRL while no validator principal is outstanding
2. Contract rejects the deposit if any principal record remains outstanding
3. Contract reconciles the balance that existed before `msg.value` arrived
4. Shares calculated at current exchange rate
5. `stQRL.mintShares()` called, shares minted to user
6. `totalPooledQRL` updated

**Withdrawal Flow:**
1. User calls `requestWithdrawal(shares)`
2. Shares lock and the contract returns an informational QRL estimate
3. Request queued with 128-block delay (~2 hours)
4. With zero outstanding principal, the owner earmarks liquid QRL in
   `withdrawalReserve`; those assets remain in `totalPooledQRL` while the queued
   shares remain in total supply
5. User calls `claimWithdrawal()` after the delay, after every validator
   principal record is retired, and after complete accounting settlement
6. The contract calculates the current QRL value, then atomically burns shares,
   reduces `totalPooledQRL`, reduces the reserve, and transfers QRL
7. If newly synchronized rewards increase the payout above an exact earmark,
   the claim may consume only the liquid unbuffered increase. Deposit-origin
   validator buffer remains unavailable to the claim.
8. If a funded request is cancelled or needs less QRL after settlement, the
   owner releases the unused earmark with `releaseWithdrawalReserve(amount)`

Queued shares continue receiving rewards and bearing slashing losses until they
are burned. Reserve funding cannot change the exchange rate because the assets
and their corresponding shares leave the conversion totals together at claim.

**Normal-State Reward Sync:**
- Ordinary liquid balance gains need no reward oracle while no validator principal is outstanding
- `_syncRewards()` reconciles `address(this).balance + stakedQRL()` against `totalPooledQRL`
- `withdrawalReserve` is a liquid subset of `totalPooledQRL`, not an additional
  liability outside pooled accounting
- Balance increases from partial withdrawals or direct transfers are pooled gains
- EIP-4895 withdrawals automatically credit the contract
- `ValidatorManager.totalPrincipalOutstanding()` is the single source for
  `stakedQRL()`. Funding registers the pubkey and root, records 40,000 QRL of
  principal, and calls the beacon deposit contract in one transaction.
- `syncRewards()` remains permissionless only when no principal is outstanding.
- While any principal is outstanding, deposits and claims remain closed even
  when the observable accounting equation is equal. Equality cannot prove that
  an unannounced zero-return loss or correlated validator return did not occur.
- The owner uses
  `recognizeValidatorRewards(amount, finalizedCheckpointSlot, evidenceRoot)`
  after checking every outstanding validator in finalized Qrysm state. It
  recognizes only the supplied amount, leaves later or larger balance credit
  unclassified, and rejects reused or nonmonotonic evidence.

**Protocol Performance Fee:**
- The fee is fixed at 1,000 basis points, or one tenth of fee-eligible
  validator rewards. Deposits, withdrawals, and zero-principal donations have
  no fee.
- The first validator funding transaction opens a fee epoch. User share supply
  remains fixed while validator principal is outstanding.
- Finalized-evidence reward recognition accumulates the maximum fee base. A fee
  cannot mint while any principal remains outstanding.
- The last terminal settlement schedules fee finalization and retains missing
  principal as a temporary receivable. A later finalized Qrysm checkpoint
  reconciles late principal and explicitly classified late rewards before the
  epoch closes.
- Finalization caps eligible rewards by the complete epoch's net asset gain.
  Prior epoch losses must be recovered before a later fee accrues.
- The fee is issued as stQRL shares to an immutable QIP-55 recipient. QRL stays
  in the pool, so fee shares bear future slashing and use the normal withdrawal
  queue.
- Dilution pricing uses the post-mint equation with the token's virtual offsets:
  `feeShares = floor(feeAssets * (shares + 1000) / (pooled + 1000 - feeAssets))`.
  Integer reward and share dust carries forward to a later profitable epoch.
- Each close checkpoints the live loss and fee carries against post-fee-mint
  supply. Closed-epoch burns recompute carry only at a new historical supply
  minimum. Temporary deposit-and-burn cycles cannot amplify or wash the
  checkpoint, and split burns produce the same result.
- Fungible pool-level accounting cannot identify replacement capital while
  aggregate supply stays above its historical minimum. That case can extend an
  existing loss shelter and conservatively undercollect fees. Exact cohort
  attribution requires per-share or per-account equalization in a later token
  design.
- Current finalized Qrysm evidence is operator checked metadata. The whole-epoch
  gain cap protects pooled principal from fee extraction, while complete
  trustless reward classification depends on the terminal receipt proposal in
  `docs/TERMINAL-WITHDRAWAL-RECEIPTS.md`.
- A finalized close-window surplus is only an upper bound because a donation is
  observationally identical to reward at the contract address. Standard tooling
  finalizes that residual as fee-exempt. Exact pre-settlement recognition remains
  chargeable, and a future authenticated receipt can safely classify the late
  remainder.
- The finalized execution balance is a minimum for the close transaction.
  Positive receipt-time drift is synchronized as fee-exempt, preventing a
  permissionless donation from repeatedly reverting finalization. A balance
  below the finalized floor still fails closed.

**Serialized Exit Settlement:**
1. `beginValidatorExit(id)` checkpoints the pool balance and moves the funded
   validator from Active to Exiting atomically. Unclassified inflow cannot block
   this lifecycle transition.
2. Deposits and claims stay closed while any principal remains outstanding.
   Explicit exits also close permissionless reward sync, validator funding,
   and reserve funding. Bounded finalized-evidence reward recognition remains
   available until terminal settlement. Withdrawal requests, cancellations,
   and token transfers remain available.
3. After one finalized Qrysm view identifies every validator that is fully
   withdrawn, `settleValidatorExits(ids)` retires their fixed principal, credits
   observed returned liquidity to the buffer, and finalizes every manager status
   in one transaction. Missing return remains a temporary pooled receivable.
4. After the final principal record retires, accounting-changing entry points
   remain locked. A newer finalized Qrysm checkpoint and its canonical execution
   payload bind the later `finalizeProtocolFeeEpoch(...)` call. This call
   reconciles late principal, recognizes only the supplied bounded late reward,
   writes off any remaining receivable once, synchronizes the final pooled value,
   and mints the exact dilution-priced fee shares.
5. Accounting and share-supply changing entry points stay closed through the
   finalization block. This gives receipt-block RPC reads a stable close state;
   the entry points reopen in the next block. Supply-neutral withdrawal requests,
   cancellations, transfers, and direct positive inflow remain available.
6. If the voluntary-exit submission was not accepted and Qrysm still reports
   the validator active, `cancelValidatorExit(id)` restores Active state and
   clears the checkpoint. Any accumulated balance delta remains quarantined for
   a separate bounded reward-recognition transaction.
7. If Qrysm reveals one or more terminal withdrawals after their returns have
   already reached the pool, the same batch function provides an owner-only
   accounting recovery path that retires all identified principal before
   repricing shares.
8. Exact principal return produces no rate change. Surplus becomes reward and
   a shortfall becomes a slashing loss.

> **Consensus-proof limitation:** execution withdrawals do not currently commit
> whether a withdrawal is partial or terminal. The operator tooling verifies
> exact Qrysm state before reward recognition, cancellation, and settlement,
> but the contract cannot verify that REST evidence. Positive unannounced
> returns remain quarantined unless the trusted owner misclassifies them. A
> zero-return terminal loss creates no execution-balance delta and remains
> invisible until principal is retired. The contract therefore defers every
> share-priced deposit and claim until all principal is retired. A finalized
> withdrawal-receipt precompile, system accumulator, or equivalent QRL protocol
> primitive is required to restore safe continuous liquid-staking flows.
> Until that primitive exists, the owner remains a lifecycle oracle and can
> retire a live Active validator through the recovery path. A compromised or
> mistaken owner can reopen pricing against an invalid principal ledger.

The fail-closed boundary has a deliberate availability cost. One Pending or
otherwise nonterminal validator keeps deposits, claims, reserve funding, and
emergency recovery closed for the complete cohort lifetime. `getQRLValue()` can
also remain provisional during partial settlement, so external protocols must
not treat it as finalized while principal is outstanding.

**Key Parameters:**
- `WITHDRAWAL_DELAY`: 128 blocks (~2 hours on QRL v2 testnet at ~60s/block, verified)
- `minDeposit`: 100 QRL default (configurable by owner, down to `ABSOLUTE_MIN_DEPOSIT = 0.001 QRL`)
- `VALIDATOR_STAKE`: 40,000 QRL
- `PROTOCOL_FEE_BPS`: 1,000 (10% of fee-eligible validator rewards)
- `protocolFeeRecipient`: immutable full QIP-55 address selected at deployment

### ValidatorManager.hyp - Validator Lifecycle

Tracks validators through their lifecycle:

```
None → Pending → Active → Exiting → Exited
                    ↓
                 Slashed
```

**State Transitions:**
- `DepositPool.fundValidator(...)` → manager Pending with 40,000 QRL outstanding
- `DepositPool.reportValidatorActive(id)` → Active (operator report gated on Qrysm)
- `DepositPool.beginValidatorExit(id)` → Exiting
- `DepositPool.cancelValidatorExit(id)` → Active when Qrysm still reports active
- `DepositPool.reportValidatorSlashed(id)` → Slashed with principal still outstanding
- `DepositPool.settleValidatorExits(ids)` → all identified terminal principal retired and statuses finalized atomically
- `DepositPool.finalizeProtocolFeeEpoch(...)` → late principal reconciled, remaining loss synchronized, and exact fee shares minted from fresh finalized evidence

**Access Control:**
- ValidatorManager has one immutable DepositPool authority
- Direct registration and lifecycle mutation on ValidatorManager always revert
- DepositPool owner submits operational lifecycle reports

## Security Model

### Access Control

| Contract | Role | Capabilities |
|----------|------|--------------|
| stQRL | Owner | Set depositPool (once), pause/unpause |
| stQRL | DepositPool | Mint/burn user shares, mint protocol fee shares, update totalPooledQRL |
| DepositPool | Owner | Pause, set parameters, fund validators, submit lifecycle reports |
| ValidatorManager | DepositPool | Register funded identities, transition status, retire principal |

### Attack Mitigations

| Attack | Mitigation |
|--------|------------|
| First depositor inflation | Virtual shares/assets (1e3 offset) |
| Reentrancy | CEI pattern, no external calls before state changes |
| Withdrawal front-running | 128-block delay, FIFO queue |
| Reserve-funded share dilution | Reserve and queued shares remain in the rate until atomic claim settlement |
| Unsynced reward capture | Deposits reconcile pre-deposit assets before minting |
| Forced balance donation while principal is outstanding | Deposits and claims stay closed until all principal is retired and accounting is settled |
| Reward growth above an exact claim reserve | Claim consumes only the synchronized unbuffered liquid increase |
| Reserved QRL sent to validators | Funding requires both buffer and liquid balance net of reserve |
| Withdrawal slashing evasion | Claims use the settled share value rather than the request estimate |
| Duplicate validator deposit | Pool-bound manager rejects duplicate pubkeys and deposit roots before value transfer |
| Exit principal booked as reward | Bounded recognition quarantines extra credit; priced flows remain closed until every principal record is retired |
| Fee charged against principal | Fee waits for later finalized zero-principal accounting and is capped by complete epoch net gain |
| Late principal counted as loss and reward | Retired principal remains a temporary receivable until later finalized fee-epoch closure |
| Fee charged before loss recovery | Persistent loss carryforward absorbs later eligible rewards first |
| Fee recipient callback or native transfer | Fee is minted as pool-backed shares to one immutable recipient |
| Reward evidence replay | Unique state-root evidence and strictly increasing finalized slots |
| Donation front-runs delayed finalization | Finalized balance is a floor; positive drift is synchronized fee-exempt and exact postconditions are checked at the receipt block |
| Deposit or claim follows finalization in the same block | One-block accounting cooldown preserves the exact receipt-block supply and carry checkpoint |
| Failed voluntary-exit submission | Qrysm-gated cancellation restores Active state and reopens synchronization |
| Emergency fund drain | emergencyWithdraw limited to excess balance only |

### Slashing Protection

When a terminal return is below the validator's fixed principal:
1. `settleValidatorExits(ids)` retires exactly the included principal and records any missing return as a temporary receivable
2. Later finalized epoch closure writes off only the unrecovered receivable and reduces `totalPooledQRL`
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

## Validation Coverage

**Current Hyperion validation:**
- `contracts/hyperion/*.hyp` are the canonical contract sources.
- `npm run compile:hyperion` compiles those sources directly with reviewed optimized via-IR `hypc` settings and writes ABI, bytecode, and manifest artifacts under `build/hyperion/`. The build rejects production artifacts that exceed go-qrl's 24,576-byte runtime limit.
- `npm test` verifies the artifact manifest and production ABI, executes the targeted release-blocker suite through pinned Hyperion and qrvmone binaries with default and optimized code generation, parses the broader retained `.t.hyp` specifications, and runs the executable Node tooling tests.
- The native suite covers unequal small stakers, atomic real funding rollback, exact-reserve reward growth, canonical validator identity, cancellation, correlated batch returns, reward and slashing algebra, zero-return loss, pre-arrived recovery, and replay guards.
- The broader `contracts/test/hyperion/*.t.hyp` unit and fuzz files are historical pre-v2.4 archives, include retired API cases, and remain parse-only evidence.

**Historical pre-removal evidence:** the former Solidity and Foundry suite was observed passing 226 tests before the `.sol` contracts and `.t.sol` tests were removed:
- `stQRL-v2.t.sol`: 68 tests (shares, conversions, rewards, slashing, minimum stake lock)
- `DepositPool-v2.t.sol`: 103 tests (deposits, withdrawals, reserve invariants, sync, off-contract stake accounting, front-run protection, access control)
- `ValidatorManager.t.sol`: 55 tests (lifecycle, slashing, batch operations)

The 226-test result is historical evidence about the pre-removal tree. It is not a current executable result for the canonical `.hyp` sources.

**Integration (live testnet, `scripts/integration-test-v2.js`):** 16 phases, all verified against the deployed contracts on chainId 1337. Covers deposit/mint, reward sync via EIP-4895-style balance donation, withdrawal request → 128-block delay → reserve funding → claim, pause/unpause, revert paths, validator lifecycle, QRC-20 allowance, batch activation, cancel. See `docs/V2-DEPLOYMENT-STATUS.md` for the phase matrix and current live state.

## Deployment Checklist

Automated by `node scripts/deploy-hyperion.js` in a single run. For reference, the sequence it performs:

The deploy script refuses to submit transactions unless the connected chain matches the configured
`chainId` and `HYPERION_DEPLOY_CONFIRM` exactly matches
`DEPLOY:<chainId>:<deployer address>:<deployment fingerprint>`. The fingerprint binds the provider,
chain, deployer, existing addresses, confirmation depth, pending starting nonce, predicted CREATE
addresses, the immutable protocol fee recipient, ABIs, and the exact in-memory bytecode snapshot used for deployment. Replacing non-empty
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
2. Deploy `DepositPoolV2(depositContract, predictedValidatorManager, protocolFeeRecipient)`
3. Deploy `ValidatorManager(predictedDepositPool)`
4. Pause `DepositPoolV2` and `stQRLv2` before wiring enables deposits
5. `pool.setStQRL(stQRL)` (**one-shot, irreversible**)
6. `stQRL.setDepositPool(pool)` (**one-shot, irreversible**)
7. Wait for confirmation depth, then verify immutable reciprocal links, fee recipient, owners, and paused states
8. Transfer DepositPool and stQRL ownership to multisig (optional for mainnet)

Fresh deployments remain paused until a separate operator action completes read-only verification,
seed-liquidity planning, and address publication.

The two one-shot steps mean that wiring to the wrong address requires full redeploy. `deploy-hyperion.js` deploys in one tx each and wires immediately afterward using the contract instances returned by `.deploy().send()` (the wallet is pre-bound on those; see `contracts/hyperion/README.md` for the `@theqrl/web3` wallet-binding notes).

## Future Improvements

- [ ] Multi-operator support (permissionless registration)
- [ ] Two-step ownership transfer pattern
- [ ] Pagination for `getValidatorsByStatus()`
- [x] Atomic on-chain integration between DepositPool and ValidatorManager
- [ ] Verifiable consensus lifecycle and terminal-withdrawal receipt primitive specified in `docs/TERMINAL-WITHDRAWAL-RECEIPTS.md`
