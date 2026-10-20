# Native QRL publication security review

Date: 2026-09-15. Scope: the native contract graph, accounting and proof tools, frontend transaction lifecycle, monitoring, dependencies and outgoing repository changes. This is a defensive source and regression review of the implementation candidate. It is not an independent external audit or public-launch approval.

The subsequent [2026-09-16 integration review](MERGE-REVIEW.md) records two additional independent agent passes, a pending-refund discovery fix and added randomized native-VM accounting checks. Contract source remains unchanged by that follow-up.

The publication branch integrates current `origin/dev` revision `50ec49d` with the native redesign. The existing identity/navigation updates and shared pairing UI version 0.2.1 are preserved. Legacy token contracts, token ABIs and executable deployment paths are retired as listed in [the retirement manifest](RETIRED-FILES.json). Historical prototypes and records remain explicitly separated from the active implementation.

## Resolved findings

| Severity | Finding and effect | Resolution and evidence |
|---|---|---|
| Medium | A position rounding to zero could hold the FIFO head while an outstanding validator remained nonterminal. Later solvent users could consequently wait despite positive pool assets and available cash. | `NativeLedger.hyp`, `_reserve`, completes the zero-value request and advances ordering. Shares, principal/fee bases, fee carry and later cash rights remain intact. The emitted `ZeroValueRequestCompleted` event explains the outcome in the UI. Model and native-VM regressions cover a positive-assets pool, a later funded payout, unchanged late-return rights and subsequent recovery. |
| Medium | A delayed wallet hash, receipt or exception from an obsolete session could overwrite a newer transaction's UI state or release its pending guard. The existing pre-signing checks constrained destination and identity; the demonstrated issue concerned asynchronous state ownership. | The store binds preparation, send and receipt processing to a transaction generation. Connection, account, provider and transport changes retire old work. Thirteen store-level tests cover overlapping sends, late errors and receipts, reconnection, disconnect and dismissal. They use synthetic wallet/RPC responses and request no real signature. |
| Medium | Removing the exporter-down rule left missing or crashed exporters without a reliable alert; a last-success metric cannot signal failure when its time series is absent. | Restored `ContractExporterDown` for failed or absent targets. The stale rule also covers a reachable exporter with missing completion metrics. Promtool executes seven alert timing and recovery scenarios and validates all 26 configured rules. |
| Medium, configuration-dependent | Prometheus and Alertmanager Compose ports were published on all host interfaces, exposing internal monitoring interfaces on hosts without an independent network restriction. | Both bindings now use loopback, matching the exporter. No running service or remote firewall was changed. Grafana retains the existing dashboard exposure policy. |

Primary source locations are `native/contracts/NativeLedger.hyp:362`, `frontend/src/stores/poolStore.ts` transaction-generation guards and `sendTransaction`, `monitoring/prometheus/rules/contract-alerts.yml:4`, and `monitoring/docker-compose.yml:21`. Tests preserve economic entitlements and failure behavior; none demonstrates unauthorized withdrawal of another user's principal.

The review also corrected a remaining landing-page staking label and updated affected frontend/tooling and exporter dependency locks to patched versions. Fresh installs reported zero known npm audit advisories in the root, frontend and exporter dependency graphs at review time. This observation covers the npm advisory database and those locks, not native dependencies, container images or undiscovered vulnerabilities.

## Executed final candidate checks

| Gate | Result and limits |
|---|---|
| Full native `npm test` | Passed: compile, 38 model tests, 2,070 ledger QRVM steps, 828 component/proof/recovery/executor QRVM steps, 155 finality QRVM steps and 32 tooling tests. Total native execution: 3,053 steps with 151 expected reverts. |
| Arithmetic histories | 20,000 seeded actions and 200 zero-consensus rounding cycles included in the model tests. These are reproducible bounded histories, not a formal proof. |
| Frontend | 41 tests, lint, typecheck, changed-file formatting and production build passed. ABI regenerated from the current native pool. The existing large Web3 bundle warning remains. |
| Browser | Production bundle passed five routes at 390 and 1440 pixels. Ten synthetic connected-state checks covered normal, expiry, recovery and completed-request presentation. The landing homepage and pool page passed both widths with fonts/icons enabled. No horizontal overflow or JavaScript page errors remained. No wallet signing occurred; temporary servers were stopped. |
| Monitoring | 26 rule parses and seven alert scenarios passed through pinned Prometheus promtool. Native exporter tooling checks are included above. |
| Publication hygiene | Changed/new source and the compressed public certificate fixture were scanned for credential material, private operational/workstation references, conflict markers and forbidden punctuation. Generated builds, local receipts, keys and findings remain ignored. |

The final pool runtime is 21,628 bytes; its SHA-256 is `fdd7f5d7bc81556a464299190356ea49fd217e1444b06d84d59cb0e39c89f777`. The current ledger source SHA-256 is `49e0fdceb28c6f0fc4de663e8ea4020b230a6094c09a168f807ebf5927f7f41e`. The pool ABI SHA-256 is `042e75eef1059d454b76d28eae82360c55f3766e268ed5fb89c918a947348e18`. Compilation writes the complete source, compiler and artifact fingerprints to the ignored build manifest.

The executor uses the unmodified native QRVM with 64-byte addresses and words. Economic component inputs, account allocations and clocks are declared fixtures. Finality tests use captured native certificates and include two committee transitions. Counts above describe VM execution; they are not counts of mined transactions.

## Network evidence and remaining launch gates

The earlier frozen graph completed a real local validator lifecycle: 44,000 QRL contributed, 44,028.836982927800000001 QRL paid to position owners, 3.204109214199999999 QRL paid as the earned operator fee, and zero remaining cash or claims. Returned principal incurred no fee. A separate graph demonstrated actual liquid-principal recovery after pool accounting expired while global finality remained healthy. [The implementation report](IMPLEMENTATION.md) identifies the versions, transactions, gas and evidence boundaries.

Neither earlier graph contains the later zero-value FIFO runtime change. A complete funded-validator lifecycle on the exact final bytecode remains a pre-launch gate. No new network transactions, upstream edits, legacy recovery or remote deployments were performed during this publication review.

The following constraints remain material:

- Deployment supplies a trusted recent checkpoint and immutable graph, fee recipient, fork and timing configuration. Subsequent updates authenticate a sampled native committee certificate requiring 86 of 128 positions; repeated keys can occupy multiple positions. This does not replay whole-network consensus. Independent anchor/configuration verification remains necessary.
- The immutable validator operator controls new key preparation using its own capital. Signing-key behavior affects native performance/losses and execution-tip routing. Published exits permit independent eligible exits and also unwanted early exits. Public exit policy and promised transaction-tip guarantees remain product decisions requiring review.
- Complete occupied-block history, signatures and all registered validator records must fit the checkpoint budget. The permanent registry has a 64-validator lifetime limit. The portfolio runtime has only 67 bytes of headroom. [Measured scale](proofs/SCALE.md) and the earlier local run's 6.182261598933041068 QRL gas expense, exceeding its 3.204109214199999999 QRL fee, do not establish viable public economics.
- Local 64-slot freshness is unsuitable for the pinned mainnet's 128-slot epochs. Production timing, archival availability, keeper funding and complete proof latency require qualification. Expiry irreversibly permits proportional cash recovery; it cannot force unavailable validator principal to return by a deadline.
- Broader multi-validator admission/withdrawal histories, external top-ups across the same interval, skipped-slot capture and aborted proof generations remain integration coverage gaps. Existing synthetic multi-loss and capacity tests do not establish those real-network results.

There is no owner, upgrader, proxy admin, pauser, arbitrary fund rescue, balance setter or mutable fee role in the native graph. The fee remains an immutable 10% of eligible realized net consensus gains, after loss recovery, at reservation. The fee recipient can receive only earned reserves. The initial anchor and operator performance powers above remain relevant even with those restrictions.

## Reproduction

Use the exact client revisions in [the source lock](network/source-lock.json) and compiler identity in [the toolchain configuration](../config/hyperion-toolchain.json). Set `HYPERION_COMPILER` to the qualified executable if needed.

```sh
npm ci
npm test
npm --prefix frontend ci
npm --prefix frontend run abi:sync
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix monitoring/contract-exporter ci
sh monitoring/test-rules.sh
```

Hosted CI runs model, tooling, monitoring and frontend checks. The full native compiler/VM gate requires the pinned toolchain and was executed locally. Hosted checks do not claim that additional execution.
