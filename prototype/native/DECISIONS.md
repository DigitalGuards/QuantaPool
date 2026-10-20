# Native-QRL candidate decisions

Historical design-phase record. The general native ledger and fee accounting are now implemented under `native/`; current decisions and qualification are recorded in [the implementation report](../../native/IMPLEMENTATION.md). Original prototype evidence below retains its earlier scope.

These are the engineering defaults selected for review on 2026-09-14, with the clean-deployment scope clarified on 2026-09-15. The earlier contracts were public-testnet experiments and are [abandoned as development targets](../../docs/TESTNET-RETIREMENT.md). The native design starts fresh with no legacy balance, address, API or storage-layout compatibility requirement. No transferable staking receipt exists in these components. Earlier proof-phase results retain their original test provenance.

## Selected behavior

| Decision | Candidate rule | Consequence to review |
|---|---|---|
| Deployment and migration | Fresh native contracts and fresh state. No old token balances, validators, addresses or storage are imported. | Testnet retirement is authorized. Historical recovery and backwards compatibility are excluded from the native redesign. |
| Normal operator fee | Fixed 10% of eligible verified, realized net staking rewards; deduct unresolved losses before earning further fees. Round down, accrue only earned fees, pay the immutable fee destination from available earned reserves. | The general multi-user fee ledger still requires implementation. Existing single-validator cash evidence proves its own narrower principal-first fee rule. |
| Finality maintenance | Permissionless certificate submissions; immutable bootstrap, native domain, committee roots and timing policy. Historical catch-up is permitted only before the previously established trust deadline. | A sampled-committee honesty assumption remains. The test windows are not qualified mainnet security parameters. |
| Verifier expiry | Irreversible. No root reset, replacement verifier, administrator rescue or upgrade over existing positions. | A sufficiently long outage closes that pool instance. A new pool would require users to opt in with assets they can actually claim. |
| Recovery economics | Freeze existing risk weights, preserve segregated cash claims, distribute only actual current and later contract cash, retain late-return rights. Earn zero new fees during recovery. | Returned principal, old rewards and unknown receipts cannot accidentally become a new fee base. Recovery can remain partial and take an indefinite time. |
| Validator admission | Operator supplies the native 2,000 QRL bootstrap; authenticate canonical registration and the full pool withdrawal recipient before the 38,000 QRL pooled top-up. | Bootstrap capital must be explicitly recorded as operator-owned principal on the same loss-bearing terms. It cannot become a donation, reward or reimbursement by implication. This booking is a ledger implementation requirement. |
| Exit availability | Verify and store the epoch-zero signed exit before pooled top-up. Any independent party can retrieve and relay it. | Any holder can force an eligible exit. This trades staking uptime and replacement cost for availability. Future fork-domain changes can invalidate old signatures. |
| Transaction tips | Configure and monitor the pool as recipient. Enforceable accounting includes only assets actually received and authenticated. Do not promise receipt of every proposer tip. | Unmodified QRL lets the signing-key operator redirect execution tips. This is a material limitation for review; changing routing guarantees requires corresponding product terms before launch. |
| Administrative powers | No owner, pauser, upgrader, discretionary reporter, fee setter, beneficiary editor or asset sweep in the candidate components. | Deployment-time trust configuration must be reviewed before any deposits. Validator keys retain native consensus capabilities and their associated risks. |

Unclassified donations and tips require an explicit fee-exempt accounting category. An operator cannot label an arbitrary increase as chargeable staking income. The normal ledger must demonstrate the classification and loss carryforward before enabling the 10% fee. Recovery already avoids this uncertainty by earning no new fee.

## Guarantees demonstrated in this phase

The [recovery verifier](../recovery/README.md) accepts genuine historical certificates within its trust window, preserves that window during stale progress, renews only on a timely fresh finalized checkpoint, and cannot resume after expiry. Its 224 direct QRVM checks include 60 expected reverts.

The [matched checkpoint consumer](CHECKPOINT-DESIGN.md) verifies the pool's native account cash through a real signed finalized update, its execution state root and the 64-byte account's trie proof in the actual QRVM. Both the actual drained pool and a separate positive account fixture pass. The suite has 117 checks including 50 expected reverts. The positive account's locked protocol deposit balance is never pool backing.

The [cash recovery experiment](CASH-RECOVERY.md) executes permanent membership freezing and native pull claims under real verifier expiry. Its 335 QRVM checks include 28 expected reverts and explicitly synthetic native withdrawal credits. The separate reserve model covers pending refunds, fixed cash claims and earned fee reserves across 26,730 exhaustive histories and 50,000 seeded actions.

Together these are 676 new VM checks, including getters and 138 expected reverts. They extend the previously documented live lifecycle evidence. They do not execute a complete multi-user staking pool. The new phase uses captured real certificates in a simulated execution environment; it does not add a new mined recovery deployment.

## Accounting boundary for the next integration

Use one finalized beacon state to authenticate the pool's execution account, all registered validator balances and the consumed execution-deposit cursor. The registry must be maintained by the funding gate and every included validator proved exactly once. Add in-flight pool funding only when its execution block is in the cutoff and its deposit index is still unconsumed. Validator indices and deposit indices are different namespaces.

Preserve an on-chain history of cumulative external deposits, user payments, funding and fee liabilities. Use it at the same authenticated execution block as the cash proof. Pending deposits remain separate until their admission checkpoint settles. Unfunded withdrawal requests retain their risk shares until deterministic queue processing reserves cash. This prevents later deposits or payments from distorting an earlier finalized balance sheet. Current live cash cannot simply be added to a historical validator balance.

Before production use, the next coherent implementation must connect those components into one native ledger and demonstrate: complete portfolio coverage, pending-deposit timing, proportional loss allocation, deterministic FIFO liquidity, no settlement front-running, loss-aware fee extraction, and O(1) recovery with existing cash reserves. The isolated recovery contract deliberately lacks normal-state withdrawals and must never receive public user funds.

## Remaining trust and operating limits

An independently reviewed initial finalized header and its chain configuration remain deployment inputs. Native committee signatures authenticate a root under the sample's keys. They do not replay whole-network stake-weighted finality or all state transitions. Repeated keys may occupy multiple committee positions. Sufficient historical-key compromise can forge old certificates, and no objectively safe recovery interval has been derived from native withdrawal or history-retention settings.

The verifier supports a fixed fork, consecutive occupied signing slots and occupied finalized epoch boundaries. Unsupported cases fail closed. A relayer must gather at least 86 of 128 positional signatures while the trust window is valid. Failure can lead to recovery even while native consensus continues. Economic freshness limits and a recovery deadline remain separate parameters.

The two disposable local fixtures share their genesis-validator root and fork version, so their native signature domains coincide. Capture tools also check execution chain ID, execution genesis and the complete saved beacon configuration. Those operational checks do not provide cryptographic domain separation. This evidence does not demonstrate isolation between intentionally cloned validator domains; deployment identity and key reuse need explicit review.

Actual account trie data can be pruned before a delayed proof request. Operators and independent keepers should cache public proofs promptly or use archive retention. A proof supplier has no authority to invent account data, but withholding all usable proofs can harm liveness. No reporting fallback has been introduced.

Public exits cover the tested native eligibility/domain behavior. They cannot guarantee continued compatibility through arbitrary future forks, prevent validator slashing, or impose a withdrawal deadline on native consensus. Recovery distributes cash when it arrives and never reports an unproved validator as fully recovered or finally lost.

## Privilege inventory for the candidate

| Actor | Available power | Existing-fund impact and failure behavior |
|---|---|---|
| Deployer | Sets immutable checkpoint, chain policy, verifier and account references at creation | A false initial anchor undermines verification. No post-deployment correction or replacement authority exists in these components. Review deployment inputs before deposits. |
| Proof submitter / keeper | Pays for proof verification, contributes certificate positions, finalizes valid updates, clears superseded proposals | Cannot set arbitrary roots or balances. Disappearance can cause expiry; any other submitter may continue before expiry. |
| Validator signing-key operator | Signs native consensus duties and exits; controls proposer-tip configuration | Can cause downtime, penalties and tip diversion. Cannot change a canonically established withdrawal recipient through later deposits. Public exit availability limits the new-signature dependency under supported forks. |
| Recovery caller | Starts recovery only after verifier status is permanently expired | Cannot choose weights, recipients, timing before expiry, or increase its own claims. No special role is required. |
| Claimant | Claims its own existing share of actual recovery cash | Cannot transfer its position or choose another beneficiary. A failed payment rolls back and does not block other claimants. |
| Fee recipient | Receives only previously earned cash-backed fees in the reserve model | No entitlement to new recovery fees. The executable recovery contract contains no fee function. Normal fee reserves remain an integration requirement. |
| Owner / admin / proxy admin / upgrader / pauser / multisig / emergency guardian | None in the new candidate contracts | No administrative seizure, balance setter, fee-rate change, permanent discretionary pause or code upgrade. |

## Supplied report alignment

Sections 9 and 10 of the supplied Dutch BV report call for evidence of actual control, independently exercisable exits, verifiable economics and a review of any changed guarantees. These artifacts support that evidence. Tip control, fork-sensitive exits, committee trust and deployment configuration remain explicit facts for the scope review. Removing the transferable receipt does not itself settle the classification of pooled participation rights or services. This phase makes no new legal conclusion or launch-clearance claim.

## Fresh deployment scope

New verifier, observation and recovery storage belongs to new isolated contracts. The old testnet storage and deployment addresses impose no design constraint, and no migration adapter is required. The normal native ledger and coordinated token-code/UI removal remain implementation work. No old on-chain balance or remote service was changed by the retirement clarification, and such cleanup is not a prerequisite for the new deployment.
