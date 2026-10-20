# Recovery verifier execution tests

[RecoverableFinalityVerifier.hyp](../contracts/RecoverableFinalityVerifier.hyp) separates authenticated historical committee progress from the freshness required for economic use. Its immutable recovery-window policy can be renewed only by a fully verified, sufficiently fresh finalized checkpoint accepted before the existing deadline. Once that deadline lapses, the instance cannot resume verification. Economic consumers must call `economicCheckpoint()`; the raw finalized-state getters can expose historical progress.

The direct go-qrl QRVM suite passes **224 checks, including 60 expected contract reverts**. It verifies real ML-DSA signatures and SSZ witnesses captured from the pinned, unmodified QRL fixture network. Execution state, initial balances and time are test fixtures. These results establish neither a live mined recovery deployment nor production economic wind-down.

## Executed scenarios

The main instance uses an economic age limit of 64 slots and a recovery window of 256 slots. Its bootstrap is slot 80. At simulated slot 209, it accepts the captured historical updates to finalized slots 96 and 128. Both remain economically stale, and neither changes trust anchor 80 or deadline 336. The next captured update reaches finalized slot 192, which is fresh at slot 209 and renews the anchor. A subsequent update reaches finalized slot 272 and renews again.

| Observation | Result |
|---|---|
| Historical proof and genuine signatures within the recovery window | Advances verified history |
| Historical progress without a fresh finalized checkpoint | Leaves anchor and deadline unchanged |
| Economic getter during historical catch-up | Reverts |
| Fresh finalized checkpoint accepted before the previous deadline | Renews anchor and restores economic availability |
| Missing committee period | Reverts |
| Wrong bootstrap/header/committee roots, branches, key or signature | Reverts |
| 85 authenticated positions | Cannot finalize |
| Duplicate position in a batch | Reverts atomically, including cache insertion |
| Economically stale active historical proposal | Cannot be discarded merely for staleness |
| Superseded or expired proposal | Can be discarded permissionlessly |

Separate instances use a 65-slot recovery window with the same 64-slot economic age limit. Their initial deadline is slot 145. The genuine captured period-2 certificate is accepted and renews one instance exactly at slot 145. At slot 146, the same still-fresh certificate cannot begin on an expired instance; an already staged 85-position candidate cannot receive its last vote; and a fully signed candidate cannot finalize. This tests expiry using authentic certificate data that would otherwise qualify, including the rule that a newly claimed fresh checkpoint cannot renew an already expired trust anchor.

The suite also tests implicit expiry before any keeper transaction, permissionless irreversible expiry recording, proposal cleanup without revival, exact economic-freshness boundaries, exact recovery-deadline boundaries and inability to force expiry early. The largest successful signature batch uses 100,036 calldata bytes and 6,304,280 gas before refunds. All signatures execute in the actual pinned go-qrl VM; these are not signature mocks.

## Security boundary

The 64/256 and 64/65 configurations are test policy choices. They do not establish a protocol-derived safe lifetime for historic committee keys. The prototype retains the explicitly trusted bootstrap, native signing-domain assumptions, 86-of-128 positional quorum and fixed-fork/occupied-slot subset described in [the finality experiment](../finality/README.md). A recovery window assumes adequate committee-key honesty against retrospective forgery during that interval. Arbitrary outage followed by sufficient retired-key compromise cannot be resolved from these certificates alone.

Source review found the deadline arithmetic and renewal ordering consistent with the intended rules: the deadline uses a widened sum; all mutation paths check the prior deadline; historical checkpoints cannot renew it; and cleanup changes no anchor. Expiry is visible through `status()` even before `expire()` records its flag. Consumers must use that status instead of relying solely on the stored flag. No administrator can reset roots or replace the expired verifier in this component.

The verifier accepts no funds. A separate wind-down design must preserve existing beneficiaries and liabilities, stop new funding, retain available exit authorizations and distribute only economically attributable recovered QRL. These tests do not prove complete-portfolio accounting, cash/beacon reconciliation, native reward fees or user claims during wind-down.

## Reproduce

Use the exact source/toolchain revisions in [source-lock.json](../source-lock.json) and the existing [captured witness](../finality/capture/README.md). Set `QRL_PROTOTYPE_SOURCE_ROOT` to the directory containing the pinned source checkouts. The original finality experiment and its plan are preserved.

```sh
"$QRL_PROTOTYPE_SOURCE_ROOT/hyperion/build/hypc/hypc" --abi --bin --bin-runtime --optimize --optimize-runs=1 --via-ir --base-path=prototype/contracts --output-dir build/prototype --overwrite prototype/contracts/RecoverableFinalityVerifier.hyp
GOWORK=off GOMAXPROCS=2 go -C prototype/execution build -mod=readonly -p=2 -o ../../build/prototype-execution .
node prototype/recovery/make-plan.js
build/prototype-execution -plan build/prototype/recovery-plan.json -report build/prototype/recovery-execution.json
```

The generator checks the witness's pinned Qrysm revision, captured roots and expected slot progression. It writes `build/prototype/recovery-plan.json` and `recovery-plan.meta.json`; the latter records the input SHA-256 and policy parameters. The runner's JSON report records each step's gas, calldata size and expected-revert status. Its gas includes native intrinsic gas and is reported before refunds. Initial fixture-account balances exclude transaction fees.
