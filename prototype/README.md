# Native-QRL safety prototype

Historical prototype phase: the descriptions below record the earlier investigation. The current pooled ledger and frontend replacement are implemented under `native/`; see [the implementation and validation report](../native/IMPLEMENTATION.md). These prototype commands are not active deployment paths.

This isolated prototype tests the prerequisites for QuantaPool's native-QRL redesign against unmodified QRL implementations. It includes a bounded finality verifier, validator-state proof components and a disposable native-return experiment with a deterministic 10% surplus fee. It has no complete staking ledger or transferable receipt token. The old public-testnet contracts are [abandoned experiments](../docs/TESTNET-RETIREMENT.md); the native deployment starts fresh with no legacy migration or compatibility requirement. The token-oriented frontend and monitoring await coordinated replacement.

The [finality feasibility component](finality/README.md) now verifies real sync-committee certificates, finalized-state branches and committee transitions in both the actual QRVM and mined local transactions. Its initial checkpoint is an explicit external trust input. A complete production light client and synchronized economic accounting remain separate implementation dependencies. RPC responses, a local network's finalized flag and agreement between nodes do not supply contract-verifiable authentication.

The next phase adds a [recoverable verifier](recovery/README.md), a [matched finalized execution-cash proof](native/CHECKPOINT-DESIGN.md), and an [irreversible cash recovery experiment](native/CASH-RECOVERY.md). All 676 new QRVM checks pass, including 138 expected reverts. The [candidate decisions](native/DECISIONS.md) select bounded historical recovery, public presigned exits, explicit tip-routing limits, a normal 10% verified net reward fee and zero new recovery fees for review. The complete normal-state pooled ledger remains unimplemented.

The [change and validation record](native/VALIDATION.md) lists files, storage, invariants, limitations and reproducible commands. A subsequently observed [Qrysm loader fix](native/UPSTREAM-REFRESH.md) has been qualified separately; prior captures keep their exact original execution provenance.

| Component | What actually executes | What this establishes |
| --- | --- | --- |
| `protocol/` | Unmodified Qrysm deposit, signature, registry, exit and withdrawal functions on synthetic states | Canonical recipient preservation, bootstrap ordering, signed exits, identity/domain/eligibility rules and zero-withdrawal behavior |
| `contracts/CheckpointProofHarness.hyp` | Latest Hyperion bytecode in unmodified go-qrl QRVM | SSZ membership, complete bounded portfolios, identity, recipient, freshness and terminal-zero checks relative to supplied fixture roots |
| `contracts/FundingGatePrototype.hyp` | Real ML-DSA precompile and unmodified current beacon deposit contract in go-qrl QRVM | Atomic admission checks, publicly stored exit and exact 38,000 QRL top-up following a 2,000 QRL bootstrap |
| `contracts/FinalityFeasibilityVerifier.hyp` | Captured real signatures and state branches in the actual QRVM and mined local transactions | Bounded 86-of-128 positional certificates, authenticated finalized roots, committee transitions and freshness under an explicit bootstrap trust assumption |
| `contracts/FinalizedValidatorRecordProbe.hyp` | One immutable validator's record and balance proofs under the separate verifier's accepted root | Authenticated observations including terminal zero; no economic allocation or asset custody |
| `contracts/RecoverableFinalityVerifier.hyp` | Genuine captured certificates in actual QRVM with simulated time | Historical catch-up without deadline extension, timely economic renewal and irreversible expiry |
| `contracts/FinalizedPoolCashProbe.hyp` | Real paired certificate, SSZ and native account-trie proofs in actual QRVM | Cash, execution block and consumed deposit cursor at one authenticated cutoff; no economic allocation |
| `contracts/CashRecoveryPool.hyp` | Real certificate verification and synthetic cash/time/native withdrawal credits in actual QRVM | Constant-cost immutable recovery claims and late-return rights; no normal-state staking or senior reserves |
| `contracts/NativeReturnProbe.hyp` and `lifecycle/` | One actual local validator funded with 40,000 QRL; separate QRVM cash regressions | Physical native asset return and principal-first 10% surplus fee measurement; no production admission or pooled ledger |
| `network/` and `protocol/cmd/relay-exit` | Source-built EL, CL and validator clients in a loopback Kurtosis network | Actual block production, finality observations and independently submitted public exit messages; see the network evidence for acceptance and inclusion separately |

The completed local lifecycle returned 40,000 QRL principal and 40.339819966 QRL consensus surplus directly to the probe. Actual claims paid 36.3058379694 QRL user rewards and a 4.0339819966 QRL operator fee, leaving zero probe cash. All 57 native withdrawals reconcile, and repeated claims reject. Before claims, mined contracts authenticated finalized state 1664 and validator 64's zero balance from trusted bootstrap 1640, spanning the actual principal withdrawal in block 1649. [Lifecycle results](lifecycle/README.md) distinguish native payouts, incidental fixture proposer tips, contract state proofs and RPC canonicality checks.

The current validation reports contain 1,067 QRVM steps, including getters and 279 expected reverts: 200 finality, 196 validator-record, 544 cash-accounting and 127 earlier accounting/funding steps. Cash regression inputs are synthetic native withdrawal payloads. The separate local-chain results use actual consensus withdrawals and mined contract transactions. Go protocol/relay tests, execution-runner Go vet, compilation and source syntax/style checks also pass.

Measured transaction budgets support further engineering. Production remains a substantial light-client and accounting project. The new candidate permits historical recovery inside an explicit trust window and then expires permanently; the cash recovery experiment demonstrates distribution after that event. The matched proof component supplies the execution/beacon cutoff, while historical user-flow accounting and complete portfolio settlement remain outstanding. A separately reviewed shared verifier could amortize maintenance and gas across applications. No trusted reporting substitute or production funding has been introduced.

## Exact source and tool versions

The revision lock is [source-lock.json](source-lock.json). It supersedes the earlier `config/qrl-upstream-sources.json` snapshot for this prototype only. Heads were frozen at the source refresh on 2026-09-14; future upstream changes require a fresh qualification.

| Component | Pinned revision |
| --- | --- |
| cyyber/go-qrl | `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9` |
| cyyber/qrysm | `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3` |
| cyyber/hyperion | `cee9d335984c139c1dc0b0e84ec13290031ea4b1` |
| cyyber/qrl-genesis-generator | `97d65b671a7b86602e932b6e2ec1e0a9bd5ca22c` |
| cyyber/qrl-package | `04fd3133a7107229531da425dc750129bb691514` |
| Go | `1.26.5` |

The separate Go modules retain their upstream library replacements and checksums. Hyperion uses IR compilation, optimization enabled and one optimizer run. The tested compiler identifies itself as `0.2.0-develop.2026.9.14+commit.cee9d335.Linux.g++`. Compiler/binary hashes and observed versions are written to ignored build artifacts.

The existing Hyperion semantic host and pinned qrvmone use different QRVMC revision identifiers, and the host lacks the required ML-DSA precompile. `execution/` resolves this prototype's testing dependency by running current bytecode in the matching unmodified go-qrl VM. It applies transaction intrinsic gas limits, strict canonical 64-byte ABI return checks and state finalization between actions. Synthetic caller balances exclude transaction fees; this component runner does not submit signed execution transactions or execute network consensus. Retained v2 `.t.hyp` specifications remain outside this executable suite.

Current integration uses 64-byte addresses, 64-byte VM words, 32-byte SSZ/signing roots, 2,592-byte public keys, 4,627-byte signatures, raw 32-byte RANDAO commitments and the five-argument deposit ABI. The prototype compiles the upstream deposit contract directly from the pinned checkout. Its raw 32-byte precompile result is handled by that unchanged contract.

## Reproduce component evidence

Supply pristine checkouts named `go-qrl`, `qrysm` and `hyperion` under `SOURCE_ROOT`. Build the pinned Hyperion compiler in its checkout with its documented dependencies:

```bash
cmake -S "$SOURCE_ROOT/hyperion" -B "$SOURCE_ROOT/hyperion/build" -DCMAKE_BUILD_TYPE=Release -DUSE_Z3=OFF -DUSE_CVC4=OFF
cmake --build "$SOURCE_ROOT/hyperion/build" --target hypc -j2
node prototype/run-components.js "$SOURCE_ROOT" --upstream-tests
```

Run the last command from QuantaPool. It verifies exact source commits, cleanliness and required audit-fix ancestry before and after execution. It compiles the earlier accounting/funding components and the unchanged beacon contract, builds the Go VM runner, regenerates public signed funding vectors, runs the protocol tests, executes both contract plans and optionally runs the selected upstream regression suites. It writes plans, logs and version/hash metadata under ignored `build/prototype/`. The newer [finality](finality/README.md#reproduction) and [cash regression](lifecycle/PROBE-REGRESSIONS.md#reproduce) commands are documented separately.

The completed component run passed 91 accounting steps, 36 funding steps, nine top-level prototype Go tests with four identity/domain subtests, and 90 selected upstream top-level tests with 748 subtests across six packages. Step counts include getters, assertions and expected reverts. All negative cases require actual contract reversion; an out-of-gas failure does not count as the expected rejection. The signed funding call used approximately 2.8 million gas including intrinsic gas before refunds, below the 20-million limit. Random ephemeral signatures can change calldata gas slightly between runs.

The accounting suite includes 39 expected reverts. It checks canonical public-key/validator roots against native and protobuf Qrysm hashing on its synthetic states; malformed branches, identities, list lengths and recipients; omitted, repeated and reordered portfolio members; atomic rollback; future, stale, replayed and regressing checkpoints; and positive, active-zero and terminal-zero states. Real populated states exposed a generated protobuf participation-root discrepancy, described in the [capture diagnostic](finality/capture/README.md#state-hash-diagnostic). Live proofs use the consensus-native root matching the actual block header. The five proven fixture balance totals are 80,000, 77,000, 41,000, 41,000 and 40,000 QRL. Configured loss snapshots demonstrate proof interpretation. They do not execute a full validator slashing transition or implement user loss allocation.

The funding suite executes both real 2,000 QRL deposits and the successful 38,000 QRL top-up in the current beacon contract. The checkpoint proving the bootstrap is produced separately by actual Qrysm `ProcessDeposit` calls on synthetic state. These two component executions are joined by the explicit test fixture, without a live cross-layer finality proof. Incorrect existing recipients, forged recipient proofs, wrong keys, missing/invalid exits, genuinely signed far-future exits, RANDAO mismatch, invalid deposit signatures and incorrect deposit roots all fail. Failure preserves contributor funds and rolls back exit storage. Successful funding leaves the gate with zero QRL and an independently retrievable exit; replay cannot fund the same index twice.

## Authenticated accounting dependency

The intended production trust anchor must be an independently bootstrapped QRL finalized checkpoint and a contract-verifiable sequence of light-client updates. The pinned [Qrysm light-client update code](https://github.com/cyyber/qrysm/blob/9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3/beacon-chain/blockchain/lightclient.go) provides relevant upstream structures. The implemented feasibility verifier uses native sync signatures and SSZ proofs with a fixed-fork, occupied-slot subset. Its production recovery, fork, missed-slot and security policies remain unfinished.

The component binds each contribution to an immutable update commitment, checks at most 12 positions per call, rejects repeated positions and commits a root only after 86 authenticated positions. It preserves repeated keys in different positions. Measured cold-cache and warm-cache updates cost about 39.7 million and 23.4 million gas across bounded transactions. An extrapolated 86-distinct-key update costs about 45.2 million gas; that number is a model, not a larger-network measurement. Actual signed transactions fit the 128 KiB node limit. See the [cost and trust analysis](finality/README.md) for precise limits, cadence models and the sampled-committee security assumption. Bootstrap security and long inactivity still require an explicit production checkpoint policy.

After finality verification, the economic layer still needs a synchronized execution/beacon accounting checkpoint. Adding today's execution-contract balance to an older finalized beacon balance can double-count an already credited withdrawal. A beacon balance decrease can represent a reward withdrawal, principal withdrawal or validator loss. Proven withdrawal tuples and mechanical subsequent deposits/claims must reconcile those movements before booking rewards or losses. Global accounting and fee invariants belong to that later layer.

The pinned execution header commits to a withdrawal root and has no parent beacon-state root. A recent-block withdrawal inclusion proof can help authenticate a positive payment. It cannot prove complete finalized validator balances or a zero-balance terminal exit. Withdrawal credit does not call a pool receiver function. The protocol test confirms a terminal zero balance produces no payment receipt, so the full validator lifecycle and balance need a state proof.

`CheckpointProofHarness` bounds the registered portfolio to eight indices and accepts a complete ordered observation atomically. Its constructor fixes roots, registered identities, intended pool recipient and freshness limits. These checks demonstrate component invariants under that anchor. They cannot reveal an unfinalized later loss or an omitted validator that was never admitted to the registry. Production funding must make registry completeness enforceable, and deposit/withdrawal settlement must address the delay between economic events and finalized knowledge.

## Recipient and exit sequencing

Unmodified Qrysm retains the withdrawal recipient established by the first accepted deposit for a public key. A later deposit that supplies a pool address does not rebind an existing key. Therefore pool funding must first authenticate the canonical validator record, index, public key and full 64-byte recipient.

The demonstrated sequence is: operator pays the 2,000 QRL minimum bootstrap; consensus creates the canonical inactive validator index; the operator signs an epoch-zero exit for that index and chain; the pool verifies the canonical record and exit, stores the public message, then funds the remaining 38,000 QRL. A fresh index and signed exit exist before pooled funding in the actual protocol-function tests. Live finality authentication of that bootstrap remains the dependency. The prototype does not define ownership or reimbursement accounting for operator bootstrap capital. Its deployment accepts immutable fixture contract addresses; production must pin and validate the chain's canonical deposit contract.

The gate enforces epoch zero so a correctly signed future epoch cannot postpone exit indefinitely. Eligibility still requires activation plus the unchanged 16 active epochs. The signed public exit can then be submitted by an independent party. Contract storage makes its signature available independently of the operator; practical RPC access and a willing relayer remain liveness requirements.

Publishing a valid exit also lets any holder force an exit once eligible, even without pool withdrawal demand. This can disrupt staking availability and cause replacement costs. Keeping the message conditionally secret would introduce another availability/control assumption. In addition, the current signing-domain rules retain only the current/previous fork versions: tested synthetic fork transitions show an old exit failing after its version leaves that pair. A permanent operator-disappearance guarantee across arbitrary future forks has not been demonstrated.

## Local network and remaining work

Use the [network reproduction instructions](network/README.md) and [public exit relay](protocol/README.md). Local timing is six-second slots and eight slots per epoch. Exit eligibility remains 16 active epochs, and the minimum interval from assigned exit epoch to withdrawable epoch remains 16 epochs. Exit scheduling/churn and the withdrawal sweep can add time. Current Qrysm requires a 64-epoch execution voting period at that slot count to preserve its compiled 512-slot SSZ dimension; the project-owned configuration wrapper supplies that supported parameter. No consensus source or network rule is patched. The hosted private v3 network was inspected read-only and uses older revisions.

Live genesis-validator exit evidence establishes independent submission under an actual node and fork. Genesis validators already have indices and funding. It cannot establish a newly bootstrapped validator's full live deposit/finality/funding sequence, and the genesis fixture's zero recipient cannot demonstrate a withdrawal credit to a pool contract.

The live run prepared validator 63's epoch-zero public exit at head slot 17. An independent relay received the expected premature rejection, then submitted the same message at head slot 130 in epoch 16. It received HTTP 200, and block slot 131 included that exact message. At 13:13:42 UTC on 2026-09-14, finalized checkpoint slot 136 showed the validator scheduled to exit at epoch 21 and become withdrawable at epoch 37. The relay used no signing key. Normal local consensus services continued running. These are separately recorded RPC/block observations, without a contract finality-verifier claim.

The finality experiment has now executed four real captured updates and committee transitions in mined transactions. Separate fresh captures advanced the same deployed verifier through finalized states 864 and 896 within its 64-slot policy. The [native-return lifecycle](lifecycle/README.md) uses a separate three-second local clock and unchanged consensus counts. Its test scope and exact run results are recorded there. Native public launch requires a reviewed verifier policy, synchronized execution/beacon reconciliation and supported exit/reward guarantees. Native implementation has no dependency on the abandoned testnet's balances, validators or availability.

Execution/transaction-fee routing remains operator-controlled. The new candidate policy proposes enforceable claims only on authenticated assets actually received, with routing monitoring and explicit disclosure for review. Existing reward promises and deployments have not been changed. The earlier cash probe pays immutable beneficiaries and earns a deterministic 10% fee after recovery of all contributed capital. Its conservative cash basis differs from the future pooled reward/loss ledger and from the new fee-free recovery policy. This prototype provides no production non-custody or regulatory clearance claim.
