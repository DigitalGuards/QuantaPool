# Receipt-token dependency inventory

The repository-wide scan includes `stQRL`, `share price`, `exchange rate`, `sharesToQrl`, `qrlToShares`, `mint`, `burn`, `receipt token` and `liquid staking`, case-insensitively. It covers source and hidden configuration, excluding dependencies, generated builds, ignored local evidence, PDFs and lockfiles. Matches in vendored test interfaces and unrelated protocol terminology are classified below. The active package compiler selects only native contracts.

## Removed executable dependencies

The [complete removed-path record](RETIRED-FILES.json) covers the token contract, old pool and manager, Solidity mirrors, token-specific tests, legacy deploy/fund/recovery commands, token ABIs and old address configuration. No native import, runtime call or user flow needs those files. Internal nontransferable accounting units remain because they allocate rewards and losses efficiently.

## Refactored consumers

| Consumer | Native replacement |
|---|---|
| Contract compiler, package commands and CI | Compile current immutable native contracts; execute actual native-VM suites |
| Frontend state, actions, activity and ABI | On-chain native positions, future-cutoff requests, native claims and cash recovery |
| Frontend copy and social metadata | Pooled staking, variable returns, explicit proof and exit assumptions |
| Exporter, dashboards, alerts and provisioning inputs | Read-only native cash, reserves, finality and pool-accounting status |
| README and architecture | Fresh state, complete authenticated accounting, fixed native fee and privilege inventory |
| Ecosystem landing card and QuantaPool page | Native pooled staking in local qualification; prior token examples removed |

No legacy balance importer or migration contract exists. Historical documents and prototype evidence retain their original provenance and are identified as historical. Old on-chain state remains untouched.

## Residual textual matches at the scan

These are file locations, not evidence of a runtime token dependency. Counts include all requested search terms, so generic `mint`/`burn` matches can occur in vendored interfaces or unrelated words.

| Path | Classification | Matching lines |
|---|---|---|
| `README.md` | Explicit removal statement, inventory or internal accounting terminology | 3 |
| `contracts/hyperion/README.md` | Explicit removal statement, inventory or internal accounting terminology | 3 |
| `docs/QUANTAPOOL-FEE-SECURITY-REVIEW-2026-08-28.md` | Explicitly historical record | 13, 15, 24, 25, 45, 63, 65, 79, 91, 126, 164, 175, 176, 189, 192 |
| `docs/TESTNET-RETIREMENT.md` | Explicit removal statement, inventory or internal accounting terminology | 7 |
| `docs/UPSTREAM-FINDINGS.md` | Explicitly historical record | 115 |
| `docs/V2-DEPLOYMENT-STATUS.md` | Explicitly historical record | 57, 65, 71, 153, 165, 171, 197, 200, 207, 208, 224, 232, 235, 240, 274, 295, 307, 309, 335, 348 and more |
| `docs/architecture.md` | Explicit removal statement, inventory or internal accounting terminology | 90 |
| `docs/legacy/V2-ARCHITECTURE.md` | Archived token design | 9, 21, 27, 30, 35, 56, 76, 87, 88, 100, 109, 139, 146, 149, 152, 153, 154, 155, 193, 253 and more |
| `docs/legacy/V2-README.md` | Archived token design | 7, 11, 15, 19, 36, 42, 45, 74, 79, 104, 115, 124, 127, 139, 149, 154, 159, 160, 185, 191 and more |
| `docs/v1-deprecated/architecture.md` | Archived token design | 5, 16, 24, 28, 43, 45, 47, 48, 68, 75, 98, 99, 110, 111, 121 |
| `docs/v1-deprecated/contract-deployment.md` | Archived token design | 37, 61, 91, 142, 143, 146, 153, 193 |
| `docs/v1-deprecated/contracts/DepositPool.md` | Archived token design | 5, 13, 18, 19, 43, 53, 59, 60, 62, 63, 83, 85, 91, 121, 126, 185, 195, 255, 283, 297 and more |
| `docs/v1-deprecated/contracts/OperatorRegistry.md` | Archived token design | 23, 24 |
| `docs/v1-deprecated/contracts/RewardsOracle.md` | Archived token design | 5, 11, 19, 20, 81, 82, 137, 159, 287, 293 |
| `docs/v1-deprecated/contracts/stQRL.md` | Archived token design | 1, 5, 12, 37, 66, 77, 90, 112, 114, 117, 118, 123, 125, 128, 129, 139, 140, 164, 165, 169 and more |
| `docs/v1-deprecated/minipool-economics.md` | Archived token design | 42, 60, 82, 133, 135, 140, 141, 145, 146, 149, 195 |
| `docs/v1-deprecated/quantapool-research.md` | Archived token design | 1, 3, 5, 60, 62, 65, 68, 128, 140, 143, 167, 193, 222, 243, 245 |
| `docs/v1-deprecated/rocketpool-reading-guide.md` | Archived token design | 9, 13, 14, 66, 77, 100, 101, 111, 113 |
| `infrastructure/docs/validator-integration.md` | Reviewed source or documentation terminology | 41, 45, 92, 285, 357, 378, 445 |
| `lib/forge-std/src/StdCheats.sol` | Unused vendored test interface or dependency documentation | 783, 784, 785 |
| `lib/forge-std/src/Vm.sol` | Unused vendored test interface or dependency documentation | 1965, 1968 |
| `lib/forge-std/src/interfaces/IERC1155.sol` | Unused vendored test interface or dependency documentation | 11, 17, 18, 24, 30, 31 |
| `lib/forge-std/src/interfaces/IERC4626.sol` | Unused vendored test interface or dependency documentation | 65, 74, 77, 88, 90, 91, 93, 95, 98, 99, 101, 106, 107, 108, 110, 113, 114, 115, 119, 131 and more |
| `lib/forge-std/src/interfaces/IERC7540.sol` | Unused vendored test interface or dependency documentation | 63, 70, 82, 90, 95 |
| `lib/forge-std/src/interfaces/IERC7575.sol` | Unused vendored test interface or dependency documentation | 83, 92, 97, 110, 111, 112, 115, 118, 121, 122, 124, 129, 130, 132, 135, 138, 139, 140, 145, 160 and more |
| `lib/forge-std/test/StdAssertions.t.sol` | Unused vendored test interface or dependency documentation | 7, 21 |
| `lib/forge-std/test/Vm.t.sol` | Unused vendored test interface or dependency documentation | 11 |
| `native/RETIRED-FILES.json` | Explicit removal statement, inventory or internal accounting terminology | 11, 14, 19, 29, 30, 33 |
| `native/proofs/go.mod` | Explicit removal statement, inventory or internal accounting terminology | 12 |
| `prototype/README.md` | Earlier isolated proof or design evidence | 3 |
| `prototype/native/wind-down-model.js` | Earlier isolated proof or design evidence | 30 |
| `prototype/protocol/go.mod` | Earlier isolated proof or design evidence | 12 |
| `slither-report.txt` | Explicitly historical record | 6, 46, 47, 56 |
