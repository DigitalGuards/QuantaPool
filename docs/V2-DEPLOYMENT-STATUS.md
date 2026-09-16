# Abandoned QuantaPool v2 testnet experiments

**Retired as development targets:** 2026-09-15. These were public-testnet experiments. The native-QRL redesign uses a clean deployment and requires no migration, recovery, address compatibility or storage-layout compatibility with these contracts. See [testnet retirement](TESTNET-RETIREMENT.md) and the [current native architecture](architecture.md).

The observations below are historical. They are not a current RPC verification, launch instruction or recovery work order. All earlier v2 release and migration prerequisites are superseded for the native redesign. No on-chain state is changed by retirement.

**Historical record last updated:** 2026-08-28
**Branch:** `dev`
**Network:** QRL v2 testnet, chainId `1337`
**Deployment revision:** v2.3 security and accounting hardening

---

## Historical local v2.4 candidate - uncommitted and loopback-only

The canonical Hyperion sources currently contain local release-blocker work that
has not been staged, committed, pushed, or deployed to a public network. Local
validation uses disposable contracts on chain ID `3151911` inside an existing
loopback Kurtosis enclave. The addresses below remain historical v2.3 and v2.2
deployments.

The local v2.4 candidate:

- Makes ValidatorManager an immutable, pool-only identity and principal ledger.
- Registers each real beacon deposit atomically with a canonical 1-based ID and
  rejects duplicate pubkeys or deposit roots before value transfer.
- Removes `fundValidatorMVP()` and the separate `recordValidatorExit(amount)` path
  from production bytecode.
- Keeps reward sync permissionless only while no validator principal is
  outstanding. Every deposit and claim stays closed while any principal record
  remains, including when observable accounting appears equal. Validator-epoch
  rewards use exact bounded owner recognition, including during a serialized
  exit before terminal settlement.
- Starts one planned validator exit through `beginValidatorExit(id)` and settles
  every Qrysm-confirmed terminal validator through `settleValidatorExits(ids)`.
  Fixed-principal retirement, observed buffer refill, and Manager finalization
  share one transaction. A later finalized checkpoint completes reward or loss
  recognition and protocol fee crystallization.
- Allows a Qrysm-confirmed zero-return settlement, cancellation of an exit that
  Qrysm still reports active, and recovery when a terminal return arrived before
  the begin checkpoint. Cancellation leaves accumulated balance changes
  unclassified for a separate bounded recognition step.
- Lets a claim whose value grew after reserve funding consume only synchronized
  unbuffered liquid rewards, preserving deposit-origin validator liquidity.
- Pins the locally reviewed Hyperion and qrvmone toolchain identities. Hyperion
  remains pre-release software with no tagged stable compiler distribution.
- Uses the latest QRL-specific Hyperion branch head (`6f862206`) plus a local,
  uncommitted generated-getter fix that stores each mapping key using its actual
  type. The focused wide-key semantic case passes default and optimized legacy
  plus via-IR codegen. The compiler's 5,528 nonsemantic cases and 39,549
  assertions also pass without changing unrelated gas snapshots.
- Avoids legacy Hyperion's unsafe generated mapping getters for Q128 address and
  `bytes32` keys. The affected mappings are private and expose explicit typed
  accessors, with default and optimized legacy-codegen regressions plus ABI
  gates that forbid the unsafe generated getter names.
- Adds a fixed 10% performance fee on finalized-evidence validator rewards.
  The fee crystallizes as dilution-priced stQRL shares only after the complete
  validator cohort settles and a later finalized accounting pass reconciles
  late principal and reward credit. It is capped by whole-epoch net gain and
  recovers prior epoch losses first. The immutable QIP-55 fee recipient is bound
  into the deployment fingerprint and verified before config persistence.

Pre-audit loopback evidence on the accessor-safe candidate includes eight
distinct Q128 stakers with uneven deposits totaling exactly 40,000 QRL. Every
preview matched its mint, aggregate assets, buffer, and supply matched exactly,
and one real validator funding transaction moved the full 40,000 QRL to the
beacon deposit contract while registering canonical manager ID 1 atomically.
Two additional full Q128 accounts exercised the live withdrawal storage boundary
with the same request ID. One 50-share request was cancelled while the other
remained pending, proving per-address isolation. The pending request then passed
the 128-block delay, consumed an exactly funded 50 QRL reserve, burned exactly 50
shares, advanced only its own FIFO index, and left pooled assets and share supply
equal at 40,150 QRL.

The real validator entered `active_ongoing` at epoch 737. A 1.774859636 QRL
consensus reward reached the Q128 pool recipient and was recognized by the
earlier active-principal sync path without retiring principal. All eight original
stakers increased by the exact pro-rata share formula; the ten-holder aggregate
differed from total pooled assets by five execution base units from integer
flooring. The planned exit checkpoint transaction was
`0xb3623234c859d4d7c74c0615c58914d6923ebe7d086bc28a7f60985de8eeb1f8`.
Qrysm accepted the matching voluntary exit, assigned exit epoch 759 and
withdrawable epoch 775, then finalized `withdrawal_done` with a zero beacon
balance and an exact 40,000 QRL terminal credit to the pool.

Settlement transaction
`0x42bda88d8f1b5115d7605110ec6caa176779123c7f64ef8d1f9b355d2f047390`
retired the complete principal and restored the complete validator buffer. Final
state is 40,187.477185077 QRL pooled, 40,150 QRL shares, 40,150 QRL buffered,
37.477185077 QRL cumulative rewards, zero cumulative slashing, zero outstanding
principal, and manager counts `total=1, exited=1` with every other status count
zero. The ten holder values reconcile within six execution base units. Tooling
also accounts for go-qrl applying beacon withdrawals after transactions during
block finalization, so a legitimate same-block post-call inflow is reported as
unsynced while outflow and inconsistent accounting still fail closed.

On 2026-08-28, an executable audit regression confirmed that an unannounced
40,000 QRL terminal return could be synchronized as reward and let one equal
staker claim about 60,000 QRL, leaving the other with about 20,000 QRL. Pool
pause did not stop the claim. A second regression identified a partial-settlement
race where validator B can return after a snapshot for terminal validator A;
B's returned balance can mask A's zero-return loss while B principal remains in
the Manager ledger. The local source now blocks claims while paused, keeps every
share-priced deposit and claim closed until all principal is retired, quarantines
balance deltas, and limits owner reward recognition to an explicit amount. These
changes remain uncommitted and undeployed.

The remaining protocol-level limitation is terminal-withdrawal proof. Current
execution withdrawal data does not identify a withdrawal as partial or full, so
the owner tooling must verify exact Qrysm state before reward recognition,
cancellation, or settlement. A positive unannounced return stays quarantined. A
zero-return terminal loss creates no execution-balance delta and remains
invisible until principal retirement. The contract-local safety boundary closes
deposits and claims for the entire outstanding-principal interval. A finalized
withdrawal receipt primitive is required to restore continuous deposits and
withdrawals without trusting lifecycle reports.

The fail-closed contract-local mitigation creates a High availability tradeoff:
one Pending or otherwise nonterminal validator keeps deposits, claims, reserve
funding, and emergency recovery closed for the whole cohort lifetime. Partial
settlement can leave `getQRLValue()` provisional for secondary-market consumers.
The owner also remains a lifecycle oracle; a compromised or mistaken owner can
retire live Active IDs through the recovery path and reopen pricing against an
invalid principal ledger. Finalized-state tooling reduces operator error but is
not an on-chain proof.

The narrow protocol interface identified by the current Qrysm, go-qrl, QRVM,
and Hyperion source audit is a fork-versioned execution withdrawal receipt. It
must commit the withdrawal index, validator index, full Q128 recipient, amount,
validator public-key root, and a consensus-derived terminal flag. go-qrl can
write each canonical receipt to a fixed withdrawal inbox in the same state
transition that credits the recipient. QuantaPool can then verify recipient and
validator identity, distinguish partial rewards from terminal principal, and
consume each receipt exactly once. The current execution withdrawal tuple omits
the terminal flag and validator identity commitment. A block-header plus
withdrawal-trie proof can authenticate amount and recipient within the blockhash
window, but it cannot fill either missing fact. The local contract now
quarantines unexplained balance changes while principal is outstanding. Fully
trustless production safety still requires this interface or an equivalent
authenticated beacon-state path.

The proposed fork interface, zero-balance terminal rule, consensus-written
receipt inbox, cross-client invariants, and activation gates are specified in
`docs/TERMINAL-WITHDRAWAL-RECEIPTS.md`. This is design evidence only and is not
implemented or deployed.

---

## Current deployment on QRL v2 testnet (v2.3)

| Contract | Address |
|----------|---------|
| **stQRLv2** | `Q7d4cA4872502a1ab02bCA855C093449aaE2bee58` |
| **DepositPoolV2** | `Q8e01Ea0bC7e337806154573A5B46Bb37F50Ea8fC` |
| **ValidatorManager** | `Qd84648a8F7314652B3E98D346645415eA03cce5f` |

The nonce-bound deployment completed on 2026-08-03 from the reviewed `dev` artifacts. All three contracts have deployed runtime bytecode matching those artifacts, the three one-shot links are correct, and the deployer is the sole owner. The token and pool are paused with zero supply, zero pooled QRL, zero staked QRL, and no validators. Keep them paused until migration and beacon-settlement procedures are independently validated.

The deployment required eight transactions: three contract creations, two immediate pause calls, and three one-shot wiring calls. `config/testnet-hyperion.json` is updated only after 12 confirmations and final ownership, link, bytecode, and paused-state checks.

The deployed v2.3 contracts predate the local performance-fee work and charge
no protocol fee. Enabling the 10% fee requires a new reviewed deployment with
an explicit QIP-55 fee recipient. No current address is upgraded in place.

One earlier stQRL creation at `Qd7D63e681aF8aae122366Ee537943078ED47E63E` is abandoned after the hosted RPC proxy rejected the following oversized deployment body. It has zero supply and no deposit-pool authority, so no account can mint through it. It is absent from every active config.

## Historical v2.2 deployment - previously observed paused

| Contract | Address |
|----------|---------|
| **stQRLv2** | `QA2f23388d1e3986416A36d2Ef113850D6900b69C` |
| **DepositPoolV2** | `Q109d7C528a67b80eb638D4C85e7C4545ef9Bb9aC` |
| **ValidatorManager** | `QA5b6e85B7713670589e4eAf2F039380Ec2792c8C` |

The legacy token and pool were emergency-paused on 2026-08-03 and were observed with historical stake and validator state. Do not call `syncRewards`, `requestWithdrawal`, or `claimWithdrawal` on this pool because its missing off-contract stake accounting would record phantom slashing. Earlier recovery plans required independently verifiable beacon exit and reward settlement. Recovery is now separate optional historical work and imposes no prerequisite on the clean native deployment.

**Real validator deposit executed 2026-04-14:**
- Buffer top-up `pool.deposit(40000)` - tx `0x12e2b96b8f4ac2e80b8246a32af92d047dfdf6dcc3416e52a1dce5751c3fc8c6`
- `pool.fundValidator(pubkey, creds, sig, root)` - tx `0x61d6f48c7b17187abc3527577f65e6f100eda4ab50161d382e370321fbbd81c0`
- 40 000 QRL forwarded to beacon deposit contract `Q4242…`
- Local beacon confirmed `beacon_processed_deposits_total = 1`
- Validator `0xa40ca760bcc4…` is in the activation queue (`UNKNOWN_STATUS` → eventually `ACTIVE` after several epochs)

**Scenario 2 - end-to-end test of terraform + ansible + user-driven pool + second validator (2026-04-15):**
- Terraform provisioned 2 VPS (primary + backup). Monitoring module disabled on the new project (reused node #1 monitoring).
- Ansible deployed full stack on both (gqrl + qrysm-beacon + qrysm-validator). Drift fixes landed in commits `251e1db`, `ba18717`.
- Funded 8 throwaway user wallets (mnemonics in `.env.scenario2`, gitignored) via `scripts/fanout-test-wallets.js` - 40100 QRL total.
- 8 `pool.deposit()` calls (`scripts/scenario2-deposit.js`) → buffer 0 → 40092 QRL, shares 1:1 (8 txs, all green). Confirmed **overfund is benign**: 92 QRL sat safely alongside the 40k stake.
- Keystore generated on the primary host via rebuilt `staking-deposit-cli`. Mnemonic + seed persisted to a `0600` file on the host. `verify-deposit-data.js` passed all checks.
- `pool.fundValidator(pubkey, creds, sig, root)` - tx `0x8fe035435c620faac48ea719d386d2b4b4b77741b576ee7b2274d5ad6d6b2b61`. On-chain: `validatorCount: 1 → 2`, `bufferedQRL: 40092 → 92 QRL`.
- Keystore imported, `qrysm-validator.service` active. Validator `0xb86185d4fcf4…` now in `UNKNOWN_STATUS`, same ~24h eth1 voting window ahead as validator #1.

### Earlier deprecated deployments (v2.0 + v2.1) - DO NOT interact

| Rev | Contract | Address | Why orphaned |
|-----|----------|---------|--------------|
| v2.0 | stQRLv2 | `Q09046968aF19E745F4aBa7A9fa5CD946b4E981DB` | wrong withdrawal-credentials prefix (`bytes1(0x01)`) |
| v2.0 | DepositPoolV2 | `Q38F73cb87c60d365fdFA7abF0e534fc1a9D5F9B9` | holds ~120k QRL MVP stake; `fundValidator()` would revert |
| v2.0 | ValidatorManager | `Q1b083D7Dc47212DcBc4595249D9384Fa16cE6FC5` | superseded |
| v2.1 | stQRLv2 | `Qd4EC1BEBdD86A9Aa387295d82d0B3Ef3E84f955e` | wrong `SIGNATURE_LENGTH = 4595` (qrysm enforces 4627) |
| v2.1 | DepositPoolV2 | `QD4B89C98727a9C149fDaCf9DcE46E0E7846BaDC5` | holds ~40k QRL MVP stake; `fundValidator()` would revert |
| v2.1 | ValidatorManager | `Q9a80a082870B6632cF0E71494162BFC2AF53F4d8` | superseded |

Backups of prior configs live at `config/testnet-hyperion.v2.{0,1,2}.json.bak`.

Read-back smoke confirmed:
- `stQRL.owner == pool.owner == vm.owner == deployer`
- `stQRL.depositPool == pool` and `pool.stQRL == stQRL` (one-shot links, irreversible)
- `vm.depositPool == pool`
- `minDeposit = 100 QRL`, `VALIDATOR_STAKE = 40000 QRL`, `DEPOSIT_CONTRACT = Q4242…`
- Both user-facing v2.3 contracts are paused and all counters are zero.

---

## Historical integration phase record (`scripts/integration-test-v2.js`)

This table records mixed historical deployments. The current script keeps safe
generic phases and prints handoffs for real validator funding and Qrysm-gated
lifecycle mutations. Current candidate evidence is stated separately above.

| Phase | What it exercises | Status |
|-------|-------------------|--------|
| `status` | Read-only dump: positions, rewards, pending requests, VM stats | ✓ |
| `smoke` | Deposit 100 QRL → shares minted, totals consistent | ✓ |
| `rewards` | With zero principal, donate 1 QRL + `syncRewards` → rate 1.00 → 1.01 | ✓ |
| `withdraw` | Request 50 shares → locked, `blocksRemaining=128`, canClaim=false | ✓ |
| `validator` | Prints the real QIP-55 funding handoff; placeholder funding is retired | current tooling |
| `errors` | 6 revert paths (below-min, zero, over-balance, one-shot guards, bad pubkey) | ✓ |
| `pause` | `pause()` blocks deposit; `unpause()` restores | ✓ |
| `lifecycle` | Prints the finalized-Qrysm lifecycle handoff | current tooling |
| `claim-prep` | `fundWithdrawalReserve` reclassifies pooled→reserve; claim still blocked on 128-block delay | ✓ (historical v2.2 behavior) |
| `claim` | Actual `claimWithdrawal` after 128-block delay + reserve funded | ✓ (completed end-to-end on v2.0 2026-04-14: 50 shares burned, 50.5 QRL paid out before v2.1 redeploy) |
| `wait-claim` | Polls `getWithdrawalRequest` every 60s, auto-claims when ready | ✓ |
| `cancel` | Create 1-share request → cancel → shares unlock, request zeroed | ✓ |
| `transfer-locked` | `stQRL.transfer(unlocked+1)` reverts; exact-unlocked succeeds | ✓ |
| `batch` | Register 3 validators → `batchActivateValidators` → verify all Active; dup pubkey reverts | ✓ |
| `approve` | `approve` + `transferFrom` (self-spend); infinite-allowance non-decrement | ✓ |
| `all` | Runs every phase sequentially | use with care (adds state each run) |

Historical v2.2 validation: the claim paid the request-time `qrlAmount=50.5` while reserve funding temporarily reduced `currentQRLValue` to 50.436. A later source review found that this reserve carve-out distorted deposits made before the queued shares burned, and the fixed payout let queued holders avoid losses synchronized before claim. The current source retires that behavior: reserve remains inside `totalPooledQRL`, the request value is an estimate, and claim settles at the synchronized share value.

---

## What's blocked / deferred

### 1. ~~`DEPOSIT_CONTRACT = Q4242…` unverified~~ - **verified** (2026-04-14)

Confirmed against `qrysm/config/params/testnet_e2e_config.go:8` and `testdata/e2e_config.yaml:57`. Bytecode is pre-deployed at genesis (`qrysm/runtime/interop/genesis.go`). See `docs/UPSTREAM-FINDINGS.md` for details, including the mainnet address (`Q00000000219ab540356cBB839Cbe05303d7705Fa`).

### 2. ~~Withdrawal-credential prefix byte was wrong~~ - **fixed in v2.1, kept in v2.2**

Qrysm uses `ExecutionAddressWithdrawalPrefixByte = byte(0)` (`mainnet_config.go:74`). The historical Solidity `DepositPool-v2.sol` originally hardcoded `bytes1(0x01)` from Ethereum-spec muscle memory. Any real `staking-deposit-cli` deposit would have reverted with `InvalidWithdrawalCredentials` and stuck the stake. Nine cases covering the fix are retained in `contracts/test/hyperion/DepositPool-v2.t.hyp`. Their earlier Foundry execution is pre-removal historical evidence, not a current Hyperion test-runner result.

### 2b. ~~`SIGNATURE_LENGTH` was wrong~~ - **fixed + redeployed as v2.2 2026-04-14**

The historical Solidity `DepositPool-v2.sol:78` hardcoded `SIGNATURE_LENGTH = 4595`, but qrysm's `crypto/ml_dsa_87/ml_dsa_87t/signature.go` enforces ML-DSA-87 signatures at exactly **4627 bytes**. Any real `fundValidator()` on v2.1 would have reverted with `InvalidSignatureLength` before reaching the beacon contract. The fix changed the constant to 4627 and updated four retained behavioral cases. At that point the former Foundry suite was observed at **187 passing tests**; this is pre-removal historical evidence. The v2.2 live addresses ship the fixed bytecode and have already executed a real `fundValidator()` end-to-end (see "Real validator deposit executed" above).

### 3. ~~Real validator deployment~~ - **done 2026-04-14**
gqrl + qrysm beacon + qrysm validator running under systemd on the validator host. Beacon fully synced, validator key imported and listening for activation. Runbook is maintainer-internal (not in this public repo).

### 4. ~~Monitoring contract-exporter rewrite~~ - **done 2026-04-14**
Rewritten for v2 ABIs. Running under docker-compose on the validator host. After v2.2 redeploy: `pooled=40000 shares=40000 rate=1.0 validators=1`. Discord webhook wired for critical/warning/info receivers; `monitoring/prometheus/rules/*.yml` tuned this session to suppress false positives (`BeaconChainLowPeers` was matching the always-zero `state="Connecting"` bucket; `NetworkInterfaceDown` was firing on the unplugged secondary NIC).

### 5. Slashing path
Forced live slashing is unavailable on the testnet. The current targeted native Hyperion suite executes slashed principal, zero-return loss, and aggregate settlement algebra. The broader retained cases in `contracts/test/hyperion/ValidatorManager.t.hyp` remain parse-only specifications. Current qrysm slashing constants are **placeholders** per the QRL team (Discord, 2026-01-25) - snapshot captured in `docs/UPSTREAM-FINDINGS.md` §4 for later diffing.

### 6. Validator activation observation
Validator `0xa40ca760bcc4…` is in the activation queue. Once it transitions to `ACTIVE`, the validator client will start signing attestations. Need a follow-up integration test that, after activation, polls `validator_statuses{}` and confirms the pool's `_syncRewards()` picks up beacon-chain rewards routed back via the withdrawal address.

### 7. Off-contract stake accounting (`stakedQRL`) - **deployed in paused v2.3**

**Update 2026-08-03:** the fixed bytecode is deployed in v2.3 and remains paused. The legacy v2.2 pool still has the old bytecode and remains paused during migration planning.

The deployed v2.2 `DepositPoolV2` decrements only `bufferedQRL` when `fundValidator()` forwards the 40k stake to the beacon deposit contract; it never adds the off-contract principal back inside `_syncRewards()`. `_syncRewards()` computes `actualTotalPooled = balance − withdrawalReserve`, so the moment a real `fundValidator()` runs, the contract balance is 40k below `totalPooledQRL`. The next `syncRewards()` call (permissionless, and also triggered inside every `requestWithdrawal`/`claimWithdrawal`) emits `SlashingDetected(40000)` and collapses the exchange rate - after which a dust deposit can mint a near-unbounded share count and capture the pool when the stake/rewards return.

**This remains the legacy v2.2 state:** the real `fundValidator()` executed on 2026-04-14 means a `syncRewards()` against the v2.2 `DepositPoolV2` will report phantom slashing. Keep the legacy pool paused and do not trigger reward sync or withdrawals while planning migration.

**Local v2.4 replacement in canonical Hyperion sources:**

- ValidatorManager records the only outstanding-principal total and exposes it
  through the pool's compatibility `stakedQRL()` view.
- `fundValidator()` registers the exact pubkey and deposit root before forwarding
  40,000 QRL. The beacon call and Manager registration revert together.
- Normal-state `_syncRewards()` reconciles balance plus Manager principal and is
  permissionless only with zero outstanding principal. Active-validator rewards
  use bounded owner recognition after finalized Qrysm validation.
- `beginValidatorExit(id)` checkpoints pool balance and enters an explicit
  one-exit settlement state without letting unsolicited inflow block progress.
- `settleValidatorExits(ids)` accepts no amount, requires the canonical begun
  exit when one exists, retires every included fixed principal, restores observed
  returned liquidity, and schedules fee-epoch closure after the last retirement.
- Missing returned principal remains a temporary receivable until a later block.
  Fresh finalized Qrysm and canonical execution evidence then bounds
  `finalizeProtocolFeeEpoch(...)`, which writes off only the remaining shortfall,
  synchronizes the complete epoch, and mints the exact protocol fee shares.
- The standard finalizer supplies zero late eligible reward. Residual positive
  close-window surplus remains fee-exempt because current finalized state cannot
  distinguish validator reward from a direct donation. Exact rewards recognized
  before settlement remain in the fee base. The finalized execution balance is
  used as a floor, and positive receipt-time drift is accepted as fee-exempt so
  a donation cannot indefinitely revert the close transaction.
- Accounting and share-supply changes remain closed through the successful
  finalization block. This prevents later transactions in that block from
  invalidating exact receipt-block verification and reopens normal flows in the
  next block.
- Close-time loss and fee carries are checkpointed against the closing share
  supply. Later burns reduce them only at a new historical supply minimum, so
  near-total cohort exit cannot leave the full old loss shelter for replacement
  capital and a temporary deposit-and-burn cycle cannot wash the checkpoint.
- Replacement deposits can keep aggregate supply above that minimum and inherit
  the remaining pool-level loss shelter. This is conservative fee
  undercollection. Exact cohort attribution is deferred to a per-share or
  per-account equalization design.
- `cancelValidatorExit(id)` recovers a failed exit submission only while the
  operator has verified exact `active_ongoing` state in Qrysm.
- The same batch path repairs accounting after terminal returns arrived before
  the begin checkpoint. Bounded reward recognition does not reopen priced flows.
- Deposits and claims remain blocked whenever any Manager principal is
  outstanding. This also covers zero-return loss and cross-validator return
  masking that observable accounting equality cannot detect.

**Action:** keep v2.3 paused. The targeted executable v2.4 behavior gate,
independent static review, and fresh QIP-55 many-staker validator lifecycle are
complete locally. The fail-closed source sacrifices continuous deposits and
claims while validators are funded. Mainnet still requires verifiable terminal
withdrawal evidence, or an explicit product decision to retain this cohort-based
liquidity model, before any deployment decision.

### 7b. Share and reserve accounting hardening - **deployed in paused v2.3**

The current source includes additional accounting changes found during the v2.3 security review:

- Deposits reconcile rewards or losses that existed before `msg.value`, preventing new shares from capturing unsynced rewards.
- `withdrawalReserve` remains part of `totalPooledQRL` until claim. Reserve funding therefore changes neither side of the share conversion rate.
- Claims price shares after synchronized settlement. Request-time QRL values are informational estimates, so queued holders receive rewards and bear slashing until their shares burn.
- Exit settlement restores observed returned principal to `bufferedQRL` and carries missing retired principal as a temporary receivable through the later finalized close. This preserves restaking liquidity, allows late recovery across settlement batches, and records an unrecovered loss once.
- Real validator funding requires liquid balance net of reserve as well as sufficient `bufferedQRL`. Repeated reserve funding reduces the usable buffer without exposing earmarked funds.
- Cancelled or overfunded requests can be unearmarked with `releaseWithdrawalReserve`; reserve provenance restores only validator buffer that was actually reserved.
- `emergencyWithdraw` synchronizes normal-state native inflows and remains closed during exit settlement.
- Deterministic and fuzz regressions for each accounting issue, repeated reserve funding, safe reserve release, and exit-principal provenance are retained in the Hyperion test sources. The former Foundry suite reached 226 passing tests before the `.sol` and `.t.sol` tree was removed; that count is historical evidence rather than a current Hyperion runner result.

These changes are present at the v2.3 addresses above. The new pool remains paused and empty while operational migration checks continue. The legacy v2.2 addresses retain the historical behavior.

### 8. Minimum stake lock (anti-griefing) - **deployed in paused v2.3**

Fresh deposits now mature for `minStakeBlocks` (default 1536, ~1 day) before they can be transferred or queued for withdrawal. Closes the deposit/withdraw yo-yo grief that would force the operator to bridge liquidity or exit validators at no cost to the attacker. Design points:

- Two-bucket lazy maturity in `stQRLv2` (`immatureSharesOf` / `matureAtBlockOf`), mirroring the `_lockedShares` pattern. Top-ups fold remaining immature shares into a new bucket and reset its maturity; matured shares are unaffected.
- Immature shares are non-transferable (closes the fresh-address bypass); transfers never write to the recipient's bucket (no dust-grief vector).
- Owner deposits are exempt so operator bridge capital can enter/exit without the wait.
- `setMinStakeBlocks` owner-settable, capped at `MAX_MIN_STAKE_BLOCKS` (46500, ~30 days), `0` disables.
- Sixteen maturity-lock regressions and invariant fuzz cases are retained in the Hyperion test sources. They were part of the historical **226-test** pre-removal Foundry result. The frontend handles missing views defensively against historical v2.2 and shows a maturing notice on the Withdrawals page.
- The v2.3 contracts include the lock. It becomes relevant only after the paused pool is deliberately launched.

---

## Frontend

`frontend/` (React 19 + Vite 7 + MobX, merged via PR #21) serves at **https://quantapool.com** and **https://quantapool.io**, both Cloudflare-proxied with SSL mode Full (strict).

- The app reads chain state through the qrlwallet RPC proxy and the QRL price through the zondscan explorer API; both CORS allowlists must include the quantapool origins or the app shows "Could not reach the QRL network".
- Hosting, deploy steps, cert locations, and the exact CORS allowlist hosts are operational details kept out of this public repo (see the private `CLAUDE.md`).
- Defaults in `frontend/src/config/networks.ts` mirror the paused v2.3 addresses above; override via `VITE_*` env vars.

---

## How to resume

```bash
cd QuantaPool
git status                                    # expect clean on dev
npm run compile:hyperion                      # compile canonical .hyp contracts
node --test scripts/deploy-hyperion-safety.test.js scripts/loadDeployer.test.js
node scripts/integration-test-v2.js status    # read-only v2.3 state
# validator-host service health (gqrl/qrysm): see the maintainer-internal runbook
```

Integration test phases run independently, but mutating phases must remain disabled while v2.3 is paused:
```bash
node scripts/integration-test-v2.js <phase>
```
Phase names are listed in the coverage table above.

The `validator` phase locks 40,000 QRL into the pool per run. Recover via the `claim-prep` + `claim` sequence.

---

## Cost so far
- Three historical full deploys (v2.0 through v2.2) used five transactions each.
- The v2.3 safety deployment used eight transactions: three deploys, two pauses, and three one-shot links. One extra zero-supply token creation was abandoned after a proxy body-limit rejection.
- Integration test runs + MVP validator funding orphaned ~120k QRL in v2.0 pool, ~40k in v2.1 pool.
- v2.2: deployer funded one real validator (40k forwarded to beacon `Q4242…`).
- Testnet refills required: 60k + 10k = 70k QRL above the original 50k seed.
- All testnet QRL - no real-money cost.

## Files of interest
- `config/testnet-hyperion.json` - provider URL, chainId, live addresses
- `scripts/deploy-hyperion.js` - fingerprinted deploy, pause, wire, finality, and atomic config update
- `scripts/integration-test-v2.js` - all 16 test phases (works)
- `scripts/lib/loadDeployer.js` - wallet.js v3 loader (34-word mnemonic, registers seed on `web3.qrl.wallet`)
- `contracts/hyperion/` - canonical, hand-edited `.hyp` contract sources
- `contracts/test/hyperion/semantic/` - targeted native release-blocker suite executed by `npm test`
- `contracts/test/hyperion/*.t.hyp` - historical pre-v2.4 specifications with retired API cases, parsed as archival evidence
- `scripts/verify-deposit-data.js` - safety gate; validates a `deposit_data-*.json` against the live pool
- `scripts/fund-validator-real.js` - broadcasts `pool.fundValidator()` (real beacon path)
- `build/hyperion/{stQRLv2,DepositPoolV2,ValidatorManager}.{abi,bin}` - compiled artifacts (gitignored)
- `.env` - `TESTNET_SEED` (gitignored)
- `scripts/v1-deprecated/` - archived v1 scripts (do not run against v2)
- `contracts/hyperion/README.md` - Hyperion dialect + hypc workflow notes
- `docs/TERMINAL-WITHDRAWAL-RECEIPTS.md` - proposed Qrysm/go-qrl terminal receipt interface
