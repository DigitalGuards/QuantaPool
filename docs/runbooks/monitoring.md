# Monitoring Runbook

## Overview

This guide covers understanding and operating the QuantaPool monitoring stack.

## Accessing Dashboards

### Grafana

```
URL: http://<monitoring-ip>:3000
Default user: admin
Password: (set in deployment)
```

### Prometheus (Internal Only)

```
URL: http://<monitoring-ip>:9090 (from private network)
```

## Key Dashboards

### 1. Contract State Dashboard

Shows:
- Total Value Locked (TVL)
- stQRL exchange rate
- Pending deposits/withdrawals
- Validator queue status

**Key metrics**:
- `quantapool_deposit_pool_total_deposits` - Total deposited QRL
- `quantapool_stqrl_total_supply` - stQRL tokens in circulation
- `quantapool_stqrl_exchange_rate` - Current stQRL:QRL ratio

### 2. Validator Dashboard

Shows:
- Validator status (active/pending/exited)
- Attestation performance
- Proposed blocks
- Sync status

**Key metrics**:
- `validator_statuses` - Count by status
- `beacon_head_slot` - Current slot
- `beacon_participation_rate` - Network participation
- `validator_balance_total` - Total validator balance

### 3. System Dashboard

Shows:
- CPU/Memory/Disk usage
- Network traffic
- Service status

## Understanding Alerts

### Critical Alerts (Immediate Action Required)

| Alert | Meaning | Action |
|-------|---------|--------|
| ValidatorOffline | Validator not attesting | Check validator service, consider failover |
| DepositPoolPaused | Deposits halted | Check contract state, contact team |
| BeaconChainDown | Consensus client crashed | Restart qrysm-beacon |
| DiskSpaceCritical | >90% disk usage | Expand storage immediately |

### Warning Alerts (Investigate Soon)

| Alert | Meaning | Action |
|-------|---------|--------|
| MissedAttestation | Missed >2 attestations | Check validator logs |
| BeaconChainNotSynced | Sync lag >30 min | Check peers, network |
| GzondLowPeers | <3 execution peers | Check firewall |
| OracleReportStale | No oracle report 48h | Check oracle service |

### Info Alerts (Awareness)

| Alert | Meaning | Action |
|-------|---------|--------|
| ValidatorThresholdApproaching | Near 40k deposit | Prepare validator creation |
| HighCPUUsage | >80% CPU | Monitor, consider upgrade |

## Silencing Alerts

For planned maintenance:

```bash
# Access Alertmanager
http://<monitoring-ip>:9093

# Or via CLI
amtool silence add alertname="ValidatorOffline" comment="Planned maintenance" duration=2h
```

## Checking Metrics Manually

### Node Metrics

```bash
# Check node_exporter
curl -s http://<validator-ip>:9100/metrics | grep node_

# Check gzond metrics
curl -s http://<validator-ip>:6060/debug/metrics/prometheus

# Check beacon metrics
curl -s http://<validator-ip>:8080/metrics

# Check validator metrics
curl -s http://<validator-ip>:8081/metrics
```

### Contract Metrics

```bash
# Check contract exporter
curl -s http://<monitoring-ip>:9101/metrics | grep quantapool
```

## Log Analysis

### View Service Logs

```bash
# gzond logs
journalctl -u gzond -f --since "1 hour ago"

# Beacon logs
journalctl -u qrysm-beacon -f

# Validator logs
journalctl -u qrysm-validator -f

# Filter for errors
journalctl -u qrysm-validator --since "1 hour ago" | grep -i error
```

### Common Log Patterns

**Good Signs**:
```
Submitted new attestation
Successfully proposed block
Peer connected
```

**Warning Signs**:
```
Failed to submit attestation
Syncing behind head
Low peer count
```

**Critical Signs**:
```
Slashing detected
Database corruption
Out of memory
```

## Prometheus Queries

### Useful PromQL Queries

```promql
# Validator balance over time
validator_balance_total

# Attestation hit rate (last 24h)
sum(increase(validator_attestation_hits[24h])) /
sum(increase(validator_attestation_total[24h]))

# Sync lag
beacon_head_slot - beacon_finalized_slot

# Disk usage trend
predict_linear(node_filesystem_avail_bytes[1h], 24*3600)

# RPC error rate
rate(quantapool_rpc_errors_total[5m])
```

## Troubleshooting Monitoring

### Grafana Not Loading

```bash
# Check container status
docker ps | grep grafana

# Check logs
docker logs grafana

# Restart if needed
docker restart grafana
```

### Metrics Missing

```bash
# Check Prometheus targets
curl -s http://localhost:9090/api/v1/targets | jq

# Look for targets with state != "up"
```

### High Cardinality Issues

If Prometheus is slow:
```bash
# Check metric cardinality
curl -s http://localhost:9090/api/v1/status/tsdb | jq

# Prune old data if needed
docker exec prometheus promtool tsdb analyze /prometheus
```

## Backup and Restore

### Backup Grafana Dashboards

```bash
# Export dashboards via API
for dashboard in $(curl -s "http://admin:password@localhost:3000/api/search" | jq -r '.[].uid'); do
    curl -s "http://admin:password@localhost:3000/api/dashboards/uid/$dashboard" > "dashboard_$dashboard.json"
done
```

### Backup Prometheus Data

```bash
# Create snapshot
curl -X POST http://localhost:9090/api/v1/admin/tsdb/snapshot

# Copy snapshot
docker cp prometheus:/prometheus/snapshots/<id> /backup/
```
