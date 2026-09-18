# QuantaPool

QuantaPool is a native-QRL pooled staking implementation. Users deposit and claim QRL directly through immutable contracts. Their principal, loss exposure, pending deposits, withdrawal requests and reserved rewards are recorded on chain. No transferable staking receipt token exists.

The native contracts, accounting model, proof tools and application checks are implemented. A complete local validator lifecycle returned all 44,000 QRL of contributed principal, paid native rewards and the earned 10% operator fee, and drained the pool to zero. That normal-flow run used frozen earlier artifacts; the final hardened source has separate native-VM and actual cash-recovery qualification. [Implementation evidence](native/IMPLEMENTATION.md) records the exact versions, checks and boundaries. Public launch remains subject to review of the trust anchor, committee assumptions, expiry policy, public exits, transaction-tip control and substantial proof cost described in the [architecture](docs/architecture.md).

The [final security review](native/FINAL-SECURITY-REVIEW.md) records the resolved findings, release-candidate checks and remaining launch gates.

## Economic rules

- Native validators use the unchanged 40,000 QRL protocol amount. The immutable validator operator first risks its own 2,000 QRL preparation deposit; contracts authenticate the canonical pool recipient before atomically adopting that principal and releasing the 38,000 QRL pooled top-up.
- Internal nontransferable stake units allocate verified gains and losses. Deposits and withdrawal requests settle against a later authenticated checkpoint. No user iteration occurs on reward receipt or loss recognition.
- A global FIFO serves withdrawal and reward requests from available cash. Reserved claims are cash-backed and payable only to their original beneficiaries.
- The operator earns a fixed **10%** of eligible realized net consensus gains, with deterministic loss recovery and rounding. Principal, gifts and unclassified receipts are fee-exempt. The fee destination is immutable.
- Public signed exits are stored before pooled funding. Anyone can relay them under the supported native fork and eligibility rules. This also allows unwanted early exits.
- Expiry of verification or complete pool accounting permanently closes normal operation. Recovery preserves existing shares and pays actual present and later cash, with zero new fees.

Execution tips remain under validator-operator routing control in upstream QRL. Enforceable claims cover received authenticated assets. This implementation does not promise every proposer tip, a fixed return, guaranteed principal or a withdrawal deadline.

## Development

```sh
npm ci
npm run compile
npm test
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

Compilation requires the reviewed compiler identified in `config/hyperion-toolchain.json`. Set `HYPERION_COMPILER` to its executable when it is outside the local qualified source tree. All active package commands target the native implementation. The executable tests use the pinned, unmodified go-qrl QRVM with 64-byte addresses and 64-byte ABI words. [Ledger tests](native/testing/README.md) identify their synthetic economic inputs; proof and real-network results are recorded separately.

[Source pins and local network setup](native/network/README.md) describe the current cyyber revisions, loopback isolation, canonical deposit runtime and supported local timing configuration. The network harness does not patch qrysm, go-qrl or their consensus rules. [Implementation and validation](native/IMPLEMENTATION.md) records scope, invariants, privileges and current evidence.

## Layout

| Path | Purpose |
|---|---|
| `native/contracts/` | Immutable finality verifier, portfolio proof verifier, validator gate and native pool |
| `native/testing/`, `native/accounting-model*` | Executable QRVM accounting checks and independent arithmetic model |
| `native/proofs/` | Native state, flow and signature fixtures, capture tools and proof tests |
| `native/network/`, `native/lifecycle/` | Pinned local network and actual deployment/lifecycle harness |
| `frontend/` | Native QRL deposits, positions, withdrawal requests and claims |
| `monitoring/` | Read-only native accounting and finality metrics |
| `prototype/`, `docs/legacy/` | Earlier evidence and historical design records |

The old public-testnet contracts are abandoned. Their balances, validators, addresses and storage impose no migration requirement. Token contracts, token tests, old deployment commands and token ABIs are removed from the active implementation. Historical records remain identified as such. No old on-chain state is imported or modified. See [testnet retirement](docs/TESTNET-RETIREMENT.md).

License: GPL-3.0.
