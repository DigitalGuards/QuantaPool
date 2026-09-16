# Retirement of the v2 testnet experiments

Decision recorded on 2026-09-15 from the project owner's clarification: the earlier QuantaPool contracts were public-testnet experiments, unavailable for normal use because of public-testnet limitations. They are abandoned as targets for the native-QRL redesign.

## Clean native deployment

The new protocol starts with newly deployed contracts and fresh accounting state. It has no dependency on old testnet balances, rewards, validators, addresses, ownership settings, storage layouts or receipt-token APIs. Legacy recovery and migration are removed from the development and launch prerequisites. No claim in the native pool can be created by importing a historical stQRL balance.

There will be no compatibility wrapper, token redemption adapter, inherited proxy layout, old-address alias, or automatic transfer of historical stake. Existing native prototype contracts already use their own storage and constructor-bound protocol/verifier/account references. Generic wallet and source-validation helpers may be reused without carrying old economic state.

The 10% operator fee remains a requirement for the new native reward model. Abandoning the testnet experiments does not remove authenticated accounting, loss allocation, deterministic withdrawal ordering, correct fee classification or native exit requirements.

## Historical material

The v2 source, token-oriented tests, deployment scripts, frontend and monitoring remain historical implementation material pending coordinated replacement. They impose no backwards-compatibility promise. Ordinary package build/test/deploy commands still target those old sources and must not be presented as native-pool qualification or deployment commands.

The previous [README](legacy/V2-README.md) and [architecture](legacy/V2-ARCHITECTURE.md) are archived with their historical context. [Testnet deployment observations](V2-DEPLOYMENT-STATUS.md) retain addresses and earlier results for reference. Their older recovery requirements are superseded for the native redesign.

This retirement decision does not query, erase, transfer, recover or modify existing network state. It does not assert that old addresses have zero balances. Any optional historical cleanup is separate work and is unnecessary for the new deployment. Upstream QRL implementations, network semantics and remote services remain outside this change.

## Current development references

- [Native architecture](architecture.md)
- [Selected defaults and remaining trust assumptions](../prototype/native/DECISIONS.md)
- [Implemented components and recorded validation](../prototype/native/VALIDATION.md)

The next implementation target is the integrated native ledger and its application interface. Missing authentication or accounting guarantees remain technical work; legacy testnet availability is no longer a dependency.
