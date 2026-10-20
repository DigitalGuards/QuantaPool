# Retired token contracts

The former `stQRL-v2.hyp`, `DepositPool-v2.hyp` and `ValidatorManager.hyp` contracts and their token-specific tests are removed. The native implementation lives in [native/contracts](../../native/contracts/), with current [architecture](../../docs/architecture.md) and [validation](../../native/IMPLEMENTATION.md).

No token ABI, allowance, exchange-rate conversion or storage migration is required. Previous design details remain in the explicitly [archived architecture](../../docs/legacy/V2-ARCHITECTURE.md). Old on-chain deployments are abandoned and untouched.
