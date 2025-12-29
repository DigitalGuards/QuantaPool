# QuantaPool Infrastructure Deployment Guide

This guide covers deploying the complete QuantaPool validator infrastructure on Hetzner Cloud.

## Prerequisites

### Software Requirements

- **Terraform** >= 1.5.0
- **Ansible** >= 2.14
- **SSH key pair** (Ed25519 recommended)
- **Hetzner Cloud account** with API token

### Installation

```bash
# Install Terraform (Ubuntu/Debian)
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform

# Install Ansible
pip install ansible

# Generate SSH key (if needed)
ssh-keygen -t ed25519 -C "quantapool"
```

## Quick Start

### One-Command Deployment

```bash
# Set required environment variables
export HCLOUD_TOKEN="your-hetzner-api-token"
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." # Optional

# Deploy testnet infrastructure
cd infrastructure/scripts
./deploy.sh --environment testnet
```

This deploys:
- Primary validator node (gzond + qrysm)
- Backup validator node (hot standby)
- Monitoring server (Prometheus + Grafana)

### Manual Step-by-Step Deployment

#### 1. Configure Terraform

```bash
cd infrastructure/terraform/environments/testnet

# Create terraform.tfvars
cat > terraform.tfvars << EOF
hcloud_token        = "your-hetzner-api-token"
ssh_public_key_path = "~/.ssh/id_ed25519.pub"
discord_webhook_url = ""  # Optional
EOF
```

#### 2. Deploy Infrastructure

```bash
# Initialize
terraform init

# Plan
terraform plan -out=tfplan

# Apply
terraform apply tfplan

# Generate Ansible inventory
terraform output -raw ansible_inventory > ../../ansible/inventory.ini
```

#### 3. Provision Nodes with Ansible

```bash
cd ../../ansible

# Deploy validator nodes
ansible-playbook -i inventory.ini playbooks/deploy-node.yml

# Deploy monitoring
ansible-playbook -i inventory.ini playbooks/deploy-monitoring.yml
```

## Server Specifications

| Node Type | Hetzner Type | vCPU | RAM | Disk | Est. Cost |
|-----------|--------------|------|-----|------|-----------|
| Primary Validator | CPX31/CPX41 | 4-8 | 8-16GB | 160-240GB | €15-80/mo |
| Backup Validator | CPX21/CPX31 | 3-4 | 4-8GB | 80-160GB | €10-30/mo |
| Monitoring | CPX11 | 2 | 2GB | 40GB | €5/mo |

## Network Architecture

```
Internet
    │
    ├── Port 30303 (gzond P2P) ──────┐
    ├── Port 13000 (qrysm TCP) ──────┼──► Primary Node (10.0.0.10)
    ├── Port 12000 (qrysm UDP) ──────┘
    │
    ├── Same ports ──────────────────────► Backup Node (10.0.0.11)
    │
    └── Port 3000 (Grafana) ─────────────► Monitoring (10.0.0.20)

Private Network (10.0.0.0/24)
    │
    ├── :8545 (gzond RPC) ───────────► Internal only
    ├── :3500 (beacon API) ──────────► Internal only
    ├── :9100 (node_exporter) ───────► Monitoring only
    └── :8080 (beacon metrics) ──────► Monitoring only
```

## Post-Deployment Steps

### 1. Generate Validator Keys

```bash
cd key-management
./generate-keys.sh 1  # Generate 1 validator key
```

### 2. Import Keys to Validator

```bash
./import-to-validator.sh /opt/quantapool/validator-keys/batch_TIMESTAMP
```

### 3. Make Beacon Chain Deposit

Deposit 40,000 QRL per validator to the beacon deposit contract.

### 4. Access Monitoring

```bash
# Get Grafana URL
cd infrastructure/terraform/environments/testnet
terraform output grafana_url
```

Default credentials: admin / (set via GRAFANA_ADMIN_PASSWORD)

### 5. Verify Health

```bash
cd infrastructure/scripts
./health-check.sh
```

## Updating Infrastructure

### Update Node Software

```bash
cd infrastructure/ansible
ansible-playbook -i inventory.ini playbooks/update-clients.yml
```

### Scale Up/Down

Modify `terraform.tfvars`:
```hcl
primary_server_type = "cpx41"  # Upgrade to larger instance
enable_backup_node  = true     # Enable/disable backup
```

Then apply:
```bash
terraform apply
```

## Destroying Infrastructure

**WARNING: This is irreversible!**

```bash
cd infrastructure/scripts
./destroy.sh --environment testnet
```

## Troubleshooting

### SSH Connection Issues

```bash
# Test connectivity
ssh -i ~/.ssh/id_ed25519 root@<primary-ip>

# Check SSH key is correct
terraform output ssh_connection_primary
```

### Service Not Starting

```bash
# Check service status
systemctl status gzond
systemctl status qrysm-beacon
systemctl status qrysm-validator

# View logs
journalctl -u gzond -f
journalctl -u qrysm-beacon -f
```

### Sync Issues

```bash
# Check gzond sync status
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' \
  http://localhost:8545

# Check beacon sync status
curl http://localhost:3500/eth/v1/node/syncing
```

## Cost Estimation

| Component | Monthly Cost (EUR) |
|-----------|-------------------|
| Primary (CPX31) | €15.59 |
| Backup (CPX21) | €9.29 |
| Monitoring (CPX11) | €4.15 |
| Storage (200GB) | €9.60 |
| **Total** | **~€38-40** |

*Prices as of 2024. Actual costs may vary.*
