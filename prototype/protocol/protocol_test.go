package protocol_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/qrysm/beacon-chain/core/blocks"
	"github.com/theQRL/qrysm/beacon-chain/core/epoch"
	"github.com/theQRL/qrysm/beacon-chain/core/signing"
	"github.com/theQRL/qrysm/beacon-chain/state"
	"github.com/theQRL/qrysm/config/params"
	"github.com/theQRL/qrysm/consensus-types/primitives"
	"github.com/theQRL/qrysm/container/trie"
	"github.com/theQRL/qrysm/contracts/deposit"
	"github.com/theQRL/qrysm/crypto/ml_dsa_87"
	"github.com/theQRL/qrysm/crypto/randao"
	"github.com/theQRL/qrysm/encoding/bytesutil"
	qrysmpb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
	"github.com/theQRL/qrysm/testing/util"
)

const shorPerQRL = uint64(1_000_000_000)

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func requireError(t *testing.T, err error, contains string) {
	t.Helper()
	if err == nil || !bytes.Contains([]byte(err.Error()), []byte(contains)) {
		t.Fatalf("expected error containing %q, got %v", contains, err)
	}
}

func randomKey(t *testing.T) ml_dsa_87.MLDSA87Key {
	t.Helper()
	k, err := ml_dsa_87.RandKey()
	must(t, err)
	return k
}

func recipient(tag byte) common.Address {
	var address common.Address
	address[0] = tag
	address[len(address)-1] = tag
	return address
}

func freshState(t *testing.T) state.BeaconState {
	t.Helper()
	s, err := util.NewBeaconStateZond(func(s *qrysmpb.BeaconStateZond) error {
		s.GenesisValidatorsRoot = bytes.Repeat([]byte{0x19}, 32)
		s.Fork = &qrysmpb.Fork{
			PreviousVersion: bytes.Clone(params.BeaconConfig().GenesisForkVersion),
			CurrentVersion:  bytes.Clone(params.BeaconConfig().GenesisForkVersion),
		}
		return nil
	})
	must(t, err)
	return s
}

// depositLog models an execution deposit tree supplied to the actual protocol
// processor. Its root is a synthetic-state input, not a finality trust anchor.
type depositLog struct{ deposits []*qrysmpb.Deposit_Data }

func (l *depositLog) apply(t *testing.T, s state.BeaconState, key ml_dsa_87.MLDSA87Key, address common.Address, amount uint64) (state.BeaconState, bool) {
	t.Helper()
	// DefaultLayers is the upstream validator default. No consensus parameters
	// or signature checks are weakened by this harness.
	commitment := randao.Commitment(key.Marshal(), randao.DefaultLayers)
	d, _, err := deposit.DepositInputWithRandaoCommitment(key, address, amount, nil, commitment)
	must(t, err)
	if len(d.PublicKey) != 2592 || len(d.WithdrawalRecipient) != 64 || len(d.RandaoCommitment) != 32 || len(d.Signature) != 4627 {
		t.Fatal("unexpected current-QRL deposit shape")
	}
	domain, err := signing.ComputeDomain(params.BeaconConfig().DomainDeposit, nil, nil)
	must(t, err)
	must(t, deposit.VerifyDepositSignature(d, domain))
	l.deposits = append(l.deposits, d)
	leaves := make([][]byte, len(l.deposits))
	for i, item := range l.deposits {
		root, err := item.HashTreeRoot()
		must(t, err)
		leaves[i] = bytes.Clone(root[:])
	}
	tree, err := trie.GenerateTrieFromItems(leaves, params.BeaconConfig().DepositContractTreeDepth)
	must(t, err)
	proof, err := tree.MerkleProof(len(l.deposits) - 1)
	must(t, err)
	root, err := tree.HashTreeRoot()
	must(t, err)
	must(t, s.SetExecutionData(&qrysmpb.ExecutionData{DepositRoot: root[:], DepositCount: uint64(len(l.deposits)), BlockHash: make([]byte, 32)}))
	result, created, err := blocks.ProcessDeposit(s, &qrysmpb.Deposit{Data: d, Proof: proof}, true)
	must(t, err)
	return result, created
}

func signedExit(t *testing.T, s state.BeaconState, key ml_dsa_87.MLDSA87Key, index primitives.ValidatorIndex, exitEpoch primitives.Epoch) *qrysmpb.SignedVoluntaryExit {
	t.Helper()
	e := &qrysmpb.SignedVoluntaryExit{Exit: &qrysmpb.VoluntaryExit{ValidatorIndex: index, Epoch: exitEpoch}}
	var err error
	e.Signature, err = signing.ComputeDomainAndSign(s, exitEpoch, e.Exit, params.BeaconConfig().DomainVoluntaryExit, key)
	must(t, err)
	return e
}

func verifyExit(s state.BeaconState, exit *qrysmpb.SignedVoluntaryExit) error {
	v, err := s.ValidatorAtIndexReadOnly(exit.Exit.ValidatorIndex)
	if err != nil {
		return err
	}
	return blocks.VerifyExitAndSignature(v, s, exit)
}

// activate executes the registry/effective-balance functions. Slot progression
// and finalized checkpoint are supplied synthetic inputs; no blocks or finality
// votes are fabricated and represented as a live-chain result.
func activate(t *testing.T, s state.BeaconState, index primitives.ValidatorIndex) state.BeaconState {
	t.Helper()
	var err error
	s, err = epoch.ProcessEffectiveBalanceUpdates(s)
	must(t, err)
	s, err = epoch.ProcessRegistryUpdates(context.Background(), s)
	must(t, err)
	v, err := s.ValidatorAtIndex(index)
	must(t, err)
	if v.ActivationEligibilityEpoch == params.BeaconConfig().FarFutureEpoch {
		t.Fatal("validator not eligible for activation queue")
	}
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(uint64(v.ActivationEligibilityEpoch+1))))
	must(t, s.SetFinalizedCheckpoint(&qrysmpb.Checkpoint{Epoch: v.ActivationEligibilityEpoch, Root: make([]byte, 32)}))
	s, err = epoch.ProcessRegistryUpdates(context.Background(), s)
	must(t, err)
	v, err = s.ValidatorAtIndex(index)
	must(t, err)
	if v.ActivationEpoch == params.BeaconConfig().FarFutureEpoch {
		t.Fatal("activation not scheduled")
	}
	return s
}

func TestPinnedNetworkParameters(t *testing.T) {
	c := params.BeaconConfig()
	if len(common.Address{}) != 64 || c.MinDepositAmount != 2000*shorPerQRL || c.MaxEffectiveBalance != 40000*shorPerQRL || c.ShardCommitteePeriod != 16 || c.SlotsPerEpoch != 128 {
		t.Fatal("pinned upstream network parameters changed")
	}
}

func TestExistingValidatorPreservesCanonicalRecipient(t *testing.T) {
	s, key, log := freshState(t), randomKey(t), new(depositLog)
	canonical, supplied := recipient(0x41), recipient(0x52)
	var created bool
	s, created = log.apply(t, s, key, canonical, 2000*shorPerQRL)
	if !created {
		t.Fatal("first deposit did not create validator")
	}
	index, found := s.ValidatorIndexByPubkey(bytesutil.ToBytes2592(key.PublicKey().Marshal()))
	if !found {
		t.Fatal("canonical validator index unavailable after deposit processing")
	}
	s, created = log.apply(t, s, key, supplied, 38000*shorPerQRL)
	if created || len(s.Validators()) != 1 {
		t.Fatal("existing key created another validator")
	}
	v, err := s.ValidatorAtIndex(index)
	must(t, err)
	if !bytes.Equal(v.WithdrawalRecipient, canonical[:]) {
		t.Fatal("canonical withdrawal recipient changed")
	}
	balance, err := s.BalanceAtIndex(index)
	must(t, err)
	if balance != 40000*shorPerQRL {
		t.Fatalf("balance %d", balance)
	}
	if bytes.Equal(v.WithdrawalRecipient, supplied[:]) {
		t.Fatal("supplied recipient must not be treated as canonical binding")
	}
	t.Log("Protocol preserves the first recipient; pooled funding must authenticate that existing binding before top-up.")
}

func TestOperatorBootstrapPresignsBeforePooledFunding(t *testing.T) {
	s, key, log := freshState(t), randomKey(t), new(depositLog)
	pool := recipient(0x63)
	s, _ = log.apply(t, s, key, pool, 2000*shorPerQRL)
	index, found := s.ValidatorIndexByPubkey(bytesutil.ToBytes2592(key.PublicKey().Marshal()))
	if !found {
		t.Fatal("bootstrap did not produce canonical index")
	}
	v, err := s.ValidatorAtIndex(index)
	must(t, err)
	if v.ActivationEpoch != params.BeaconConfig().FarFutureEpoch {
		t.Fatal("bootstrap unexpectedly active")
	}
	presigned := signedExit(t, s, key, index, 0)
	// Available public SSZ bytes are handed to an independent participant.
	encoded, err := presigned.MarshalSSZ()
	must(t, err)
	if len(encoded) != 16+4627 {
		t.Fatal("wrong signed exit SSZ length")
	}
	independent := new(qrysmpb.SignedVoluntaryExit)
	must(t, independent.UnmarshalSSZ(encoded))
	requireError(t, verifyExit(s, independent), "non-active")
	s, _ = log.apply(t, s, key, pool, 38000*shorPerQRL)
	key = nil
	s = activate(t, s, index)
	v, err = s.ValidatorAtIndex(index)
	must(t, err)
	eligible := v.ActivationEpoch + params.BeaconConfig().ShardCommitteePeriod
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(uint64(eligible-1))))
	requireError(t, verifyExit(s, independent), "not been active long enough")
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(uint64(eligible))))
	must(t, verifyExit(s, independent))
	s, err = blocks.ProcessVoluntaryExits(context.Background(), s, []*qrysmpb.SignedVoluntaryExit{independent})
	must(t, err)
	v, err = s.ValidatorAtIndex(index)
	must(t, err)
	if v.ExitEpoch == params.BeaconConfig().FarFutureEpoch {
		t.Fatal("exit not scheduled")
	}
	requireError(t, verifyExit(s, independent), "already submitted an exit")
	t.Logf("Canonical index %d and %d public SSZ bytes available at 2000 QRL; independent processing succeeds at eligible epoch %d, exit scheduled at %d.", index, len(encoded), eligible, v.ExitEpoch)
}

func eligibleState(t *testing.T) (state.BeaconState, ml_dsa_87.MLDSA87Key, *qrysmpb.SignedVoluntaryExit) {
	t.Helper()
	s, key, log := freshState(t), randomKey(t), new(depositLog)
	s, _ = log.apply(t, s, key, recipient(0x63), 40000*shorPerQRL)
	e := signedExit(t, s, key, 0, 0)
	s = activate(t, s, 0)
	v, err := s.ValidatorAtIndex(0)
	must(t, err)
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(uint64(v.ActivationEpoch+params.BeaconConfig().ShardCommitteePeriod))))
	return s, key, e
}

func TestIndependentExitIdentityDomainAndEpoch(t *testing.T) {
	s, key, valid := eligibleState(t)
	for _, tc := range []struct {
		name      string
		change    func(state.BeaconState, *qrysmpb.SignedVoluntaryExit)
		errorText string
	}{
		{"wrong-validator-index", func(_ state.BeaconState, e *qrysmpb.SignedVoluntaryExit) { e.Exit.ValidatorIndex = 99 }, "index"},
		{"wrong-signing-key", func(st state.BeaconState, e *qrysmpb.SignedVoluntaryExit) {
			e.Signature = signedExit(t, st, randomKey(t), 0, 0).Signature
		}, "signature did not verify"},
		{"wrong-genesis-domain", func(st state.BeaconState, _ *qrysmpb.SignedVoluntaryExit) {
			must(t, st.SetGenesisValidatorsRoot(bytes.Repeat([]byte{0x20}, 32)))
		}, "signature did not verify"},
		{"future-exit-epoch", func(st state.BeaconState, e *qrysmpb.SignedVoluntaryExit) {
			future := primitives.Epoch(st.Slot()/params.BeaconConfig().SlotsPerEpoch) + 1
			*e = *signedExit(t, st, key, 0, future)
		}, "expected current epoch >= exit epoch"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copyState := s.Copy()
			encoded, err := valid.MarshalSSZ()
			must(t, err)
			e := new(qrysmpb.SignedVoluntaryExit)
			must(t, e.UnmarshalSSZ(encoded))
			tc.change(copyState, e)
			requireError(t, verifyExit(copyState, e), tc.errorText)
		})
	}
}

func TestPresignedExitForkRetentionLimit(t *testing.T) {
	s, _, exit := eligibleState(t)
	genesis := bytes.Clone(s.Fork().CurrentVersion)
	must(t, verifyExit(s, exit))
	firstVersion := []byte{1, 0, 0, 0}
	must(t, s.SetFork(&qrysmpb.Fork{PreviousVersion: genesis, CurrentVersion: firstVersion, Epoch: 1}))
	must(t, verifyExit(s, exit))
	must(t, s.SetFork(&qrysmpb.Fork{PreviousVersion: firstVersion, CurrentVersion: []byte{2, 0, 0, 0}, Epoch: 2}))
	requireError(t, verifyExit(s, exit), "signature did not verify")
	t.Log("Synthetic fork-state inputs exercise current signature-domain logic: the original presign survives one version transition and fails after its version leaves current/previous Fork state.")
}

func TestExitPublicJSONAvailability(t *testing.T) {
	s, _, e := eligibleState(t)
	// The beacon REST message uses decimal strings and a hex signature.
	publicMessage := struct {
		Message struct {
			Epoch          string `json:"epoch"`
			ValidatorIndex string `json:"validator_index"`
		} `json:"message"`
		Signature string `json:"signature"`
	}{Signature: fmt.Sprintf("0x%x", e.Signature)}
	publicMessage.Message.Epoch = fmt.Sprint(e.Exit.Epoch)
	publicMessage.Message.ValidatorIndex = fmt.Sprint(e.Exit.ValidatorIndex)
	encoded, err := json.Marshal(publicMessage)
	must(t, err)
	if bytes.Contains(encoded, []byte("seed")) || bytes.Contains(encoded, []byte("private")) {
		t.Fatal("unexpected secret field")
	}
	must(t, verifyExit(s, e))
	t.Logf("Public JSON exit payload contains %d bytes and requires no operator secret to relay. This test does not establish durable publication or REST inclusion.", len(encoded))
}
