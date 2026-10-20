# QRL Terminal Withdrawal Receipt Interface

Status: protocol proposal and local audit design. This interface is not implemented in the reviewed Qrysm or go-qrl snapshots and is not a deployed security boundary.

## Objective

Give Hyperion contracts enough consensus-authenticated information to distinguish all three validator balance events:

1. a partial reward withdrawal,
2. a terminal withdrawal that retires validator principal, and
3. a terminal zero-balance validator that produces no native balance delta.

QuantaPool currently closes deposits and claims while any validator principal is outstanding because the execution balance and existing withdrawal tuple cannot prove which case occurred. The proposed receipt makes each validator transition explicit and replay protected.

## Reviewed source boundary

This design was checked against:

- Qrysm `e07a6007f4424aae030dd0e5a69f3d57e69dc677`, where `Withdrawal` contains index, validator index, a 20-byte address, and amount, and `ExpectedWithdrawals` omits fully withdrawable validators whose balance is zero.
- go-qrl `39be3a83cb956adc9796ceee1783f97df3f7e2a5`, where `types.Withdrawal` contains index, validator index, address, and amount in Shor, and `consensus/beacon.Finalize` credits `amount * params.Shor` to the recipient.
- Qrysm Q128 commit `b53fd7c488f3f0d1d4163b270afac1749eed954b`, which is available locally but is not an ancestor of the reviewed Qrysm main snapshot. The terminal-receipt work must first port or rebase the Q128 withdrawal representation.

The current execution withdrawal already authenticates its validator index through the consensus-generated withdrawals root. It does not authenticate whether the withdrawal is terminal or bind the full validator public key to a contract-side record. A block proof cannot reconstruct facts absent from the committed tuple.

## Forked consensus tuple

Introduce a fork-specific `WithdrawalV3` container:

```text
WithdrawalV3 {
    index: uint64
    validator_index: uint64
    recipient: bytes64
    amount_shor: uint64
    validator_pubkey_hash: bytes32
    terminal: bool
}
```

`recipient` is the full raw 64-byte QIP-55 execution address. `validator_pubkey_hash` is `Keccak256(validator.public_key)`, matching QuantaPool ValidatorManager's existing identity key. The hash algorithm and exact byte serialization are consensus constants and require fixed test vectors.

`terminal` is derived by Qrysm from the pre-transition beacon state. A caller, builder, or execution client cannot select it. It is true exactly when the validator is fully withdrawable at the payload's epoch and has not previously issued a terminal receipt.

## Zero-balance terminal rule

Add a consensus-state bit for each validator:

```text
terminal_withdrawal_issued: bool
```

At the new fork, expected-withdrawal generation follows this order:

```text
if fully_withdrawable(validator, current_epoch) and not terminal_withdrawal_issued:
    emit WithdrawalV3(amount_shor=balance, terminal=true)
else if partially_withdrawable(validator, balance):
    emit WithdrawalV3(amount_shor=balance-max_effective_balance, terminal=false)
```

The terminal entry is emitted once even when `balance == 0`. Processing a terminal entry sets `terminal_withdrawal_issued = true`. Processing a zero amount is a valid no-op for beacon balance reduction and execution balance credit. Repeated terminal entries are invalid.

This bit must be part of the forked beacon-state schema. A side database is insufficient because every consensus participant must derive the same expected withdrawals root after reorgs and state sync.

## Engine API V3

Add versioned methods rather than changing V2 decoding in place:

- `engine_forkchoiceUpdatedV3`
- `engine_getPayloadV3`
- `engine_newPayloadV3`

The V3 execution payload carries `WithdrawalV3[]`. Qrysm validates the complete SSZ root against its expected list before changing balances or setting terminal markers. go-qrl validates the corresponding execution withdrawal root and rejects malformed field widths, non-Q128 recipients, invalid booleans, duplicate indexes, and payloads used on the wrong side of the activation timestamp.

The new tuple changes both SSZ and RLP roots. It therefore needs a fresh consensus fork version and an execution activation time. A fresh testnet genesis is the simplest activation path for the current development network.

## Consensus-written receipt inbox

Reserve one Q128 system address outside precompile slots 1 through 6. Genesis installs immutable getter-only runtime code at that address. During `Beacon.Finalize`, go-qrl performs these operations atomically for every valid `WithdrawalV3`:

1. credit `amount_shor * params.Shor` to `recipient`,
2. reject any previously stored receipt at `index`,
3. write the authenticated receipt record to the system account,
4. update the system account storage root in the same canonical state transition.

The runtime exposes one view method:

```text
withdrawalReceipt(uint64 index) returns (
    bool exists,
    uint64 validatorIndex,
    address recipient,
    uint64 amountShor,
    bytes32 validatorPubkeyHash,
    bool terminal,
    uint64 sourceBlock
)
```

Protocol constants must fix the inbox address, runtime bytecode, runtime code hash, storage layout, and ABI selector. User transactions cannot write the inbox. The execution client writes its storage only through the consensus finalization path.

The receipt and native balance credit share one state root. A canonical reorg removes or replaces both together. QuantaPool does not need an independent finality oracle for fund safety, although operators should wait for finalized consensus before submitting receipts to reduce reverted transactions.

## QuantaPool consumption

QuantaPool stores the last consumed status for each withdrawal index. A permissionless receipt-consumption call must verify:

- the inbox is the immutable protocol address and has the expected code hash,
- `exists` is true,
- the index has not been consumed,
- `recipient == address(this)`,
- `validatorPubkeyHash` maps to the supplied pool validator ID,
- `validatorIndex` matches the beacon index previously bound to that pool validator,
- `amountShor * 1e9` fits `uint256` and matches the observed native accounting unit,
- a terminal receipt retires that validator's fixed principal exactly once.

A partial receipt increases pooled rewards. A terminal receipt applies its amount, retires fixed principal, and records any resulting reward or loss. A zero-amount terminal receipt retires principal and exposes the full loss without relying on a balance delta.

Continuous deposits and claims require receipt consumption to be permissionless and recipient scoped. The contract can accept caller-supplied receipt indexes because the inbox authenticates every record. Missing receipt submission can delay accounting but cannot forge reward, principal, or terminal state.

The current QuantaPool Manager does not store the consensus validator index. Deployment tooling must bind that index after the deposit becomes canonical, using a separate authenticated inclusion mechanism or an extension of the deposit receipt. Until that binding is trustless, the current cohort safety lock remains required.

## Security invariants

1. Consensus is the sole authority for `terminal` and `validator_pubkey_hash`.
2. One withdrawal index identifies one immutable receipt for the life of a canonical state.
3. One validator emits at most one terminal receipt.
4. A terminal zero balance still emits a receipt.
5. Native credit and inbox storage update are atomic.
6. The inbox has no user-write path, upgrade path, delegate call, or value-transfer method.
7. Pre-fork nodes reject V3 payloads and post-fork nodes reject V2 payloads.
8. Q128 recipient bytes remain unchanged across Qrysm SSZ, Engine JSON, go-qrl RLP, state credit, and Hyperion ABI decoding.

## Required tests

### Qrysm

- partial withdrawal has `terminal=false` and the correct public-key hash,
- positive full withdrawal has `terminal=true`,
- zero-balance full withdrawal emits exactly once,
- terminal marker survives SSZ round trip and state sync,
- payload root changes if any new field changes,
- mismatched terminal flag, key hash, or recipient is rejected,
- Q128 recipient test vectors survive every JSON and protobuf conversion.

### go-qrl

- V3 JSON and RLP round trips preserve all fields,
- withdrawal root commits every new field,
- finalization credits the recipient and writes the inbox atomically,
- zero amount writes a receipt without changing balance,
- duplicate index and malformed Q128 recipient are rejected,
- reorg removes both credit and receipt,
- snapshot, sync, tracing, GraphQL, and RPC readers preserve V3 receipts,
- inbox runtime code and storage cannot be changed by a transaction.

### Cross-client and QuantaPool

- fixed vectors produce the same withdrawal root in both clients,
- partial rewards cannot retire principal,
- terminal principal cannot be counted as reward,
- zero-return slashing becomes visible and retires principal,
- duplicate receipt consumption reverts,
- a receipt for another pool or validator reverts,
- multiple validators returning in one block settle independently,
- continuous deposit and claim pricing remains correct across partial and terminal receipts.

## Activation gates

- Pin reviewed Qrysm, go-qrl, Hyperion, qrl-package, and QuantaPool commits. Do not build validator infrastructure from a floating branch or `latest` image.
- Start a fresh chain ID and genesis fork version for the receipt testnet.
- Publish the Engine V3 schema, Q128 test vectors, inbox address, code hash, and storage layout before genesis.
- Run cross-client root vectors and a bounded Kurtosis lifecycle covering positive, partial, slashed, and zero-balance terminal cases.
- Keep the QuantaPool cohort safety lock enabled until every invariant above is executable and the deployed inbox code hash is verified.

## Open protocol decisions

- How a contract trustlessly binds a beacon validator index to its original deposit.
- Whether the public-key commitment remains Keccak-256 for direct QuantaPool compatibility or moves to a QRL-wide hash with an explicit contract conversion path.
- The permanent reserved Q128 inbox address and governance for its genesis code hash.
- Whether V3 receipts become the general QRL withdrawal format or a new parallel receipt accumulator.
