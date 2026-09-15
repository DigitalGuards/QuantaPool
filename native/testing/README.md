# Native ledger component tests

Run from the QuantaPool root:

```sh
npm run test:model
HYPERION_COMPILER=/path/to/reviewed/hypc npm run test:vm
```

`run.js` verifies the compiler version and binary SHA-256 against `config/hyperion-toolchain.json`. It compiles the committed test contracts, builds the committed Go runner with `GOWORK=off`, `GOMAXPROCS=2`, `GOTOOLCHAIN=go1.26.5`, `-mod=readonly` and `-p 2`, generates every plan from JavaScript, and executes the bytecode. The Go module pins the unmodified cyyber go-qrl revision in `native/network/source-lock.json`. The explicit compiler override supports a checkout restored without local build artifacts. Go may download the pinned toolchain and dependencies.

Generated plans, ABI/bytecode, logs, and reports are written under ignored `build/native/`. No ignored input fixture is needed. `build/native/ledger-results.json` records the compiler hash, node revision, runtime size, step counts, expected reverts, and maximum gas usage. Individual reports retain calldata size, intrinsic gas, and gas before refund for every operation. The generic executable is `build/native/execution`; it also supports the proof tests in `native/proofs/`.

These are actual executions of the native QRVM and native 64-byte ABI. Execution timestamps, block numbers, account balances, validator cash movement, and classified checkpoint economics are synthetic fixture inputs. The ledger fixtures have public setters specifically for component testing and must never be deployed as a production pool. These tests do not establish finalized-state authentication, actual validator exits, actual slashing, or live withdrawal completion. The separately implemented proof and local-network suites provide their own evidence for those boundaries.

Proof plans can explicitly request `captureAllocation` on a zero-value constructor deployment and then a `fixture-predeploy` operation. The runner captures storage keys from actual native constructor execution, reads their completed full-width StateDB values, and installs that code, nonce and storage at a previously absent test address. It copies no account balance and cannot replace an existing account. This is synthetic genesis allocation for canonical-address tests; it changes no live network or upstream protocol code.

The plans cover:

- Three-user deposits, reward requests, partial exits, fee-exempt gifts, losses, request cancellation, stale-stage abort, and permanent recovery.
- Twelve repeated admission and withdrawal cycles with gift and rounding residue, proving zero consensus income produces zero operator fees.
- A gift and loss in one checkpoint where the loss exceeds opening assets, with a correctly positive remaining balance.
- Full loss with multiple pending exits, a refundable pending depositor, immutable recovery proportions, later cash receipts, and no newly earned fees.
- A zero-rounded FIFO head in a pool with positive assets and available cash, followed by a paid user withdrawal and later recovery of the preserved residual position.
- A 40,000-unit multi-user pool with validator funding, rewards, losses, partial validator returns, and a complete terminal drain.
- A historical execution cutoff normalized for a later deposit and an already paid claim.
- A recipient which rejects payment, proving claim state and cash rollback, followed by a successful payment whose reentrant claim is rejected.

Each differential scenario independently computes expected user positions, fee basis including fractional carry, claims, global reserves, reward budget, loss carry, and physical cash through the BigInt specification. Assertions are encoded as expected native ABI values and checked against actual return bytes. Expected failures must return the QRVM execution-reverted error; out-of-gas errors and other faults fail the test. The runner accounts for intrinsic gas and the 20-million gas ceiling, finalizes state after each action, and does not deduct fictitious transaction fees from the component cash ledger.

The independent model also runs 100 seeded histories with 20,000 economic actions and conservation checks after every action. It covers 200 zero-consensus rounding cycles, exact 512-bit multiplication, same-block cutoff rules, proportional losses, fee carry, full validator loss, terminal gating, and ownerless dust. User enumeration occurs only in this reference model's assertions. Contract operations use constant-cost position accounting, binary-searched flow history, and bounded admission and withdrawal batches.

A zero-valued position retains its shares while any owned validator remains nonterminal. Its zero-payout request completes so later FIFO entries can use available cash; its position, fee basis and fee carry remain intact. The beneficiary can request again after its value changes. Once every validator is authenticated terminal, normal exits can retire the position. Expiry recovery freezes the existing shares and allocates later cash proportionally. Rounding in recovery can leave less than one smallest native unit per participant; unowned cash remains quarantined and has no operator withdrawal path.
