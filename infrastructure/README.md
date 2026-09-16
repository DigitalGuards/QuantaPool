# Infrastructure templates

The current executable local qualification uses [the pinned Kurtosis network](../native/network/README.md) and [the native lifecycle harness](../native/lifecycle/README.md). No remote infrastructure is deployed by the native redesign.

The Terraform and Ansible files remain optional provisioning templates. Their monitoring inputs now require an explicit native pool address and chain ID. Their historical node installation, backup and failover paths have not been qualified for a native public launch. Review source pins, signing-key protection, duplicate-validator prevention and network exposure before a separate deployment.

The [native architecture](../docs/architecture.md) defines the protocol's authoritative asset and privilege boundaries. The [monitoring exporter](../monitoring/README.md) is read-only and holds no validator or transaction key. Infrastructure availability cannot authorize a balance report, change a beneficiary or reset expired verification.

Validation of these templates comprises formatting and Terraform configuration validation. It does not establish a provisioned server, working remote validator or accepted withdrawal.
