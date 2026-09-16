# Native QRL redesign and validation

Qualification date: 2026-09-15. This is a fresh local implementation candidate. The old testnet deployments are abandoned and untouched. Upstream clients, consensus rules and remote deployments remain unchanged. Public launch is a separate review decision.

## Implemented architecture

The native design replaces the old token/pool/manager graph with an immutable finality verifier, complete portfolio verifier, canonical validator funding gate and native position ledger. An optional immutable executor batches existing proof and ledger calls. The frontend, active package scripts, contract ABIs and monitoring use this graph. There is no transferable staking receipt, token conversion, allowance, token fee issuance, lending, leverage or discretionary allocation.

Users send native QRL directly to the pool. Pending deposits remain cash-backed and refundable. A strictly later authenticated execution cutoff admits them into nontransferable internal positions. Global risk assets and units allocate gains and losses without visiting every staker. Rewards remain exposed to subsequent losses until a future-cutoff request receives a cash reservation. All requests use one deterministic FIFO; claims pay their original beneficiaries directly.

The immutable validator-operator address supplies its own 2,000 QRL preparation deposit and authorizes future consensus-key enrollment. Anyone may finish admission of that authorized preparation with valid proofs. Contracts authenticate the canonical recipient, balance, identity and inactive state, verify and store an index/domain-bound public exit, then atomically adopt that 2,000 QRL as ordinary principal and fund the remaining 38,000 QRL. The pool retains the configured 5% funding buffer and protects pending deposits, claims and earned fees. An existing foreign validator recipient cannot be repaired by a later deposit.

The fee is fixed at 10% of eligible realized net consensus gain when cash is reserved. The base excludes contributed principal, adopted preparation capital, third-party top-ups, gifts and unclassified receipts; global prior losses must be recovered before further fee entitlement. Per-user fractional carry prevents repeated tiny actions from changing rounding policy. Only the earned reserve can be paid to the immutable fee recipient. Recovery earns zero new fees.

[The architecture](../docs/architecture.md) contains the matched accounting formulas, claim lifecycle, failure modes and privilege inventory. [The dependency inventory](LEGACY-DEPENDENCIES.md) records the repository search and retired consumers.

## Files and removed contracts

| Area | Changed files or responsibility |
|---|---|
| Native core | Eight `native/contracts/*.hyp` files: four core contracts, ledger base, SSZ/account-proof libraries and checkpoint executor |
| Accounting tests | `native/accounting-model*`, `native/testing/` and pinned native execution runner |
| Proofs and recovery | `native/proofs/`, `native/finality/`, and isolated recovery qualification |
| Actual local execution | `native/network/`, `native/lifecycle/`, pinned source/runtime/compiler manifests |
| Build and checks | `package.json`, lockfile, `scripts/compile-hyperion.js`, `scripts/test.js`, native tooling checks and CI |
| Frontend | Native pool ABI, state/actions, event decoding, all staking/claim/statistics pages, metadata and fixtures |
| Monitoring | Read-only exporter, dashboard, alerts, explicit native address/chain provisioning inputs |
| Documentation | README, architecture, source baseline, testnet retirement and historical-phase labels |
| Ecosystem landing cell | QuantaPool page and ecosystem card copy; local edits only |

Removed contracts include Hyperion `stQRL-v2.hyp`, `DepositPool-v2.hyp`, `ValidatorManager.hyp`, their Solidity mirrors, and deprecated v1 `stQRL`, `DepositPool`, `OperatorRegistry`, `RewardsOracle` and test token. Token-specific tests, address configuration and executable old deployment/integration commands were removed together. See [all 57 retired executable paths](RETIRED-FILES.json). No legacy funds or storage are recovered or imported.

## Storage layout

This is a new deployment, with no proxy or in-place storage migration. Hyperion emits native layouts under `build/native/*_storage.json`; native storage words and addresses are 64 bytes. The following are roots of new storage, not Ethereum layout assumptions.

| Contract | New mutable state |
|---|---|
| Finality | Finalized slot/root, current/next committees, trust anchor slot, expiry, proposals and verified public-key hashes |
| Portfolio | Ordered registry and uniqueness maps, accepted/staged validator observations, pending proof generation, complete snapshot and terminal count |
| Gate | Operator preparations, public signed exits, exact funding/deposit-index history and deterministic exit cursor |
| Pool | Risk assets/internal units, fixed cash reserves, fee-exempt basis accumulator, reward/loss budget, historical cash flows, pending/FIFO arrays, immutable-beneficiary positions and recovery cohort |

The compiler places pool position, pending-deposit, request and historical-flow roots at slots 11, 12, 13 and 14 respectively. Each position records units, principal basis, fee basis/debt/fraction, pending cash, principal and reward claims, fee carry, request identity and recovery paid. Cross-contract references, fee recipient, minimum deposit and timing policy are immutable bytecode values. The build manifest hashes current source, compiler, ABI, creation bytecode and runtime.

## Accounting invariants

1. Native cash always covers pending deposits, reserved user claims, earned fee reserves and quarantined ownerless cash.
2. A complete snapshot includes pool cash, every registered validator and all intervening occupied-block deposits/withdrawals at one finalized execution cutoff. Unknown or omitted data cannot become a committed snapshot.
3. Pool funding is counted once: native cash before transfer, explicit in-flight principal while unconsumed, then canonical validator balance after consumption.
4. Historical gross assets are normalized by recorded later external deposits and actual cash payouts. Returned principal and newly adopted preparation capital never enter the consensus fee base.
5. Aggregate unreserved position entitlements are bounded by risk assets. Cash reservations remove the corresponding units/value before payment; repeated claims cannot reuse an entitlement.
6. Deposits and withdrawal/reward requests require a strictly later cutoff. Queued users bear gains and losses until reservation; newcomers cannot buy earlier settled rewards.
7. Earned operator fees are bounded by realized taxable gain and eligible net consensus income, after prior-loss recovery. No key can edit the fee or its recipient.
8. A normal final exit requires the priced snapshot to prove terminal zero validators and no pool funding in flight. Zero-value users retain late-return rights while validators remain outstanding.
9. Recovery freezes existing units, preserves already segregated reserves and pays cumulative available cash minus prior claims. Late cash remains claimable and earns no new fee.
10. Rounding uses bounded integer arithmetic and conservative directions. Ownerless cash and any sub-unit distribution residue remain explicit; the operator has no sweep.

## Executed checks and evidence boundaries

The complete default `npm test` passed after the final security review fixes: compilation, 38 arithmetic-model tests, 2,070 ledger QRVM steps, 828 component/recovery/capacity/executor QRVM steps, 155 finality QRVM steps and 32 tooling tests. That is 3,053 native-VM steps, including 151 expected reverts. The model includes 20,000 seeded actions and 200 zero-consensus rounding cycles. The frontend ABI was regenerated; its 41 tests, lint, typecheck, formatting and build passed. The earlier 18 gas-preparation browser cases and the final transaction-generation tests use synthetic wallet/RPC fixtures. [The final security review](FINAL-SECURITY-REVIEW.md) records fixes, current source fingerprints and publication checks.

| Check | Evidence boundary |
|---|---|
| Ledger QRVM | Actual compiled bytecode in pinned unmodified go-qrl; synthetic economic checkpoints exercise deposits, losses, rewards, partial/full claims, FIFO, final drain, callbacks and recovery |
| Portfolio/gate/adapter QRVM | Actual native contract bytecode, canonical deposit runtime and real native signatures; explicitly synthetic checkpoint authority and state fixtures |
| Finality QRVM | Real certificates captured from current unchanged Qrysm, including two committee transitions; VM clock and starting balances are fixtures |
| Current local lifecycle | Real execution/beacon clients, on-chain transactions, actual deposit ingestion, current finality signatures, complete proofs and native balances; milestones below |
| Frontend | 41 tests, lint, typecheck and build passed. The final built bundle passed ten route/viewport checks; synthetic normal, expired and recovery states passed separately. Real pending/admitted values used an earlier compatible frontend against the original graph; current recovery values used the hardened graph, both with synthetic read-only wallet adapters and zero signing/write requests. The 18 final gas-preparation browser scenarios use synthetic wallets and RPC responses throughout. |
| Ecosystem landing | Final four route/viewport checks passed at 390 and 1440 pixels, including the updated homepage label; no page errors or horizontal overflow, no live-site activation |
| Monitoring/infrastructure | Read-only actual-chain scrape, 32 tooling checks, 26 monitoring rules parsed and seven alert timing/recovery scenarios passed. Terraform formatting and validation passed; no provisioning or remote service change |

The current native portfolio runtime is 24,509 bytes, only 67 bytes below the pinned 24,576-byte limit. Compiler and source fingerprint checks prevent accidental unqualified rebuilds. The frontend build reports a large native Web3 bundle; performance optimization remains separate from accounting correctness.

## Real-network milestones

The fresh isolated network runs current pinned 64-byte clients, 64 genesis validators, three-second slots and eight-slot epochs. It preserves the native 512-block execution follow distance, 64-epoch execution voting period, 16-active-epoch exit eligibility and 16-epoch withdrawal delay. Source-built images and actual loopback host mappings are verified. The genesis wrapper supplies the exact current upstream canonical deposit runtime because the pinned generator embedded an older minimum; no node or protocol source is patched.

- The operator deposited 2,000 QRL at slot 776; users deposited 20,000 and 22,000 QRL at slots 778 and 780.
- Native consensus consumed the bootstrap at slot 1792 and assigned index 64 with the pool recipient and exact 2,000 QRL balance.
- The public epoch-zero exit was exported and independently verified before pooled funding. Its stored bytes match the original signed message.
- The first complete portfolio at finalized slot 1824 authenticated all 1,184 occupied intervening blocks, activated both users and committed at execution slot 1886. Earlier stale attempts reverted and were discarded without releasing pending funds.
- Atomic admission at slot 1888 adopted the operator's 2,000 QRL principal and deposited exactly 38,000 QRL to the canonical contract. Pool cash became 4,000 QRL and risk assets 44,000 QRL, with zero fees.
- A later complete checkpoint at finalized slot 1984 reconciled 4,000 cash + 2,000 validator balance + 38,000 authenticated in-flight funding = 44,000 QRL. No funding became reward income.

Native consensus consumed the 38,000 QRL top-up at slot 2816. A complete authenticated checkpoint then reconciled 40,000 QRL validator balance + 4,000 QRL cash + zero in-flight funding = 44,000 QRL, with zero fees. The validator activated at epoch 360. Native observations recorded an ordinary missed-duty penalty followed by successful attestations and rewards. This was not a slashing test or a separately applied negative accounting checkpoint.

The users and operator queued their complete positions at slots 2933, 2935 and 2937. The finalized-slot-2944 checkpoint authenticated 44,007.135415902 QRL of risk assets: 4,005.773507222 QRL cash plus 40,001.36190868 QRL validator balance. All three requests remained queued with zero claim or fee reserve because the first position exceeded available cash. The gate recorded exit demand at slot 2939.

An independent process relayed the original public epoch-zero exit after native eligibility at epoch 376. Unmodified Qrysm accepted it at observed slot 3009 and included the exact signed message in block 3010. Finalized state 3016 subsequently recorded exit epoch 381 and withdrawable epoch 397. The relay used neither a validator signing key nor an execution signing key. These inclusion and scheduling observations are explicitly RPC evidence; complete contract proofs establish economic state.

The actual native full withdrawal at slot 3177 returned exactly 40,000 QRL directly to the pool. Complete finalized checkpoint 3200 authenticated the terminal zero balance and all intervening native flows. The FIFO then reserved all three full withdrawals and only the earned fee. User payouts completed at blocks 3234, 3293 and 3295; the immutable fee recipient was paid at block 3297. All principal shortfalls were zero.

| Final reconciliation | Native QRL |
|---|---:|
| User and operator stake contributions | 44,000 |
| Principal sent to the native validator | 40,000 |
| Total authenticated validator withdrawals | 40,032.041092142 |
| Net consensus gain | 32.041092142 |
| Principal and net rewards paid to position owners | 44,028.836982927800000001 |
| Earned operator fee | 3.204109214199999999 |
| Remaining pool cash and reserved claims | 0 |

The one-base-unit difference from an exact 10% fee is the documented per-user integer rounding. No returned principal was charged a fee. The read-only completion report rechecked actual creation artifacts, canonical deposits and every native withdrawal, then reconciled contract-authorized payouts with account balances, incidental fixture proposer tips and transaction gas. All shares, pending deposits, user reserves and earned fee reserves were zero after payment. Lifecycle maintenance, finality keeper and the controlled validator process were stopped only after that result; the fresh enclave and its native node services remain running.

The original graph journal contains 2,481 successful mined transactions and 12 mined reverts, including initial stale portfolio attempts and one payout gas failure. Total gas was 6,182,259,703, costing fixture transaction senders 6.182261598933041068 QRL. These include commissioning and user actions, exclude the separate recovery graph, and never debit pooled principal. This run's gas expenditure exceeded its earned operator fee. Accelerated fixture rewards, local gas prices, startup costs and short validator uptime cannot establish sustainable public economics.

## Payout gas-estimation regression

The first user claim succeeded. The second initially exhausted its 112,824-gas limit at a native `SSTORE`: latest-block estimation had returned 85,687 gas, while the next mined block required an additional cash-flow history entry. The failed transaction preserved the full 22,014.4184914639 QRL reserved claim. A separately named 300,000-gas retry succeeded after canonical failed-receipt and preserved-entitlement checks; its original failed transaction remains in the journal. The helper uses that claim-only allowance without changing proof transaction packing limits.

The current frontend supplies explicit gas to both extension and relay wallets. Deposit, pending refund, native claim and recovery claim use `max(300000, ceil(estimate * 1.3) + 100000)`. Estimates must succeed and the result must fit the current native block gas limit; the app never clamps an insufficient allowance or retries automatically. It rechecks wallet identity and chain before sending. The emitted native layout confirms two storage slots per new cash-flow entry plus the array-length update. Tests cover the observed estimate, malformed inputs, block limits, transport encodings and wallet changes. Eighteen additional store-level browser cases validate both transports using synthetic wallets/RPC only. Contract accounting and ABI are unchanged by this fix.

## Source-hardening provenance

The funded graph uses frozen artifacts from before subsequent review fixes. First, canonical-address constructor hardening additionally requires the native 64-byte `Q42...42` deposit address. Its runtime instruction template is unchanged; [the review](REVIEW.md) records exact metadata-stripped equivalence and wrong-address regression execution.

Second, pool-specific timeout hardening closes a recovery-liveness gap: healthy finality updates alone must not prevent recovery when complete pool accounting stops. The source candidate uses an immutable deadline renewed only by an applied complete pool checkpoint. Expired normal accounting cannot restart; existing claims and pending refunds survive. This changes pool/gate runtime, so the original funded lifecycle cannot establish execution of that additional safeguard. Separate native-VM and isolated new-graph checks qualify it explicitly. The same source hardening also caps lifetime validator admissions at 64 and restricts new preparations to an immutable validator-operator address. The original funded graph does not enforce those additional boundaries.

## Actual pool-timeout recovery result

A separate deployment used the timeout, capacity and operator-enrollment hardening, a 64-slot freshness window and a 96-slot recovery window. It predates the final zero-value FIFO fix; that later change has native-VM regression coverage and has not been exercised in a newly funded network graph. A genuine finalized checkpoint at slot 2696 admitted 10 QRL. The pool deadline remained 2792 while authenticated global finality advanced to slot 2776. After that pool deadline passed, global finality still reported status zero and the pool reported status two.

An independent fixture account began recovery at slot 2826. The depositor claimed exactly 10 QRL at slot 2834. Actual balance reconciliation accounts for the user's transaction gas. Earned fees and remaining pool cash were both zero. A repeated claim was rejected through a read-only native execution call. Recovery and payout used 83,657 and 165,328 gas respectively. The whole successful isolated run used 103 mined transactions and 262,237,957 gas, including genuine finality maintenance.

An earlier unfunded probe encountered an insufficient 5-million-gas cold-signature batch limit. Its failed receipts and zero-balance graph are preserved separately. The successful replacement used an 8.5-million cap; the largest actual cold batch used 6,303,738 gas, consistent with the independent VM measurement. No user principal entered the failed graph.

The browser verified recovery eligibility at blocks 2804-2805 with healthy global finality, available cash at 2832-2833, and the completed payout at 2842. New deposits were disabled after expiry; recovery and claim controls followed actual on-chain state. The browser made zero signing or write requests. The final UI distinguishes frozen historical positions, current recoverable cash and amounts already paid. Monitoring also read the final pool status, recovery deadline and zero balances successfully from the current deployed ABI.

The current frontend requires the hardened graph's `poolStatus` and `poolRecoveryDeadlineSlot` views. The original funded graph lacks those methods, so its earlier browser captures cannot qualify the current application's compatibility with that old ABI. No legacy compatibility adapter was added. Normal-flow transaction and payout evidence for that graph comes from its explicitly frozen lifecycle drivers.

This test used actual native certificates, account and complete block-flow proofs, and mined contract transactions. There was no synthetic chain state or validator signing-key access. It tests the pool timeout with liquid principal; the separate original graph supplies the full native validator lifecycle evidence.

## Trust, powers and launch constraints

| Role or dependency | Remaining authority or risk |
|---|---|
| Initial deployment | Supplies the trusted recent checkpoint, immutable chain/fork/timing configuration, graph and fee recipient. Independent deployment verification is essential. |
| Sampled committee | At least 86 of 128 authenticated native positions endorse updates. Repeated keys can occupy multiple positions. Committee key honesty is an explicit assumption; whole-network consensus is not replayed. |
| Validator preparation address | Immutable permission to prepare future consensus keys with its own capital. It cannot change balances or payout recipients. Compromise can harm future validator performance; disappearance prevents new preparations while existing exits and claims remain available. |
| Validator signer | Can fail duties, incur native losses and choose execution-tip routing. This candidate publishes a valid exit before pooled funding; anyone can also force an eligible early exit. |
| Keeper/proof supplier | Needs public historical data and gas to complete bounded work. No balance-reporting authority. Anyone can replace it. Registry size and elapsed history can make completion impractical. |
| Owner/admin/proxy/upgrader/pauser/multisig | No corresponding mutable role exists. There is no arbitrary fund rescue, beneficiary edit, fee change, accounting setter or upgrade. |
| Fee recipient | Receives the existing earned reserve at its immutable address. No principal or balance-management access. |
| Users | Request, cancel, refund, trigger available recovery and claim directly through contracts. Native exits and returns can still take an indefinite time. |

The permanent validator registry retains terminal records. The source hardening caps lifetime admissions at 64, with no administrator override or retirement. Concurrent operator preparations can still lose an admission opportunity if other preparations fill the remaining capacity first. Complete checkpoint work is linear in the bounded registry and intervening occupied blocks. [Measured scale and projections](proofs/SCALE.md) identify capacity margins and production timing work. The local 64-slot freshness window is unsuitable for pinned mainnet 128-slot epochs. Local gas prices do not establish public operating economics.

The supplied Dutch BV report's technical assumptions are addressed by direct contract interaction, fixed beneficiaries, on-chain positions, deterministic fees and the absence of a transferable receipt. Initial trust, sampled verification, public exits, tip routing, failure recovery and operator-funded preparation must remain visible to its reviewer. Removing the token does not resolve the report's separate pooling/control/legal classification questions. This implementation does not assert an exemption or a public-launch approval.

## Reproduction

```sh
npm ci
npm run compile
npm test
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
terraform -chdir=infrastructure/terraform fmt -check -recursive
terraform -chdir=infrastructure/terraform init -backend=false -input=false
terraform -chdir=infrastructure/terraform validate
```

Use [the exact source lock](network/source-lock.json), [compiler identity](../config/hyperion-toolchain.json), [network commands](network/README.md) and [guarded lifecycle commands](lifecycle/README.md). Actual source trees, deployment addresses, keys, signed-message journals, transaction receipts and browser captures are retained in ignored local evidence. The repository contains no validator secret or private deployment configuration.
