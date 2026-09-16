# QRL source baseline for the native QRL redesign

The redesign targets unmodified QRL clients. `config/qrl-upstream-sources.json` pins the cyyber `main` heads qualified on 2026-09-15, their relevant fix ancestry, and the QRVMC submodule revision. Refresh these pins deliberately when upstream changes. A floating branch name or a published `latest` image does not identify the implementation tested.

| Source | Revision |
|---|---|
| go-qrl | `9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9` |
| qrysm | `3b816311ac3e86b7a7af40a062ae290318554f7a` |
| Hyperion | `cee9d335984c139c1dc0b0e84ec13290031ea4b1` |
| qrvmone | `bca84a21a046bc8506ee4b7a89b31ac9e621904f` |
| QRVMC, as pinned by qrvmone | `b70fb65874ce9a50a55475f800dcb33e39a5a261` |

Use clean, separate clones at those revisions, with directories named `go-qrl`, `qrysm`, `hyperion`, and `qrvmone` below one source root. Initialize qrvmone's pinned QRVMC submodule. The source check rejects a different revision, tracked changes, untracked source files, or submodule changes. It performs no checkout, reset, patch, or network deployment.

```sh
node scripts/check-qrl-upstream.js /path/to/source-root
node scripts/check-qrl-upstream.js /path/to/source-root --test
node scripts/check-qrl-upstream.js /path/to/source-root --require-semantic-runtime
```

The optional test command runs selected, existing Go tests with two compiler processes, `-mod=readonly`, workspace overlays disabled, and Qrysm's required `develop` build tag. It checks that every selected package actually executed tests. Its JSON output states the exact scope and revisions. The ancestry checks require enough clone history to contain the listed fixes. These checks do not execute all upstream suites or establish that a running network uses these sources.

The older binary identities in `config/hyperion-toolchain.json` describe the retained pool's existing semantic baseline. They must only change after rebuilding and qualifying the compiler and semantic runtime together. Successful source qualification alone does not qualify those binaries, the pool bytecode, or the native accounting redesign.

## Qualification results and current test dependency

The selected Go tests passed at these exact revisions: 44 top-level tests across go-qrl's common, ABI, and VM packages, and 37 across Qrysm's configuration, deposit-contract, and block-operation packages. Both clients used Go 1.26.5. The source check also verified the listed fix ancestry and clean working trees.

Hyperion's compiler and semantic runner and the qrvmone library built from the pinned sources. The existing three pool contracts compiled with identical ABIs and runtime sizes of 22,768 bytes for the pool, 6,136 bytes for the manager, and 5,443 bytes for the retained token. These compilation results describe the existing architecture.

Semantic execution is blocked for this exact compiler/runtime pairing: Hyperion's embedded `test/qrvmc/qrvmc.h` identifies `QRVMC_ZOND` as 1, while qrvmone's pinned `qrvmc/include/qrvmc/qrvmc.h` identifies it as 0. Both advertise ABI version 2, so checking that version alone would miss the mismatch. The source check reports both identifiers; `--require-semantic-runtime` rejects the combination before any semantic execution. The build products were left separate from the older pinned pool toolchain. No source patch or older-runtime substitution was used to obtain a passing result.

The native accounting verifier also needs tests against go-qrl's actual ML-DSA precompile. The current Hyperion test host handles precompile addresses 1, 2, 4, and 5 and has no ML-DSA implementation at address 3. Signature-dependent accounting cannot be qualified using that host alone.

QuantaPool's existing beacon call, deposit-signing helper, and semantic beacon fixtures still omit the new RANDAO commitment. Their existing tests therefore do not establish funding compatibility with this current Qrysm deposit contract. The native redesign must update that integration as one coherent change.

## Current protocol facts

- Addresses and QRVM words are 64 bytes. Hashes and consensus signing roots remain 32 bytes. Address width does not determine hash width.
- A full validator has 40,000 QRL effective balance. The beacon contract now enforces a 2,000 QRL minimum per deposit. The pool's minimum user deposit is a separate application parameter.
- Deposit data includes a 32-byte `randao_commitment`, in addition to the 2,592-byte public key, 64-byte withdrawal recipient, amount, and 4,627-byte signature. The signature message and deposit-data SSZ root both include the commitment. The current deposit ABI and precompile input must be used together.
- The default configuration has 128 slots per epoch, 60 seconds per slot, a 128-position sync committee, and eight epochs per committee period. Deployment must check its actual network configuration.
- A repeated public-key deposit increases the existing validator's balance. It retains the original canonical withdrawal recipient. Checking the recipient in a new deposit message alone does not prove the recipient of that existing validator.
- Consensus withdrawals credit the execution account directly. The execution withdrawal tuple has no terminal flag, and a validator with zero balance generates no withdrawal payment. A raw pool balance change is insufficient to authenticate a complete validator portfolio or distinguish every loss from every reward.
- Normal voluntary exits require the validator's signature and at least 16 active epochs under the default configuration. A pool withdrawal address does not authorize a consensus exit. Public, verified exit authorizations are a possible application-level dependency; their validator-index binding, availability, eligibility, and fork-domain validity require validation before user-funded activation.
- The proposer chooses execution transaction-fee routing separately from the validator's withdrawal recipient. A pool can account deterministically for funds it receives. A contract cannot collect transaction fees that the proposer sends elsewhere.

These facts come from the pinned `common/types.go`, `core/vm/contracts.go`, `core/types/withdrawal.go`, `consensus/beacon/consensus.go`, and `core/state_transition.go` in go-qrl, and `config/params/mainnet_config.go`, `contracts/deposit/deposit_contract.hyp`, `beacon-chain/core/blocks/deposit.go`, `beacon-chain/core/blocks/exit.go`, `beacon-chain/state/state-native/getters_withdrawal.go`, and `beacon-chain/rpc/qrysm/v1alpha1/validator/proposer_execution_payload.go` in Qrysm.

## Application boundaries still to implement

An application-layer verifier may use the existing ML-DSA verification precompile, sync-committee signatures, and SSZ state commitments. QuantaPool currently has no complete implementation of that verifier. It must authenticate validator identity, canonical withdrawal routing, balances, complete portfolio checkpoints, and zero-balance terminal states. Its bootstrap, fork handling, proof freshness, transition rules, gas bounds, and data availability need explicit validation. RPC metadata and operator-supplied roots do not provide that authentication.

The planned operator fee remains 10%, payable in native QRL to an immutable recipient from economically earned rewards. Returned principal earns no fee. Fee calculation must follow verified accounting, including loss treatment, before any fee is claimable.

The source baseline and checks support the implemented native pool, global withdrawal queue, proof-bound user accounting and clean token removal. See [current implementation evidence](../native/IMPLEMENTATION.md). Earlier source-only test results in this document retain their original scope. Upstream source remains unchanged.
