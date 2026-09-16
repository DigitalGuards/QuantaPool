// verify-checkpoint checks captured SSZ and account proofs with pinned native
// implementations. The input beacon header still needs a finality trust anchor.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/core/types"
	"github.com/theQRL/go-qrl/crypto"
	"github.com/theQRL/go-qrl/qrldb/memorydb"
	"github.com/theQRL/go-qrl/rlp"
	"github.com/theQRL/go-qrl/trie"
	statenative "github.com/theQRL/qrysm/beacon-chain/state/state-native"
	"github.com/theQRL/qrysm/config/params"
	engine "github.com/theQRL/qrysm/proto/engine/v1"
	qrysmpb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func require(ok bool, message string) {
	if !ok {
		panic(message)
	}
}
func hx(v []byte) string { return "0x" + hex.EncodeToString(v) }
func unhex(v string) []byte {
	raw, err := hex.DecodeString(strings.TrimPrefix(v, "0x"))
	must(err)
	return raw
}
func leaf(v uint64) []byte { b := make([]byte, 32); binary.LittleEndian.PutUint64(b, v); return b }
func pair(a, b []byte) []byte {
	h := sha256.Sum256(append(append([]byte(nil), a...), b...))
	return h[:]
}
func tree(leaves [][]byte, index int) ([]byte, [][]byte) {
	n := 1
	for n < len(leaves) {
		n *= 2
	}
	nodes := make([][]byte, n)
	for i := range nodes {
		nodes[i] = make([]byte, 32)
		if i < len(leaves) {
			copy(nodes[i], leaves[i])
		}
	}
	var branch [][]byte
	for len(nodes) > 1 {
		branch = append(branch, nodes[index^1])
		next := make([][]byte, len(nodes)/2)
		for i := range next {
			next[i] = pair(nodes[i*2], nodes[i*2+1])
		}
		nodes = next
		index /= 2
	}
	return nodes[0], branch
}
func vector(v []byte) []byte {
	chunks := make([][]byte, (len(v)+31)/32)
	if len(chunks) == 0 {
		chunks = make([][]byte, 1)
	}
	for i := range chunks {
		chunks[i] = make([]byte, 32)
		copy(chunks[i], v[min(i*32, len(v)):min(i*32+32, len(v))])
	}
	r, _ := tree(chunks, 0)
	return r
}
func headerFields(h *engine.ExecutionPayloadHeaderZond) [][]byte {
	return [][]byte{h.ParentHash, vector(h.FeeRecipient), h.StateRoot, h.ReceiptsRoot, vector(h.LogsBloom), h.PrevRandao,
		leaf(h.BlockNumber), leaf(h.GasLimit), leaf(h.GasUsed), leaf(h.Timestamp), pair(vector(h.ExtraData), leaf(uint64(len(h.ExtraData)))),
		h.BaseFeePerGas, h.BlockHash, h.TransactionsRoot, h.WithdrawalsRoot}
}
func hexList(v [][]byte) []string {
	out := make([]string, len(v))
	for i := range v {
		out[i] = hx(v[i])
	}
	return out
}
func reconstruct(v []byte, branch [][]byte, index uint64) []byte {
	for _, sibling := range branch {
		if index&1 == 0 {
			v = pair(v, sibling)
		} else {
			v = pair(sibling, v)
		}
		index /= 2
	}
	require(index == 1, "branch depth mismatch")
	return v
}
func main() {
	dir := flag.String("capture-dir", "", "public checkpoint capture directory")
	output := flag.String("output", "", "public verified witness output")
	flag.Parse()
	require(*dir != "" && *output != "", "capture-dir and output required")
	read := func(name string) []byte { raw, err := os.ReadFile(filepath.Join(*dir, name)); must(err); return raw }
	var manifest struct {
		Slot        string
		Account     string
		QrysmCommit string
		GoQrlCommit string
		Files       map[string]struct {
			SHA256 string
			Bytes  int
		}
	}
	must(json.Unmarshal(read("manifest.json"), &manifest))
	require(manifest.QrysmCommit == "3b816311ac3e86b7a7af40a062ae290318554f7a" && manifest.GoQrlCommit == "9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9", "capture source pins mismatch")
	for name, info := range manifest.Files {
		require(filepath.Base(name) == name, "invalid filename")
		raw := read(name)
		h := sha256.Sum256(raw)
		require(len(raw) == info.Bytes && hex.EncodeToString(h[:]) == info.SHA256, "capture integrity mismatch")
	}
	config, err := params.UnmarshalConfigFile(filepath.Join(*dir, "config.yml"), nil)
	must(err)
	params.OverrideBeaconConfig(config)
	p := new(qrysmpb.BeaconStateZond)
	must(p.UnmarshalSSZ(read("state.ssz")))
	state, err := statenative.InitializeFromProtoZond(p)
	must(err)
	root, err := state.HashTreeRoot(context.Background())
	must(err)
	var observed struct {
		Data struct {
			Root   string
			Header struct {
				Message struct {
					Slot      string
					StateRoot string `json:"state_root"`
				}
			}
		}
	}
	must(json.Unmarshal(read("header.json"), &observed))
	require(observed.Data.Header.Message.Slot == manifest.Slot && fmt.Sprint(p.Slot) == manifest.Slot, "state slot mismatch")
	require(hx(root[:]) == observed.Data.Header.Message.StateRoot, "native state root differs from header")
	fields, err := statenative.ComputeFieldRootsWithHasher(context.Background(), state.(*statenative.BeaconState))
	must(err)
	fullRoot, payloadBranch := tree(fields, 24)
	require(bytes.Equal(fullRoot, root[:]), "native field roots mismatch")
	h := p.LatestExecutionPayloadHeader
	payloadFields := headerFields(h)
	payloadRoot, stateRootBranch := tree(payloadFields, 2)
	nativePayloadRoot, err := h.HashTreeRoot()
	must(err)
	require(bytes.Equal(payloadRoot, nativePayloadRoot[:]) && bytes.Equal(payloadRoot, fields[24]), "payload header root mismatch")
	stateRootBranch = append(stateRootBranch, payloadBranch...)
	require(bytes.Equal(reconstruct(h.StateRoot, stateRootBranch, 898), root[:]), "execution-root SSZ proof mismatch")
	_, depositBranch := tree(fields, 10)
	require(bytes.Equal(reconstruct(leaf(p.ExecutionDepositIndex), depositBranch, 42), root[:]), "deposit cursor proof mismatch")
	_, blockBranch := tree(payloadFields, 6)
	blockBranch = append(blockBranch, payloadBranch...)
	require(bytes.Equal(reconstruct(leaf(h.BlockNumber), blockBranch, 902), root[:]), "execution block proof mismatch")
	var execution struct{ Hash, StateRoot, Number string }
	must(json.Unmarshal(read("execution.json"), &execution))
	blockNumber, err := strconv.ParseUint(strings.TrimPrefix(execution.Number, "0x"), 16, 64)
	must(err)
	require(blockNumber == h.BlockNumber && execution.Hash == hx(h.BlockHash) && execution.StateRoot == hx(h.StateRoot), "execution header mismatch")
	var proof struct {
		Address, Balance, Nonce, StorageHash, CodeHash string
		AccountProof                                   []string
	}
	must(json.Unmarshal(read("account.json"), &proof))
	require(len(manifest.Account) == 129 && manifest.Account[0] == 'Q', "requires full 64-byte address")
	addressBytes, err := hex.DecodeString(manifest.Account[1:])
	must(err)
	require(len(addressBytes) == 64, "address width mismatch")
	address := common.BytesToAddress(addressBytes)
	require(strings.EqualFold(proof.Address, manifest.Account), "RPC account mismatch")
	db := memorydb.New()
	defer db.Close()
	totalBytes := 0
	require(len(proof.AccountProof) > 0 && len(proof.AccountProof) <= 65, "account proof count bound")
	for _, node := range proof.AccountProof {
		raw := unhex(node)
		require(len(raw) <= 1024, "account proof node bound")
		must(db.Put(crypto.Keccak256(raw), raw))
		totalBytes += len(raw)
	}
	key := crypto.Keccak256(address.Bytes())
	value, err := trie.VerifyProof(common.BytesToHash(h.StateRoot), key, db)
	must(err)
	require(len(value) > 0, "pool account must exist")
	account := new(types.StateAccount)
	must(rlp.DecodeBytes(value, account))
	claimed, ok := new(big.Int).SetString(strings.TrimPrefix(proof.Balance, "0x"), 16)
	require(ok && claimed.Cmp(account.Balance) == 0, "RPC balance differs from proven RLP")
	claimedNonce, err := strconv.ParseUint(strings.TrimPrefix(proof.Nonce, "0x"), 16, 64)
	must(err)
	require(claimedNonce == account.Nonce && proof.StorageHash == account.Root.Hex() && proof.CodeHash == hx(account.CodeHash), "RPC account fields differ from proven RLP")
	// Native negative checks bind the state root and all 64 address bytes.
	wrongRoot := common.BytesToHash(h.StateRoot)
	wrongRoot[0] ^= 1
	_, err = trie.VerifyProof(wrongRoot, key, db)
	require(err != nil, "wrong root accepted")
	wrongKey := crypto.Keccak256(address.Bytes()[32:])
	wrongValue, wrongErr := trie.VerifyProof(common.BytesToHash(h.StateRoot), wrongKey, db)
	require(wrongErr != nil || !bytes.Equal(wrongValue, value), "truncated address accepted")
	result := map[string]any{"slot": manifest.Slot, "beaconStateRoot": hx(root[:]), "executionBlock": fmt.Sprint(h.BlockNumber), "executionBlockHash": hx(h.BlockHash),
		"executionStateRoot": hx(h.StateRoot), "executionStateRootBranch": hexList(stateRootBranch), "executionStateRootGeneralizedIndex": "898",
		"executionBlockBranch": hexList(blockBranch), "executionBlockGeneralizedIndex": "902", "executionDepositIndex": fmt.Sprint(p.ExecutionDepositIndex), "executionDepositIndexBranch": hexList(depositBranch), "executionDepositIndexGeneralizedIndex": "42",
		"account": manifest.Account, "accountTrieKey": hx(key), "accountProof": proof.AccountProof, "accountRLP": hx(value), "balanceBaseUnits": account.Balance.String(), "nonce": fmt.Sprint(account.Nonce), "storageRoot": account.Root.Hex(), "codeHash": hx(account.CodeHash),
		"proofNodes": len(proof.AccountProof), "proofBytes": totalBytes, "nativeSSZVerified": true, "nativeAccountProofVerified": true, "wrongRootRejected": true, "truncatedAddressRejected": true,
		"boundary": "Native proof verified relative to the captured beacon header. This capture does not establish contract-verified finality or economic accounting."}
	raw, err := json.MarshalIndent(result, "", "  ")
	must(err)
	must(os.WriteFile(*output, append(raw, '\n'), 0644))
	delete(result, "accountProof")
	delete(result, "accountRLP")
	delete(result, "executionStateRootBranch")
	delete(result, "executionBlockBranch")
	delete(result, "executionDepositIndexBranch")
	summary, err := json.Marshal(result)
	must(err)
	fmt.Println(string(summary))
}
