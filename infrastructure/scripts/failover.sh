#!/bin/bash
# QuantaPool Validator Failover Script
#
# This script performs a safe failover from primary to backup validator.
# CRITICAL: Running two validators with the same keys = SLASHING
#
# Usage: ./failover.sh [--force] [--no-confirm]
#
# Options:
#   --force     Skip some safety checks (DANGEROUS)
#   --no-confirm Skip manual confirmation (for automation)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (update these or load from environment)
PRIMARY_HOST="${PRIMARY_HOST:-}"
BACKUP_HOST="${BACKUP_HOST:-}"
SSH_USER="${SSH_USER:-root}"
SSH_KEY="${SSH_KEY:-~/.ssh/id_ed25519}"
LOCK_FILE="/etc/quantapool/VALIDATOR_LOCKED"
SLASHING_DB="/var/lib/qrysm/validator/slashing-protection"

# Parse arguments
FORCE=false
NO_CONFIRM=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --force) FORCE=true; shift ;;
        --no-confirm) NO_CONFIRM=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

ssh_cmd() {
    local host=$1
    shift
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${SSH_USER}@${host}" "$@"
}

# Check configuration
check_config() {
    if [[ -z "$PRIMARY_HOST" ]] || [[ -z "$BACKUP_HOST" ]]; then
        error "PRIMARY_HOST and BACKUP_HOST must be set"
    fi
}

# Display warning banner
display_warning() {
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                    ⚠️  FAILOVER WARNING ⚠️                      ║${NC}"
    echo -e "${RED}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║                                                               ║${NC}"
    echo -e "${RED}║  This script will transfer validator duties:                  ║${NC}"
    echo -e "${RED}║    FROM: ${PRIMARY_HOST}${NC}"
    echo -e "${RED}║    TO:   ${BACKUP_HOST}${NC}"
    echo -e "${RED}║                                                               ║${NC}"
    echo -e "${RED}║  RUNNING TWO VALIDATORS = SLASHING = LOSS OF FUNDS           ║${NC}"
    echo -e "${RED}║                                                               ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Get confirmation
get_confirmation() {
    if [[ "$NO_CONFIRM" == "true" ]]; then
        warn "Skipping confirmation (--no-confirm flag)"
        return 0
    fi

    read -p "Type 'FAILOVER' to confirm: " confirm
    if [[ "$confirm" != "FAILOVER" ]]; then
        error "Failover cancelled"
    fi
}

# Step 1: Verify connectivity
verify_connectivity() {
    log "Verifying connectivity to both hosts..."

    if ! ssh_cmd "$PRIMARY_HOST" "echo 'Primary OK'" 2>/dev/null; then
        warn "Cannot connect to primary host - may already be down"
        if [[ "$FORCE" != "true" ]]; then
            error "Use --force to continue without primary connectivity"
        fi
    fi

    if ! ssh_cmd "$BACKUP_HOST" "echo 'Backup OK'" 2>/dev/null; then
        error "Cannot connect to backup host - failover impossible"
    fi

    log "Connectivity verified"
}

# Step 2: Stop primary validator
stop_primary() {
    log "Stopping primary validator..."

    # Try to stop gracefully
    if ssh_cmd "$PRIMARY_HOST" "sudo systemctl stop qrysm-validator" 2>/dev/null; then
        log "Primary validator service stopped"
    else
        warn "Could not stop primary via systemctl"
    fi

    # Force kill any remaining processes
    ssh_cmd "$PRIMARY_HOST" "sudo pkill -9 -f qrysm-validator || true" 2>/dev/null || true

    sleep 5

    # Verify stopped
    log "Verifying primary validator is stopped..."
    for i in {1..5}; do
        if ssh_cmd "$PRIMARY_HOST" "pgrep -f qrysm-validator" 2>/dev/null; then
            warn "Validator still running, attempt $i/5"
            ssh_cmd "$PRIMARY_HOST" "sudo pkill -9 -f qrysm-validator" 2>/dev/null || true
            sleep 3
        else
            log "Primary validator confirmed stopped"
            return 0
        fi
    done

    if [[ "$FORCE" != "true" ]]; then
        error "Could not verify primary is stopped. Use --force to continue (DANGEROUS)"
    fi
    warn "Continuing despite primary state uncertainty (--force mode)"
}

# Step 3: Backup and transfer slashing protection
transfer_slashing_protection() {
    log "Backing up slashing protection database..."

    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="/tmp/slashing-protection-$timestamp.tar.gz"

    # Create backup on primary
    if ssh_cmd "$PRIMARY_HOST" "sudo tar -czf $backup_file -C $(dirname $SLASHING_DB) $(basename $SLASHING_DB)" 2>/dev/null; then
        log "Slashing protection backed up on primary"

        # Transfer to local, then to backup
        scp -i "$SSH_KEY" "${SSH_USER}@${PRIMARY_HOST}:$backup_file" /tmp/ 2>/dev/null
        scp -i "$SSH_KEY" /tmp/$(basename $backup_file) "${SSH_USER}@${BACKUP_HOST}:/tmp/" 2>/dev/null

        # Extract on backup
        ssh_cmd "$BACKUP_HOST" "sudo tar -xzf /tmp/$(basename $backup_file) -C $(dirname $SLASHING_DB)"
        ssh_cmd "$BACKUP_HOST" "sudo chown -R qrysm:qrysm $SLASHING_DB"

        log "Slashing protection transferred to backup"
    else
        warn "Could not backup slashing protection from primary"
        if [[ "$FORCE" != "true" ]]; then
            error "Use --force to continue without slashing protection transfer (RISKY)"
        fi
    fi
}

# Step 4: Start backup validator
start_backup() {
    log "Starting backup validator..."

    # Ensure beacon is running
    ssh_cmd "$BACKUP_HOST" "sudo systemctl start qrysm-beacon" 2>/dev/null || true

    log "Waiting for beacon to sync..."
    for i in {1..30}; do
        if ssh_cmd "$BACKUP_HOST" "curl -s http://127.0.0.1:3500/eth/v1/node/health" 2>/dev/null | grep -q "200\|206"; then
            log "Beacon node healthy"
            break
        fi
        sleep 10
    done

    # Remove lock file
    log "Removing validator lock file..."
    ssh_cmd "$BACKUP_HOST" "sudo rm -f $LOCK_FILE"

    # Start validator
    log "Starting validator service..."
    ssh_cmd "$BACKUP_HOST" "sudo systemctl start qrysm-validator"
    ssh_cmd "$BACKUP_HOST" "sudo systemctl enable qrysm-validator"

    sleep 10

    # Verify started
    if ssh_cmd "$BACKUP_HOST" "systemctl is-active qrysm-validator" 2>/dev/null | grep -q "active"; then
        log "Backup validator started successfully"
    else
        error "Failed to start backup validator"
    fi
}

# Step 5: Final verification
final_verify() {
    log "Performing final verification..."

    # Check primary is still stopped
    if ssh_cmd "$PRIMARY_HOST" "pgrep -f qrysm-validator" 2>/dev/null; then
        error "CRITICAL: Primary validator is running! Manual intervention required!"
    fi

    # Check backup is running
    if ! ssh_cmd "$BACKUP_HOST" "systemctl is-active qrysm-validator" 2>/dev/null | grep -q "active"; then
        error "Backup validator is not running!"
    fi

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                   FAILOVER COMPLETE ✓                         ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Primary validator: STOPPED                                   ║${NC}"
    echo -e "${GREEN}║  Backup validator:  RUNNING                                   ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Monitor the backup node for successful attestations         ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Main execution
main() {
    check_config
    display_warning
    get_confirmation
    verify_connectivity
    stop_primary
    transfer_slashing_protection
    start_backup
    final_verify
}

main "$@"
