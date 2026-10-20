# Native return lifecycle fixture

This disposable local fixture sends 40,000 native QRL from `NativeReturnProbe` to the canonical deposit contract for one controlled fresh validator. The deposit names the immutable probe address as its withdrawal recipient. The fixture then follows actual consensus activation, voluntary exit and native execution-layer withdrawals. All clients use the unchanged source pins documented in [the network harness](../network/README.md).

This tests physical asset movement and principal-first fee classification. Admission remains a separate dependency: the fixture controls the fresh key, checks its absence through local RPC and funds it before its canonical validator index exists. That procedure does not establish production-safe recipient authentication before funding. The public presigned exit can be obtained only after canonical registration in this run. RPC observations remain observations; they supply no contract-verifiable finality proof.

## Configuration and timing

The separate network uses chain `3151915`, 64 genesis validators, three-second slots and eight slots per epoch. It preserves the 512-block execution follow distance, 64-epoch execution voting period, 16 active epochs before voluntary exit, five-epoch activation/exit lookahead, and 16-epoch withdrawal delay. The genesis wrapper checks this exact local configuration and selects the supported `64 * 8 = 512` voting layout. Only the slot clock differs from the existing six-second fixture, which remains available separately.

A deposit included in the first 512 execution blocks can enter consensus at approximately slot 1280, following the actual premined-genesis vote selection and majority rules. With subsequent finality, activation, eligibility, exit and withdrawal delays, an uninterrupted run needs approximately 82 minutes from genesis. This is accelerated local fixture timing, not a public-network duration.

The single fixture validator runs with an explicit local wallet, separate slashing protection database, loopback beacon connection and disabled monitoring. Its suggested transaction-fee recipient is the probe. That setting is operator-controlled and does not establish an enforced transaction-fee routing guarantee.

## Reproduce

Build the pinned images with the network harness, and compile the prototype contracts with the repository's prototype compiler before deployment. Run commands from the QuantaPool directory. Every signer command requires an explicit disposable fixture selector. Runtime addresses, dynamic loopback ports, credentials, receipts and process records stay in ignored `findings/native-qrl-prototype/lifecycle/`.

```bash
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151915 bash prototype/lifecycle/start-network.sh
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151915 node prototype/lifecycle/run.js deploy
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151915 python3 prototype/lifecycle/prepare-key.py
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151915 node prototype/lifecycle/run.js fund
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151915 python3 prototype/lifecycle/start-validator.py
python3 prototype/lifecycle/observe.py --watch-seconds 6600
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151915 python3 prototype/lifecycle/prepare-exit.py
```

Run the bounded read-only observer in a separate terminal while the protocol clock advances. Once it records canonical registration, export the exit. The separate [public-only relay](../protocol/README.md) verifies the local genesis and submits this public message once the validator is eligible. The relay requires no wallet access. Record HTTP acceptance, block inclusion and finalized validator state separately.

After the observer records `withdrawal_done` and zero balance in finalized state, capture a pre-withdrawal bootstrap and a later certificate proving a finalized state after the withdrawal. Include the selected validator's SSZ membership witnesses. The [terminal finality runner](../finality/LIVE-RUN.md) uses actor 2 to verify the fresh certificate and record terminal zero in an immutable proof consumer before the helper permits claims:

```bash
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151915 node prototype/lifecycle/run.js observe
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=2 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151915 node prototype/finality/live.js --execute-terminal-finality TERMINAL_WITNESS_JSON
QUANTAPOOL_PUBLIC_DEV_ACCOUNT=0 QUANTAPOOL_PUBLIC_DEV_CHAIN_ID=3151915 node prototype/lifecycle/run.js claim
```

## Cash reconciliation

The probe records all native cash returned as its current balance plus prior principal, reward and fee payments. It allocates the first 40,000 QRL entirely to principal recovery. Only cumulative cash above that amount becomes surplus. The immutable operator recipient earns `floor(surplus / 10)` in base units; the beneficiary receives the remaining surplus. Integer remainder therefore belongs to the beneficiary. A single terminal withdrawal containing 40,000 QRL principal cannot create a 4,000 QRL operator fee.

After authenticated terminal state, claims can pay recovered principal below the funded amount. The result records the exact principal shortfall and charges no fee on unrecovered capital. Principal is not guaranteed. This physical-return run requires a positive actual withdrawal; terminal loss with no cash return requires a separate evidence flow.

Claims are permissionless and pay only immutable beneficiaries. The helper uses a third public fixture account to pay claim transaction costs, then verifies exact native credits to the beneficiary and operator, the principal/reward/fee partition, and a zero final probe balance. It calls the fee claim first to test that withdrawal ordering does not change earned entitlement. Consensus credits bypass contract calls, so the receiver requires no payable callback.

The genesis validators use public fixture account 0 as their execution-fee recipient, which is also this experiment's beneficiary. The helper separately reconciles those incidental proposer tips over a fixed canonical claim-block interval using actual gas receipts and the pinned go-qrl fee-credit rule. They are excluded from pool rewards and native user payout. The operator's observed balance gain must equal only its earned pool fee. Successful claim receipts are saved incrementally so a measurement retry does not repeat payments.

The observer records matching actual execution payload withdrawals, deposit inclusion and finalized terminal state through Qrysm's canonical v1 block API. Unknown API routes fail explicitly. The helper reconciles every recorded withdrawal index and recipient, converts protocol shor into execution base units, and requires that their total exactly equals the receiver's cumulative returned cash.

The separate proof consumer authenticates terminal state under its verifier's accepted root. The receiver's contract payout rule uses its own cumulative cash totals. The helper waits for both before exercising claims. This remains a component experiment with an explicit initial checkpoint trust assumption and a controlled fresh validator key.

## Executed result

The 2026-09-14 run completed against the unchanged source-pinned clients. Funding in execution block 132 increased the canonical beacon contract balance by exactly 40,000 QRL. Its matching deposit entered consensus in slot 1280 and became validator 64, with the probe as canonical recipient. Actual activation was epoch 167. The public exit became available at head slot 1287, after funding and registration, and was independently rejected before the required 16 active epochs. Its unchanged later submission entered block 1482 and finalized under state 1496. Actual exit and withdrawal epochs were 190 and 206.

The final 40,000 QRL withdrawal reached the probe in slot 1649. Across 57 unique native withdrawals, actual returned cash totaled 40,040.339819966 QRL. Every tuple reconciled against its canonical execution block and matching beacon payload. A separately selected bootstrap at slot 1640 preceded that final return. A verified certificate then authenticated finalized state 1664, and the immutable selected-validator consumer recorded balance zero and terminal status in actual block 1704, at a 40-slot state age within its 64-slot bound.

| Actual cash partition | Native QRL |
| --- | ---: |
| Principal recovered | 40,000 |
| User rewards | 36.3058379694 |
| Earned operator fee, 10% of surplus | 4.0339819966 |
| Principal shortfall | 0 |
| Final probe balance | 0 |

The fee, principal and reward claims mined successfully in blocks 1714, 1716 and 1718. They used 156,388 gas, paid by actor 2. Exact contract payout counters and recipient balances reconciled. The beneficiary separately received 0.00039097 QRL of incidental proposer tips during those claim transactions. All three repeated claims reverted through explicitly read-only calls.

The initial post-claim measurement encountered an omitted empty-block transaction list in the client formatter. The helper now validates that such blocks used zero gas, and saves claim progress. The three already-mined receipts were recovered from canonical chain data and reconciled without sending another claim. This recovery is explicitly recorded in ignored `final-reconciliation.json` alongside the 58 canonical event-block checks and the authenticated terminal-state reference.

The completed standalone fixture validator was stopped after reconciliation; the observer exited after finalized terminal zero. Both isolated enclaves and their runtime evidence remain preserved. This single controlled-key component experiment leaves secure pre-funding admission, initial checkpoint selection, production light-client recovery and execution-fee routing as separate dependencies.
