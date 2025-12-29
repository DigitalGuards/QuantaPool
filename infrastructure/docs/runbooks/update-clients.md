# Client Update Runbook

## Overview

This guide covers updating gzond and qrysm clients to new versions.

## Pre-Update Checklist

- [ ] Check release notes for breaking changes
- [ ] Verify current node is healthy
- [ ] Create backup of slashing protection
- [ ] Have rollback plan ready
- [ ] Schedule during low-activity period

## Update Methods

### Method 1: Automated Update (Recommended)

```bash
cd infrastructure/ansible

# Update all validators (one at a time)
ansible-playbook -i inventory.ini playbooks/update-clients.yml
```

This playbook:
1. Backs up slashing protection
2. Stops services gracefully
3. Pulls latest source code
4. Rebuilds binaries
5. Restarts services
6. Verifies health

### Method 2: Manual Update

#### Step 1: Backup Slashing Protection

```bash
ssh root@<validator-ip>

# Run backup script
/usr/local/bin/backup-slashing-protection

# Or manually
tar -czf /opt/quantapool/backups/slashing-pre-update-$(date +%Y%m%d).tar.gz \
    -C /var/lib/qrysm/validator \
    slashing-protection
```

#### Step 2: Stop Services

```bash
# Stop in reverse order
systemctl stop qrysm-validator
systemctl stop qrysm-beacon
systemctl stop gzond
```

#### Step 3: Update gzond

```bash
cd /opt/quantapool/gzond/source

# Pull latest
git fetch --all
git checkout main  # Or specific tag
git pull

# Build
make gzond

# Install
cp build/bin/gzond /usr/local/bin/

# Verify version
gzond version
```

#### Step 4: Update qrysm

```bash
cd /opt/quantapool/qrysm/source

# Pull latest
git fetch --all
git checkout main  # Or specific tag
git pull

# Build beacon
go build -o /usr/local/bin/qrysm-beacon ./cmd/beacon-chain

# Build validator
go build -o /usr/local/bin/qrysm-validator ./cmd/validator

# Verify versions
qrysm-beacon --version
qrysm-validator --version
```

#### Step 5: Start Services

```bash
# Start in order
systemctl start gzond

# Wait for gzond to sync
sleep 30

systemctl start qrysm-beacon

# Wait for beacon to sync
sleep 60

systemctl start qrysm-validator
```

#### Step 6: Verify Health

```bash
# Check services
systemctl status gzond qrysm-beacon qrysm-validator

# Check sync status
curl -s http://localhost:3500/eth/v1/node/syncing | jq

# Check attestations
journalctl -u qrysm-validator --since "5 minutes ago" | grep attestation
```

## Rolling Updates

For zero-downtime updates across primary and backup:

1. **Update backup first**
   ```bash
   ansible-playbook -i inventory.ini playbooks/update-clients.yml --limit backup
   ```

2. **Verify backup is healthy**
   ```bash
   ./scripts/health-check.sh
   ```

3. **Failover to backup**
   ```bash
   ./scripts/failover.sh
   ```

4. **Update old primary (now backup)**
   ```bash
   ansible-playbook -i inventory.ini playbooks/update-clients.yml --limit primary
   ```

5. **(Optional) Failback to original primary**

## Rollback Procedure

If update causes issues:

### Quick Rollback (Previous Binary)

```bash
# If you kept old binaries
cp /usr/local/bin/gzond.old /usr/local/bin/gzond
cp /usr/local/bin/qrysm-beacon.old /usr/local/bin/qrysm-beacon
cp /usr/local/bin/qrysm-validator.old /usr/local/bin/qrysm-validator

systemctl restart gzond qrysm-beacon qrysm-validator
```

### Full Rollback (Rebuild Old Version)

```bash
cd /opt/quantapool/gzond/source
git checkout <previous-tag>
make gzond
cp build/bin/gzond /usr/local/bin/

cd /opt/quantapool/qrysm/source
git checkout <previous-tag>
go build -o /usr/local/bin/qrysm-beacon ./cmd/beacon-chain
go build -o /usr/local/bin/qrysm-validator ./cmd/validator

systemctl restart gzond qrysm-beacon qrysm-validator
```

## Version Compatibility

Ensure execution and consensus clients are compatible:

| gzond Version | qrysm Version | Notes |
|---------------|---------------|-------|
| main (latest) | main (latest) | Recommended for testnet |
| v1.x.x | v4.x.x | Check release notes |

## Post-Update Verification

- [ ] All services running
- [ ] gzond synced and processing blocks
- [ ] Beacon node synced
- [ ] Validator submitting attestations
- [ ] No errors in logs
- [ ] Metrics being collected
- [ ] Alerts cleared

## Troubleshooting

### Service Won't Start After Update

```bash
# Check for config changes
journalctl -u qrysm-beacon --since "10 minutes ago" | head -50

# Common issues:
# - New required flags
# - Deprecated flags removed
# - Database format change
```

### Database Migration Issues

```bash
# If database format changed, may need clean start
# WARNING: This resyncs from genesis - takes time

# Backup first
mv /var/lib/qrysm/beacon /var/lib/qrysm/beacon.old

# Restart beacon (will resync)
systemctl start qrysm-beacon
```

### Performance Degradation

```bash
# Check resource usage
htop

# Check for known issues in release notes
# May need to adjust cache settings in config
```
