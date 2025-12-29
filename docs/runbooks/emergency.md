# Emergency Procedures Runbook

## Emergency Contact Information

- **QRL Discord**: https://discord.gg/qrl (#zond channel)
- **QuantaPool Team**: [Add contact]
- **Hetzner Support**: https://console.hetzner.cloud

## Quick Reference

| Scenario | Action | Priority |
|----------|--------|----------|
| Validator offline | Failover to backup | CRITICAL |
| Possible slashing | Stop ALL validators | CRITICAL |
| Node out of sync | Wait/resync | HIGH |
| Disk full | Expand storage | HIGH |
| DDoS attack | Enable Hetzner DDoS protection | HIGH |

## Critical Scenarios

### 1. Slashing Detected or Suspected

**Symptoms**:
- Balance dropping significantly
- "Slashing" alerts from monitoring
- Two validators running with same keys

**IMMEDIATE ACTION**:
```bash
# Stop ALL validators IMMEDIATELY
ssh root@<primary-ip> "systemctl stop qrysm-validator; pkill -9 -f qrysm-validator"
ssh root@<backup-ip> "systemctl stop qrysm-validator; pkill -9 -f qrysm-validator"

# Verify both are stopped
ssh root@<primary-ip> "pgrep -f qrysm-validator || echo 'STOPPED'"
ssh root@<backup-ip> "pgrep -f qrysm-validator || echo 'STOPPED'"
```

**DO NOT restart** until you understand what happened.

**Investigation**:
1. Check beacon chain explorer for slashing events
2. Review logs on both nodes
3. Check if both validators were running simultaneously
4. Contact QRL team if needed

### 2. Both Nodes Unresponsive

**Symptoms**:
- Cannot SSH to primary or backup
- Grafana/Prometheus unreachable
- Health checks failing

**Action**:
1. Access Hetzner Cloud Console
2. Check server status in console
3. Use Hetzner rescue mode if needed
4. If servers are running, check network/firewall

```bash
# From Hetzner console, try rescue boot
# Then mount filesystem and check logs
mount /dev/sda1 /mnt
cat /mnt/var/log/syslog | tail -100
```

### 3. Disk Full

**Symptoms**:
- Services crashing
- "No space left on device" errors
- Disk usage >95%

**Immediate Action**:
```bash
# Check disk usage
df -h

# Clean docker (if applicable)
docker system prune -a

# Clean old logs
journalctl --vacuum-time=3d

# Clean old chain data snapshots
rm -rf /var/lib/gzond/ancient/bodies.0001

# Expand Hetzner volume
# (In Hetzner Console, resize volume)
# Then:
growpart /dev/sda 1
resize2fs /dev/sda1
```

### 4. Node Out of Sync

**Symptoms**:
- Sync distance increasing
- Missing attestations
- "beacon_sync_distance > 10" alerts

**Action**:
```bash
# Check sync status
curl -s http://localhost:3500/eth/v1/node/syncing | jq

# Check peers
curl -s http://localhost:3500/eth/v1/node/peer_count | jq

# If peers are low, check firewall
ufw status

# If still not syncing, restart services
systemctl restart qrysm-beacon
systemctl restart gzond

# For severe desync, consider checkpoint sync
# (requires re-deploying beacon node)
```

### 5. Private Key Compromise Suspected

**Symptoms**:
- Unauthorized transactions
- Unknown validators appearing
- Alerts about unexpected key usage

**IMMEDIATE ACTION**:
1. **Stop all validators**
   ```bash
   systemctl stop qrysm-validator
   ```

2. **Secure the infrastructure**
   - Change all SSH keys
   - Rotate Hetzner API token
   - Check for unauthorized access

3. **Initiate voluntary exit** (if keys compromised)
   ```bash
   # Exit validator to protect remaining stake
   qrysm-validator accounts voluntary-exit
   ```

4. **Contact authorities** if theft occurred

### 6. DDoS Attack

**Symptoms**:
- High network traffic
- Services unresponsive
- Hetzner alerts

**Action**:
1. Enable Hetzner DDoS protection (automatic for most attacks)
2. Temporarily restrict SSH access:
   ```bash
   ufw allow from <your-ip> to any port 22
   ufw deny 22
   ```
3. Contact Hetzner support if attack persists

## Recovery Procedures

### Restore from Backup

```bash
# Stop services
systemctl stop qrysm-validator qrysm-beacon gzond

# Restore from backup
cd /opt/quantapool/key-management
./restore-keys.sh /opt/quantapool/backups/latest-backup.tar.gz.gpg

# Restart services
systemctl start gzond
sleep 30
systemctl start qrysm-beacon
# Wait for sync before starting validator
```

### Rebuild Node from Scratch

```bash
# Destroy and redeploy
cd infrastructure/scripts
./destroy.sh --environment testnet
./deploy.sh --environment testnet

# Import keys from backup
./key-management/restore-keys.sh <backup-file>
./key-management/import-to-validator.sh /opt/quantapool/validator-keys
```

## Post-Incident Actions

1. **Document everything**
   - Timeline of events
   - Actions taken
   - Root cause (if known)

2. **Review and improve**
   - What could have prevented this?
   - Do we need better monitoring?
   - Should procedures be updated?

3. **Test failover procedures**
   - Schedule regular failover tests
   - Update runbooks based on learnings

## Emergency Checklist

- [ ] Identify the issue
- [ ] Assess impact (validators at risk?)
- [ ] Take immediate protective action
- [ ] Document what's happening
- [ ] Investigate root cause
- [ ] Implement fix
- [ ] Verify resolution
- [ ] Write post-mortem
