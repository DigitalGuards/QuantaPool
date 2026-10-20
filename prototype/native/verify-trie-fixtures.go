// verify-trie-fixtures independently rebuilds the test plan's synthetic trie
// roots using unmodified go-qrl. These roots have no finality/economic authority.
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"os"
	"strings"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/core/rawdb"
	"github.com/theQRL/go-qrl/core/types"
	"github.com/theQRL/go-qrl/crypto"
	"github.com/theQRL/go-qrl/qrldb/memorydb"
	"github.com/theQRL/go-qrl/rlp"
	"github.com/theQRL/go-qrl/trie"
)

func main() {
	input := flag.String("fixtures", "", "synthetic JSON exported by make-checkpoint-plan.js")
	flag.Parse()
	if *input == "" {
		panic("fixtures input required")
	}
	must := func(err error) {
		if err != nil {
			panic(err)
		}
	}
	decode := func(value string) []byte {
		raw, err := hex.DecodeString(strings.TrimPrefix(value, "0x"))
		must(err)
		return raw
	}
	raw, err := os.ReadFile(*input)
	must(err)
	var fixtures []struct {
		Name, Account, Key, Root, Balance, AccountRLP string
		Proof                                         []string
		Entries                                       []struct{ Key, Value string }
	}
	must(json.Unmarshal(raw, &fixtures))
	if len(fixtures) == 0 || len(fixtures) > 64 {
		panic("fixture count outside bound")
	}
	for _, fixture := range fixtures {
		if len(fixture.Account) != 129 || fixture.Account[0] != 'Q' {
			panic("fixture address width mismatch")
		}
		address := decode("0x" + fixture.Account[1:])
		key := crypto.Keccak256(address)
		if !bytes.Equal(key, decode(fixture.Key)) {
			panic("fixture key does not hash all address bytes")
		}
		db := trie.NewDatabase(rawdb.NewMemoryDatabase(), nil)
		tree := trie.NewEmpty(db)
		for _, entry := range fixture.Entries {
			must(tree.Update(decode(entry.Key), decode(entry.Value)))
		}
		if tree.Hash().Hex() != fixture.Root {
			panic("native rebuilt root differs: " + fixture.Name)
		}
		proof := memorydb.New()
		for _, node := range fixture.Proof {
			value := decode(node)
			must(proof.Put(crypto.Keccak256(value), value))
		}
		value, err := trie.VerifyProof(common.BytesToHash(decode(fixture.Root)), key, proof)
		must(err)
		if !bytes.Equal(value, decode(fixture.AccountRLP)) {
			panic("native proof result differs: " + fixture.Name)
		}
		account := new(types.StateAccount)
		must(rlp.DecodeBytes(value, account))
		want, ok := new(big.Int).SetString(fixture.Balance, 10)
		if !ok || account.Balance.Cmp(want) != 0 {
			panic("native account balance differs: " + fixture.Name)
		}
		must(proof.Close())
		must(db.Close())
		fmt.Println("PASS native trie construction, proof and account RLP:", fixture.Name)
	}
	fmt.Printf("PASS %d synthetic fixtures independently reconstructed by native go-qrl\n", len(fixtures))
}
