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
	engine "github.com/theQRL/qrysm/proto/engine/v1"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
	"github.com/theQRL/qrysm/testing/util"
)

// These states are synthetic accounting fixtures. Native Qrysm hashes every
// field; a separate immutable test anchor supplies authority in component tests.
func TestPortfolioFixtures(t *testing.T) {
	pool := bytes.Repeat([]byte{0x11}, 64)
	account, err := rlp.EncodeToBytes(&types.StateAccount{Nonce: 1, Balance: big.NewInt(123000000000000), Root: types.EmptyRootHash, CodeHash: types.EmptyCodeHash.Bytes()})
	Must(err)
	key := crypto.Keccak256(pool)
	node, err := rlp.EncodeToBytes([][]byte{append([]byte{0x20}, key...), account})
	Must(err)
	cashRoot := crypto.Keccak256(node)
	future := primitives.Epoch(^uint64(0))
	s, err := util.NewBeaconStateZond()
	Must(err)
	for i := 0; i < 3; i++ {
		recipient := bytes.Clone(pool)
		if i == 2 {
			recipient[0] ^= 1
		}
		Must(s.AppendValidator(&pb.Validator{PublicKey: bytes.Repeat([]byte{byte(0x70 + i)}, 2592), WithdrawalRecipient: recipient, EffectiveBalance: 2000000000000, ActivationEligibilityEpoch: future, ActivationEpoch: future, ExitEpoch: future, WithdrawableEpoch: future, RandaoCommitment: bytes.Repeat([]byte{0x30}, 32)}))
		Must(s.AppendBalance(2000000000000))
	}
	set := func(slot, index uint64) StateWitness {
		Must(s.SetSlot(primitives.Slot(slot)))
		Must(s.SetExecutionDepositIndex(index))
		proto := s.ToProto().(*pb.BeaconStateZond)
		h := proto.LatestExecutionPayloadHeader
		h.StateRoot = cashRoot
		h.BlockNumber = slot
		wrapped, err := consensus.WrappedExecutionPayloadHeaderZond(h, 0)
		Must(err)
		Must(s.SetLatestExecutionPayloadHeader(wrapped))
		return State(s.(*statenative.BeaconState), []uint64{0, 1, 2})
	}
	initial := set(64, 3)
	parent := bytes.Repeat([]byte{0x42}, 32)
	makeBlock := func(slot uint64, stateRoot []byte, deposits []*pb.Deposit, withdrawals []*engine.Withdrawal) (BlockWitness, []byte) {
		b := util.NewBeaconBlockZond().Block
		b.Slot = primitives.Slot(slot)
		b.ParentRoot = parent
		b.StateRoot = stateRoot
		b.Body.Deposits = deposits
		b.Body.ExecutionPayload.Withdrawals = withdrawals
		f := Flow(b)
		root := Root(b)
		parent = root
		return f, root
	}
	deposit := func(index int, amount uint64) *pb.Deposit {
		v, _ := s.ValidatorAtIndex(primitives.ValidatorIndex(index))
		proof := make([][]byte, 33)
		for i := range proof {
			proof[i] = make([]byte, 32)
		}
		return &pb.Deposit{Proof: proof, Data: &pb.Deposit_Data{PublicKey: v.PublicKey, WithdrawalRecipient: v.WithdrawalRecipient, Amount: amount, RandaoCommitment: v.RandaoCommitment, Signature: make([]byte, 4627)}}
	}
	decode := func(value string) []byte { return common.FromHex(value) }
	initialBlock, initialRoot := makeBlock(64, decode(initial.StateRoot), nil, nil)
	b72, _ := makeBlock(72, bytes.Repeat([]byte{0x72}, 32), []*pb.Deposit{deposit(0, 38000000000000), deposit(1, 38000000000000), deposit(0, 100000000000), deposit(2, 2000000000000)}, nil)
	Must(s.SetBalances([]uint64{40100000000000, 41000000000000, 4000000000000}))
	for i := 0; i < 2; i++ {
		v, _ := s.ValidatorAtIndex(primitives.ValidatorIndex(i))
		v.ActivationEpoch = 0
		v.ActivationEligibilityEpoch = 0
		v.EffectiveBalance = 40000000000000
		Must(s.UpdateValidatorAtIndex(primitives.ValidatorIndex(i), v))
	}
	pointA := set(80, 7)
	b80, rootA := makeBlock(80, decode(pointA.StateRoot), nil, []*engine.Withdrawal{{Index: 1, ValidatorIndex: 1, Address: pool, Amount: 500000000000}, {Index: 2, ValidatorIndex: 2, Address: bytes.Repeat([]byte{0x12}, 64), Amount: 100000000000}})
	b88, _ := makeBlock(88, bytes.Repeat([]byte{0x88}, 32), nil, []*engine.Withdrawal{{Index: 3, ValidatorIndex: 1, Address: pool, Amount: 41000000000000}})
	Must(s.SetBalances([]uint64{36000000000000, 0, 4000000000000}))
	v, _ := s.ValidatorAtIndex(0)
	v.Slashed = true
	Must(s.UpdateValidatorAtIndex(0, v))
	v, _ = s.ValidatorAtIndex(1)
	v.ExitEpoch = 9
	v.WithdrawableEpoch = 10
	Must(s.UpdateValidatorAtIndex(1, v))
	pointB := set(96, 7)
	b96, rootB := makeBlock(96, decode(pointB.StateRoot), nil, nil)
	data := map[string]any{"boundary": "Synthetic state and header ancestry, canonical pinned Qrysm SSZ roots; test fixture authority only.", "pool": "Q" + Hex(pool)[2:], "accountProof": []string{Hex(node)}, "cashBalance": "123000000000000", "initial": initial, "initialHeader": initialBlock.Header, "initialHeaderRoot": Hex(initialRoot), "updates": []any{map[string]any{"state": pointA, "headerRoot": Hex(rootA), "blocks": []BlockWitness{b80, b72}}, map[string]any{"state": pointB, "headerRoot": Hex(rootB), "blocks": []BlockWitness{b96, b88}}}}
	if output := os.Getenv("QUANTAPOOL_PORTFOLIO_FIXTURE"); output != "" {
		raw, err := json.MarshalIndent(data, "", "  ")
		Must(err)
		Must(os.WriteFile(output, append(raw, '\n'), 0644))
	}
	if len(pointA.Validators[0].ValidatorBranch) != 46 || len(pointA.Validators[0].BalanceBranch) != 44 || len(b80.WithdrawalsBranch) != 8 || len(b72.DepositsBranch) != 4 {
		t.Fatal("canonical branch shape changed")
	}
}
