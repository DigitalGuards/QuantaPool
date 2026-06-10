# Hyperion Sources

Generated Hyperion mirrors of the canonical Solidity contracts. Kept peer to `contracts/solidity/` so both language flavors are co-located under `contracts/`.

## Layout

```
contracts/solidity/*.sol          # canonical, hand-edited
contracts/hyperion/*.hyp          # generated mirrors - do not edit directly
contracts/test/*.sol              # Foundry test suite (canonical)
contracts/test/hyperion/*.t.hyp   # generated test mirrors (reference only; not compiled)
build/hyperion/                   # hypc output (ABI, bin, manifest.json) - gitignored
config/testnet-hyperion.json      # deployment addresses + provider for the Hyperion path
```

## Workflow

1. Sync the generated Hyperion sources from the Solidity originals:

```bash
node scripts/sync-hyperion.js
```

2. Compile with the Hyperion compiler:

```bash
HYPERION_COMPILER=/path/to/hypc node scripts/compile-hyperion.js
```

3. Deploy the v2 contracts to QRL:

```bash
TESTNET_SEED="..." node scripts/deploy-hyperion.js
```

## Notes

- The Solidity sources in `contracts/solidity/` are the canonical editing target. Never hand-edit a `.hyp` file - regenerate.
- `scripts/sync-hyperion.js` translates three Solidity-vs-Hyperion dialect differences: pragma version, unit suffixes (`ether/wei/gwei` → `quanta/planck/shor`), and address literal prefix (`0x<40hex>` → `Q<40hex>`).
- The Foundry tests in `contracts/test/` are the canonical test suite; `contracts/test/hyperion/` is a mirrored compatibility layer kept for reference but not run through `hypc`.
