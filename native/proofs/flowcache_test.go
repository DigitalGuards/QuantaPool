package proofs

import (
	"bytes"
	"encoding/json"
	"testing"

	engine "github.com/theQRL/qrysm/proto/engine/v1"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
	"github.com/theQRL/qrysm/testing/util"
)

func TestCompactFlowCacheRevalidatesNativeProofs(t *testing.T) {
	b := util.NewBeaconBlockZond().Block
	b.Body.ExecutionPayload.Withdrawals = []*engine.Withdrawal{{Index: 3, ValidatorIndex: 7, Address: bytes.Repeat([]byte{1}, 64), Amount: 123}}
	proof := make([][]byte, 33)
	for i := range proof {
		proof[i] = make([]byte, 32)
	}
	b.Body.Deposits = []*pb.Deposit{{Proof: proof, Data: &pb.Deposit_Data{PublicKey: make([]byte, 2592), WithdrawalRecipient: make([]byte, 64), RandaoCommitment: make([]byte, 32), Signature: make([]byte, 4627), Amount: 2000000000000}}}
	value := Flow(b)
	if CheckedFlowRoot(value) != Hex(Root(b)) {
		t.Fatal("compact cache changed native block root")
	}
	mutations := map[string]func(*BlockWitness){
		"missing withdrawal":      func(v *BlockWitness) { v.Withdrawals = nil },
		"changed native amount":   func(v *BlockWitness) { v.Withdrawals[0].AmountShor = "124" },
		"changed validator index": func(v *BlockWitness) { v.Withdrawals[0].ValidatorIndex = "8" },
		"missing deposit":         func(v *BlockWitness) { v.Deposits = nil },
		"changed deposit amount":  func(v *BlockWitness) { v.Deposits[0].AmountShor = "1" },
		"changed proof branch":    func(v *BlockWitness) { v.WithdrawalsBranch[0] = Hex(bytes.Repeat([]byte{255}, 32)) },
		"short recipient":         func(v *BlockWitness) { v.Withdrawals[0].Recipient = Hex(make([]byte, 63)) },
	}
	for name, change := range mutations {
		t.Run(name, func(t *testing.T) {
			raw, err := json.Marshal(value)
			Must(err)
			var altered BlockWitness
			Must(json.Unmarshal(raw, &altered))
			change(&altered)
			defer func() {
				if recover() == nil {
					t.Fatal("changed cached proof accepted")
				}
			}()
			CheckedFlowRoot(altered)
		})
	}
}
