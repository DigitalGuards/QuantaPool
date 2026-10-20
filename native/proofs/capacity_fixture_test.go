package proofs

import (
	"bytes"
	"encoding/json"
	"math/big"
	"os"
	"testing"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/core/types"
	"github.com/theQRL/go-qrl/crypto"
	"github.com/theQRL/go-qrl/rlp"
	statenative "github.com/theQRL/qrysm/beacon-chain/state/state-native"
	consensus "github.com/theQRL/qrysm/consensus-types/blocks"
	"github.com/theQRL/qrysm/consensus-types/primitives"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
	"github.com/theQRL/qrysm/testing/util"
)

// Synthetic 65-validator state, hashed and proved through unchanged Qrysm SSZ.
// The capacity plan calls the actual portfolio from its explicit fixture gate
// identity; no registry storage is seeded and no network transition is claimed.
func TestLifetimeCapacityFixture(t *testing.T) {
	origin := common.BytesToAddress(bytes.Repeat([]byte{0x11}, 64))
	pool := common.BytesToAddress(bytes.Repeat([]byte{0x33}, 64))
	s, err := util.NewBeaconStateZond()
	Must(err)
	future := primitives.Epoch(^uint64(0))
	indices := make([]uint64, 65)
	for i := range indices {
		indices[i] = uint64(i)
		Must(s.AppendValidator(&pb.Validator{PublicKey: bytes.Repeat([]byte{byte(i + 1)}, 2592),
			WithdrawalRecipient: pool.Bytes(), EffectiveBalance: 2000000000000, ActivationEligibilityEpoch: future,
			ActivationEpoch: future, ExitEpoch: future, WithdrawableEpoch: future, RandaoCommitment: bytes.Repeat([]byte{0x30}, 32)}))
		Must(s.AppendBalance(2000000000000))
	}
	a, err := rlp.EncodeToBytes(&types.StateAccount{Nonce: 1, Balance: big.NewInt(0), Root: types.EmptyRootHash, CodeHash: types.EmptyCodeHash.Bytes()})
	Must(err)
	node, err := rlp.EncodeToBytes([][]byte{append([]byte{0x20}, crypto.Keccak256(pool.Bytes())...), a})
	Must(err)
	set := func(slot uint64) StateWitness {
		Must(s.SetSlot(primitives.Slot(slot)))
		h := s.ToProto().(*pb.BeaconStateZond).LatestExecutionPayloadHeader
		h.StateRoot = crypto.Keccak256(node)
		h.BlockNumber = slot
		wrapped, err := consensus.WrappedExecutionPayloadHeaderZond(h, 0)
		Must(err)
		Must(s.SetLatestExecutionPayloadHeader(wrapped))
		return State(s.(*statenative.BeaconState), indices)
	}
	initial := set(64)
	b0 := util.NewBeaconBlockZond().Block
	b0.Slot = 64
	b0.StateRoot = common.FromHex(initial.StateRoot)
	v, err := s.ValidatorAtIndex(0)
	Must(err)
	v.ActivationEpoch = 0
	v.ExitEpoch = 1
	v.WithdrawableEpoch = 2
	Must(s.UpdateValidatorAtIndex(0, v))
	Must(s.UpdateBalancesAtIndex(0, 0))
	terminal := set(96)
	b1 := util.NewBeaconBlockZond().Block
	b1.Slot = 96
	b1.ParentRoot = Root(b0)
	b1.StateRoot = common.FromHex(terminal.StateRoot)
	if output := os.Getenv("QUANTAPOOL_CAPACITY_FIXTURE"); output != "" {
		data := map[string]any{"origin": origin.String(), "pool": pool.String(), "initial": initial,
			"initialHeaderRoot": Hex(Root(b0)), "terminal": terminal, "terminalHeaderRoot": Hex(Root(b1)),
			"blocks": []BlockWitness{Flow(b1)}, "accountProof": []string{Hex(node)}}
		raw, err := json.MarshalIndent(data, "", "  ")
		Must(err)
		Must(os.WriteFile(output, append(raw, '\n'), 0644))
	}
}
