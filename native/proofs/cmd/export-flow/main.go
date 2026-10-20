// export-flow reconstructs complete compact receipt witnesses from public SSZ.
package main

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"

	proofs "github.com/DigitalGuards/QuantaPool/native/proofs"
	pb "github.com/theQRL/qrysm/proto/qrysm/v1alpha1"
)

func main() {
	dir := flag.String("capture-dir", "", "captured public block directory")
	output := flag.String("output", "", "JSON witness output")
	stop := flag.String("stop-root", "", "optional complete interval stop after a verified cached tail")
	var cacheFiles []string
	flag.Func("witness-cache", "prior compact witness file; each list and branch is reverified", func(value string) error { cacheFiles = append(cacheFiles, value); return nil })
	flag.Parse()
	proofs.Require(*dir != "" && *output != "", "capture-dir and output required")
	raw, err := os.ReadFile(filepath.Join(*dir, "flow-manifest.json"))
	proofs.Must(err)
	var manifest struct {
		StartRoot string `json:"startRoot"`
		StopRoot  string `json:"stopRoot"`
		Blocks    []struct {
			File string `json:"file"`
			Root string `json:"root"`
		} `json:"blocks"`
	}
	proofs.Must(json.Unmarshal(raw, &manifest))
	proofs.Require(len(manifest.Blocks) > 0 && len(manifest.Blocks) <= 4096, "bounded occupied interval required")
	next := manifest.StartRoot
	target := manifest.StopRoot
	if *stop != "" {
		target = *stop
	}
	cache := map[string]proofs.BlockWitness{}
	for _, file := range cacheFiles {
		data, err := os.ReadFile(file)
		proofs.Must(err)
		var prior struct {
			Blocks []proofs.BlockWitness `json:"blocks"`
		}
		proofs.Must(json.Unmarshal(data, &prior))
		proofs.Require(len(prior.Blocks) <= 4096, "bounded witness cache required")
		for _, item := range prior.Blocks {
			cache[proofs.CheckedFlowRoot(item)] = item
		}
	}
	reused := 0
	result := []proofs.BlockWitness{}
	for _, item := range manifest.Blocks {
		proofs.Require(filepath.Base(item.File) == item.File && strings.HasSuffix(item.File, ".ssz"), "invalid capture filename")
		if prior, ok := cache[next]; ok {
			proofs.Require(item.Root == next, "cached header manifest mismatch")
			result = append(result, prior)
			next = prior.Header.ParentRoot
			reused++
			continue
		}
		raw, err := os.ReadFile(filepath.Join(*dir, item.File))
		proofs.Must(err)
		b := new(pb.SignedBeaconBlockZond)
		proofs.Must(b.UnmarshalSSZ(raw))
		proofs.Require(proofs.Hex(proofs.Root(b.Block)) == next && item.Root == next, "broken captured block ancestry")
		result = append(result, proofs.Flow(b.Block))
		next = proofs.Hex(b.Block.ParentRoot)
	}
	proofs.Require(next == manifest.StopRoot, "incomplete captured interval")
	for next != target {
		proofs.Require(len(result) < 4096, "bounded cached interval required")
		item, ok := cache[next]
		proofs.Require(ok, "missing canonical cached tail")
		result = append(result, item)
		next = item.Header.ParentRoot
		reused++
	}
	raw, err = json.MarshalIndent(map[string]any{"schemaVersion": 1, "startRoot": manifest.StartRoot, "stopRoot": target, "blocks": result, "cachedBlocks": reused, "nativeRootVerified": true, "boundary": "Canonical native SSZ root checks; finality authority is supplied separately by the immutable verifier."}, "", "  ")
	proofs.Must(err)
	proofs.Must(os.WriteFile(*output, append(raw, '\n'), 0644))
}
