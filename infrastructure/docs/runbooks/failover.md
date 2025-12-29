# Failover Runbook

## Overview

This runbook covers the procedure for failing over validator duties from the primary node to the backup node.

**CRITICAL WARNING**: Running two validators with the same keys results in **SLASHING** and **LOSS OF FUNDS**. Follow this procedure carefully.

## When to Perform Failover

- Primary node is unresponsive for >15 minutes
- Primary node has hardware failure
- Planned maintenance requiring >1 hour downtime
- Primary node software is critically corrupted

## Prerequisites

- SSH access to both primary and backup nodes
- Backup node is synced (gzond and beacon)
- Slashing protection database is accessible

## Automated Failover

### Using the Failover Script

```bash
cd /path/to/QuantaPool/infrastructure/scripts

# Set environment variables
export PRIMARY_HOST="<primary-ip>"
export BACKUP_HOST="<backup-ip>"
export SSH_KEY="~/.ssh/id_ed25519"

# Run failover
./failover.sh
```

The script will:
1. Verify connectivity to both hosts
2. Stop the primary validator (with force if needed)
3. Verify primary is stopped (multiple checks)
4. Transfer slashing protection database
5. Remove lock file on backup
6. Start backup validator
7. Verify backup is running

### Using Ansible

```bash
cd infrastructure/ansible
ansible-playbook -i inventory.ini playbooks/failover.yml
```

## Manual Failover Procedure

If the automated scripts fail, follow this manual procedure:

### Step 1: Stop Primary Validator

```bash
# SSH to primary
ssh root@<primary-ip>

# Stop validator service
systemctl stop qrysm-validator

# Force kill if needed
pkill -9 -f qrysm-validator

# VERIFY it's stopped
systemctl status qrysm-validator
pgrep -f qrysm-validator  # Should return nothing

# Double-check
ps aux | grep qrysm-validator
```

**DO NOT PROCEED** until you're 100% certain the primary validator is stopped.

### Step 2: Backup Slashing Protection

```bash
# On primary (if accessible)
tar -czf /tmp/slashing-protection.tar.gz \
    -C /var/lib/qrysm/validator \
    slashing-protection

# Copy to local machine
scp root@<primary-ip>:/tmp/slashing-protection.tar.gz /tmp/
```

If primary is inaccessible, check for recent backups:
```bash
ls -la /opt/quantapool/backups/slashing-protection-*.tar.gz
```

### Step 3: Transfer to Backup

```bash
# Copy to backup
scp /tmp/slashing-protection.tar.gz root@<backup-ip>:/tmp/

# SSH to backup
ssh root@<backup-ip>

# Extract slashing protection
cd /var/lib/qrysm/validator
mv slashing-protection slashing-protection.old  # Backup existing
tar -xzf /tmp/slashing-protection.tar.gz
chown -R qrysm:qrysm slashing-protection
```

### Step 4: Verify Backup Node Readiness

```bash
# Check beacon is synced
curl -s http://localhost:3500/eth/v1/node/syncing

# Should return: {"data":{"is_syncing":false,"head_slot":"...",..."}}

# Check gzond is synced
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' \
  http://localhost:8545

# Should return: {"jsonrpc":"2.0","id":1,"result":false}
```

### Step 5: Start Backup Validator

```bash
# Remove lock file
rm /etc/quantapool/VALIDATOR_LOCKED

# Start validator
systemctl start qrysm-validator

# Verify it's running
systemctl status qrysm-validator

# Check logs for attestations
journalctl -u qrysm-validator -f
```

### Step 6: Verify Successful Failover

Watch for:
- "Submitted new attestation" messages in logs
- Validator balance not decreasing
- No slashing alerts

```bash
# Check validator metrics
curl -s http://localhost:8081/metrics | grep validator
```

## Post-Failover Actions

1. **Document the incident**
   - Time of primary failure
   - Time of failover completion
   - Any issues encountered

2. **Investigate primary failure**
   - Check logs: `journalctl -u qrysm-validator`
   - Check system resources: `htop`, `df -h`
   - Check network: `ping`, connectivity tests

3. **Repair primary node**
   - Fix underlying issue
   - Update slashing protection from backup
   - Keep validator DISABLED until confirmed

4. **Swap roles**
   - Old primary becomes new backup
   - Create lock file on old primary

## Rollback Procedure

If backup failover fails:

1. **Immediately stop backup validator**
   ```bash
   ssh root@<backup-ip> "systemctl stop qrysm-validator; pkill -9 -f qrysm-validator"
   ```

2. **Attempt to restore primary**
   ```bash
   ssh root@<primary-ip> "systemctl start qrysm-validator"
   ```

3. **Monitor for slashing**
   - Watch beacon chain explorer for your validators
   - Check for slashing events

## Emergency Contacts

- QRL Discord: #zond channel
- QuantaPool Team: [Contact info]

## Checklist

- [ ] Primary validator confirmed stopped
- [ ] Primary process confirmed killed
- [ ] Slashing protection transferred
- [ ] Backup beacon synced
- [ ] Backup gzond synced
- [ ] Lock file removed on backup
- [ ] Backup validator started
- [ ] Attestations being submitted
- [ ] Alerts cleared
- [ ] Incident documented
