// Offline public-fixture generation with an explicit local signature domain.
// All credential, RANDAO, deposit and keystore operations use unchanged Qrysm.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/theQRL/go-qrl/common"
	qrllib "github.com/theQRL/go-qrllib/wallet/misc"
	"github.com/theQRL/qrysm/cmd/staking-deposit-cli/config"
	"github.com/theQRL/qrysm/cmd/staking-deposit-cli/misc"
	"github.com/theQRL/qrysm/cmd/staking-deposit-cli/stakingdeposit"
	"github.com/theQRL/qrysm/config/params"
)

func run() error {
	if os.Getenv("QUANTAPOOL_PUBLIC_LOCAL_NETWORK") != "3151916" || len(os.Args) < 2 || os.Args[1] != "new-seed" {
		return errors.New("explicit local fixture selector required")
	}
	f := flag.NewFlagSet("deposit-fixture", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	count := f.Uint64("num-validators", 0, "")
	start := f.Uint64("validator-start-index", 0, "")
	folder := f.String("folder", "", "")
	mnemonic := f.String("mnemonic", "", "")
	passwordFile := f.String("keystore-password-file", "", "")
	chain := f.String("chain-name", "", "")
	address := f.String("execution-address", "", "")
	light := f.Bool("lightkdf", false, "")
	if f.Parse(os.Args[2:]) != nil || f.NArg() != 0 || *count == 0 || *count > 128 || *start > 128 || *chain != "dev" || *folder == "" {
		return errors.New("invalid bounded fixture arguments")
	}
	seed, err := qrllib.MnemonicToBin(*mnemonic)
	if err != nil {
		return errors.New("invalid fixture mnemonic")
	}
	recipient, err := common.NewAddressFromString(*address)
	if err != nil {
		return errors.New("invalid fixture recipient")
	}
	passwordBytes, err := os.ReadFile(*passwordFile)
	if err != nil {
		return errors.New("fixture password file unavailable")
	}
	password := strings.TrimRight(string(passwordBytes), "\r\n")
	if password == "" {
		return errors.New("empty fixture password")
	}
	if err = os.MkdirAll(*folder, 0700); err != nil {
		return errors.New("fixture directory unavailable")
	}
	settings := &config.ChainSetting{Name: config.DEV, GenesisForkVersion: []byte{0x31, 0x51, 0x91, 0x60}, GenesisValidatorsRoot: make([]byte, 32)}
	amounts := make([]uint64, *count)
	for i := range amounts {
		amounts[i] = params.BeaconConfig().MaxEffectiveBalance
	}
	encoded := misc.EncodeHex(seed[:])
	credentials, err := stakingdeposit.NewCredentialsFromSeed(encoded, *count, amounts, settings, *start, recipient)
	if err != nil {
		return errors.New("fixture credential generation failed")
	}
	keystores, err := credentials.ExportKeystores(password, *folder, *light)
	if err != nil {
		return errors.New("fixture keystore export failed")
	}
	depositFile, err := credentials.ExportDepositDataJSON(*folder)
	if err != nil {
		return errors.New("fixture deposit export failed")
	}
	if !credentials.VerifyKeystores(keystores, password) {
		return errors.New("fixture keystore verification failed")
	}
	// The upstream verifier requires the individual credentials. Reconstruct them
	// through its public constructor without exposing their private fields.
	individual := make([]*stakingdeposit.Credential, *count)
	for i := uint64(0); i < *count; i++ {
		individual[i], err = stakingdeposit.NewCredential(encoded, *start+i, amounts[i], settings, recipient)
		if err != nil {
			return errors.New("fixture verification input failed")
		}
	}
	if !stakingdeposit.VerifyDepositDataJSON(depositFile, individual) {
		return errors.New("fixture deposit signature verification failed")
	}
	fmt.Printf("Verified %d local fixture deposits for fork 0x31519160\n", *count)
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
