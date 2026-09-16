# Fresh native pool fixture network

This harness starts one isolated 64-byte-address network against the exact clean client revisions in `source-lock.json`. Upstream sources remain unchanged. The current Qrysm target includes ML-DSA batch validation, public-key cache removal, seed-based aggregator selection, empty-group validation, and configuration validation fixes added after the previous prototype pin.

The fixture has 64 genesis validators, a unique chain ID `3151916`, and unique genesis fork version `0x31519160`. Its 3-second slots and 8-slot epochs are explicit supported local configuration. The 512-block execution follow distance, 64-epoch execution voting period, 16 active epochs before voluntary exit, and 16-epoch withdrawability delay remain intact. These clock settings describe local evidence only.

The pristine genesis-generator pin still embeds the earlier one-QRL deposit minimum. Current Qrysm commit `e9984fc` changes that floor to 2,000 QRL. Before beacon genesis is created, `qualify-genesis.py` checks the generator's expected prior code hash and installs exactly the current pinned Qrysm runtime into this disposable genesis allocation. It uses the same runtime extraction as upstream `DepositContractRuntimeCodeHex`; constructor storage is unchanged by that one-line contract edit. This makes the local predeployment match the current canonical upstream contract. The running network verifier rejects every other runtime hash.

The source-built offline `deposit-fixture.go` uses Qrysm's exported credential, RANDAO, deposit, signing, keystore, and verification functions. The upstream CLI's fixed `dev` fork does not support this fixture's distinct signing domain. This wrapper supplies that domain to the existing library and avoids the CLI's seed-printing behavior. It accepts only the explicit local selector and bounded generation arguments. It does not change node or validator behavior. The upstream genesis entrypoint is copied unchanged; a small entrypoint wrapper overrides supported configuration inputs and suppresses its credential-bearing Bash trace.

Build from pristine sibling source checkouts whose names match the lock file:

```sh
native/network/build-images.sh "$SOURCE_ROOT" "$SOURCE_ROOT/qrl-genesis-generator"
QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151916 native/network/start.sh
```

Run these commands from the QuantaPool cell. Outputs, source checkouts, logs, generated keys and runtime metadata belong under ignored `findings/native-network-20260915/`. The source-built image namespace is `quantapool-native`, with tag `20260915-3b81631`. `network.json` records actual loopback mappings, genesis identities, chain configuration and running container/image identities. The supplied port ranges document allocation intent; actual assigned endpoints come from Docker inspection.

The start script creates a harmless disposable Kurtosis TCP bind probe and verifies every actual published host address is loopback before launching the chain. It stops only its own failed network if a later startup check fails. Existing enclaves are preserved. Docker-wide configuration is never changed by these scripts. Public package fixtures must be selected explicitly by each transaction helper, which must also check literal loopback URLs, chain ID and genesis identity before using fixture keys. The network selector by itself is not a transaction guard.

`canonical-deposit.abi.json` is extracted from the pinned upstream generated Go binding. Native funding uses `deposit(bytes pubkey, bytes withdrawal_recipient, bytes randao_commitment, bytes signature, bytes32 deposit_data_root)` with QRL value. Withdrawal recipients are 64 bytes; a public key is 2,592 bytes, an ML-DSA signature is 4,627 bytes, and the RANDAO commitment is included in the canonical deposit message. Pool funding and state-proof tests are separate from this infrastructure harness.

Operator-controlled execution-tip routing remains an unresolved reward-guarantee limitation. This local network alone establishes neither a finality trust anchor nor a production non-custodial architecture.
