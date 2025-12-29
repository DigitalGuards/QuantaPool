# Infrastructure

Terraform and Ansible automation for deploying QuantaPool validator infrastructure on Hetzner Cloud.

## Structure

```
infrastructure/
├── terraform/          # Infrastructure provisioning
│   ├── modules/        # Reusable Terraform modules
│   └── environments/   # Environment-specific configs (testnet, mainnet)
├── ansible/            # Server configuration
│   ├── playbooks/      # Deployment and maintenance playbooks
│   └── roles/          # Ansible roles (gzond, qrysm, security, monitoring)
├── scripts/            # Operational scripts
│   ├── deploy.sh       # One-command deployment
│   ├── destroy.sh      # Tear down infrastructure
│   ├── failover.sh     # Manual failover trigger
│   └── health-check.sh # Verify node health
└── docs/               # Documentation
    ├── DEPLOYMENT.md   # Step-by-step deployment guide
    ├── ARCHITECTURE.md # Infrastructure architecture
    └── runbooks/       # Operational procedures
```

## Quick Start

```bash
# Set required environment variables
# IMPORTANT: Do not commit your API token to version control.
export HCLOUD_TOKEN="your-hetzner-api-token"

# Deploy testnet infrastructure
cd scripts
./deploy.sh --environment testnet
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed instructions.

## What Gets Deployed

- **Primary validator node** - gzond + qrysm beacon + validator client
- **Backup validator node** - Hot standby for failover
- **Monitoring server** - Prometheus + Grafana + Alertmanager

## Requirements

- Terraform >= 1.5.0
- Ansible >= 2.14
- Hetzner Cloud account with API token
- SSH key pair (Ed25519 recommended)
