// relay-exit submits one already signed public message to an explicitly pinned
// loopback beacon. It accepts no signing keys and never signs a message.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/theQRL/qrysm/beacon-chain/core/signing"
	"github.com/theQRL/qrysm/beacon-chain/rpc/qrl/shared"
	"github.com/theQRL/qrysm/config/params"
)

func loopbackURL(value string) (*url.URL, error) {
	u, err := url.Parse(value)
	if err != nil {
		return nil, err
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "http" || ip == nil || !ip.IsLoopback() || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("beacon must be a literal loopback HTTP origin without credentials, path, query or fragment")
	}
	return u, nil
}

func request(client *http.Client, method, endpoint string, payload []byte) (int, []byte, error) {
	r, err := http.NewRequest(method, endpoint, bytes.NewReader(payload))
	if err != nil {
		return 0, nil, err
	}
	if payload != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(r)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, data, err
}

func checkFixtureIdentity(expectedTime, expectedChain, actualTime, actualChain string) error {
	if expectedTime == "" && expectedChain == "" {
		return nil
	}
	for _, value := range []string{expectedTime, expectedChain} {
		n, err := strconv.ParseUint(value, 10, 64)
		if err != nil || n == 0 || strconv.FormatUint(n, 10) != value {
			return errors.New("genesis-time and deposit-chain-id must both be canonical positive integers")
		}
	}
	if expectedTime != actualTime || expectedChain != actualChain {
		return errors.New("local beacon genesis time or deposit chain ID differs from explicit fixture pins")
	}
	return nil
}

func run() error {
	beacon := flag.String("beacon", "", "literal loopback HTTP beacon origin")
	genesis := flag.String("genesis-root", "", "expected genesis validators root, 0x plus 64 hex characters")
	genesisTime := flag.String("genesis-time", "", "optional exact local genesis time, paired with deposit-chain-id")
	depositChainID := flag.String("deposit-chain-id", "", "optional exact local DEPOSIT_CHAIN_ID, paired with genesis-time")
	exitFile := flag.String("exit-file", "", "public signed exit JSON file")
	submit := flag.Bool("submit-local-exit", false, "submit this one message to the verified local target")
	verifyOnly := flag.Bool("verify-only", false, "verify public signature and domain without submitting")
	flag.Parse()
	u, err := loopbackURL(*beacon)
	if err != nil {
		return err
	}
	root, err := hex.DecodeString(strings.TrimPrefix(*genesis, "0x"))
	if err != nil || len(root) != 32 || bytes.Equal(root, make([]byte, 32)) {
		return errors.New("expected nonzero 32-byte genesis root is required")
	}
	if *submit == *verifyOnly {
		return errors.New("choose exactly one of -submit-local-exit or -verify-only")
	}
	if *submit && (*genesisTime == "" || *depositChainID == "") {
		return errors.New("local exit submission requires explicit genesis-time and deposit-chain-id pins")
	}
	data, err := os.ReadFile(*exitFile)
	if err != nil {
		return err
	}
	if len(data) > 20000 {
		return errors.New("exit JSON exceeds bounded message size")
	}
	var exit shared.SignedVoluntaryExit
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&exit); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	consensusExit, err := exit.ToConsensus()
	if err != nil {
		return err
	}
	// An empty secret-free public message cannot make a valid exit; conversion
	// checks fields and lengths before the server checks the real signature.
	if len(consensusExit.Signature) != 4627 {
		return errors.New("wrong ML-DSA exit signature length")
	}
	client := &http.Client{
		Timeout:       15 * time.Second,
		Transport:     &http.Transport{Proxy: nil},
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirects are prohibited") },
	}
	origin := u.Scheme + "://" + u.Host
	status, genesisData, err := request(client, "GET", origin+"/qrl/v1/beacon/genesis", nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("genesis request failed with status %d", status)
	}
	var info struct {
		Data struct {
			Root string `json:"genesis_validators_root"`
			Time string `json:"genesis_time"`
		} `json:"data"`
	}
	if err := json.Unmarshal(genesisData, &info); err != nil {
		return err
	}
	if !strings.EqualFold(info.Data.Root, "0x"+hex.EncodeToString(root)) {
		return errors.New("local beacon genesis does not match the explicit expected root")
	}
	if *genesisTime != "" || *depositChainID != "" {
		status, specData, err := request(client, "GET", origin+"/qrl/v1/config/spec", nil)
		if err != nil {
			return err
		}
		if status != http.StatusOK {
			return fmt.Errorf("configuration lookup failed with status %d", status)
		}
		var specification struct {
			Data map[string]string `json:"data"`
		}
		if err := json.Unmarshal(specData, &specification); err != nil {
			return err
		}
		if err := checkFixtureIdentity(*genesisTime, *depositChainID, info.Data.Time, specification.Data["DEPOSIT_CHAIN_ID"]); err != nil {
			return err
		}
	}
	status, validatorData, err := request(client, "GET", origin+"/qrl/v1/beacon/states/head/validators/"+fmt.Sprint(consensusExit.Exit.ValidatorIndex), nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("validator lookup failed with status %d", status)
	}
	var validatorInfo struct {
		Data struct {
			Index     string `json:"index"`
			Validator struct {
				PublicKey string `json:"pubkey"`
			} `json:"validator"`
		} `json:"data"`
	}
	if err := json.Unmarshal(validatorData, &validatorInfo); err != nil {
		return err
	}
	if validatorInfo.Data.Index != fmt.Sprint(consensusExit.Exit.ValidatorIndex) {
		return errors.New("validator index response mismatch")
	}
	publicKey, err := hex.DecodeString(strings.TrimPrefix(validatorInfo.Data.Validator.PublicKey, "0x"))
	if err != nil || len(publicKey) != 2592 {
		return errors.New("invalid validator public key in local response")
	}
	status, forkData, err := request(client, "GET", origin+"/qrl/v1/beacon/states/head/fork", nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("fork lookup failed with status %d", status)
	}
	var forkInfo struct {
		Data *shared.Fork `json:"data"`
	}
	if err := json.Unmarshal(forkData, &forkInfo); err != nil {
		return err
	}
	fork, err := forkInfo.Data.ToConsensus()
	if err != nil {
		return err
	}
	domain, err := signing.Domain(fork, consensusExit.Exit.Epoch, params.BeaconConfig().DomainVoluntaryExit, root)
	if err != nil {
		return err
	}
	if err := signing.VerifySigningRoot(consensusExit.Exit, publicKey, consensusExit.Signature, domain); err != nil {
		return err
	}
	publicKeyHash := sha256.Sum256(publicKey)
	result := map[string]any{
		"genesisValidatorsRoot":             info.Data.Root,
		"genesisTime":                       info.Data.Time,
		"depositChainIdPin":                 *depositChainID,
		"operationalFixtureIdentityChecked": *genesisTime != "",
		"validatorIndex":                    fmt.Sprint(consensusExit.Exit.ValidatorIndex),
		"exitEpoch":                         fmt.Sprint(consensusExit.Exit.Epoch),
		"publicKeySHA256":                   hex.EncodeToString(publicKeyHash[:]),
		"domain":                            "0x" + hex.EncodeToString(domain),
		"fork":                              forkInfo.Data,
		"signatureVerified":                 true,
		"observationBoundary":               "local node RPC identity and signature checks; no contract-verifiable finality claim",
	}
	if *verifyOnly {
		result["result"] = "public signature and domain verified; no message submitted and eligibility not evaluated"
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	status, body, err := request(client, "POST", origin+"/qrl/v1/beacon/pool/voluntary_exits", data)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("exit submission rejected: HTTP %d: %s", status, strings.TrimSpace(string(body)))
	}
	result["httpStatus"] = status
	result["result"] = "beacon accepted public signed exit; block inclusion and finality require separate checks"
	return json.NewEncoder(os.Stdout).Encode(result)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
