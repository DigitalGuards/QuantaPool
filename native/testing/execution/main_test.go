package main

import (
	"bytes"
	"math/big"
	"testing"

	"github.com/theQRL/go-qrl/accounts/abi"
	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/core/rawdb"
	"github.com/theQRL/go-qrl/core/state"
	"github.com/theQRL/go-qrl/core/types"
)

func TestSyntheticBlockAdvancesMonotonically(t *testing.T) {
	r := runner{}
	r.config.BlockNumber = big.NewInt(1)
	r.config.Time = 7
	if _, err := r.run(step{Op: "block", Value: "81"}); err != nil {
		t.Fatal(err)
	}
	if r.config.BlockNumber.Uint64() != 81 || r.config.Time != 7 {
		t.Fatal("synthetic block advance changed the wrong context field")
	}
	for _, value := range []string{"81", "80", "-1", "18446744073709551616", "invalid"} {
		if _, err := r.run(step{Op: "block", Value: value}); err == nil {
			t.Fatalf("accepted invalid synthetic block %q", value)
		}
	}
}

func TestSyntheticPredeploymentPreservesNativeStorageWidth(t *testing.T) {
	db, err := state.New(types.EmptyRootHash, state.NewDatabase(rawdb.NewMemoryDatabase()), nil)
	if err != nil {
		t.Fatal(err)
	}
	target := common.BytesToAddress(bytes.Repeat([]byte{0x42}, 64))
	key := common.BytesToHash([]byte{1})
	value := common.BytesToStorageValue64(bytes.Repeat([]byte{0xa5}, 64))
	r := runner{addresses: make(map[string]common.Address), abis: make(map[string]abi.ABI),
		allocations: map[string]fixtureAllocation{"copy": {[]byte{0}, 1, map[common.Hash]common.StorageValue64{key: value}}}}
	r.config.State = db
	input := step{Op: "fixture-predeploy", ID: "canonical", Source: "@copy", Target: target.String()}
	if _, err := r.run(input); err != nil {
		t.Fatal(err)
	}
	if db.GetState(target, key) != value || !bytes.Equal(db.GetCode(target), []byte{0}) || db.GetNonce(target) != 1 {
		t.Fatal("synthetic native predeployment lost constructor code, nonce or full-width storage")
	}
	if db.GetBalance(target).Sign() != 0 {
		t.Fatal("fixture allocation created QRL")
	}
	input.ID = "overwrite"
	if _, err := r.run(input); err == nil {
		t.Fatal("fixture allocation overwrote existing account")
	}
	input.Source = "@missing"
	if _, err := r.run(input); err == nil {
		t.Fatal("fixture allocation accepted missing constructor state")
	}
}
