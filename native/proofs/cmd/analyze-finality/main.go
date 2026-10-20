// analyze exports real captured committee/finality witnesses and runs the
// unmodified Qrysm signature verifier. Contract acceptance remains a separate step.
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
	fastssz "github.com/prysmaticlabs/fastssz"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/theQRL/qrysm/beacon-chain/core/altair"
	"github.com/theQRL/qrysm/beacon-chain/core/helpers"
	"github.com/theQRL/qrysm/beacon-chain/core/signing"
	statenative "github.com/theQRL/qrysm/beacon-chain/state/state-native"
	"github.com/theQRL/qrysm/config/params"
	"github.com/theQRL/qrysm/consensus-types/primitives"
	"github.com/theQRL/qrysm/crypto/ml_dsa_87"
	qrysmpb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
	"github.com/theQRL/qrysm/time/slots"
)

var rootDiagnostics = map[string]map[string]any{}

func merkleRoot(leaves [][]byte) []byte {
	count := 1
	for count < len(leaves) {
		count *= 2
	}
	nodes := make([][]byte, count)
	for i := range nodes {
		nodes[i] = make([]byte, 32)
		if i < len(leaves) {
			copy(nodes[i], leaves[i])
		}
	}
	for len(nodes) > 1 {
		next := make([][]byte, len(nodes)/2)
		for i := range next {
			value := sha256.Sum256(append(append([]byte(nil), nodes[2*i]...), nodes[2*i+1]...))
			next[i] = value[:]
		}
		nodes = next
	}
	return nodes[0]
}
func generatedParticipationRoot(value []byte) []byte {
	h := fastssz.NewHasher()
	index := h.Index()
	h.PutBytes(value)
	h.MerkleizeWithMixin(index, uint64(len(value)), (1099511627776+31)/32)
	root, err := h.HashRoot()
	must(err)
	return root[:]
}

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
func hx(value []byte) string { return "0x" + hex.EncodeToString(value) }
func unhex(value string) []byte {
	result, err := hex.DecodeString(strings.TrimPrefix(value, "0x"))
	must(err)
	return result
}
func num(value string) uint64 {
	result, err := strconv.ParseUint(value, 10, 64)
	must(err)
	return result
}
func hash(value []byte) string { result := sha256.Sum256(value); return hex.EncodeToString(result[:]) }

type header struct {
	Slot          string `json:"slot"`
	ProposerIndex string `json:"proposer_index"`
	ParentRoot    string `json:"parent_root"`
	StateRoot     string `json:"state_root"`
	BodyRoot      string `json:"body_root"`
}

func (h header) consensus() *qrysmpb.BeaconBlockHeader {
	return &qrysmpb.BeaconBlockHeader{Slot: primitives.Slot(num(h.Slot)), ProposerIndex: primitives.ValidatorIndex(num(h.ProposerIndex)), ParentRoot: unhex(h.ParentRoot), StateRoot: unhex(h.StateRoot), BodyRoot: unhex(h.BodyRoot)}
}
func (h header) root() []byte { root, err := h.consensus().HashTreeRoot(); must(err); return root[:] }
func readHeader(dir, name string) header {
	raw, err := os.ReadFile(filepath.Join(dir, name))
	must(err)
	var response struct {
		Data struct {
			Root   string `json:"root"`
			Header struct {
				Message header `json:"message"`
			} `json:"header"`
		} `json:"data"`
	}
	must(json.Unmarshal(raw, &response))
	h := response.Data.Header.Message
	require(hx(h.root()) == response.Data.Root, "captured header root mismatch")
	return h
}
func readState(dir string, slot uint64) *statenative.BeaconState {
	raw, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("state-%d.ssz", slot)))
	must(err)
	proto := new(qrysmpb.BeaconStateZond)
	must(proto.UnmarshalSSZ(raw))
	require(uint64(proto.Slot) == slot, "state slot mismatch")
	s, err := statenative.InitializeFromProtoZond(proto)
	must(err)
	nativeRoot, err := s.HashTreeRoot(context.Background())
	must(err)
	protoRoot, err := proto.HashTreeRoot()
	must(err)
	h := readHeader(dir, fmt.Sprintf("header-%d.json", slot))
	require(bytes.Equal(nativeRoot[:], unhex(h.StateRoot)), fmt.Sprintf("real state root mismatch at slot %d: native=%s header=%s", slot, hx(nativeRoot[:]), h.StateRoot))
	diagnostic := map[string]any{"nativeRoot": hx(nativeRoot[:]), "protobufRoot": hx(protoRoot[:]), "headerRoot": h.StateRoot, "nativeMatchesHeader": true, "protobufMatchesNative": nativeRoot == protoRoot}
	if nativeRoot != protoRoot {
		fields, err := statenative.ComputeFieldRootsWithHasher(context.Background(), s.(*statenative.BeaconState))
		must(err)
		require(bytes.Equal(merkleRoot(fields), nativeRoot[:]), "native field roots differ from native state root")
		fields[15] = generatedParticipationRoot(proto.PreviousEpochParticipation)
		fields[16] = generatedParticipationRoot(proto.CurrentEpochParticipation)
		require(bytes.Equal(merkleRoot(fields), protoRoot[:]), "protobuf mismatch extends beyond the identified participation-field hash helper")
		diagnostic["difference"] = "Generated protobuf participation fields15/16 call PutBytes before MerkleizeWithMixin; native packed participation roots reconstruct the consensus header."
	}
	rootDiagnostics[fmt.Sprint(slot)] = diagnostic
	return s.(*statenative.BeaconState)
}
func verifyBranch(leaf []byte, branch [][]byte, gindex uint64, root []byte) {
	value := append([]byte(nil), leaf...)
	for _, sibling := range branch {
		require(len(sibling) == 32 && len(value) == 32, "proof shape mismatch")
		var input []byte
		if gindex&1 == 0 {
			input = append(append([]byte(nil), value...), sibling...)
		} else {
			input = append(append([]byte(nil), sibling...), value...)
		}
		h := sha256.Sum256(input)
		value = h[:]
		gindex /= 2
	}
	require(gindex == 1 && bytes.Equal(value, root), "native branch reconstruction failed")
}
func hexList(values [][]byte) []string {
	result := make([]string, len(values))
	for i := range values {
		result[i] = hx(values[i])
	}
	return result
}

type committeeWitness struct {
	Root             string     `json:"root"`
	PublicKeys       []string   `json:"publicKeys"`
	Branch           []string   `json:"branch"`
	GeneralizedIndex string     `json:"generalizedIndex"`
	UniquePublicKeys int        `json:"uniquePublicKeys"`
	PublicKeyBytes   int        `json:"publicKeyBytes"`
	PublicKeyRoots   []string   `json:"publicKeyRoots"`
	SeatBranches     [][]string `json:"seatBranches"`
}

func committee(s *statenative.BeaconState, next bool) committeeWitness {
	c, err := s.CurrentSyncCommittee()
	must(err)
	branch, err := s.CurrentSyncCommitteeProof(context.Background())
	must(err)
	gindex := uint64(54)
	if next {
		c, err = s.NextSyncCommittee()
		must(err)
		branch, err = s.NextSyncCommitteeProof(context.Background())
		must(err)
		gindex = 55
	}
	root, err := c.HashTreeRoot()
	must(err)
	stateRoot, err := s.HashTreeRoot(context.Background())
	must(err)
	verifyBranch(root[:], branch, gindex, stateRoot[:])
	unique := map[string]bool{}
	size := 0
	for _, key := range c.Pubkeys {
		require(len(key) == 2592, "pubkey size mismatch")
		unique[string(key)] = true
		size += len(key)
	}
	pubkeyRoots := make([][]byte, len(c.Pubkeys))
	for i, key := range c.Pubkeys {
		chunks := make([][]byte, len(key)/32)
		for j := range chunks {
			chunks[j] = key[j*32 : (j+1)*32]
		}
		pubkeyRoots[i] = merkleRoot(chunks)
	}
	require(bytes.Equal(merkleRoot(pubkeyRoots), root[:]), "committee public-key SSZ roots differ from native committee root")
	seatBranches := make([][]string, len(c.Pubkeys))
	for seat := range c.Pubkeys {
		nodes := append([][]byte(nil), pubkeyRoots...)
		index := seat
		proof := make([][]byte, 0, 7)
		for len(nodes) > 1 {
			proof = append(proof, nodes[index^1])
			next := make([][]byte, len(nodes)/2)
			for i := range next {
				next[i] = merkleRoot(nodes[i*2 : i*2+2])
			}
			nodes = next
			index /= 2
		}
		verifyBranch(pubkeyRoots[seat], proof, uint64(128+seat), root[:])
		seatBranches[seat] = hexList(proof)
	}
	return committeeWitness{hx(root[:]), hexList(c.Pubkeys), hexList(branch), fmt.Sprint(gindex), len(unique), size, hexList(pubkeyRoots), seatBranches}
}

type updateWitness struct {
	AttestedHeader              header           `json:"attestedHeader"`
	AttestedRoot                string           `json:"attestedRoot"`
	FinalizedHeader             header           `json:"finalizedHeader"`
	FinalizedRoot               string           `json:"finalizedRoot"`
	FinalizedEpoch              string           `json:"finalizedEpoch"`
	FinalityBranch              []string         `json:"finalityBranch"`
	SignatureSlot               string           `json:"signatureSlot"`
	SignaturePeriod             string           `json:"signaturePeriod"`
	SignatureCommittee          committeeWitness `json:"signatureCommittee"`
	NextCommittee               committeeWitness `json:"nextCommittee"`
	FinalizedNextCommittee      committeeWitness `json:"finalizedNextCommittee"`
	SyncCommitteeBits           string           `json:"syncCommitteeBits"`
	Signatures                  []string         `json:"signatures"`
	UniqueSignatures            int              `json:"uniqueSignatures"`
	Domain                      string           `json:"domain"`
	SigningRoot                 string           `json:"signingRoot"`
	NativeSignatureVerification bool             `json:"nativeSignatureVerification"`
	Participants                int              `json:"participants"`
	SignatureBytes              int              `json:"signatureBytes"`
}

func update(dir string, slot uint64) updateWitness {
	s := readState(dir, slot)
	signatureState := readState(dir, slot+1)
	raw, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("block-%d.json", slot+1)))
	must(err)
	var block struct {
		Data struct {
			Message struct {
				Slot       string `json:"slot"`
				ParentRoot string `json:"parent_root"`
				Body       struct {
					SyncAggregate struct {
						Bits       string   `json:"sync_committee_bits"`
						Signatures []string `json:"sync_committee_signatures"`
					} `json:"sync_aggregate"`
				} `json:"body"`
			} `json:"message"`
		} `json:"data"`
	}
	must(json.Unmarshal(raw, &block))
	require(num(block.Data.Message.Slot) == slot+1, "signature block slot mismatch")
	aggregate := block.Data.Message.Body.SyncAggregate
	bits := unhex(aggregate.Bits)
	require(len(bits) == 16, "committee bitvector length mismatch")
	current, err := signatureState.CurrentSyncCommittee()
	must(err)
	keys := make([]ml_dsa_87.PublicKey, 0, 128)
	signatures := make([][]byte, len(aggregate.Signatures))
	unique := map[string]bool{}
	signatureBytes := 0
	for i := 0; i < 128; i++ {
		if bits[i/8]&(1<<uint(i%8)) != 0 {
			key, err := ml_dsa_87.PublicKeyFromBytes(current.Pubkeys[i])
			must(err)
			keys = append(keys, key)
		}
	}
	for i, value := range aggregate.Signatures {
		signatures[i] = unhex(value)
		require(len(signatures[i]) == 4627, "signature size mismatch")
		unique[value] = true
		signatureBytes += len(signatures[i])
	}
	must(altair.VerifySyncCommitteeSigs(signatureState, keys, signatures))
	attested := readHeader(dir, fmt.Sprintf("header-%d.json", slot))
	previousRoot, err := helpers.BlockRootAtSlot(signatureState, primitives.Slot(slot))
	must(err)
	require(bytes.Equal(previousRoot, attested.root()) && block.Data.Message.ParentRoot == hx(attested.root()), "signature target mismatch")
	domain, err := signing.Domain(signatureState.Fork(), slots.ToEpoch(primitives.Slot(slot)), params.BeaconConfig().DomainSyncCommittee, signatureState.GenesisValidatorsRoot())
	must(err)
	signingRoot, err := (&qrysmpb.SigningData{ObjectRoot: attested.root(), Domain: domain}).HashTreeRoot()
	must(err)
	finalized := readHeader(dir, fmt.Sprintf("finalized-header-%d.json", slot))
	finalizedState := readState(dir, num(finalized.Slot))
	checkpoint := s.FinalizedCheckpoint()
	require(bytes.Equal(checkpoint.Root, finalized.root()), "finalized header mismatch")
	branch, err := s.FinalizedRootProof(context.Background())
	must(err)
	verifyBranch(finalized.root(), branch, 105, unhex(attested.StateRoot))
	return updateWitness{attested, hx(attested.root()), finalized, hx(finalized.root()), fmt.Sprint(checkpoint.Epoch), hexList(branch), fmt.Sprint(slot + 1), fmt.Sprint((slot + 1) / uint64(params.BeaconConfig().SlotsPerEpoch) / uint64(params.BeaconConfig().EpochsPerSyncCommitteePeriod)), committee(signatureState, false), committee(s, true), committee(finalizedState, true), aggregate.Bits, aggregate.Signatures, len(unique), hx(domain), hx(signingRoot[:]), true, len(keys), signatureBytes}
}

func membershipChange(dir string, previous, current updateWitness) map[string]any {
	previousKeys, currentKeys := map[string]bool{}, map[string]bool{}
	for _, key := range previous.SignatureCommittee.PublicKeys {
		previousKeys[key] = true
	}
	seatCounts := map[string]int{}
	for _, key := range current.SignatureCommittee.PublicKeys {
		currentKeys[key] = true
		seatCounts[key]++
	}
	removed, added := map[string]bool{}, 0
	for key := range previousKeys {
		if !currentKeys[key] {
			removed[key] = true
		}
	}
	for key := range currentKeys {
		if !previousKeys[key] {
			added++
		}
	}
	indices, hashes := []string{}, []string{}
	state := readState(dir, num(current.SignatureSlot))
	for i := 0; i < state.NumValidators(); i++ {
		validator, err := state.ValidatorAtIndex(primitives.ValidatorIndex(i))
		must(err)
		if removed[hx(validator.PublicKey)] {
			indices = append(indices, fmt.Sprint(i))
			hashes = append(hashes, hash(validator.PublicKey))
		}
	}
	require(len(indices) == len(removed), "removed committee key is absent from canonical validator registry")
	histogram := map[int]int{}
	for _, count := range seatCounts {
		histogram[count]++
	}
	return map[string]any{"fromPeriod": previous.SignaturePeriod, "toPeriod": current.SignaturePeriod,
		"previousUniquePublicKeys": len(previousKeys), "currentUniquePublicKeys": len(currentKeys),
		"removedValidatorIndices": indices, "removedPublicKeySHA256": hashes, "addedPublicKeys": added,
		"positionCount": len(current.SignatureCommittee.PublicKeys), "positionsPerKeyHistogram": histogram,
		"orderedVectorChanged":    previous.SignatureCommittee.Root != current.SignatureCommittee.Root,
		"uniqueMembershipChanged": len(removed) != 0 || added != 0}
}

// sparseProof preserves the full SSZ limit without allocating its zero suffix.
func sparseProof(leaves [][]byte, depth uint, index uint64) ([]byte, [][]byte) {
	require(index < uint64(len(leaves)) && uint64(len(leaves)) <= uint64(1)<<depth, "invalid sparse proof bounds")
	nodes := append([][]byte(nil), leaves...)
	zero, branch := make([]byte, 32), make([][]byte, 0, depth)
	for level := uint(0); level < depth; level++ {
		sibling := zero
		if index^1 < uint64(len(nodes)) {
			sibling = nodes[index^1]
		}
		branch = append(branch, sibling)
		next := make([][]byte, (len(nodes)+1)/2)
		for i := range next {
			right := zero
			if 2*i+1 < len(nodes) {
				right = nodes[2*i+1]
			}
			next[i] = merkleRoot([][]byte{nodes[2*i], right})
		}
		nodes, zero, index = next, merkleRoot([][]byte{zero, zero}), index/2
	}
	require(len(nodes) == 1, "sparse proof did not reach root")
	return nodes[0], branch
}

func selectedValidator(dir string, slot, index uint64) map[string]any {
	s := readState(dir, slot)
	validators, balances := s.Validators(), s.Balances()
	require(index < uint64(len(validators)) && len(validators) == len(balances) && len(validators) <= 1<<40,
		"selected validator must exist in canonical equal-length lists")
	fields, err := statenative.ComputeFieldRootsWithHasher(context.Background(), s)
	must(err)
	root, slotBranch := sparseProof(fields, 5, 2)
	nativeRoot, err := s.HashTreeRoot(context.Background())
	must(err)
	require(bytes.Equal(root, nativeRoot[:]), "selected proof root differs from canonical native state")
	leaves := make([][]byte, len(validators))
	for i, validator := range validators {
		r, err := validator.HashTreeRoot()
		must(err)
		leaves[i] = bytes.Clone(r[:])
	}
	chunks := make([][]byte, (len(balances)+3)/4)
	for i := range chunks {
		chunks[i] = make([]byte, 32)
	}
	for i, balance := range balances {
		binary.LittleEndian.PutUint64(chunks[i/4][8*(i%4):8*(i%4+1)], balance)
	}
	length := make([]byte, 32)
	binary.LittleEndian.PutUint64(length, uint64(len(validators)))
	vroot, vbranch := sparseProof(leaves, 40, index)
	broot, bbranch := sparseProof(chunks, 38, index/4)
	require(bytes.Equal(merkleRoot([][]byte{vroot, length}), fields[11]), "canonical validator list root mismatch")
	require(bytes.Equal(merkleRoot([][]byte{broot, length}), fields[12]), "canonical balance list root mismatch")
	_, vf := sparseProof(fields, 5, 11)
	_, bf := sparseProof(fields, 5, 12)
	vbranch = append(append(vbranch, length), vf...)
	bbranch = append(append(bbranch, length), bf...)
	vg, bg := uint64(43)<<41|index, uint64(44)<<39|index/4
	verifyBranch(leaves[index], vbranch, vg, root)
	verifyBranch(chunks[index/4], bbranch, bg, root)
	validator := validators[index]
	keyChunks := make([][]byte, 81)
	for i := range keyChunks {
		keyChunks[i] = validator.PublicKey[32*i : 32*(i+1)]
	}
	witness := map[string]any{"index": fmt.Sprint(index), "publicKey": hx(validator.PublicKey),
		"publicKeyRoot": hx(merkleRoot(keyChunks)), "withdrawalRecipient": hx(validator.WithdrawalRecipient),
		"effectiveBalance": fmt.Sprint(validator.EffectiveBalance), "slashed": validator.Slashed,
		"activationEligibilityEpoch": fmt.Sprint(validator.ActivationEligibilityEpoch), "activationEpoch": fmt.Sprint(validator.ActivationEpoch),
		"exitEpoch": fmt.Sprint(validator.ExitEpoch), "withdrawableEpoch": fmt.Sprint(validator.WithdrawableEpoch),
		"randaoCommitment": hx(validator.RandaoCommitment), "validatorRoot": hx(leaves[index]),
		"validatorGeneralizedIndex": fmt.Sprint(vg), "validatorBranch": hexList(vbranch),
		"balance": fmt.Sprint(balances[index]), "balanceChunk": hx(chunks[index/4]),
		"balanceGeneralizedIndex": fmt.Sprint(bg), "balanceBranch": hexList(bbranch)}
	return map[string]any{"slot": fmt.Sprint(slot), "stateRoot": hx(root), "slotBranch": hexList(slotBranch), "validators": []any{witness}}
}

func run() {
	dir := flag.String("capture-dir", "", "public capture directory")
	output := flag.String("output", "", "public witness JSON output")
	validatorIndex := flag.Int64("validator-index", -1, "optional canonical validator index proven under every finalized state")
	flag.Parse()
	require(*dir != "" && *output != "", "capture-dir and output are required")
	manifestRaw, err := os.ReadFile(filepath.Join(*dir, "manifest.json"))
	must(err)
	var manifest struct {
		QrysmCommit           string `json:"qrysmCommit"`
		GenesisValidatorsRoot string `json:"genesisValidatorsRoot"`
		BootstrapSlot         string `json:"bootstrapSlot"`
		Updates               []struct {
			AttestedSlot string `json:"attestedSlot"`
		} `json:"updates"`
		Files map[string]struct {
			SHA256 string `json:"sha256"`
			Bytes  int    `json:"bytes"`
		} `json:"files"`
	}
	must(json.Unmarshal(manifestRaw, &manifest))
	require(manifest.QrysmCommit == "3b816311ac3e86b7a7af40a062ae290318554f7a", "capture source revision mismatch")
	for name, info := range manifest.Files {
		require(filepath.Base(name) == name, "invalid captured filename")
		raw, err := os.ReadFile(filepath.Join(*dir, name))
		must(err)
		require(len(raw) == info.Bytes && hash(raw) == info.SHA256, "captured file hash mismatch")
	}
	config, err := params.UnmarshalConfigFile(filepath.Join(*dir, "config.yml"), nil)
	must(err)
	params.OverrideBeaconConfig(config)
	require(config.SlotsPerEpoch == 8 && config.EpochsPerSyncCommitteePeriod == 8 && config.SyncCommitteeSize == 128, "capture configuration mismatch")
	bootstrapSlot := num(manifest.BootstrapSlot)
	require(len(manifest.Updates) <= 4, "capture exceeds four bounded updates")
	bootstrapState := readState(*dir, bootstrapSlot)
	require(hx(bootstrapState.GenesisValidatorsRoot()) == manifest.GenesisValidatorsRoot, "state genesis mismatch")
	bootstrapCurrent, bootstrapNext := committee(bootstrapState, false), committee(bootstrapState, true)
	updates := make([]updateWitness, 0, len(manifest.Updates))
	currentPeriod, lastFinalized, lastAttested := bootstrapSlot/64, bootstrapSlot, bootstrapSlot
	currentRoot, nextRoot := bootstrapCurrent.Root, bootstrapNext.Root
	for _, item := range manifest.Updates {
		slot := num(item.AttestedSlot)
		require(slot > lastAttested, "attested slots must increase after bootstrap")
		u := update(*dir, slot)
		period, finalized := num(u.SignaturePeriod), num(u.FinalizedHeader.Slot)
		require(period == currentPeriod || period == currentPeriod+1, "capture skips a required committee transition")
		require(finalized > lastFinalized && finalized <= slot && finalized%8 == 0 && finalized/64 == period,
			"capture does not satisfy bounded occupied finalized-slot/period policy")
		if period == currentPeriod+1 {
			currentRoot = nextRoot
		} else {
			require(u.FinalizedNextCommittee.Root == nextRoot, "same-period next committee changed")
		}
		require(u.SignatureCommittee.Root == currentRoot, "signature committee lacks prior authenticated root")
		currentPeriod, nextRoot, lastFinalized, lastAttested = period, u.FinalizedNextCommittee.Root, finalized, slot
		updates = append(updates, u)
	}
	transitions := []map[string]any{}
	membership := map[string]any{}
	for i := 1; i < len(updates); i++ {
		membership = membershipChange(*dir, updates[i-1], updates[i])
		transitions = append(transitions, membership)
	}
	if bootstrapSlot == 80 && len(updates) == 4 && num(updates[3].AttestedHeader.Slot) == 288 {
		indices := membership["removedValidatorIndices"].([]string)
		require(len(indices) == 1 && indices[0] == "63" && membership["addedPublicKeys"].(int) == 0,
			"historical fourth update must show the actual exited validator63 removal")
	}
	result := map[string]any{"schemaVersion": 1, "qrysmCommit": manifest.QrysmCommit, "genesisValidatorsRoot": manifest.GenesisValidatorsRoot, "bootstrapHeader": readHeader(*dir, fmt.Sprintf("header-%d.json", bootstrapSlot)), "bootstrapCurrentCommittee": bootstrapCurrent, "bootstrapNextCommittee": bootstrapNext, "updates": updates, "membershipTransition": membership, "committeeTransitions": transitions, "stateRootDiagnostics": rootDiagnostics, "boundary": "Actual captured data and unmodified native signature/SSZ verification. Initial bootstrap trust, light-client update policy and VM acceptance are separate responsibilities."}
	if *validatorIndex >= 0 {
		witnesses := []map[string]any{}
		for _, u := range updates {
			witnesses = append(witnesses, selectedValidator(*dir, num(u.FinalizedHeader.Slot), uint64(*validatorIndex)))
		}
		result["finalizedValidatorWitnesses"] = witnesses
	}
	encoded, err := json.MarshalIndent(result, "", "  ")
	must(err)
	must(os.WriteFile(*output, append(encoded, '\n'), 0644))
	summary := map[string]any{"bootstrapSlot": bootstrapSlot, "bootstrapCurrentCommitteeRoot": bootstrapCurrent.Root, "bootstrapNextCommitteeRoot": bootstrapNext.Root, "committeeTransitionChangesOrderedVector": bootstrapCurrent.Root != bootstrapNext.Root, "membershipTransition": membership, "updates": []map[string]any{}}
	for _, u := range updates {
		summary["updates"] = append(summary["updates"].([]map[string]any), map[string]any{"attestedSlot": u.AttestedHeader.Slot, "signatureSlot": u.SignatureSlot, "finalizedSlot": u.FinalizedHeader.Slot, "signaturePeriod": u.SignaturePeriod, "participants": u.Participants, "signatureBytes": u.SignatureBytes, "uniquePublicKeys": u.SignatureCommittee.UniquePublicKeys, "uniqueSignatures": u.UniqueSignatures, "nativeSignaturesVerified": true})
	}
	must(json.NewEncoder(os.Stdout).Encode(summary))
}
func main() { run() }
