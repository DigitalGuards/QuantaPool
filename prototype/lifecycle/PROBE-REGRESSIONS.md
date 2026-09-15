# Native return probe regressions

Two isolated execution plans passed 544 checks in the pinned go-qrl QRVM: 274 with an ordinary immutable fee recipient and 270 with a callback fee recipient. The plans replay the public lifecycle fixture's genuine five-field 40,000-QRL deposit through the unchanged Qrysm deposit contract. The beneficiary's nonce-zero CREATE address is checked against the signed withdrawal recipient before generating either plan. The test reads public deposit bytes and uses no signing keys or network connection.

Cash inputs are synthetic withdrawal tuples processed by the unchanged `consensus/beacon.Beacon.Finalize` routine. This accurately exercises the execution-layer credit path in isolated state. It does not establish actual consensus withdrawal authorization or finality. The pinned QRVM has no `SELFDESTRUCT` instruction, so no forced-transfer helper or upstream modification is used.

The tests cover failed funding rollback, exact validator-size funding, one-shot funding, partial principal returns, an exact 40,000-QRL return with zero operator fee, multiple reward cycles, repeated claims, fee-first ordering, immutable payout destinations and complete cash drain. Every stage reconciles actual contract and recipient balances with cumulative external test credits and previous payments. The original deposit remains separately accounted at the beacon contract. The VM harness excludes transaction fees from account balances.

Native withdrawals have whole-shor granularity. The smallest credited amount in these tests is one shor, earning an exact 0.1-shor fee in base units. Repeated cumulative fee calculation is checked across irregular amounts and claim ordering. Sub-base-unit arithmetic is impossible; these withdrawal inputs have no fractional-base-unit fee remainder.

The callback fixture rejects one earned fee payment to prove atomic rollback, then accepts fees while trying each of the three claim entry points during payment. All 24 nested calls fail specifically at the reentrancy guard. The first fee callback occurs while the full principal and user reward remain available, proving the callback cannot pull them. Both suites finish with zero probe cash and exact immutable beneficiary/operator balances.

## Reproduce

Use the checkouts pinned in `prototype/source-lock.json`, with `QUANTAPOOL_SOURCE_ROOT` pointing to their common parent. The public lifecycle `probe.json` and `deposit-data.json` files must already exist in ignored findings storage. This command sequence does not operate the local network.

```sh
"$QUANTAPOOL_SOURCE_ROOT/hyperion/build/hypc/hypc" --abi --bin --bin-runtime --optimize --optimize-runs=1 --via-ir --output-dir build/prototype --overwrite prototype/contracts/NativeReturnProbe.hyp prototype/contracts/test/ProbeFeeCallback.hyp "$QUANTAPOOL_SOURCE_ROOT/qrysm/contracts/deposit/deposit_contract.hyp"
cd prototype/execution
GOWORK=off GOMAXPROCS=2 go build -mod=readonly -p=2 -o ../../build/prototype-execution .
cd ../..
node prototype/lifecycle/make-probe-plan.js
build/prototype-execution -plan build/prototype/probe-cash-plan.json -report build/prototype/probe-cash-report.json
build/prototype-execution -plan build/prototype/probe-callback-plan.json -report build/prototype/probe-callback-report.json
```

The tested maximum per-action gas before refunds was 1,169,128, including intrinsic gas. This belongs to the synthetic execution measurement; live transaction receipts are recorded independently by the lifecycle runner.
