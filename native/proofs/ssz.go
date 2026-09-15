// Package proofs exports canonical witnesses from the pinned, unchanged Qrysm
// implementation. Native root checks are mandatory for every exported proof.
package proofs

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"

	consensus "github.com/theQRL/qrysm/consensus-types/blocks"
	engine "github.com/theQRL/qrysm/proto/engine/v1"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

func Must(err error) {
	if err != nil {
		panic(err)
	}
}
func Require(ok bool, message string) {
	if !ok {
		panic(message)
	}
}
func Hex(v []byte) string  { return "0x" + hex.EncodeToString(v) }
func Uint(v uint64) []byte { r := make([]byte, 32); binary.LittleEndian.PutUint64(r, v); return r }
func Pair(a, b []byte) []byte {
	r := sha256.Sum256(append(append([]byte(nil), a...), b...))
	return r[:]
}
func HexList(v [][]byte) []string {
	r := make([]string, len(v))
	for i := range v {
		r[i] = Hex(v[i])
	}
	return r
}
func Tree(leaves [][]byte, depth uint, index uint64) ([]byte, [][]byte) {
	Require(uint64(len(leaves)) <= uint64(1)<<depth && index < uint64(1)<<depth, "tree bound")
	current := append([][]byte(nil), leaves...)
	if len(current) == 0 {
		current = [][]byte{make([]byte, 32)}
	}
	zero := make([]byte, 32)
	branch := make([][]byte, 0, depth)
	for level := uint(0); level < depth; level++ {
		sibling := zero
		if index^1 < uint64(len(current)) {
			sibling = current[index^1]
		}
		branch = append(branch, sibling)
		next := make([][]byte, (len(current)+1)/2)
		for i := range next {
			right := zero
			if i*2+1 < len(current) {
				right = current[i*2+1]
			}
			next[i] = Pair(current[i*2], right)
		}
		current = next
		zero = Pair(zero, zero)
		index /= 2
	}
	Require(len(current) == 1, "tree did not converge")
	return current[0], branch
}
func Vector(v []byte) []byte {
	chunks := make([][]byte, (len(v)+31)/32)
	for i := range chunks {
		chunks[i] = make([]byte, 32)
		copy(chunks[i], v[i*32:min((i+1)*32, len(v))])
	}
	depth := uint(0)
	for 1<<depth < len(chunks) {
		depth++
	}
	r, _ := Tree(chunks, depth, 0)
	return r
}

type rooted interface{ HashTreeRoot() ([32]byte, error) }

func Root(v rooted) []byte { r, err := v.HashTreeRoot(); Must(err); return r[:] }
func list[T rooted](values []T, depth uint) []byte {
	leaves := make([][]byte, len(values))
	for i := range values {
		leaves[i] = Root(values[i])
	}
	r, _ := Tree(leaves, depth, 0)
	return Pair(r, Uint(uint64(len(values))))
}
func HeaderFields(h *engine.ExecutionPayloadHeaderZond) [][]byte {
	return [][]byte{h.ParentHash, Vector(h.FeeRecipient), h.StateRoot, h.ReceiptsRoot, Vector(h.LogsBloom), h.PrevRandao, Uint(h.BlockNumber), Uint(h.GasLimit), Uint(h.GasUsed), Uint(h.Timestamp), Pair(Vector(h.ExtraData), Uint(uint64(len(h.ExtraData)))), h.BaseFeePerGas, h.BlockHash, h.TransactionsRoot, h.WithdrawalsRoot}
}

type Header struct {
	Slot          string `json:"slot"`
	ProposerIndex string `json:"proposerIndex"`
	ParentRoot    string `json:"parentRoot"`
	StateRoot     string `json:"stateRoot"`
	BodyRoot      string `json:"bodyRoot"`
}
type Withdrawal struct {
	Index          string `json:"index"`
	ValidatorIndex string `json:"validatorIndex"`
	Recipient      string `json:"recipient"`
	AmountShor     string `json:"amountShor"`
}
type Deposit struct {
	PublicKeyRoot           string `json:"publicKeyRoot"`
	WithdrawalRecipientRoot string `json:"withdrawalRecipientRoot"`
	AmountShor              string `json:"amountShor"`
	RandaoCommitment        string `json:"randaoCommitment"`
	SignatureRoot           string `json:"signatureRoot"`
	DepositProofRoot        string `json:"depositProofRoot"`
}
type BlockWitness struct {
	Header            Header       `json:"header"`
	Withdrawals       []Withdrawal `json:"withdrawals"`
	Deposits          []Deposit    `json:"deposits"`
	WithdrawalsBranch []string     `json:"withdrawalsBranch"`
	DepositsBranch    []string     `json:"depositsBranch"`
}

// Flow compresses large fixed-size public keys/signatures to their authenticated
// SSZ roots. It keeps both complete ordered native lists, including unrelated keys.
func Flow(block *pb.BeaconBlockZond) BlockWitness {
	body := block.Body
	payload, err := consensus.WrappedExecutionPayloadZond(body.ExecutionPayload, 0)
	Must(err)
	payloadHeader, err := consensus.PayloadToHeaderZond(payload)
	Must(err)
	payloadFields := HeaderFields(payloadHeader)
	payloadRoot, withdrawalBranch := Tree(payloadFields, 4, 14)
	Require(bytes.Equal(payloadRoot, Root(body.ExecutionPayload)), "payload field roots differ from native root")
	fields := [][]byte{body.RandaoReveal, Root(body.ExecutionData), body.Graffiti, list(body.ProposerSlashings, 4), list(body.AttesterSlashings, 1), list(body.Attestations, 2), list(body.Deposits, 4), list(body.VoluntaryExits, 4), Root(body.SyncAggregate), payloadRoot}
	bodyRoot, payloadBranch := Tree(fields, 4, 9)
	Require(bytes.Equal(bodyRoot, Root(body)), "body field roots differ from native root")
	_, depositBranch := Tree(fields, 4, 6)
	out := BlockWitness{Header: Header{fmt.Sprint(block.Slot), fmt.Sprint(block.ProposerIndex), Hex(block.ParentRoot), Hex(block.StateRoot), Hex(bodyRoot)}, Withdrawals: []Withdrawal{}, Deposits: []Deposit{}, WithdrawalsBranch: HexList(append(withdrawalBranch, payloadBranch...)), DepositsBranch: HexList(depositBranch)}
	for _, w := range body.ExecutionPayload.Withdrawals {
		leaf, _ := Tree([][]byte{Uint(w.Index), Uint(uint64(w.ValidatorIndex)), Vector(w.Address), Uint(w.Amount)}, 2, 0)
		Require(bytes.Equal(leaf, Root(w)), "withdrawal summary differs from native root")
		out.Withdrawals = append(out.Withdrawals, Withdrawal{fmt.Sprint(w.Index), fmt.Sprint(w.ValidatorIndex), Hex(w.Address), fmt.Sprint(w.Amount)})
	}
	for _, d := range body.Deposits {
		proofRoot, _ := Tree(d.Proof, 6, 0)
		dataRoot, _ := Tree([][]byte{Vector(d.Data.PublicKey), Vector(d.Data.WithdrawalRecipient), Uint(d.Data.Amount), d.Data.RandaoCommitment, Vector(d.Data.Signature)}, 3, 0)
		Require(bytes.Equal(dataRoot, Root(d.Data)) && bytes.Equal(Pair(proofRoot, dataRoot), Root(d)), "deposit summary differs from native root")
		out.Deposits = append(out.Deposits, Deposit{Hex(Vector(d.Data.PublicKey)), Hex(Vector(d.Data.WithdrawalRecipient)), fmt.Sprint(d.Data.Amount), Hex(d.Data.RandaoCommitment), Hex(Vector(d.Data.Signature)), Hex(proofRoot)})
	}
	return out
}
