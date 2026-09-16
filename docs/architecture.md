# Native QRL pooled staking

QuantaPool uses four immutable core contracts and an optional immutable checkpoint executor. A new deployment has fresh state and no legacy token compatibility. There is no transferable staking receipt, lending, leverage, rehypothecation, discretionary investment allocation, guaranteed principal or guaranteed return.

## Contract map and asset flow

| Contract | Authoritative state and responsibility |
|---|---|
| `NativeFinalityVerifier` | Initial trusted header, immutable chain/domain/timing policy, authenticated current and next committee roots, accepted finalized headers, trust deadline and irreversible expiry |
| `NativePortfolioVerifier` | Gate-only canonical validator registry; complete bounded proofs of pool cash, validator records, all intervening deposits and withdrawals; committed snapshot and terminal observations |
| `NativeValidatorGate` | Original operator bootstrap beneficiary; canonical deposit runtime/domain; valid public exits; exact native top-up transactions and deposit-index history |
| `NativeQrlPool` / `NativeLedger` | Immutable fee beneficiary, risk assets, nontransferable positions, fee basis, loss/reward budget, cash reserves, FIFO requests, historical cash flows and recovery rights |
| `NativeCheckpointExecutor` | Optional typed batching of proof completion, settlement and bounded ledger work; immutable pool/portfolio bindings, no funds or authority |

Users send QRL directly to `NativeQrlPool.deposit()`. Pending principal stays fully cash-backed, belongs to the sender and can be refunded before admission. A later finalized execution cutoff admits it at the settled portfolio value. Native funding moves from the pool through the immutable gate to the canonical deposit contract in one transaction. The gate has no discretionary asset transfer or pool balance editor. Validator withdrawal recipients are the pool's full 64-byte address. Consensus principal and rewards return directly to that address.

Ordinary deposits require the configured minimum. Validator funding requires 38,000 QRL of free cash plus a 5% buffer against risk assets after bootstrap adoption. Reserved user claims, pending deposits, earned fees and quarantined ownerless cash cannot fund validators. Funding also waits for an empty withdrawal queue. The lifetime registry is capped at 64 admitted validators, including terminal records, with no privileged override. A new pool instance is required for additional lifetime admissions.

## Operator preparation and canonical recipient

Only the immutable validator-operator address can pay a native 2,000 QRL preparation through the gate. That address authorizes future signing-key enrollment and supplies its own capital. Anyone may later submit the complete proofs and finish admission of that authorized preparation. That preparation is outside the active pool ledger until admission. The gate validates the native deposit signature and root; the protocol determines the canonical validator record. After finalization, the portfolio verifier proves the exact public key, original pool withdrawal recipient, unslashed inactive status, RANDAO commitment and exact 2,000 QRL balance.

Before releasing pooled funds, the gate verifies and stores an epoch-zero exit for the proven validator index and validates the 38,000 QRL top-up signature. It then atomically adopts the operator's 2,000 QRL as ordinary loss-bearing principal at the already settled checkpoint price and deposits the remaining 38,000 QRL. Any failure rolls back registration, stake adoption, exit storage and pooled funding together.

An existing public key cannot change its canonical recipient through a later deposit. A foreign recipient, wrong balance or incompatible validator state fails admission. An unsolicited top-up can make preparation ineligible. New preparation is rejected after lifetime capacity is full, but concurrent preparations can exhaust remaining admission capacity before an earlier preparation is ready. Failed or abandoned preparation can leave the operator's own 2,000 QRL locked under unchanged native rules, particularly if the key disappears before publishing an exit. Pooled user funds never reimburse that preparation by discretion.

## Authentication and complete accounting

A deployment supplies an independently reviewed recent finalized header and chain identity. This is the initial trust anchor. Later updates require signatures authenticating at least 86 of the native 128 committee positions, Merkle membership, finalized-header proofs and authenticated committee transitions. RPC responses and node agreement only provide public proof material; they confer no reporting authority.

This is a sampled-committee verifier with explicit committee-key honesty and initial-anchor assumptions. It does not replay the complete native state transition or whole-network stake-weighted consensus. Repeated committee keys can occupy multiple positions. The implementation supports the pinned fixed fork, consecutive occupied signing slots and occupied finalized epoch boundaries. Unsupported histories fail closed. The 64-slot economic freshness and 4,096-slot recovery window used locally are test parameters, not established safe production values.

Each portfolio snapshot authenticates one matched finalized beacon state and its execution cutoff:

1. The execution state root, execution block and consumed native deposit index through SSZ proofs.
2. The exact pool account cash through its native 64-byte account trie proof.
3. Every registered validator, in registry order, including true zero balances and terminal status.
4. Every occupied parent-linked block back to the previous snapshot, with complete native withdrawal and deposit lists. All deposits to registered public keys are counted, including third-party top-ups.

Validator and deposit indices are separate namespaces. In-flight pool funding counts only deposits sent at or before the execution cutoff whose native deposit index is still unconsumed at that same cutoff. The ledger normalizes the historical balance sheet using on-chain cumulative user/adopted deposits and actual cash payouts. It never combines current cash with historical validator balances without that reconciliation.

For an interval, consensus gain or loss is `new validator balance + native withdrawals - old validator balance - consumed validator deposits - newly adopted bootstrap principal`. The remaining independently authenticated asset increase is fee-exempt. Returned principal and third-party deposits therefore cannot masquerade as consensus rewards.

## Positions, precision and losses

The pool stores a position for each immutable beneficiary: internal stake units, contributed principal basis, separate fee basis and fractional carry, pending deposits, reserved principal/reward claims, one active request and recovery payments. The global ledger stores risk assets, total internal units and the fee-exempt-basis accumulator. Positions cannot be transferred or approved to another spender.

Unreserved position value is the user's fraction of risk assets. Positive value above contributed principal is the available gross gain; value below principal records current loss exposure. Unreserved gains remain exposed to later native losses. A global asset change allocates rewards or losses proportionally without visiting every staker. A fee-basis accumulator allocates verified gifts in constant cost per later user action. Historical earned amounts can be indexed from on-chain events; the operator cannot set them.

Multiplication uses native 512-bit intermediates. Admissions round internal units down; sales round units up; fee-exempt basis rounds conservatively against charging fees. Internal scales are `1e27` and `1e54`. The last normal exit requires the same priced snapshot to prove every validator terminal and all funding consumed, allowing a complete cash drain. A zero-valued user retains its position while validators remain nonterminal. Ownerless cash is quarantined and cannot be swept by the operator. Recovery can retain less than one smallest native unit per participant as rounding residue.

## Withdrawals and rewards

`requestWithdrawal(amount)` and `requestRewards(amount)` join the same global FIFO. The maximum integer requests the full available amount. Requests retain their stake exposure until a strictly later authenticated execution cutoff and successful cash reservation. A deposit made just before settlement cannot capture earlier rewards; a request made after a loss cannot use an earlier cutoff to avoid it.

Anyone can stage a checkpoint, process bounded admissions and process the FIFO. A head request without enough free cash stays first. The keeper processes available cash before requesting further validator exits; public signed exits remain independently usable. Once reserved, principal and reward claims are fixed and fully cash-backed. `claim()` pays only the original beneficiary. A failing recipient does not block other reserved claims. No administrator can reorder or selectively compensate requests. Owners can cancel their own unprocessed requests and cash-backed pending deposits.

Staged work has its own authenticated freshness check. Anyone may abandon a stale stage while preserving completed admissions and reserved payouts, then continue from a new verified snapshot. A newer finality root cannot make an old pricing stage fresh again.

## Operator fee

The fee is fixed at 1,000 basis points, or 10%. Its base is eligible realized net consensus gain when a FIFO request reserves actual cash. Unresolved consensus losses consume the global gain budget and then accumulate as loss carry. Subsequent gains recover that carry before creating new eligible fee income. Per-user principal and fee bases also constrain the chargeable amount. Gifts and unclassified cash add fee basis and never create a consensus fee budget.

Each user carries a remainder from zero through nine base units, so splitting claims cannot evade the cumulative floor of the 10% charge. Fees go into a cash-backed earned reserve. Anyone can execute `claimFees()`, which always pays the immutable fee recipient. There is no arbitrary fee withdrawal, rate change, recipient change, principal sweep or retroactive accounting report. Previously earned fees are not clawed back after later losses. Recovery earns zero new fees, including on unknown later receipts.

## Exits, expiry and disappearance

The gate exposes signed epoch-zero exits before pooled top-up. An independent relayer can retrieve and broadcast them after native activation and eligibility. Mechanical exit-work events follow funding order. The native signature remains independently usable, so anyone holding it can force an eligible exit even without a pool request. This affects staking uptime and replacement cost. Future fork changes can invalidate stored exit domains.

Keepers can authenticate fresh updates or perform bounded historical catch-up before the previously established verifier trust deadline. Historical progress alone does not extend that deadline. The pool also has an immutable accounting recovery window, initially anchored to its constructor checkpoint and renewed only by a complete portfolio checkpoint applied to the ledger. Finality updates, staged proofs and unapplied portfolios cannot renew that pool deadline. Once either deadline expires, normal pool operations cannot restart. Anyone can begin recovery, including while native finality remains healthy; no owner can reset the root, swap the verifier or reopen the pool.

Recovery freezes existing risk weights, protects pending refunds, reserved user claims and already earned fees, and allocates actual current and later free cash proportionally. Rights survive earlier recovery payouts. The remaining validators may return cash later or suffer losses. Recovery cannot impose a native withdrawal deadline or recreate unavailable cash. If all proof suppliers disappear, expiry can occur despite a healthy native chain. A portfolio-specific data or capacity stall can also trigger pool recovery even while finality updates continue. Public proof caching and adequate archive retention improve liveness without supplying economic authority. The lifetime registry and occupied-header workload need explicit capacity qualification; see [measured scale limits](../native/proofs/SCALE.md).

## Privileges and trust

| Actor | Power, effect on deposits, compromise and disappearance |
|---|---|
| Deployer | Chooses immutable initial anchor, chain policy, graph bindings, minimum deposit and fee beneficiary. A malicious initial configuration undermines the deployment. No later owner or upgrade power exists; users must review the deployment before depositing. |
| Validator preparation address | Immutable and restricted to authorizing new validator preparations with its own capital. Cannot redirect pooled principal, edit positions or block existing public exits. Compromise exposes future validator operations to harmful signing-key selection; disappearance prevents new preparations. |
| Proof submitter / keeper | Supplies public authenticated data and executes deterministic batches. Cannot edit balances, redirect funds, change fees or bypass expiry. Withholding all useful proofs harms liveness; other keepers may continue. |
| Validator signing-key holder | Performs native consensus duties, can exit, go offline, be slashed and select execution-tip routing. Cannot change the established consensus withdrawal recipient or user beneficiary. Public signatures remove the need for a new exit signature under the supported fork. |
| Bootstrap payer | Risks its own preparation capital. Successful admission creates ordinary principal for its original address. Cannot claim another depositor's principal or obtain a discretionary reimbursement. |
| Fee recipient | Receives only earned reserved fees. Cannot select another destination, take principal, alter rates or block user claims. A recipient that rejects payment leaves only its fee reserve unpaid. |
| User / recovery caller | Requests or claims its own entitlement; anyone can begin permitted mechanical work or irreversible recovery after expiry. Cannot select other beneficiaries or change weights. |
| Owner, admin, proxy admin, upgrader, pauser, oracle/reward reporter, emergency multisig | No such privilege exists in the native contracts. There is no administrative pause, confiscation, discretionary balance setter, rescue transfer or upgrade. |

Execution transaction tips are a material operator-control limitation. Only received, authenticated assets enter enforceable accounting. The product must not promise every tip reaches the pool. Public exits, committee honesty, deployment trust, proof availability, unsupported forks and indefinite native recovery remain review items before launch. These technical facts support review of actual control under the supplied Dutch BV report; this implementation makes no new legal classification or clearance claim.

## Storage and history

All four contracts use new storage and immutable cross-contract references. The old token balances, approvals, exchange rates, proxy/admin slots and deployed validators are not imported. [Removed executable files](../native/RETIRED-FILES.json) and [historical documentation](legacy/V2-ARCHITECTURE.md) record the previous system. The compiler emits each new storage layout under `build/native/`; there is no in-place storage migration.
