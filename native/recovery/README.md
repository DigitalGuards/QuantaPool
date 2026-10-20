# Isolated live pool-timeout regression

This helper deploys a separate graph on the existing guarded local network. Public fixture actor 4 owns its transaction journal, is the fresh gate's immutable enrollment operator, and deposits 10 QRL. Public fixture actor 5 invokes permissionless recovery. The original pooled-validator graph, its artifacts and actors 0 through 3 remain separate.

The source and VM gates must qualify the pool-specific recovery timeout before execution. The helper freezes the newly compiled core artifacts and mechanical executor in its own ignored runtime directory. It uses a genuine native bootstrap, current native committee certificates, an authenticated pool account proof and complete parent-linked native block-flow proofs. It applies the 10 QRL deposit at a complete finalized checkpoint. No synthetic state or validator signing key participates.

The fresh graph uses a 64-slot economic freshness window and a 96-slot recovery window. After its deposit is active, the helper intentionally stops applying portfolio checkpoints while continuing to verify fresh finality certificates. Once the pool's immutable accounting deadline passes, it requires global finality to remain healthy, writes `ui-ready.json` and leaves a 60-second read-only observation window. It invokes recovery from actor 5, writes `ui-recovering.json`, leaves a 20-second observation window, and claims the exact 10 QRL principal for actor 4. It reconciles execution gas, requires zero operator fees and zero remaining pool cash, and checks that a repeated claim has no entitlement. Initial trust-anchor selection remains explicit.

After source and VM qualification, execute from the QuantaPool cell:

```sh
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151916 QUANTAPOOL_PUBLIC_DEV_ACCOUNT=4 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151916 node native/recovery/live.js --execute
```

All endpoints, chain and genesis identities are checked through the existing strict local guard. The separate transaction helper admits only actors 4 and 5, saves signed transaction bytes before broadcast, and records canonical mined receipts. It accepts no ambient wallet seed. The operation is bounded to fifteen minutes after deployment and reports exact receipts under ignored `findings/native-network-20260915/recovery-timeout/`.

Certificate batches reserve 8.5 million gas. Twelve uncached native public keys measured over 6.3 million gas in VM tests. The initial disposable graph used an insufficient 5-million-gas cap: seven vote transactions reverted, its initial checkpoint expired, and no user deposit occurred. All five contract balances were checked at zero before preserving that graph, its exact signed messages and canonical receipts under `recovery-timeout-unfunded-gas-failure-2512/`. The replacement graph has separate deployment provenance and nonces.

This graph has no funded validator and tests stalled pool accounting with liquid native principal. It supplements the independent full validator lifecycle. Public-network timing and large-registry capacity remain separate launch conditions.

The actual replacement run completed successfully. A 10 QRL deposit mined at slot 2692 was activated by the complete checkpoint for finalized slot 2696, committed at execution slot 2724. That checkpoint verified the account proof and all 48 occupied blocks since bootstrap 2648 in five transactions. Its immutable pool deadline was 2792. Actor 5 invoked recovery at slot 2826 while the global verifier still accepted finalized slot 2776 with status 0. Actor 4 claimed exactly 10 QRL at slot 2834. Gas-adjusted recipient reconciliation, zero pool cash, zero earned fees and repeated-claim rejection all passed. The recovery and claim transactions used 83,657 and 165,328 gas respectively.

The read-only UI observed recovery availability and the subsequent 10 QRL claimable state. A controlled helper restart during the no-transaction observation window loaded the requested 20-second pre-claim pause: every submitted transaction had a successful canonical receipt and actor 4 had no pending nonce. The same graph, saved signed messages and on-chain state were preserved. Detailed evidence is in `report.json`, `latest-checkpoint.json`, `controlled-resume.json`, the UI markers and the separate transaction journals.
