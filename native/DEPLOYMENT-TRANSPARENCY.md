# Deployment transparency

This document defines the information QuantaPool should publish for every public native-QRL contract graph. It is a technical disclosure template, not a legal classification.

The goal is simple: a user, reviewer or regulator should be able to verify which code is deployed, which powers exist, which powers do not exist and which operator responsibilities remain.

## Deployment manifest

Complete this table for each public deployment before accepting public funds.

| Field | Published value |
| --- | --- |
| Network | `<network>` |
| Pool | `<address>` |
| Validator gate | `<address>` |
| Portfolio verifier | `<address>` |
| Finality verifier | `<address>` |
| Canonical deposit contract | `<address>` |
| Validator operator | `<address>` |
| Fee recipient | `<address>` |
| Source commit | `<git commit>` |
| Compiler identity | `<compiler version and source revision>` |
| Pool runtime SHA-256 | `<sha256>` |
| Validator gate runtime SHA-256 | `<sha256>` |
| Deployment transaction or block | `<reference>` |
| Initial trusted checkpoint | `<slot/root/reference>` |

The deployment manifest should be published in the repository and linked from the web application.

## Fixed control model

For the current native design, deployment is intended to establish all of the following properties:

- no owner role
- no upgrade role
- no proxy admin
- no pauser
- no arbitrary fund rescue
- no balance setter
- no mutable fee role
- fixed 10% fee logic for eligible realized net consensus gains
- immutable fee recipient
- immutable pool, gate, portfolio and finality bindings
- validator consensus withdrawals bound to the pool
- canonical deposit runtime pinned by address and code hash
- no transferable staking receipt token

A future QuantaPool version should use a separate deployment. Existing deployed pool code should not change in place.

## What the operator can still do

Immutability does not remove every trust assumption. The validator operator still controls validator signing infrastructure and therefore can affect validator availability, penalties and execution-tip routing. The operator also prepares new validator keys using its own bootstrap capital.

Those operational powers should be disclosed separately from contract administration. They do not create an owner or upgrade path in the current native contract graph.

## User fund paths

The public disclosure should state the permitted native-QRL paths in plain language:

1. users deposit QRL into the pool contract
2. pooled validator funding is released only through the bound validator gate
3. validator withdrawal credentials point back to the pool
4. user claims pay the recorded position beneficiary
5. the fee recipient can receive only earned fee reserves
6. permanent recovery pays available and later returned cash according to frozen positions

Any production deployment should be checked against these statements before the frontend is configured to use it.

## Verification checklist

For each deployment, reviewers should verify the following against deployed bytecode and the published source commit:

- runtime bytecode matches the published build artifact
- no proxy or implementation slot is used to replace pool logic
- no callable owner, admin, upgrade, pause, rescue or balance-setting path exists
- immutable constructor bindings match the published addresses
- fee logic and fee recipient match the manifest
- validator deposits encode the pool as withdrawal recipient
- the canonical deposit contract address and runtime hash match the qualified network value
- the frontend is configured for the same pool address and network
- the source, compiler and artifact fingerprints are reproducible from the published build inputs

The repository security review and implementation report provide the current pre-launch evidence. A deployment-specific manifest should reference those documents and add the final on-chain addresses and bytecode hashes.
