# QuantaPool Infrastructure Architecture

## Overview

The QuantaPool infrastructure provides automated deployment and management of QRL validators with enterprise-grade reliability.

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         QUANTAPOOL INFRASTRUCTURE                           │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────┐     ┌──────────────────────┐                     │
│  │   PRIMARY VALIDATOR  │     │   BACKUP VALIDATOR   │                     │
│  │   ┌──────────────┐   │     │   ┌──────────────┐   │                     │
│  │   │    gqrl     │   │     │   │    gqrl     │   │                     │
│  │   │ (Execution)  │   │     │   │ (Execution)  │   │                     │
│  │   └──────┬───────┘   │     │   └──────┬───────┘   │                     │
│  │          │ JWT       │     │          │ JWT       │                     │
│  │   ┌──────┴───────┐   │     │   ┌──────┴───────┐   │                     │
│  │   │ qrysm-beacon │◄──┼─────┼───│ qrysm-beacon │   │                     │
│  │   │ (Consensus)  │   │ P2P │   │ (Consensus)  │   │                     │
│  │   └──────┬───────┘   │     │   └──────────────┘   │                     │
│  │          │           │     │                      │                     │
│  │   ┌──────┴───────┐   │     │   ┌──────────────┐   │                     │
│  │   │qrysm-validator│  │     │   │  VALIDATOR   │   │                     │
│  │   │  (ACTIVE)     │  │     │   │  (DISABLED)  │   │                     │
│  │   └──────────────┘   │     │   └──────────────┘   │                     │
│  └──────────────────────┘     └──────────────────────┘                     │
│           │                              │                                  │
│           │         metrics              │         metrics                  │
│           └──────────────┬───────────────┘                                  │
│                          ▼                                                  │
│                 ┌────────────────────┐                                      │
│                 │  MONITORING SERVER │                                      │
│                 │  ┌──────────────┐  │                                      │
│                 │  │  Prometheus  │  │                                      │
│                 │  │  Grafana     │  │                                      │
│                 │  │  Alertmanager│  │                                      │
│                 │  │  Contract    │  │                                      │
│                 │  │  Exporter    │  │                                      │
│                 │  └──────────────┘  │                                      │
│                 └────────────────────┘                                      │
│                          │                                                  │
│                          ▼  alerts                                          │
│                 Discord / Telegram                                          │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Execution Client (gqrl)

- **Purpose**: Processes transactions, maintains execution state
- **Source**: https://github.com/theQRL/go-qrl
- **Ports**:
  - 30303 (P2P)
  - 8545 (JSON-RPC, internal)
  - 8551 (Auth RPC for beacon)
  - 6060 (Metrics)

### Consensus Client (qrysm-beacon)

- **Purpose**: Tracks beacon chain, proposes/attests blocks
- **Source**: https://github.com/theQRL/qrysm
- **Ports**:
  - 13000 (P2P TCP)
  - 12000 (P2P UDP)
  - 3500 (REST API, internal)
  - 4000 (gRPC)
  - 8080 (Metrics)

### Validator Client (qrysm-validator)

- **Purpose**: Signs attestations and block proposals
- **CRITICAL**: Only ONE instance per key set
- **Ports**:
  - 7500 (gRPC)
  - 8081 (Metrics)

## Security Architecture

### Network Security

```
┌─────────────────────────────────────────────┐
│              FIREWALL RULES                  │
├─────────────────────────────────────────────┤
│  ALLOW IN:                                   │
│  • 22/tcp (SSH) - Trusted IPs only*         │
│  • 30303/tcp+udp (gqrl P2P) - All          │
│  • 13000/tcp (beacon P2P) - All             │
│  • 12000/udp (beacon P2P) - All             │
│  • 3000/tcp (Grafana) - Trusted IPs only*   │
│                                              │
│  *Configure via allowed_ssh_ips and         │
│   allowed_grafana_ips Terraform variables   │
│                                              │
│  DENY IN:                                    │
│  • 8545, 8551 (RPC) - External              │
│  • 3500, 4000 (Beacon API) - External       │
│  • 9090 (Prometheus) - External             │
│  • All other ports                           │
├─────────────────────────────────────────────┤
│  ALLOW OUT: All                              │
└─────────────────────────────────────────────┘
```

### Key Security

- Validator keys encrypted at rest (AES-256)
- Slashing protection database backed up
- JWT secret for execution-consensus auth
- SSH key-only authentication
- Automatic security updates

## Failover Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     FAILOVER PROCESS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NORMAL OPERATION:                                               │
│  ┌─────────────┐              ┌─────────────┐                   │
│  │   PRIMARY   │              │   BACKUP    │                   │
│  │  Validator  │              │  (STANDBY)  │                   │
│  │   ACTIVE    │◄────sync────►│  VALIDATOR  │                   │
│  │             │              │   DISABLED  │                   │
│  └─────────────┘              └─────────────┘                   │
│                                                                  │
│  ON PRIMARY FAILURE:                                             │
│  1. Detect failure (health checks)                               │
│  2. STOP primary validator (force if needed)                     │
│  3. VERIFY primary is stopped (multiple checks)                  │
│  4. Transfer slashing protection DB                              │
│  5. Remove lock file on backup                                   │
│  6. START backup validator                                       │
│  7. Alert operator                                               │
│                                                                  │
│  CRITICAL: Never run two validators with same keys!              │
│            This causes SLASHING and LOSS OF FUNDS                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Staking Flow

```
User Deposit → DepositPool → 40,000 QRL accumulated →
Validator Created → Beacon Deposit → Validator Active
```

### Rewards Flow

```
Validator Earnings → Oracle Reports Balance →
RewardsOracle Updates stQRL → Exchange Rate Increases
```

## Monitoring Architecture

### Metrics Collection

| Source | Port | Scrape Interval |
|--------|------|-----------------|
| Node Exporter | 9100 | 15s |
| gqrl | 6060 | 15s |
| Beacon Node | 8080 | 15s |
| Validator | 8081 | 15s |
| Contract Exporter | 9101 | 30s |

### Alert Routing

```
Prometheus Alert → Alertmanager → Discord/Telegram
                                → PagerDuty (critical)
```

## Infrastructure as Code

### Terraform Modules

```
terraform/
├── modules/
│   ├── validator-node/     # Primary/backup validator
│   ├── backup-node/        # Hot standby configuration
│   ├── monitoring-server/  # Prometheus + Grafana
│   └── networking/         # VPC, subnets, firewall
└── environments/
    ├── testnet/
    └── mainnet/
```

### Ansible Roles

```
ansible/roles/
├── gqrl/           # Execution client
├── qrysm-beacon/    # Consensus client
├── qrysm-validator/ # Validator client
├── monitoring/      # Monitoring stack
└── security/        # Hardening
```

## Capacity Planning

### Storage Requirements

| Data | Growth Rate | Initial | 1 Year |
|------|-------------|---------|--------|
| gqrl Chain Data | ~5GB/month | 50GB | 110GB |
| Beacon Chain Data | ~3GB/month | 30GB | 66GB |
| Prometheus TSDB | ~2GB/month | 10GB | 34GB |

### Memory Usage

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| gqrl | 4GB | 8GB |
| qrysm-beacon | 2GB | 4GB |
| qrysm-validator | 1GB | 2GB |
| Monitoring Stack | 2GB | 4GB |
