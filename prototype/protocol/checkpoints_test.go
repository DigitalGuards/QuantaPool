package protocol_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	coreblocks "github.com/theQRL/qrysm/beacon-chain/core/blocks"
	"github.com/theQRL/qrysm/beacon-chain/state"
	statenative "github.com/theQRL/qrysm/beacon-chain/state/state-native"
	"github.com/theQRL/qrysm/config/params"
	consensusblocks "github.com/theQRL/qrysm/consensus-types/blocks"
	"github.com/theQRL/qrysm/consensus-types/primitives"
	enginev1 "github.com/theQRL/qrysm/proto/engine/v1"
	qrysmpb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

func hashPair(a, b [32]byte) [32]byte {
	var input [64]byte
	copy(input[:32], a[:])
	copy(input[32:], b[:])
	return sha256.Sum256(input[:])
}

func uintRoot(v uint64) (r [32]byte) { binary.LittleEndian.PutUint64(r[:8], v); return }
func hx(v []byte) string             { return "0x" + hex.EncodeToString(v) }
func rootsHex(roots [][32]byte) []string {
	result := make([]string, len(roots))
	for i := range roots {
		result[i] = hx(roots[i][:])
	}
	return result
}

// sparseRootProof constructs only the populated tree prefix. Fixed-depth zero
// subtrees represent the rest of the SSZ capacity, including the 2^40 list.
func sparseRootProof(t *testing.T, leaves [][32]byte, depth uint, index uint64) ([32]byte, [][32]byte) {
	t.Helper()
	if index >= uint64(len(leaves)) || uint64(len(leaves)) > uint64(1)<<depth {
		t.Fatal("invalid sparse tree input")
	}
	current := append([][32]byte(nil), leaves...)
	zero := [32]byte{}
	branch := make([][32]byte, 0, depth)
	for level := uint(0); level < depth; level++ {
		sibling := index ^ 1
		if sibling < uint64(len(current)) {
			branch = append(branch, current[sibling])
		} else {
			branch = append(branch, zero)
		}
		next := make([][32]byte, (len(current)+1)/2)
		for i := range next {
			right := zero
			if 2*i+1 < len(current) {
				right = current[2*i+1]
			}
			next[i] = hashPair(current[2*i], right)
		}
		current = next
		zero = hashPair(zero, zero)
		index /= 2
	}
	if len(current) != 1 {
		t.Fatal("sparse tree failed to reach root")
	}
	return current[0], branch
}

func verifyProof(leaf [32]byte, branch [][32]byte, index uint64) [32]byte {
	for _, sibling := range branch {
		if index&1 == 0 {
			leaf = hashPair(leaf, sibling)
		} else {
			leaf = hashPair(sibling, leaf)
		}
		index /= 2
	}
	return leaf
}

type validatorWitness struct {
	Index                      string   `json:"index"`
	PublicKey                  string   `json:"publicKey"`
	PublicKeyRoot              string   `json:"publicKeyRoot"`
	WithdrawalRecipient        string   `json:"withdrawalRecipient"`
	EffectiveBalance           string   `json:"effectiveBalance"`
	Slashed                    bool     `json:"slashed"`
	ActivationEligibilityEpoch string   `json:"activationEligibilityEpoch"`
	ActivationEpoch            string   `json:"activationEpoch"`
	ExitEpoch                  string   `json:"exitEpoch"`
	WithdrawableEpoch          string   `json:"withdrawableEpoch"`
	RandaoCommitment           string   `json:"randaoCommitment"`
	ValidatorRoot              string   `json:"validatorRoot"`
	ValidatorGeneralizedIndex  string   `json:"validatorGeneralizedIndex"`
	ValidatorBranch            []string `json:"validatorBranch"`
	Balance                    string   `json:"balance"`
	BalanceChunk               string   `json:"balanceChunk"`
	BalanceGeneralizedIndex    string   `json:"balanceGeneralizedIndex"`
	BalanceBranch              []string `json:"balanceBranch"`
}

type checkpointWitness struct {
	Name       string             `json:"name"`
	Slot       string             `json:"slot"`
	StateRoot  string             `json:"stateRoot"`
	SlotBranch []string           `json:"slotBranch"`
	Validators []validatorWitness `json:"validators"`
}

func checkpoint(t *testing.T, name string, s state.BeaconState) checkpointWitness {
	t.Helper()
	fieldBytes, err := statenative.ComputeFieldRootsWithHasher(context.Background(), s.(*statenative.BeaconState))
	must(t, err)
	fields := make([][32]byte, len(fieldBytes))
	for i := range fields {
		copy(fields[i][:], fieldBytes[i])
	}
	root, slotBranch := sparseRootProof(t, fields, 5, 2)
	nativeRoot, err := s.HashTreeRoot(context.Background())
	must(t, err)
	protoRoot, err := s.ToProto().(*qrysmpb.BeaconStateZond).HashTreeRoot()
	must(t, err)
	if root != nativeRoot || root != protoRoot {
		t.Fatal("fixture SSZ tree differs from native/protobuf Qrysm root")
	}
	result := checkpointWitness{Name: name, Slot: fmt.Sprint(s.Slot()), StateRoot: hx(root[:]), SlotBranch: rootsHex(slotBranch)}
	validators := s.Validators()
	validatorLeaves := make([][32]byte, len(validators))
	for i, v := range validators {
		validatorLeaves[i], err = v.HashTreeRoot()
		must(t, err)
	}
	balances := s.Balances()
	chunks := make([][32]byte, (len(balances)+3)/4)
	for i, balance := range balances {
		binary.LittleEndian.PutUint64(chunks[i/4][8*(i%4):8*(i%4+1)], balance)
	}
	_, validatorFieldBranch := sparseRootProof(t, fields, 5, 11)
	_, balanceFieldBranch := sparseRootProof(t, fields, 5, 12)
	length := uintRoot(uint64(len(validators)))
	for i, v := range validators {
		validatorDataRoot, validatorBranch := sparseRootProof(t, validatorLeaves, 40, uint64(i))
		if hashPair(validatorDataRoot, length) != fields[11] {
			t.Fatal("validator list root mismatch")
		}
		validatorBranch = append(validatorBranch, length)
		validatorBranch = append(validatorBranch, validatorFieldBranch...)
		validatorGindex := uint64(43)<<41 | uint64(i)
		balanceDataRoot, balanceBranch := sparseRootProof(t, chunks, 38, uint64(i/4))
		if hashPair(balanceDataRoot, length) != fields[12] {
			t.Fatal("balance list root mismatch")
		}
		balanceBranch = append(balanceBranch, length)
		balanceBranch = append(balanceBranch, balanceFieldBranch...)
		balanceGindex := uint64(44)<<39 | uint64(i/4)
		if verifyProof(validatorLeaves[i], validatorBranch, validatorGindex) != root || verifyProof(chunks[i/4], balanceBranch, balanceGindex) != root {
			t.Fatal("exported proof does not reconstruct Qrysm root")
		}
		pubkeyChunks := make([][32]byte, 81)
		for j := range pubkeyChunks {
			copy(pubkeyChunks[j][:], v.PublicKey[j*32:(j+1)*32])
		}
		pubkeyRoot, _ := sparseRootProof(t, pubkeyChunks, 7, 0)
		result.Validators = append(result.Validators, validatorWitness{
			Index: fmt.Sprint(i), PublicKey: hx(v.PublicKey), PublicKeyRoot: hx(pubkeyRoot[:]), WithdrawalRecipient: hx(v.WithdrawalRecipient),
			EffectiveBalance: fmt.Sprint(v.EffectiveBalance), Slashed: v.Slashed, ActivationEligibilityEpoch: fmt.Sprint(v.ActivationEligibilityEpoch),
			ActivationEpoch: fmt.Sprint(v.ActivationEpoch), ExitEpoch: fmt.Sprint(v.ExitEpoch), WithdrawableEpoch: fmt.Sprint(v.WithdrawableEpoch),
			RandaoCommitment: hx(v.RandaoCommitment), ValidatorRoot: hx(validatorLeaves[i][:]), ValidatorGeneralizedIndex: fmt.Sprint(validatorGindex), ValidatorBranch: rootsHex(validatorBranch),
			Balance: fmt.Sprint(balances[i]), BalanceChunk: hx(chunks[i/4][:]), BalanceGeneralizedIndex: fmt.Sprint(balanceGindex), BalanceBranch: rootsHex(balanceBranch),
		})
	}
	return result
}

func TestCanonicalCheckpointFixtures(t *testing.T) {
	if params.BeaconConfig().ValidatorRegistryLimit != 1<<40 {
		t.Fatal("registry SSZ limit changed")
	}
	s := freshState(t)
	pool, other := recipient(0x63), recipient(0x41)
	for i := 0; i < 3; i++ {
		address, amount := pool, 40000*shorPerQRL
		if i == 2 {
			address, amount = other, 2000*shorPerQRL
		}
		// These deterministic PUBLIC byte arrays are SSZ-shaped accounting
		// fixtures. Actual cryptographic deposits use ephemeral keys elsewhere.
		v := &qrysmpb.Validator{
			PublicKey: bytes.Repeat([]byte{byte(0x70 + i)}, 2592), WithdrawalRecipient: bytes.Clone(address[:]),
			RandaoCommitment: bytes.Repeat([]byte{byte(0x20 + i)}, 32), EffectiveBalance: amount,
			ActivationEligibilityEpoch: 0, ActivationEpoch: 0, ExitEpoch: params.BeaconConfig().FarFutureEpoch, WithdrawableEpoch: params.BeaconConfig().FarFutureEpoch,
		}
		if i == 2 {
			v.ActivationEpoch = params.BeaconConfig().FarFutureEpoch
			v.ActivationEligibilityEpoch = params.BeaconConfig().FarFutureEpoch
		}
		must(t, s.AppendValidator(v))
		must(t, s.AppendBalance(amount))
	}
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(32)))
	points := []checkpointWitness{checkpoint(t, "initial", s)}
	must(t, s.SetBalances([]uint64{36000 * shorPerQRL, 41000 * shorPerQRL, 2000 * shorPerQRL}))
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(33)))
	points = append(points, checkpoint(t, "loss-and-reward", s))
	must(t, s.SetBalances([]uint64{0, 41000 * shorPerQRL, 2000 * shorPerQRL}))
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(34)))
	points = append(points, checkpoint(t, "active-zero", s))
	v, err := s.ValidatorAtIndex(0)
	must(t, err)
	v.Slashed = true
	v.ExitEpoch = 32
	v.WithdrawableEpoch = 35
	must(t, s.UpdateValidatorAtIndex(0, v))
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(35)))
	points = append(points, checkpoint(t, "terminal-zero", s))
	withdrawals, err := s.ExpectedWithdrawals()
	must(t, err)
	for _, withdrawal := range withdrawals {
		if withdrawal.ValidatorIndex == 0 {
			t.Fatal("zero-balance terminal validator unexpectedly produced a receipt")
		}
	}
	// Execute actual withdrawal processing for the positive validator's 1000
	// QRL excess. Native balance changes below are real protocol-function output.
	payload, err := consensusblocks.WrappedExecutionPayloadZond(&enginev1.ExecutionPayloadZond{Withdrawals: withdrawals}, 0)
	must(t, err)
	s, err = coreblocks.ProcessWithdrawals(s, payload)
	must(t, err)
	bal, err := s.BalanceAtIndex(primitives.ValidatorIndex(1))
	must(t, err)
	if bal != 40000*shorPerQRL {
		t.Fatal("partial withdrawal was not deducted")
	}
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(36)))
	points = append(points, checkpoint(t, "reward-withdrawn", s))
	fixture := struct {
		SchemaVersion     int                 `json:"schemaVersion"`
		QrysmCommit       string              `json:"qrysmCommit"`
		TrustAnchor       string              `json:"trustAnchor"`
		PoolRecipient     string              `json:"poolRecipient"`
		GenesisTime       string              `json:"genesisTime"`
		SecondsPerSlot    string              `json:"secondsPerSlot"`
		SlotsPerEpoch     string              `json:"slotsPerEpoch"`
		RegisteredIndices []string            `json:"registeredIndices"`
		Checkpoints       []checkpointWitness `json:"checkpoints"`
	}{1, "9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3", "Constructor-pinned synthetic state roots. No finality verifier or live-chain authentication. Public keys are SSZ-only fixtures; signed protocol tests use separate ephemeral real keys.", hx(pool[:]), "0", fmt.Sprint(params.BeaconConfig().SecondsPerSlot), fmt.Sprint(params.BeaconConfig().SlotsPerEpoch), []string{"0", "1"}, points}
	encoded, err := json.MarshalIndent(fixture, "", "  ")
	must(t, err)
	encoded = append(encoded, '\n')
	path := filepath.Join("testdata", "checkpoints.json")
	if os.Getenv("QUANTAPOOL_UPDATE_PUBLIC_FIXTURES") == "1" {
		must(t, os.MkdirAll(filepath.Dir(path), 0755))
		must(t, os.WriteFile(path, encoded, 0644))
	} else {
		stored, err := os.ReadFile(path)
		must(t, err)
		if !bytes.Equal(stored, encoded) {
			t.Fatal("public checkpoints differ; inspect upstream changes before explicitly updating fixtures")
		}
	}
	t.Logf("%d synthetic state checkpoints, each root crosschecked with Qrysm native/protobuf hash and all validator/balance/slot branches.", len(points))
}
