# Live certificate transaction measurements

The live runner deploys `FinalityFeasibilityVerifier` and submits actual captured Qrysm certificate inputs on the isolated source-pinned chain `3151914`. It verifies the execution genesis, beacon genesis, chain ID, client images and loopback host bindings before selecting published fixture account 0. It reads no ambient signing seed. The native-return experiment on chain `3151915` remains separate.

The component first passed its direct go-qrl VM suite. The live runner then records actual transaction receipts, gas used, effective gas price, signed transaction size and calldata size. Native fees are `gasUsed * effectiveGasPrice`. Expected rejection checks use explicitly labeled read-only `qrl_call`; they consume no transaction gas and demonstrate no block inclusion. Successful constructor, begin, vote batch and finalize operations are actual mined transactions.

## Historical replay

The original capture begins with trusted bootstrap slot 80 and follows finalized slots 96, 128, 192 and 272. Period transitions include the actual later removal of the exited fixture validator from committee membership. The runner selects those positive updates from the passing VM plan and submits 86 authenticated committee positions per update in batches of at most 12. It checks rejection before quorum and the exact accepted roots and periods after finalization.

The continuing local chain has advanced beyond the VM suite's historical execution timestamps. Historical replay therefore deploys with an explicit 4096-slot age bound, equivalent to 6 hours 49 minutes 36 seconds on this six-second fixture. This is a measured historical replay configuration. The separate fresh mode retains the 64-slot bound.

```bash
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151914 node prototype/finality/live.js --execute-local-finality
```

Input files are `build/prototype/finality-plan.json` and its metadata. Detailed local receipts and identities are written to ignored `findings/native-qrl-finality/live/live-run.json`. The file records the exact artifact and plan hashes; retries preserve completed operations. Keep the input plan and compiled artifact fixed during a run.

## Fresh capture mode

Fresh mode consumes the separate capture analyzer's witness directly. Its first input contains a recent explicitly trusted bootstrap and one verified update. A second input appends the next update while preserving the bootstrap and first update identities. The same deployed contract advances through the committee transition. Each mined transaction records the actual slot age of its input, and the contract enforces the unchanged 64-slot bound.

```bash
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151914 node prototype/finality/live.js --execute-fresh-finality FIRST_WITNESS_JSON
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151914 node prototype/finality/live.js --execute-fresh-finality SECOND_WITNESS_JSON
```

Fresh mode writes to ignored `findings/native-qrl-finality/fresh-live/live-run.json`. Capture schedules must leave enough time for the bounded transactions before input expiry. Occupied signing slots, finalized epoch boundaries, the fixed fork and authenticated predecessor committee relationships remain required.

## Pipelined votes and selected-validator records

Adding `--pipeline-votes --observe-validator` to fresh mode qualifies the same update with explicitly ordered transaction nonces and a selected validator witness. At most eight independent positive vote batches enter the local transaction pool together. Twelve-seat batches reserve 8.5 million gas against the measured maximum below 6.31 million; single-seat batches reserve one million gas. Actual receipts still determine the fees. Begin, the 85-seat rejection check, the final seat, finalization and record observation remain ordered.

The selected-validator consumer has immutable verifier, validator index, public-key root and recipient fields. Its actual observation authenticates validator and balance SSZ membership under the verifier's accepted state, enforces a separate 64-slot state-age limit and records terminal zero without receiving funds.

Terminal lifecycle mode requires chain `3151915`, fixture actor 2, three-second slots and a recorded completed native withdrawal. It checks that the bootstrap precedes the actual terminal withdrawal block and the accepted finalized update follows it. All of these additional transactions occur after this validator has withdrawn. The explicit fixture transaction-fee routing setting therefore cannot credit those transactions' tips to the probe through that validator.

```bash
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151914 node prototype/finality/live.js --execute-fresh-finality PIPELINE_WITNESS_JSON --pipeline-votes --observe-validator
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=2 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151915 node prototype/finality/live.js --execute-terminal-finality TERMINAL_WITNESS_JSON
```

## Executed results

| Run | Actual mined transactions | Gas used | Signed transaction bytes | Native QRL fees |
| --- | ---: | ---: | ---: | ---: |
| Four historical updates, 4096-slot bound | 45 | 111,881,071 | 3,219,246 | 0.279702678283167497 |
| Two fresh updates and period transition, 64-slot bound | 23 | 64,910,780 | 1,620,052 | 0.162276950454375460 |
| Pipelined fresh update plus actual validator 63 record | 14 | 43,280,340 | 849,631 | 0.108200850343712532 |
| Funded validator 64 terminal update and record, chain 3151915 | 14 | 43,537,189 | 849,631 | 0.108842972846020897 |

Historical replay reached finalized slot 272 and period 4. Its 26 expected rejection checks passed through read-only calls. Fresh updates accepted finalized states 864 and 896 at actual slots 918 and 946, respectively: state ages 54 and 50, below 64. The second update crossed from period 13 to 14 using the authenticated predecessor committee.

The pipelined qualification accepted actual state 960 and then recorded validator 63 as terminal with zero balance at actual slot 1021, a 61-slot state age. The observation transaction used 278,470 gas. Its 85-seat batches mined across three slots. This old validator's earlier withdrawal is independent of the separately funded native-return lifecycle. Detailed evidence remains in ignored `live/`, `fresh-live/` and `pipeline-live/` runtime directories.

The funded-validator run used bootstrap 1640, actual full-return slot 1649, attested slot 1680 and signature slot 1681. Its verified update authenticated finalized state 1664 in period 26. Bootstrap deployment mined at slot 1690, at age 50. The selected-validator consumer then recorded actual validator 64 as terminal with zero balance at slot 1704, a 40-slot state age. That observation used 278,266 gas. Both age checks remained within the unchanged 64-slot bounds, and the consumer's immutable key and recipient matched the original funded probe. Detailed receipts are in ignored `terminal-live/live-run.json`; capture inputs and native verification are documented in [the terminal capture result](capture/TERMINAL-CAPTURE-RESULT.md).

## Scope

The initial bootstrap checkpoint remains an explicit trust input. The verifier authenticates subsequent inputs cryptographically within its supported subset. These transaction measurements establish neither a complete production light client nor authenticated pooled economic accounting, validator admission, fork recovery, or execution-tip routing. No production or upstream protocol code is deployed or changed by this runner.
