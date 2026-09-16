# Native QRL finality-verifier feasibility

This component verifies captured QRL sync-committee signatures, a finalized-header proof and authenticated committee transitions in Hyperion contracts against unmodified QRL clients. The direct go-qrl QRVM suite passes 200 checks, including 64 expected contract reverts and four captured updates. A separate local-chain run has mined the same four updates. These results establish a bounded implementation path; production pooled accounting and a complete light client remain unfinished.

The executable contract is [FinalityFeasibilityVerifier.hyp](../contracts/FinalityFeasibilityVerifier.hyp). Inputs and their independent native verification are described in [capture/README.md](capture/README.md). No production pool, UI, existing deployment, legacy balance or upstream consensus code is modified by this component.

## Pinned source and actual consensus primitives

The authoritative revisions are recorded in [source-lock.json](../source-lock.json):

| Component | Revision |
|---|---|
| cyyber/go-qrl | `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9` |
| cyyber/qrysm | `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3` |
| cyyber/hyperion | `cee9d335984c139c1dc0b0e84ec13290031ea4b1` |
| Go toolchain | `go1.26.5` |

Sync signatures are consensus-enforced at these revisions. The ordinary block transition calls [`ProcessSyncAggregate`](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/transition/transition_no_verify_sig.go#L330), whose [`VerifySyncCommitteeSigs`](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/altair/block.go#L138) verifies each ML-DSA signature over the previous-slot beacon block root with the sync domain derived from the previous slot's epoch, fork and genesis validators root. The transition also checks the resulting [state root against the block](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/transition/transition_no_verify_sig.go#L78).

Native state methods supply [current committee, next committee and finalized-root branches](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/state/state-native/proofs.go#L31). Their generalized indexes are 54, 55 and 105, with five, five and six branch nodes. The first finalized-root sibling is the checkpoint epoch. Committee public-key-root membership uses seven branch nodes for a fixed vector of 128 positions. All SSZ hashes are 32-byte SHA-256 values; the execution ABI uses 64-byte words and addresses.

The execution header contains an execution-state root and a withdrawals root, with [no beacon-state/root field](https://github.com/cyyber/go-qrl/blob/9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9/core/types/block.go#L38). This prototype therefore adds an application-level verification component. An RPC response, an execution block hash or agreement among RPC nodes does not itself authenticate arbitrary validator balances or a zero-balance terminal exit to the contract.

## What authenticates an accepted state

Deployment fixes a recent bootstrap beacon-header root, its current and next committee roots, and the chain configuration. The constructor recomputes the bootstrap header's SSZ root and verifies both committee branches under its state root. The trusted root itself is an external input.

For this experiment, the bootstrap is captured local-chain header 80. The capture process checks the expected chain/genesis identity and independently recomputes native state roots and signatures. One controlled local network supplies the history. This proves implementation behavior with real protocol data; it does not demonstrate decentralized bootstrap selection or independent network operators.

A production bootstrap needs an explicit source and review procedure before users fund the deployed protocol. Independent reviewers must establish the intended chain, a sufficiently recent finalized checkpoint, its provenance, fork configuration and deployed bytecode/constructor inputs. Multiple node observations can assist that review, but they remain external bootstrap evidence. If the pool operator alone supplies an unchecked bootstrap root, it could install an arbitrary initial committee. Constructor immutability does not establish the truth of that initial root.

The two disposable fixtures, chain IDs 3151914 and 3151915, share their `genesis_validators_root` and fork version, so they also share their native sync and exit signing domains. Local execution guards check genesis time, deposit chain ID and execution genesis as operational identity controls; these values do not enter those native signature domains. Shared fixture domains therefore provide no cryptographic cross-network separation. Production requires an explicit assumption that the chosen consensus signing domain and trusted bootstrap committee/key population belong to the intended chain. This verifier authenticates committee certificates without replaying header ancestry or complete state transitions.

Once bootstrapped, a successful update performs these checks:

1. Authenticate at least 86 distinct committee positions with real ML-DSA signatures over the attested header's signing root.
2. Verify the finalized header's SSZ root at `finalized_checkpoint.root` inside that attested header's state root, including the checkpoint epoch.
3. Verify the subsequent committee root inside the finalized header's state root.
4. Advance finalized state and rotate committees only after quorum and repeat the freshness, ordering and committee-eligibility checks at finalization.

This is a sync certificate authenticating a head and its finalized-state claim. QRL's own whole-network finality uses [stake-weighted epoch attestations and justification/finalization rules](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/epoch/precompute/justification_finalization.go#L70). This contract does not replay those rules or verify every active validator's finality vote.

The security assumption is therefore the correctness of the trusted bootstrap, the authenticated committee's signing behavior and the underlying chain's consensus. A committee able to supply the required signatures on a fabricated state claim can defeat this verifier. The component provides no independent fraud proof or full-state transition verification to recover from that event.

## Quorum, repeated positions and committee changes

The 86-of-128 threshold is an explicit application policy. The pinned native signature verifier accepts the signatures actually present; it requires no 86-position minimum for block validity. The [configured light-client update participation minimum is one](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/config/params/mainnet_config.go#L218). Native block production can continue while this component lacks enough signatures to advance.

The actual [committee selection algorithm permits repeated validators](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/altair/sync_committee.go#L117). Consequently, quorum counts authenticated positions, not unique public keys. A bitmap prevents counting one position twice; two valid positions occupied by the same key both count. Every submitted position still performs its own signature verification. The on-chain key cache only avoids recomputing the same 2,592-byte public key's SSZ root. Cache insertion verifies the full key, and later uses check its hash.

The [native epoch transition promotes next committee to current](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/altair/epoch_spec.go#L23) every eight epochs. The verifier accepts the current period or the immediately following period. A transition uses the already authenticated next committee for signatures; its replacement next committee must be proved from the newly finalized state. Same-period updates must retain the previously authenticated next root. A caller cannot substitute a new committee using an unauthenticated RPC response.

Each candidate is indexed by `keccak256(abi.encode(attestedHeader, finalizedHeader, nextCommitteeRoot))`. An incomplete candidate does not monopolize a global pending-update slot. Calls are permissionless, vote batches contain at most 12 positions, and expired or superseded candidates can be discarded. This bounds each transaction, but it does not eliminate state-growth costs from many candidates or newly encountered public keys.

## Deliberately supported subset and freshness

The component fixes one fork and genesis configuration. It supports an occupied attested slot followed by an occupied signature slot, deriving `signatureSlot = attested.slot + 1`. It requires an occupied finalized epoch-boundary header, a matching checkpoint epoch, and a finalized period equal to the signing period. The actual native [committee duty at a period boundary](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/blockchain/head_sync_committee_info.go#L55) matters here. Missed slots, arbitrary signature-slot gaps, signatures crossing unsupported boundaries and future fork rules require additional protocol-specific design. Unsupported inputs fail closed.

Freshness is measured from the authenticated attested-header slot against execution `block.timestamp`, with the derived signature slot required to have occurred. It is checked when staging, submitting and finalizing. Finalized slots advance strictly; replay and regression are rejected. A quorum collected before expiry cannot finalize after expiry.

The VM experiment uses a 64-slot age limit on a network with six-second slots and eight-slot epochs: 6 minutes 24 seconds. This is a test policy. The [pinned mainnet parameters](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/config/params/mainnet_config.go#L83) use 60-second slots and 128-slot epochs. Mainnet finalized checkpoints can already be several epochs behind head, so the local 64-slot bootstrap/freshness choice cannot simply be copied into a mainnet deployment.

There is no administrator, upgrader, mutable checkpoint setter, funds transfer or operator exception in this verifier. Anyone with available witnesses and signatures can continue supported updates. Insufficient participation, unavailable historical data, an unsupported fork or a stale starting checkpoint can stop progress. The current component contains no stale-bootstrap replacement or recovery authority. A production recovery and user-exit policy must be designed explicitly. The native [weak-subjectivity calculation](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/core/helpers/weak_subjectivity.go#L58) does not automatically establish a safe recovery policy for this sampled-committee verifier.

### Prolonged inactivity can permanently stop this instance

The combination of current/current-plus-one periods and freshness on every vote batch has a specific catch-up limit. Let `P` be the stored current period, `L` the slots per committee period, `A` the configured age limit and `N` the current execution slot. A permitted candidate has signature period at most `P + 1`. Because its signature slot is derived as `attestedSlot + 1`, its attested slot can be no later than `(P + 2) * L - 2`. Once `N > (P + 2) * L - 2 + A`, every candidate the instance could accept is stale. This is an impossibility condition even if every historical block, proof and signature is available; missed slots or missing quorum can make the usable window shorter.

With pinned mainnet parameters, `L = 1,024` slots, or 17 hours 4 minutes. The remaining catch-up time depends on the stored period and the point at which updates stopped. As an illustration only, an age setting of 512 slots contributes 8 hours 32 minutes of age budget; the exact cutoff above includes the signing-slot offset. This is not a proposed production freshness or weak-subjectivity policy.

An already staged certificate also expires: further submissions and finalization recheck the same age bound. Discarding expired proposals clears their storage but does not advance or replace the trusted committee. Additional relayers cannot recover an instance after the impossibility condition is reached, and its immutable consumers cannot switch verifier addresses. A pool whose only withdrawal path depended on such an instance could therefore lose withdrawal liveness after prolonged operator and relayer inactivity. No user funds depend on this experiment.

Before production funding, the application needs a reviewed solution for authenticated historical catch-up and recovery. One design direction separates verification of a historical committee chain from the freshness gate on economic settlement, while preserving explicit long-range trust limits. User exit behavior during an extended verification outage must also be specified. This experiment implements neither that broader verifier nor an administrative checkpoint override.

## Executed verification and measured costs

The captured inputs advance from bootstrap 80 through finalized slots 96, 128, 192 and 272, with signatures at slots 113, 145, 209 and 289. Three transitions authenticate committee changes. The first changes reorder the same 64 keys; the last removes an exited validator and contains 63 unique keys across 128 positions. Full native capture verification covers all 512 supplied signatures. Details and the native/protobuf state-root diagnostic are in [capture/README.md](capture/README.md); every accepted proof uses the actual consensus-native/header root.

The 200 direct QRVM checks include header, branch, key, signature and domain corruption; 85-position rejection and 86-position acceptance; duplicate-position rollback; key-cache substitution; competing-candidate progress; committee-period skips; stale/future input; finalization-time expiry; and replay. The runner executes actual compiled bytecode with native intrinsic gas and per-transaction state finalization. Its initial state and clock are fixtures, and its account balances exclude transaction fees.

Measured gas below includes intrinsic gas and is before refunds. Successful update transactions are counted separately from getters and expected rejections:

These quoted verifier costs exclude verification of a complete registered-validator portfolio and execution/beacon economic reconciliation. Those additional operations need their own measurements before estimating the complete pool's settlement cost.

| Captured verification | Positions | Unique keys | Transactions | Gas | Calldata bytes |
|---|---:|---:|---:|---:|---:|
| First update, cold key cache | 86 | 64 | 11 | 39,720,747 | 719,020 |
| Second update, cached keys | 86 | 64 | 11 | 23,370,873 | 719,020 |
| Third update, cached keys | 86 | 64 | 11 | 23,368,809 | 719,020 |
| Fourth update, membership removal | 86 | 63 | 11 | 23,370,765 | 719,020 |
| Separate full captured committee | 128 | 64 | 13 | 50,915,765 | 1,068,852 |

Deployment uses 2,097,939 gas. The largest measured call uses 6,301,586 gas and 100,036 calldata bytes, within the 20-million gas bound and conservative calldata limit. The 86-position sequence deliberately uses an extra final single-position transaction to demonstrate the 85/86 boundary; packing the last two positions together would change its cost. Total update gas spans several transactions and blocks.

The signature [precompile costs 125,000 gas](https://github.com/cyyber/go-qrl/blob/9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9/params/protocol_params.go#L91) per position. Public-key SSZ hashing, ABI handling, branch verification, storage and calldata add substantial cost. A controlled pair of actual single-position calls measures a 249,543-gas execution premium for a newly cached key. Both calls begin with nonzero proposal counters; the second authenticates another position containing the same key.

Applying that premium gives the following **models**, not executions on a network of 128 distinct validators or formal worst-case bounds:

| Modeled key distribution | Gas before refunds |
|---|---:|
| 86 positions with 86 previously unseen keys | 45,210,693 |
| 128 positions with 128 previously unseen keys | 66,886,517 |
| 86 positions with cached keys and rotation | 23,370,873 measured baseline |

At an illustrative gas price of 1 shor/gas, these correspond to approximately 0.04521, 0.06689 and 0.02337 QRL per update. These prices are scenarios, not network quotes. The generated report includes 0.1, 1 and 10 shor/gas, without fiat prices or assumed returns. At pinned mainnet timing, one committee period is 61,440 seconds (17 hours 4 minutes); one epoch is 7,680 seconds (2 hours 8 minutes). Maintaining the committee chain once per period and refreshing economic accounting once per finalized epoch are different workloads. At 1 shor/gas, the cached baseline models about 0.986 QRL per 30 days for the former and 7.888 QRL for the latter, excluding outages, retries, storage growth, relayer infrastructure and settlement integration.

For a conservative budget that charges every epoch at the modeled 86-new-key cost of 45,210,693 gas, a 30-day average contains 337.5 updates. At the hypothetical price of 1 shor/gas, that is **15.258608888 QRL per 30 days** before refunds. If a deterministic operator fee were 10% of eligible gross rewards, approximately **152.586088875 QRL of gross rewards per 30 days** would be needed for that fee alone to cover this relay budget. This is a break-even calculation, with no assumed reward rate or guaranteed return, and excludes infrastructure, validator operation, additional accounting transactions, retries and other costs. Persistent caches make the all-new-key charge a budgeting scenario rather than a forecast for every epoch of the same committee.

The same 45,210,693-gas update occupies approximately **1.766%** of the theoretical `20,000,000 * 128 = 2,560,000,000` gas capacity of one mainnet epoch with every slot occupied. Other traffic, missed blocks, transaction scheduling and gas-price changes affect available capacity. The update remains split across bounded transactions.

### Live mined evidence

The separate historical replay has completed 45 mined transactions on the identified disposable chain: deployment and four updates. Receipts record 111,881,071 total gas, 3,219,246 total signed transaction bytes and 0.279702678283167497 QRL in actual local transaction fees. The accepted final state is slot 272, period 4. There are also 26 expected read-only `qrl_call` rejections; those are not mined rejection transactions.

Historical replay uses an explicit 4,096-slot age window because the continuously running chain has advanced beyond the captured history. It therefore establishes actual transaction inclusion, signed-envelope sizing, fees and contract execution for the historical certificate chain. It does not establish the VM experiment's 64-slot freshness property on those old inputs. The separate fresh-capture mode and its latest execution status are documented in [LIVE-RUN.md](LIVE-RUN.md), maintained with the live-run evidence.

### Authenticated validator-record consumer

[FinalizedValidatorRecordProbe.hyp](../contracts/FinalizedValidatorRecordProbe.hyp) consumes the actual verifier's current `finalizedSlot` and `finalizedStateRoot`. It verifies a whole registered validator record, its balance, matching canonical list lengths, withdrawal recipient and state-slot proof. The immutable consumer policy adds a finalized-state age limit and strictly increasing observations. This small contract accepts no QRL, grants no withdrawal entitlement and performs no reward/loss classification.

Two actual-QRVM runs authenticate real validator 63 observations after successful 86-position certificate verification: 117 historical checks with 37 expected reverts, and 79 fresh checks with 33 expected reverts. They use separate trusted bootstraps, not one continuously verified chain across the gap:

| Finalized slot | Proven balance in shor | Exit epoch | Withdrawable epoch | Terminal |
|---|---:|---|---|---|
| 96 | 40,001,391,396,870 | Far future | Far future | No |
| 128 | 40,001,391,396,870 | Far future | Far future | No |
| 192 | 40,000,025,099,712 | 21 | 37 | No |
| 272 | 40,000,000,000,000 | 21 | 37 | No |
| 864 | 0 | 21 | 37 | Yes |
| 896 | 0 | 21 | 37 | Yes |

The fresh observations cost 278,470 and 261,432 gas before refunds, each with 7,364 calldata bytes. Negative cases cover wrong identity, recipient, validator fields, balance chunk, branches, list lengths, state slot, freshness, replay and native-value submission. A falling beacon balance by itself does not establish slashing or an economic loss: reward sweeps and principal withdrawals also reduce that balance.

This existing genesis validator has a canonical zero withdrawal recipient. The probe deliberately permits that fixed observation target to test authentic historical data. It accepts no funding and provides no authorization to admit a zero-recipient validator into a pool. The live consumer's separately mined evidence, when executed, belongs in [LIVE-RUN.md](LIVE-RUN.md); the counts above describe direct QRVM execution.

## Remaining work before pooled accounting

- **Complete verifier policy:** missed signing slots and epoch boundaries, future forks, adversarial committee changes, bootstrap/recovery policy, long-range key compromise, state growth and sustained update liveness need specification and review. Available [native light-client construction helpers](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/blockchain/lightclient.go#L137) do not themselves provide this contract policy.
- **Atomic economic checkpoints:** finalized validator balances must be synchronized with execution cash, deposits in transit, completed withdrawals and user liabilities. Adding current cash to an older beacon balance can double-count a withdrawal that has already reached execution. A production settlement needs an authenticated common cutoff and deterministic tracking of subsequent cash flows, with each withdrawal recognized once.
- **Complete validator portfolio:** extend the fixed-record consumer to every registered validator, preserving duplicate/omission checks, canonical withdrawal recipient, freshness and explicit zero-balance terminal conditions. The earlier [checkpoint fixture harness](../contracts/CheckpointProofHarness.hyp) demonstrates complete-portfolio proof components under fixture roots. Combining those components with actual finality and reconciled native-QRL accounting remains unfinished.
- **Pending economic events:** depositor eligibility, reward accrual, losses, stake changes and queued withdrawals must use a settlement policy that prevents entry/exit around unrecognized rewards or losses. A recent authenticated root alone does not solve delayed economic recognition.
- **Native pool behavior:** operator fees, principal/reward separation, scalable loss accounting, deterministic withdrawal ordering and enforceable operator-disappearance behavior remain part of the paused native-QRL refactor. No operator fee entitlement or custody guarantee follows from this certificate experiment alone.

The next bounded implementation step is a separate accounting prototype consuming `finalizedStateRoot`, a complete registered-validator proof set and an execution-cash cutoff, with conservation tests across pending deposits and withdrawals. Validator admission, presigned exit handling and execution/transaction-tip routing remain separate workstreams. This document records no acceptance of their unresolved guarantee changes.

## Reproduction

From QuantaPool, set `QRL_PROTOTYPE_SOURCE_ROOT` to a directory containing the exact pinned `go-qrl`, `qrysm` and built `hyperion` checkouts. The component runner checks those sources before and after execution. Captured input files remain in ignored findings storage; [capture instructions](capture/README.md) describe their regeneration on the identified local network.

```sh
node prototype/run-components.js "$QRL_PROTOTYPE_SOURCE_ROOT"
"$QRL_PROTOTYPE_SOURCE_ROOT/hyperion/build/hypc/hypc" --abi --bin --bin-runtime --optimize --optimize-runs=1 --via-ir --base-path=prototype/contracts --output-dir build/prototype --overwrite prototype/contracts/FinalityFeasibilityVerifier.hyp
node prototype/finality/make-plan.js
build/prototype-execution -plan build/prototype/finality-plan.json -report build/prototype/finality-execution.json
node prototype/finality/cost-report.js
```

The plan generator checks the witness's Qrysm pin, native verification marker, header roots and occupied-slot relationship, then writes the executable plan and input-hash metadata. The gas report checks that every recorded step matches that plan and derives costs only from successful begin/submit/finalize operations. Outputs are `build/prototype/finality-plan.json`, `finality-plan.meta.json`, `finality-execution.json` and `finality-costs.json`. Follow [LIVE-RUN.md](LIVE-RUN.md) for the separately guarded commands that send local transactions.

For the fixed-record consumer, first export the selected validator's witnesses with the native capture analyzer. These commands preserve the existing finality plan and compiled verifier:

```sh
"$QRL_PROTOTYPE_SOURCE_ROOT/hyperion/build/hypc/hypc" --abi --bin --bin-runtime --optimize --optimize-runs=1 --via-ir --base-path=prototype/contracts --output-dir build/prototype --overwrite prototype/contracts/FinalizedValidatorRecordProbe.hyp
GOWORK=off GOMAXPROCS=2 go -C prototype/protocol run -mod=readonly -tags=develop ../finality/capture/analyze.go -capture-dir ../../findings/native-qrl-finality/fresh -output ../../findings/native-qrl-finality/fresh/witness-with-validator63.json -validator-index 63
node prototype/finality/make-record-plan.js
build/prototype-execution -plan build/prototype/finality-record-plan.json -report build/prototype/finality-record-execution.json
GOWORK=off GOMAXPROCS=2 go -C prototype/protocol run -mod=readonly -tags=develop ../finality/capture/analyze.go -capture-dir ../../findings/native-qrl-finality/capture -output ../../build/prototype/historical-validator63-witness.json -validator-index 63
node prototype/finality/make-record-plan.js build/prototype/historical-validator63-witness.json findings/native-qrl-prototype/network.json build/prototype build/prototype/historical-record-plan.json
build/prototype-execution -plan build/prototype/historical-record-plan.json -report build/prototype/historical-record-execution.json
```
