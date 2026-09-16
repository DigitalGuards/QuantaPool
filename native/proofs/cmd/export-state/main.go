package main

import (
	"encoding/json"
	"flag"
	"os"
	"strconv"
	"strings"

	proofs "github.com/DigitalGuards/QuantaPool/native/proofs"
	statenative "github.com/theQRL/qrysm/beacon-chain/state/state-native"
	"github.com/theQRL/qrysm/config/params"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

func main() {
	file := flag.String("state", "", "public native state SSZ")
	config := flag.String("config", "", "captured native config YAML")
	expected := flag.String("state-root", "", "authenticated header state root")
	indices := flag.String("indices", "", "comma-separated registered validator indices in admission order")
	output := flag.String("output", "", "JSON witness output")
	flag.Parse()
	proofs.Require(*file != "" && *config != "" && len(*expected) == 66 && *output != "", "complete state inputs required")
	c, err := params.UnmarshalConfigFile(*config, nil)
	proofs.Must(err)
	params.OverrideBeaconConfig(c)
	raw, err := os.ReadFile(*file)
	proofs.Must(err)
	p := new(pb.BeaconStateZond)
	proofs.Must(p.UnmarshalSSZ(raw))
	s, err := statenative.InitializeFromProtoZond(p)
	proofs.Must(err)
	selected := []uint64{}
	if *indices != "" {
		for _, v := range strings.Split(*indices, ",") {
			i, err := strconv.ParseUint(v, 10, 64)
			proofs.Must(err)
			selected = append(selected, i)
		}
	}
	out := proofs.State(s.(*statenative.BeaconState), selected)
	proofs.Require(out.StateRoot == *expected, "native state differs from supplied header")
	raw, err = json.MarshalIndent(out, "", "  ")
	proofs.Must(err)
	proofs.Must(os.WriteFile(*output, append(raw, '\n'), 0644))
}
