package proofs

import (
	"bytes"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/theQRL/qrysm/consensus-types/primitives"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

func flowHex(value string, size int) []byte {
	Require(strings.HasPrefix(value, "0x"), "canonical flow hexadecimal required")
	raw, err := hex.DecodeString(value[2:])
	Must(err)
	Require(len(raw) == size, "flow field length")
	return raw
}
func flowUint(value string) uint64 {
	n, err := strconv.ParseUint(value, 10, 64)
	Must(err)
	Require(strconv.FormatUint(n, 10) == value, "canonical flow integer required")
	return n
}
func flowBranch(root, leaf []byte, index uint64, branch []string, depth int) {
	Require(len(branch) == depth, "cached flow proof length")
	for _, item := range branch {
		sibling := flowHex(item, 32)
		if index&1 == 0 {
			leaf = Pair(leaf, sibling)
		} else {
			leaf = Pair(sibling, leaf)
		}
		index /= 2
	}
	Require(index == 1 && bytes.Equal(root, leaf), "cached flow proof root")
}

// CheckedFlowRoot verifies every compact list and branch before cached reuse.
// Its header root is computed by the pinned native SSZ implementation. Finality
// remains a separate authority; no cache flag is treated as a proof.
func CheckedFlowRoot(value BlockWitness) string {
	h := &pb.BeaconBlockHeader{Slot: primitives.Slot(flowUint(value.Header.Slot)),
		ProposerIndex: primitives.ValidatorIndex(flowUint(value.Header.ProposerIndex)),
		ParentRoot:    flowHex(value.Header.ParentRoot, 32), StateRoot: flowHex(value.Header.StateRoot, 32),
		BodyRoot: flowHex(value.Header.BodyRoot, 32)}
	Require(len(value.Withdrawals) <= 16 && len(value.Deposits) <= 16, "cached native list bound")
	withdrawals := make([][]byte, len(value.Withdrawals))
	for i, w := range value.Withdrawals {
		withdrawals[i], _ = Tree([][]byte{Uint(flowUint(w.Index)), Uint(flowUint(w.ValidatorIndex)),
			Vector(flowHex(w.Recipient, 64)), Uint(flowUint(w.AmountShor))}, 2, 0)
	}
	withdrawalRoot, _ := Tree(withdrawals, 4, 0)
	flowBranch(h.BodyRoot, Pair(withdrawalRoot, Uint(uint64(len(withdrawals)))), 414, value.WithdrawalsBranch, 8)
	deposits := make([][]byte, len(value.Deposits))
	for i, d := range value.Deposits {
		data, _ := Tree([][]byte{flowHex(d.PublicKeyRoot, 32), flowHex(d.WithdrawalRecipientRoot, 32),
			Uint(flowUint(d.AmountShor)), flowHex(d.RandaoCommitment, 32), flowHex(d.SignatureRoot, 32)}, 3, 0)
		deposits[i] = Pair(flowHex(d.DepositProofRoot, 32), data)
	}
	depositRoot, _ := Tree(deposits, 4, 0)
	flowBranch(h.BodyRoot, Pair(depositRoot, Uint(uint64(len(deposits)))), 22, value.DepositsBranch, 4)
	return Hex(Root(h))
}
