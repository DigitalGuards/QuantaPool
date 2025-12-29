# Monitoring Stack

Prometheus + Grafana monitoring for QuantaPool validators and smart contracts.

## Components

| Service | Port | Description |
|---------|------|-------------|
| Prometheus | 9090 | Time-series database, scrapes and stores metrics |
| Grafana | 3000 | Dashboards and visualization |
| Alertmanager | 9093 | Alert routing to Discord/Telegram |
| Contract Exporter | 9101 | Custom exporter for on-chain contract metrics |

## What Gets Monitored

**Smart Contracts** (via contract-exporter)
- stQRL exchange rate and total supply
- Deposit pool balance and pending deposits
- Validator count and operator registry state
- Contract events (deposits, withdrawals, oracle updates)

**Validator Node** (remote targets)
- gzond (execution client) - sync status, peers, block height
- qrysm beacon (consensus client) - attestations, sync status
- qrysm validator - duties, missed attestations
- System resources via node_exporter

## Quick Start

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your contract addresses and Discord webhook

# 2. Update prometheus.yml with your validator IP
# Replace VALIDATOR_HOST with your validator server IP

# 3. Start the stack
docker compose up -d

# 4. Access Grafana
open http://localhost:3000
# Login: admin / (password from .env)
```

## Structure

```
monitoring/
├── docker-compose.yml          # Main compose file
├── .env.example                # Configuration template
├── alertmanager/
│   └── alertmanager.yml        # Alert routing rules
├── contract-exporter/          # Custom Prometheus exporter
│   ├── Dockerfile
│   └── src/
│       ├── index.js            # HTTP server + metrics endpoint
│       ├── contracts.js        # Contract ABI + monitoring logic
│       ├── metrics.js          # Prometheus metric definitions
│       └── config.js           # Environment config
├── grafana/
│   ├── dashboards/             # Pre-built dashboards
│   │   ├── contract-state.json
│   │   ├── system-resources.json
│   │   └── validator-overview.json
│   └── provisioning/           # Auto-provisioning config
└── prometheus/
    ├── prometheus.yml          # Scrape configuration
    └── rules/                  # Alert rules
        ├── contract-alerts.yml
        ├── system-alerts.yml
        └── validator-alerts.yml
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin password |
| `STQRL_ADDRESS` | stQRL token contract address |
| `DEPOSIT_POOL_ADDRESS` | Deposit pool contract address |
| `REWARDS_ORACLE_ADDRESS` | Rewards oracle contract address |
| `OPERATOR_REGISTRY_ADDRESS` | Operator registry contract address |
| `DISCORD_WEBHOOK_URL` | Discord webhook for alerts |

### Validator Node Setup

The monitoring stack expects your validator node to expose metrics. Run the setup script from `infrastructure/scripts/`:

```bash
./setup-validator-node.sh
```

Or manually enable metrics:
- gzond: `--metrics --metrics.addr 0.0.0.0 --metrics.port 6060`
- qrysm beacon: `--monitoring-host 0.0.0.0 --monitoring-port 8080`
- qrysm validator: `--monitoring-host 0.0.0.0 --monitoring-port 8081`

## Dashboards

- **Validator Overview** - Attestations, sync status, peer count
- **Contract State** - Exchange rate, TVL, deposit queue
- **System Resources** - CPU, memory, disk, network

## Alerts

Alerts are routed by severity:
- **Critical** - Immediate notification, 1h repeat (validator down, sync stalled)
- **Warning** - 4h repeat (high resource usage, missed attestations)
- **Info** - 12h repeat (informational events)

See `prometheus/rules/` for all alert definitions.
