package proofs

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"

	statenative "github.com/theQRL/qrysm/beacon-chain/state/state-native"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

type ValidatorWitness struct {
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
	ValidatorBranch            []string `json:"validatorBranch"`
	BalanceChunk               string   `json:"balanceChunk"`
	BalanceBranch              []string `json:"balanceBranch"`
	BalanceShor                string   `json:"balanceShor"`
}
type StateWitness struct {
	Slot                        string             `json:"slot"`
	StateRoot                   string             `json:"stateRoot"`
	ExecutionStateRoot          string             `json:"executionStateRoot"`
	ExecutionBlock              string             `json:"executionBlock"`
	ExecutionDepositIndex       string             `json:"executionDepositIndex"`
	ExecutionStateRootBranch    []string           `json:"executionStateRootBranch"`
	ExecutionBlockBranch        []string           `json:"executionBlockBranch"`
	ExecutionDepositIndexBranch []string           `json:"executionDepositIndexBranch"`
	Validators                  []ValidatorWitness `json:"validators"`
}

func State(s *statenative.BeaconState, indices []uint64) StateWitness {
	root, err := s.HashTreeRoot(context.Background())
	Must(err)
	fields, err := statenative.ComputeFieldRootsWithHasher(context.Background(), s)
	Must(err)
	computed, payloadBranch := Tree(fields, 5, 24)
	Require(bytes.Equal(computed, root[:]), "native state field root mismatch")
	p := s.ToProto().(*pb.BeaconStateZond)
	h := p.LatestExecutionPayloadHeader
	hFields := HeaderFields(h)
	hRoot, cashBranch := Tree(hFields, 4, 2)
	Require(bytes.Equal(hRoot, Root(h)), "native payload header root mismatch")
	_, blockBranch := Tree(hFields, 4, 6)
	_, depositBranch := Tree(fields, 5, 10)
	out := StateWitness{Slot: fmt.Sprint(p.Slot), StateRoot: Hex(root[:]), ExecutionStateRoot: Hex(h.StateRoot), ExecutionBlock: fmt.Sprint(h.BlockNumber), ExecutionDepositIndex: fmt.Sprint(p.ExecutionDepositIndex), ExecutionStateRootBranch: HexList(append(cashBranch, payloadBranch...)), ExecutionBlockBranch: HexList(append(blockBranch, payloadBranch...)), ExecutionDepositIndexBranch: HexList(depositBranch), Validators: []ValidatorWitness{}}
	Require(len(p.Validators) == len(p.Balances), "native validator/balance list count mismatch")
	leaves := make([][]byte, len(p.Validators))
	for i, v := range p.Validators {
		leaves[i] = Root(v)
	}
	chunks := make([][]byte, (len(p.Balances)+3)/4)
	for i := range chunks {
		chunks[i] = make([]byte, 32)
	}
	for i, b := range p.Balances {
		binary.LittleEndian.PutUint64(chunks[i/4][8*(i%4):], b)
	}
	_, validatorField := Tree(fields, 5, 11)
	_, balanceField := Tree(fields, 5, 12)
	length := Uint(uint64(len(p.Validators)))
	for _, index := range indices {
		Require(index < uint64(len(p.Validators)), "selected validator absent")
		v := p.Validators[index]
		vr, vp := Tree(leaves, 40, index)
		br, bp := Tree(chunks, 38, index/4)
		Require(bytes.Equal(Pair(vr, length), fields[11]) && bytes.Equal(Pair(br, length), fields[12]), "native validator/balance root mismatch")
		vp = append(append(vp, length), validatorField...)
		bp = append(append(bp, length), balanceField...)
		out.Validators = append(out.Validators, ValidatorWitness{fmt.Sprint(index), Hex(v.PublicKey), Hex(Vector(v.PublicKey)), Hex(v.WithdrawalRecipient), fmt.Sprint(v.EffectiveBalance), v.Slashed, fmt.Sprint(v.ActivationEligibilityEpoch), fmt.Sprint(v.ActivationEpoch), fmt.Sprint(v.ExitEpoch), fmt.Sprint(v.WithdrawableEpoch), Hex(v.RandaoCommitment), HexList(vp), Hex(chunks[index/4]), HexList(bp), fmt.Sprint(p.Balances[index])})
	}
	return out
}
