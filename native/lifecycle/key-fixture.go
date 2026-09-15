// Offline keys for the isolated chain3151916 lifecycle. No ambient keys are read.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/qrysm/cmd/staking-deposit-cli/config"
	"github.com/theQRL/qrysm/cmd/staking-deposit-cli/misc"
	"github.com/theQRL/qrysm/cmd/staking-deposit-cli/stakingdeposit"
	fieldparams "github.com/theQRL/qrysm/config/fieldparams"
)

func run() error {
	if os.Getenv("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151916" {
		return errors.New("explicit isolated fixture selector required")
	}
	f := flag.NewFlagSet("key-fixture", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	mode := f.String("mode", "", "")
	keyDir := f.String("key-dir", "", "")
	recipientText := f.String("recipient", "", "")
	output := f.String("output", "", "")
	if f.Parse(os.Args[1:]) != nil || f.NArg() != 0 || *keyDir == "" {
		return errors.New("invalid bounded fixture arguments")
	}
	settings := &config.ChainSetting{Name: "dev", GenesisForkVersion: []byte{0x31, 0x51, 0x91, 0x60}, GenesisValidatorsRoot: make([]byte, 32)}
	switch *mode {
	case "prepare":
		if err := os.Mkdir(*keyDir, 0700); err != nil {
			return errors.New("fixture key directory must be new")
		}
		seed := make([]byte, fieldparams.MLDSA87SeedLength)
		if _, err := rand.Read(seed); err != nil {
			return errors.New("fixture entropy unavailable")
		}
		passwordBytes := make([]byte, 32)
		if _, err := rand.Read(passwordBytes); err != nil {
			return errors.New("fixture entropy unavailable")
		}
		password := hex.EncodeToString(passwordBytes)
		if err := os.WriteFile(filepath.Join(*keyDir, "seed.hex"), []byte(misc.EncodeHex(seed)), 0600); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(*keyDir, "fixture-password.txt"), []byte(password+"\n"), 0600); err != nil {
			return err
		}
		credential, err := stakingdeposit.NewCredential(misc.EncodeHex(seed), 0, 2000*1_000_000_000, settings, common.Address{})
		if err != nil {
			return errors.New("fixture credential generation failed")
		}
		generated := filepath.Join(*keyDir, "generated")
		if err := os.Mkdir(generated, 0700); err != nil {
			return err
		}
		file, err := credential.SaveSigningKeystore(password, generated, true)
		if err != nil {
			return errors.New("fixture keystore creation failed")
		}
		if !credential.VerifyKeystore(file, password) {
			return errors.New("fixture keystore verification failed")
		}
		data, err := stakingdeposit.NewDepositData(credential)
		if err != nil {
			return errors.New("fixture public identity failed")
		}
		public := map[string]any{"pubkey": data.PubKey, "forkVersion": "0x31519160", "chainId": 3151916, "derivationIndex": 0, "freshRandomFixture": true}
		encoded, err := json.MarshalIndent(public, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(*keyDir, "public.json"), append(encoded, '\n'), 0600); err != nil {
			return err
		}
		fmt.Println("Prepared one fresh disposable validator key without publishing its seed")
	case "deposits":
		recipient, err := common.NewAddressFromString(*recipientText)
		if err != nil || recipient == (common.Address{}) {
			return errors.New("valid nonzero immutable pool recipient required")
		}
		if *output == "" {
			return errors.New("public output directory required")
		}
		if err := os.Mkdir(*output, 0700); err != nil {
			return errors.New("public deposit directory must be new")
		}
		seedText, err := os.ReadFile(filepath.Join(*keyDir, "seed.hex"))
		if err != nil {
			return errors.New("fixture seed unavailable")
		}
		seed, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(string(seedText)), "0x"))
		if err != nil || len(seed) != fieldparams.MLDSA87SeedLength {
			return errors.New("invalid fixture seed encoding")
		}
		for _, qrl := range []uint64{2000, 38000, 40000} {
			credential, err := stakingdeposit.NewCredential(misc.EncodeHex(seed), 0, qrl*1_000_000_000, settings, recipient)
			if err != nil {
				return errors.New("fixture deposit credential failed")
			}
			data, err := stakingdeposit.NewDepositData(credential)
			if err != nil {
				return errors.New("fixture deposit generation failed")
			}
			encoded, err := json.MarshalIndent([]*stakingdeposit.DepositData{data}, "", "  ")
			if err != nil {
				return err
			}
			file := filepath.Join(*output, fmt.Sprintf("deposit-%d.json", qrl))
			if err := os.WriteFile(file, append(encoded, '\n'), 0600); err != nil {
				return err
			}
			if !stakingdeposit.VerifyDepositDataJSON(file, []*stakingdeposit.Credential{credential}) {
				return errors.New("fixture deposit signature verification failed")
			}
		}
		fmt.Println("Verified native2000/38000/40000QRL deposit variants for the immutable fixture pool")
	default:
		return errors.New("expected prepare or deposits")
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
