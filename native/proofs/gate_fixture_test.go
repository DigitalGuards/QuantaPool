package proofs

import (
	"bytes"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"testing"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/core/types"
	"github.com/theQRL/go-qrl/crypto"
	"github.com/theQRL/go-qrl/rlp"
	"github.com/theQRL/qrysm/beacon-chain/core/signing"
	statenative "github.com/theQRL/qrysm/beacon-chain/state/state-native"
	"github.com/theQRL/qrysm/config/params"
	consensus "github.com/theQRL/qrysm/consensus-types/blocks"
	"github.com/theQRL/qrysm/consensus-types/primitives"
	"github.com/theQRL/qrysm/contracts/deposit"
	"github.com/theQRL/qrysm/crypto/ml_dsa_87"
	"github.com/theQRL/qrysm/crypto/randao"
	engine "github.com/theQRL/qrysm/proto/engine/v1"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
	"github.com/theQRL/qrysm/testing/util"
)

func TestGatePublicFixture(t *testing.T) {
	origin := common.BytesToAddress(bytes.Repeat([]byte{0x11}, 64))
	pool := crypto.CreateAddress(origin, 4)
	gate := crypto.CreateAddress(origin, 3)
	fork := []byte{0x31, 0x51, 0x91, 0x60}
	genesis := bytes.Repeat([]byte{0x19}, 32)
	key, err := ml_dsa_87.RandKey()
	Must(err)
	commitment := randao.Commitment(key.Marshal(), randao.DefaultLayers)
	bootstrap, _, err := deposit.DepositInputWithRandaoCommitment(key, pool, 2000000000000, fork, commitment)
	Must(err)
	topup, _, err := deposit.DepositInputWithRandaoCommitment(key, pool, 38000000000000, fork, commitment)
	Must(err)
	depositDomain, err := signing.ComputeDomain(params.BeaconConfig().DomainDeposit, fork, nil)
	Must(err)
	Must(deposit.VerifyDepositSignature(bootstrap, depositDomain))
	Must(deposit.VerifyDepositSignature(topup, depositDomain))
	exitDomain, err := signing.ComputeDomain(params.BeaconConfig().DomainVoluntaryExit, fork, genesis)
	Must(err)
	syncDomain, err := signing.ComputeDomain(params.BeaconConfig().DomainSyncCommittee, fork, genesis)
	Must(err)
	exit := &pb.VoluntaryExit{Epoch: 0, ValidatorIndex: 0}
	exitRoot, err := signing.ComputeSigningRoot(exit, exitDomain)
	Must(err)
	signedExit, err := key.Sign(exitRoot[:])
	Must(err)
	exitSignature := signedExit.Marshal()
	Must(signing.VerifySigningRoot(exit, key.PublicKey().Marshal(), exitSignature, exitDomain))
	s, err := util.NewBeaconStateZond()
	Must(err)
	future := primitives.Epoch(^uint64(0))
	Must(s.AppendValidator(&pb.Validator{PublicKey: bootstrap.PublicKey, WithdrawalRecipient: pool.Bytes(), EffectiveBalance: 2000000000000, ActivationEligibilityEpoch: future, ActivationEpoch: future, ExitEpoch: future, WithdrawableEpoch: future, RandaoCommitment: commitment[:]}))
	Must(s.AppendBalance(2000000000000))
	account, err := rlp.EncodeToBytes(&types.StateAccount{Nonce: 1, Balance: big.NewInt(0), Root: types.EmptyRootHash, CodeHash: types.EmptyCodeHash.Bytes()})
	Must(err)
	node, err := rlp.EncodeToBytes([][]byte{append([]byte{0x20}, crypto.Keccak256(pool.Bytes())...), account})
	Must(err)
	h := s.ToProto().(*pb.BeaconStateZond).LatestExecutionPayloadHeader
	h.StateRoot = crypto.Keccak256(node)
	h.BlockNumber = 80
	wrapped, err := consensus.WrappedExecutionPayloadHeaderZond(h, 0)
	Must(err)
	Must(s.SetLatestExecutionPayloadHeader(wrapped))
	Must(s.SetSlot(64))
	initial := State(s.(*statenative.BeaconState), []uint64{0})
	b0 := util.NewBeaconBlockZond().Block
	b0.Slot = 64
	b0.StateRoot = common.FromHex(initial.StateRoot)
	initialRoot := Root(b0)
	Must(s.SetSlot(80))
	current := State(s.(*statenative.BeaconState), []uint64{0})
	b := util.NewBeaconBlockZond().Block
	b.Slot = 80
	b.ParentRoot = initialRoot
	b.StateRoot = common.FromHex(current.StateRoot)
	data := func(d *pb.Deposit_Data) map[string]any {
		return map[string]any{"publicKey": Hex(d.PublicKey), "randaoCommitment": Hex(d.RandaoCommitment), "signature": Hex(d.Signature), "dataRoot": Hex(Root(d))}
	}
	out := map[string]any{"origin": origin.String(), "pool": pool.String(), "gate": gate.String(), "forkVersion": Hex(fork), "genesisValidatorsRoot": Hex(genesis), "syncDomain": Hex(syncDomain), "depositDomain": Hex(depositDomain), "exitDomain": Hex(exitDomain), "bootstrap": data(bootstrap), "topup": data(topup), "exitSignature": Hex(exitSignature), "initial": initial, "initialHeaderRoot": Hex(initialRoot), "current": current, "headerRoot": Hex(Root(b)), "blocks": []BlockWitness{Flow(b)}, "accountProof": []string{Hex(node)}, "boundary": "Fresh discarded test key; genuine native signatures and canonical SSZ roots; synthetic checkpoint authority and mock pool cash release."}
	out["canonicalDepositAddress"] = params.BeaconConfig().DepositContractAddress
	// A second plan uses the real production pool adapter. Its checkpoints are
	// synthetic state inputs with cash, consumed deposits and registered balances
	// deliberately matched to actual QRVM cash transfers in that plan.
	parent := initialRoot
	points := []any{}
	for _, point := range []struct {
		slot, cash, balance, cursor uint64
		included                    *pb.Deposit_Data
	}{
		{80, 50000, 2000, 1, bootstrap}, {96, 12000, 2000, 1, nil},
		{112, 12000, 40000, 2, topup}, {128, 13000, 42000, 3, bootstrap},
		{144, 14000, 42000, 3, nil}, {4224, 14000, 42000, 3, nil},
	} {
		amount := new(big.Int).Mul(new(big.Int).SetUint64(point.cash), big.NewInt(1000000000000000000))
		a, err := rlp.EncodeToBytes(&types.StateAccount{Nonce: 1, Balance: amount, Root: types.EmptyRootHash, CodeHash: types.EmptyCodeHash.Bytes()})
		Must(err)
		n, err := rlp.EncodeToBytes([][]byte{append([]byte{0x20}, crypto.Keccak256(pool.Bytes())...), a})
		Must(err)
		h.StateRoot = crypto.Keccak256(n)
		h.BlockNumber = point.slot
		wrapped, err := consensus.WrappedExecutionPayloadHeaderZond(h, 0)
		Must(err)
		Must(s.SetLatestExecutionPayloadHeader(wrapped))
		Must(s.SetSlot(primitives.Slot(point.slot)))
		Must(s.SetExecutionDepositIndex(point.cursor))
		Must(s.SetBalances([]uint64{point.balance * 1000000000}))
		v, err := s.ValidatorAtIndex(0)
		Must(err)
		v.EffectiveBalance = min(point.balance, 40000) * 1000000000
		Must(s.UpdateValidatorAtIndex(0, v))
		state := State(s.(*statenative.BeaconState), []uint64{0})
		block := util.NewBeaconBlockZond().Block
		block.Slot = primitives.Slot(point.slot)
		block.ParentRoot = parent
		block.StateRoot = common.FromHex(state.StateRoot)
		if point.slot == 144 {
			block.Body.ExecutionPayload.Withdrawals = []*engine.Withdrawal{{Index: 0, ValidatorIndex: 0, Address: pool.Bytes(), Amount: 1000 * 1000000000}}
		}
		if point.included != nil {
			proof := make([][]byte, 33)
			for i := range proof {
				proof[i] = make([]byte, 32)
			}
			block.Body.Deposits = []*pb.Deposit{{Proof: proof, Data: point.included}}
		}
		parent = Root(block)
		points = append(points, map[string]any{"state": state, "headerRoot": Hex(parent), "blocks": []BlockWitness{Flow(block)}, "accountProof": []string{Hex(n)}})
	}
	// A fresh checkpoint at the pool's initial applied deadline spans both
	// explicit occupied blocks since slot 128; the intervening slots are empty.
	late := points[len(points)-1].(map[string]any)
	prior := points[len(points)-2].(map[string]any)
	late["blocks"] = append(late["blocks"].([]BlockWitness), prior["blocks"].([]BlockWitness)...)
	out["productionPoints"] = points
	if output := os.Getenv("QUANTAPOOL_GATE_FIXTURE"); output != "" {
		raw, err := json.MarshalIndent(out, "", "  ")
		Must(err)
		Must(os.WriteFile(output, append(raw, '\n'), 0644))
	}
	if directory := os.Getenv("QUANTAPOOL_NATIVE_DEPOSIT_ARTIFACT"); directory != "" {
		Must(os.MkdirAll(directory, 0755))
		Must(os.WriteFile(filepath.Join(directory, "CanonicalDeposit.abi"), []byte(deposit.DepositContractABI), 0644))
		Must(os.WriteFile(filepath.Join(directory, "CanonicalDeposit.bin"), []byte(deposit.DepositContractCreationCodeHex()), 0644))
	}
}
