# Hyperion Sources

This directory keeps the Hyperion port separate from the Solidity + Foundry workspace.

- `hyperion/contracts/` contains generated `.hyp` mirrors of the live Solidity contracts in `contracts/solidity/`.
- `hyperion/test/` contains generated Hyperion copies of the primary v2 tests.
- `hyperion/artifacts/` contains `hypc` output and is ignored by git.
- `config/testnet-hyperion.json` stores deployment targets for the Hyperion deployment path.

## Workflow

1. Sync the generated Hyperion sources:

```bash
node scripts/sync-hyperion.js
```

2. Compile with the Hyperion compiler:

```bash
HYPERION_COMPILER=/path/to/hypc node scripts/compile-hyperion.js
```

3. Deploy the v2 contracts to Zond:

```bash
TESTNET_SEED="..." node scripts/deploy-hyperion.js
```

## Notes

- The Solidity sources in `contracts/solidity/` remain the canonical editing target.
- The Foundry tests in `test/` remain the canonical test suite; `hyperion/test/` is a mirrored compatibility layer.
