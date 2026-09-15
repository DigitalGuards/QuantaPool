package protocol_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/qrysm/beacon-chain/core/signing"
	"github.com/theQRL/qrysm/config/params"
	"github.com/theQRL/qrysm/consensus-types/primitives"
	"github.com/theQRL/qrysm/contracts/deposit"
	"github.com/theQRL/qrysm/crypto/randao"
	qrysmpb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

type signedDepositWitness struct {
	PublicKey           string `json:"publicKey"`
	WithdrawalRecipient string `json:"withdrawalRecipient"`
	RandaoCommitment    string `json:"randaoCommitment"`
	AmountShor          string `json:"amountShor"`
	Signature           string `json:"signature"`
	DataRoot            string `json:"dataRoot"`
}

func depositWitness(t *testing.T, d *qrysmpb.Deposit_Data) signedDepositWitness {
	t.Helper()
	root, err := d.HashTreeRoot()
	must(t, err)
	return signedDepositWitness{hx(d.PublicKey), hx(d.WithdrawalRecipient), hx(d.RandaoCommitment), fmt.Sprint(d.Amount), hx(d.Signature), hx(root[:])}
}

func TestFundingFixtureWithRealSignatures(t *testing.T) {
	pool := recipient(0x63)
	if value := os.Getenv("QUANTAPOOL_FIXTURE_POOL_RECIPIENT"); value != "" {
		value = strings.TrimPrefix(strings.TrimPrefix(value, "0x"), "Q")
		decoded, err := hex.DecodeString(value)
		must(t, err)
		if len(decoded) != len(common.Address{}) {
			t.Fatal("fixture pool recipient must have exactly 64 bytes")
		}
		copy(pool[:], decoded)
	}
	s, log := freshState(t), new(depositLog)
	goodKey, existingKey := randomKey(t), randomKey(t)
	other := recipient(0x41)
	s, _ = log.apply(t, s, goodKey, pool, 2000*shorPerQRL)
	s, _ = log.apply(t, s, existingKey, other, 2000*shorPerQRL)
	must(t, s.SetSlot(params.BeaconConfig().SlotsPerEpoch.Mul(32)))
	bootstrapCheckpoint := checkpoint(t, "operator-bootstrap-before-pooled-funding", s)
	type candidate struct {
		Name                string               `json:"name"`
		Index               string               `json:"index"`
		Bootstrap           signedDepositWitness `json:"bootstrap"`
		TopUp               signedDepositWitness `json:"topUp"`
		ExitEpoch           string               `json:"exitEpoch"`
		ExitSignature       string               `json:"exitSignature"`
		ExitSigningRoot     string               `json:"exitSigningRoot"`
		ExitSSZ             string               `json:"exitSSZ"`
		FutureExitEpoch     string               `json:"futureExitEpoch"`
		FutureExitSignature string               `json:"futureExitSignature"`
	}
	candidates := make([]candidate, 0, 2)
	// Both keys are generated solely for this test and discarded after public
	// signatures have been exported. The second key is already recipient-bound.
	for i := 0; i < 2; i++ {
		key, name := goodKey, "pool-bound"
		if i == 1 {
			key, name = existingKey, "existing-other-recipient"
		}
		commitment := randao.Commitment(key.Marshal(), randao.DefaultLayers)
		topUp, _, err := deposit.DepositInputWithRandaoCommitment(key, pool, 38000*shorPerQRL, nil, commitment)
		must(t, err)
		domain, err := signing.ComputeDomain(params.BeaconConfig().DomainDeposit, nil, nil)
		must(t, err)
		must(t, deposit.VerifyDepositSignature(topUp, domain))
		exit := signedExit(t, s, key, primitives.ValidatorIndex(i), 0)
		exitDomain, err := signing.Domain(s.Fork(), 0, params.BeaconConfig().DomainVoluntaryExit, s.GenesisValidatorsRoot())
		must(t, err)
		exitRoot, err := signing.ComputeSigningRoot(exit.Exit, exitDomain)
		must(t, err)
		must(t, signing.VerifySigningRoot(exit.Exit, key.PublicKey().Marshal(), exit.Signature, exitDomain))
		exitSSZ, err := exit.MarshalSSZ()
		must(t, err)
		future := signedExit(t, s, key, primitives.ValidatorIndex(i), primitives.Epoch(1<<32))
		must(t, signing.VerifySigningRoot(future.Exit, key.PublicKey().Marshal(), future.Signature, exitDomain))
		candidates = append(candidates, candidate{name, fmt.Sprint(i), depositWitness(t, log.deposits[i]), depositWitness(t, topUp), "0", hx(exit.Signature), hx(exitRoot[:]), hx(exitSSZ), fmt.Sprint(future.Exit.Epoch), hx(future.Signature)})
	}
	exitDomain, err := signing.Domain(s.Fork(), 0, params.BeaconConfig().DomainVoluntaryExit, s.GenesisValidatorsRoot())
	must(t, err)
	depositDomain, err := signing.ComputeDomain(params.BeaconConfig().DomainDeposit, nil, nil)
	must(t, err)
	fixture := struct {
		SchemaVersion         int               `json:"schemaVersion"`
		QrysmCommit           string            `json:"qrysmCommit"`
		TrustAnchor           string            `json:"trustAnchor"`
		PoolRecipient         string            `json:"poolRecipient"`
		GenesisValidatorsRoot string            `json:"genesisValidatorsRoot"`
		ForkPreviousVersion   string            `json:"forkPreviousVersion"`
		ForkCurrentVersion    string            `json:"forkCurrentVersion"`
		ForkEpoch             string            `json:"forkEpoch"`
		ExitDomain            string            `json:"exitDomain"`
		DepositDomain         string            `json:"depositDomain"`
		Checkpoint            checkpointWitness `json:"checkpoint"`
		Candidates            []candidate       `json:"candidates"`
	}{1, "9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3", "Synthetic bootstrap state, real ephemeral-key ML-DSA signatures and deposit Merkle proofs; constructor-pinned state root supplies the fixture trust anchor, without a live finality proof.", hx(pool[:]), hx(s.GenesisValidatorsRoot()), hx(s.Fork().PreviousVersion), hx(s.Fork().CurrentVersion), fmt.Sprint(s.Fork().Epoch), hx(exitDomain), hx(depositDomain), bootstrapCheckpoint, candidates}
	encoded, err := json.MarshalIndent(fixture, "", "  ")
	must(t, err)
	encoded = append(encoded, '\n')
	if bytes.Contains(encoded, []byte("\"seed\"")) || bytes.Contains(encoded, []byte("\"privateKey\"")) {
		t.Fatal("unexpected private field in public fixture")
	}
	if output := os.Getenv("QUANTAPOOL_FUNDING_FIXTURE_PATH"); output != "" {
		must(t, os.MkdirAll(filepath.Dir(output), 0755))
		must(t, os.WriteFile(output, encoded, 0644))
	}
	t.Log("Generated and verified public deposit/exit signatures for pool-bound and existing-other-recipient candidates; bootstrap roots use actual ProcessDeposit output.")
}
