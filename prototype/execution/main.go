// Command execution runs prototype contract bytecode in the pinned, unmodified
// go-qrl QRVM. State, block time, and initial balances are explicit test fixtures.
// It neither submits network transactions nor authenticates beacon finality.
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/theQRL/go-qrl/accounts/abi"
	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/consensus/beacon"
	"github.com/theQRL/go-qrl/core"
	"github.com/theQRL/go-qrl/core/rawdb"
	"github.com/theQRL/go-qrl/core/state"
	"github.com/theQRL/go-qrl/core/types"
	"github.com/theQRL/go-qrl/core/vm"
	"github.com/theQRL/go-qrl/core/vm/runtime"
	"github.com/theQRL/go-qrl/crypto"
	"github.com/theQRL/go-qrl/params"
)

type step struct {
	Name     string `json:"name"`
	Op       string `json:"op"`
	ID       string `json:"id"`
	Artifact string `json:"artifact"`
	Target   string `json:"target"`
	Method   string `json:"method"`
	From     string `json:"from"`
	Args     []any  `json:"args"`
	Want     []any  `json:"want"`
	Value    string `json:"value"`
	Revert   string `json:"revert"`
	Time     uint64 `json:"time"`
}

type plan struct {
	Origin   string            `json:"origin"`
	Accounts map[string]string `json:"accounts"`
	Time     uint64            `json:"time"`
	Steps    []step            `json:"steps"`
}

type runner struct {
	base            string
	config          runtime.Config
	addresses       map[string]common.Address
	abis            map[string]abi.ABI
	dataBytes       int
	intrinsic       uint64
	withdrawalIndex uint64
}

func parseInteger(value any) (*big.Int, error) {
	n, ok := new(big.Int).SetString(fmt.Sprint(value), 10)
	if !ok {
		return nil, fmt.Errorf("invalid decimal integer %v", value)
	}
	return n, nil
}

func unhex(value string) ([]byte, error) {
	return hex.DecodeString(strings.TrimPrefix(value, "0x"))
}

func (r *runner) address(value string) (common.Address, error) {
	if strings.HasPrefix(value, "@") {
		a, ok := r.addresses[strings.TrimPrefix(value, "@")]
		if !ok {
			return common.Address{}, fmt.Errorf("unknown deployment %s", value)
		}
		return a, nil
	}
	if !common.IsAddress(value) {
		return common.Address{}, fmt.Errorf("invalid QIP-55 address %s", value)
	}
	return common.MustParseAddress(value), nil
}

func (r *runner) coerce(t abi.Type, value any) (any, error) {
	switch t.T {
	case abi.AddressTy:
		return r.address(fmt.Sprint(value))
	case abi.UintTy, abi.IntTy:
		n, err := parseInteger(value)
		if err != nil {
			return nil, err
		}
		if t.T == abi.UintTy && (n.Sign() < 0 || n.BitLen() > t.Size) {
			return nil, fmt.Errorf("integer exceeds %s", t.String())
		}
		target := t.GetType()
		if target.Kind() == reflect.Ptr {
			return n, nil
		}
		out := reflect.New(target).Elem()
		if t.T == abi.UintTy {
			out.SetUint(n.Uint64())
		} else {
			out.SetInt(n.Int64())
		}
		return out.Interface(), nil
	case abi.FixedBytesTy, abi.BytesTy:
		b, err := unhex(fmt.Sprint(value))
		if err != nil {
			return nil, err
		}
		if t.T == abi.BytesTy {
			return b, nil
		}
		if len(b) != t.Size {
			return nil, fmt.Errorf("wrong fixed-byte length for %s", t.String())
		}
		out := reflect.New(t.GetType()).Elem()
		reflect.Copy(out, reflect.ValueOf(b))
		return out.Interface(), nil
	case abi.BoolTy:
		b, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("expected boolean")
		}
		return b, nil
	case abi.StringTy:
		return fmt.Sprint(value), nil
	case abi.ArrayTy, abi.SliceTy:
		items, ok := value.([]any)
		if !ok {
			return nil, fmt.Errorf("expected array for %s", t.String())
		}
		var out reflect.Value
		if t.T == abi.SliceTy {
			out = reflect.MakeSlice(t.GetType(), len(items), len(items))
		} else {
			if len(items) != t.Size {
				return nil, fmt.Errorf("wrong array length")
			}
			out = reflect.New(t.GetType()).Elem()
		}
		for i, item := range items {
			converted, err := r.coerce(*t.Elem, item)
			if err != nil {
				return nil, err
			}
			out.Index(i).Set(reflect.ValueOf(converted))
		}
		return out.Interface(), nil
	case abi.TupleTy:
		object, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("expected named tuple")
		}
		out := reflect.New(t.GetType()).Elem()
		for i, field := range t.TupleElems {
			item, exists := object[t.TupleRawNames[i]]
			if !exists {
				return nil, fmt.Errorf("missing tuple field %s", t.TupleRawNames[i])
			}
			converted, err := r.coerce(*field, item)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", t.TupleRawNames[i], err)
			}
			out.Field(i).Set(reflect.ValueOf(converted))
		}
		return out.Interface(), nil
	}
	return nil, fmt.Errorf("unsupported ABI test type %s", t.String())
}

func (r *runner) arguments(arguments abi.Arguments, values []any) ([]any, error) {
	if len(arguments) != len(values) {
		return nil, fmt.Errorf("argument count %d != %d", len(values), len(arguments))
	}
	out := make([]any, len(values))
	for i, value := range values {
		converted, err := r.coerce(arguments[i].Type, value)
		if err != nil {
			return nil, fmt.Errorf("argument %d: %w", i, err)
		}
		out[i] = converted
	}
	return out, nil
}

func (r *runner) run(s step) (uint64, error) {
	r.dataBytes, r.intrinsic = 0, 0
	if s.Op == "withdrawal-credit" {
		// Explicit synthetic input for unit tests. This executes the unchanged
		// native credit routine without asserting consensus authorization.
		address, err := r.address(s.Target)
		if err != nil {
			return 0, err
		}
		amount, err := parseInteger(s.Value)
		if err != nil || amount.Sign() < 0 {
			return 0, fmt.Errorf("invalid synthetic withdrawal amount")
		}
		shor, remainder := new(big.Int), new(big.Int)
		shor.QuoRem(amount, big.NewInt(params.Shor), remainder)
		if remainder.Sign() != 0 || !shor.IsUint64() {
			return 0, fmt.Errorf("synthetic withdrawal must fit uint64 whole shor")
		}
		body := &types.Body{Withdrawals: []*types.Withdrawal{{
			Index: r.withdrawalIndex, Validator: 0, Address: address, Amount: shor.Uint64(),
		}}}
		beacon.New().Finalize(nil, &types.Header{Number: new(big.Int).Set(r.config.BlockNumber)}, r.config.State, body)
		r.withdrawalIndex++
		r.config.State.Finalise(true)
		return 0, nil
	}
	if s.Op == "time" {
		if s.Time < r.config.Time {
			return 0, fmt.Errorf("test block time cannot regress")
		}
		r.config.Time = s.Time
		r.config.BlockNumber.Add(r.config.BlockNumber, big.NewInt(1))
		return 0, nil
	}
	if s.Op == "balance" {
		address, err := r.address(s.Target)
		if err != nil {
			return 0, err
		}
		value, err := parseInteger(s.Value)
		if err != nil {
			return 0, err
		}
		if got := r.config.State.GetBalance(address); got.Cmp(value) != 0 {
			return 0, fmt.Errorf("balance %s != %s", got, value)
		}
		return 0, nil
	}
	config := r.config
	if s.From != "" {
		address, err := r.address(s.From)
		if err != nil {
			return 0, err
		}
		config.Origin = address
	}
	config.Value = new(big.Int)
	if s.Value != "" {
		value, err := parseInteger(s.Value)
		if err != nil || value.Sign() < 0 {
			return 0, fmt.Errorf("invalid call value")
		}
		config.Value = value
	}
	var ret []byte
	var left uint64
	var callErr error
	var definition abi.ABI
	if s.Op == "deploy" {
		if _, exists := r.addresses[s.ID]; exists {
			return 0, fmt.Errorf("duplicate deployment id")
		}
		artifact := filepath.Join(r.base, s.Artifact)
		abiBytes, err := os.ReadFile(artifact + ".abi")
		if err != nil {
			return 0, err
		}
		definition, err = abi.JSON(strings.NewReader(string(abiBytes)))
		if err != nil {
			return 0, err
		}
		args, err := r.arguments(definition.Constructor.Inputs, s.Args)
		if err != nil {
			return 0, err
		}
		encoded, err := definition.Pack("", args...)
		if err != nil {
			return 0, err
		}
		codeBytes, err := os.ReadFile(artifact + ".bin")
		if err != nil {
			return 0, err
		}
		code, err := unhex(strings.TrimSpace(string(codeBytes)))
		if err != nil {
			return 0, err
		}
		var address common.Address
		input := append(code, encoded...)
		intrinsic, err := core.IntrinsicGas(input, nil, true)
		if err != nil || intrinsic > config.GasLimit {
			return 0, fmt.Errorf("creation intrinsic gas exceeds fixture limit: %v", err)
		}
		config.GasLimit -= intrinsic
		r.dataBytes, r.intrinsic = len(input), intrinsic
		ret, address, left, callErr = runtime.Create(input, &config)
		if callErr == nil {
			r.addresses[s.ID] = address
			r.abis[s.ID] = definition
			if len(ret) == 0 {
				return 0, fmt.Errorf("deployment produced empty code")
			}
		}
	} else if s.Op == "call" {
		definition = r.abis[strings.TrimPrefix(s.Target, "@")]
		method, ok := definition.Methods[s.Method]
		if !ok {
			return 0, fmt.Errorf("unknown method %s", s.Method)
		}
		args, err := r.arguments(method.Inputs, s.Args)
		if err != nil {
			return 0, err
		}
		encoded, err := definition.Pack(s.Method, args...)
		if err != nil {
			return 0, err
		}
		if len(encoded) > 120*1024 {
			return 0, fmt.Errorf("prototype call exceeds conservative local calldata bound")
		}
		address, err := r.address(s.Target)
		if err != nil {
			return 0, err
		}
		intrinsic, err := core.IntrinsicGas(encoded, nil, false)
		if err != nil || intrinsic > config.GasLimit {
			return 0, fmt.Errorf("call intrinsic gas exceeds fixture limit: %v", err)
		}
		config.GasLimit -= intrinsic
		r.dataBytes, r.intrinsic = len(encoded), intrinsic
		ret, left, callErr = runtime.Call(address, encoded, &config)
		if callErr == nil && s.Revert == "" && s.Want != nil {
			got, err := method.Outputs.Unpack(ret)
			if err != nil {
				return 0, err
			}
			want, err := r.arguments(method.Outputs, s.Want)
			if err != nil {
				return 0, err
			}
			gotEncoding, err := method.Outputs.Pack(got...)
			if err != nil {
				return 0, err
			}
			wantEncoding, err := method.Outputs.Pack(want...)
			if err != nil {
				return 0, err
			}
			if !bytes.Equal(gotEncoding, wantEncoding) || !bytes.Equal(ret, wantEncoding) {
				return 0, fmt.Errorf("return values differ: got %v; want %v", got, want)
			}
		}
	} else {
		return 0, fmt.Errorf("unknown operation %s", s.Op)
	}
	if s.Revert != "" {
		if !errors.Is(callErr, vm.ErrExecutionReverted) {
			return 0, fmt.Errorf("expected contract revert, got %v", callErr)
		}
		if s.Revert != "*" {
			reason, err := abi.UnpackRevert(ret)
			if err != nil || !strings.Contains(reason, s.Revert) {
				return 0, fmt.Errorf("unexpected revert reason %q (%v)", reason, err)
			}
		}
	} else if callErr != nil {
		reason, _ := abi.UnpackRevert(ret)
		return 0, fmt.Errorf("execution error %w: %s", callErr, reason)
	}
	// Each action has its own transaction-original storage and refund journal.
	// Caller balances deliberately exclude transaction fees in this VM harness.
	r.config.State.Finalise(true)
	return r.config.GasLimit - left, nil
}

func main() {
	planFile := flag.String("plan", "", "JSON prototype execution plan")
	reportFile := flag.String("report", "", "optional JSON measurements for the executed plan")
	predict := flag.String("predict", "", "print CREATE addresses for a public test origin")
	flag.Parse()
	if *predict != "" {
		if !common.IsAddress(*predict) {
			panic("invalid address")
		}
		origin := common.MustParseAddress(*predict)
		for nonce := uint64(0); nonce < 5; nonce++ {
			fmt.Printf("%d %s\n", nonce, crypto.CreateAddress(origin, nonce))
		}
		return
	}
	if *planFile == "" {
		panic("-plan is required")
	}
	file, err := os.Open(*planFile)
	if err != nil {
		panic(err)
	}
	defer file.Close()
	var input plan
	decoder := json.NewDecoder(file)
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		panic(err)
	}
	db, err := state.New(types.EmptyRootHash, state.NewDatabase(rawdb.NewMemoryDatabase()), nil)
	if err != nil {
		panic(err)
	}
	r := &runner{base: filepath.Dir(*planFile), addresses: make(map[string]common.Address), abis: make(map[string]abi.ABI)}
	origin, err := r.address(input.Origin)
	if err != nil {
		panic(err)
	}
	r.config = runtime.Config{Origin: origin, State: db, Time: input.Time, GasLimit: params.MaxGasLimit,
		BlockNumber: big.NewInt(1), ChainConfig: &params.ChainConfig{ChainID: big.NewInt(3151914)}}
	for address, amount := range input.Accounts {
		a, err := r.address(address)
		if err != nil {
			panic(err)
		}
		n, err := parseInteger(amount)
		if err != nil || n.Sign() < 0 {
			panic("invalid fixture balance")
		}
		db.SetBalance(a, n)
	}
	measurements := make([]map[string]any, 0, len(input.Steps))
	for i, s := range input.Steps {
		gas, err := r.run(s)
		if err != nil {
			fmt.Fprintf(os.Stderr, "FAIL step %d %s: %v\n", i, s.Name, err)
			os.Exit(1)
		}
		fmt.Printf("PASS step %d %s (gas budget used %d, before refunds)\n", i, s.Name, gas)
		measurements = append(measurements, map[string]any{
			"name": s.Name, "op": s.Op, "target": s.Target, "method": s.Method,
			"calldataBytes": r.dataBytes, "intrinsicGas": r.intrinsic,
			"gasBeforeRefund": gas, "expectedRevert": s.Revert != "",
		})
	}
	if *reportFile != "" {
		encoded, err := json.MarshalIndent(map[string]any{
			"steps":    measurements,
			"boundary": "Actual QRVM and intrinsic gas; synthetic execution environment; no transaction fees debited. Any withdrawal-credit operation executes the native credit routine with an explicitly synthetic unauthenticated payload.",
		}, "", "  ")
		if err != nil {
			panic(err)
		}
		if err := os.WriteFile(*reportFile, append(encoded, '\n'), 0644); err != nil {
			panic(err)
		}
	}
	fmt.Printf("PASS %d steps: actual go-qrl QRVM plus intrinsic gas bound; synthetic state/time; balances exclude transaction fees; no network consensus or finality claim\n", len(input.Steps))
}
