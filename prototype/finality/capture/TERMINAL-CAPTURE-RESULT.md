# Actual funded-validator terminal witness

At 15:19:32.585 UTC on 2026-09-14, the capture tool exported a real signed finality update and validator 64 record from the isolated chain 3151915. The unmodified native verifier checked all 128 sync signatures and reconstructed the canonical state roots and proof branches.

| Input | Actual result |
|---|---|
| Explicit bootstrap header | Slot 1640, preceding the principal-return block |
| Full principal return | Slot 1649, withdrawal index 26360, 40,000 QRL sent to the immutable probe recipient |
| Signed attested header | Slot 1680, sync signatures carried by block 1681 |
| Certified finalized header | Slot 1664, strictly after the return |
| Committee transition | Bootstrap period 25 to signature/finalized period 26, using the next committee authenticated under the bootstrap state |
| Native signatures | 128 valid assigned-seat signatures, 64 unique public keys and signatures, 592,256 signature bytes |
| Canonical validator record | Index 64, actual balance 0, effective balance 0, unslashed, activation epoch 167, exit epoch 190, withdrawable epoch 206 |
| Proof depths | Slot 5, validator 46, balance 44 |

Finalized state root: `0xf3382a65a33bcb6e2bb5a188f8adeccae5374c35efb01a8f612bb796069bf2dd`.

Validator public-key SSZ root: `0x5a1a2d34a3a0566183e5965f64cf29d60d72f9a2cf07462ad29af0c6c765b389`.

The ignored witness is `findings/native-qrl-finality/terminal/witness.json`, SHA-256 `3238ba112548f60b57c16c5da9ca29b5d9a3f9649cdce3e25a8fd0e449d8c685`. Its manifest records every public JSON/SSZ input hash. Sources are pinned in `prototype/source-lock.json`; Qrysm is `9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3`.

From the QuantaPool root, with this disposable fixture still available:

```sh
python3 prototype/finality/capture/capture.py --network findings/native-qrl-prototype/lifecycle/network.json --output-dir findings/native-qrl-finality/terminal --bootstrap-slot 1640 --attested-slots 1680 --allow-unfinalized-updates
cd prototype/protocol
GOWORK=off GOMAXPROCS=2 go run -mod=readonly -tags=develop ../finality/capture/analyze.go -capture-dir ../../findings/native-qrl-finality/terminal -output ../../findings/native-qrl-finality/terminal/witness.json -validator-index 64
```

These commands verify the captured native signatures and SSZ inputs. They do not deploy or submit a transaction. Initial bootstrap trust, committee assumptions, bounded verifier policy and future fork support remain explicit dependencies.

The separate live lifecycle runner subsequently accepted finalized slot 1664 in the deployed verifier and recorded validator 64's zero balance in `FinalizedValidatorRecordProbe`. Its observation transaction succeeded at block 1704, state age 40 within the enforced 64-slot bound. The recorded run used 14 mined transactions and 43,537,189 gas, and checked that 85 distinct seats could not finalize while 86 could. This application quorum policy is separate from native block acceptance. The durable live artifact is `findings/native-qrl-finality/terminal-live/live-run.json`; record transaction hash `0xe393def5f63f049e96905766c7f7cfb1c5d77fe15ebe39d31e6acf11160687fc`.

The balance-zero record authenticates a particular finalized snapshot. Its conjunction with the separately observed canonical withdrawal identifies the cash-return lifecycle. A zero record alone does not identify which cash movement or loss caused it, and later deposits can credit an exited validator again. See [the terminal-state source review](../../lifecycle/TERMINAL-STATE.md).
