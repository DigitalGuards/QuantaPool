#!/bin/bash
# QuantaPool Comprehensive Key Backup
#
# Creates encrypted backup of all validator keys, wallet, and slashing protection.
#
# Usage: ./backup-keys.sh [--remote <destination>]
#
# Options:
#   --remote    rsync destination for off-site backup (e.g., user@host:/path)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
VALIDATOR_KEYS_DIR="${VALIDATOR_KEYS_DIR:-/opt/quantapool/validator-keys}"
VALIDATOR_WALLET_DIR="${VALIDATOR_WALLET_DIR:-/var/lib/qrysm/validator/wallet}"
SLASHING_DB_DIR="${SLASHING_DB_DIR:-/var/lib/qrysm/validator/slashing-protection}"
BACKUP_DIR="${BACKUP_DIR:-/opt/quantapool/backups}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-/etc/quantapool/backup-passphrase}"

REMOTE_DEST=""

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

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --remote)
            REMOTE_DEST="$2"
            shift 2
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_SUBDIR="$BACKUP_DIR/backup_$TIMESTAMP"

log "Starting comprehensive key backup..."
log "Timestamp: $TIMESTAMP"

# Create backup directory
mkdir -p "$BACKUP_SUBDIR"
chmod 700 "$BACKUP_SUBDIR"

# Check for passphrase file
if [[ ! -f "$PASSPHRASE_FILE" ]]; then
    warn "No passphrase file found at $PASSPHRASE_FILE"
    echo "Creating new passphrase file..."
    mkdir -p "$(dirname "$PASSPHRASE_FILE")"
    head -c 32 /dev/urandom | base64 > "$PASSPHRASE_FILE"
    chmod 600 "$PASSPHRASE_FILE"
    log "Generated new backup passphrase"
    echo -e "${YELLOW}SAVE THIS PASSPHRASE SECURELY: $(cat "$PASSPHRASE_FILE")${NC}"
fi

# Backup validator keys
if [[ -d "$VALIDATOR_KEYS_DIR" ]]; then
    log "Backing up validator keys..."
    tar -czf "$BACKUP_SUBDIR/validator-keys.tar.gz" \
        -C "$(dirname "$VALIDATOR_KEYS_DIR")" \
        "$(basename "$VALIDATOR_KEYS_DIR")"
else
    warn "Validator keys directory not found: $VALIDATOR_KEYS_DIR"
fi

# Backup wallet
if [[ -d "$VALIDATOR_WALLET_DIR" ]]; then
    log "Backing up validator wallet..."
    tar -czf "$BACKUP_SUBDIR/validator-wallet.tar.gz" \
        -C "$(dirname "$VALIDATOR_WALLET_DIR")" \
        "$(basename "$VALIDATOR_WALLET_DIR")"
else
    warn "Validator wallet not found: $VALIDATOR_WALLET_DIR"
fi

# Backup slashing protection (CRITICAL!)
if [[ -d "$SLASHING_DB_DIR" ]]; then
    log "Backing up slashing protection database..."
    tar -czf "$BACKUP_SUBDIR/slashing-protection.tar.gz" \
        -C "$(dirname "$SLASHING_DB_DIR")" \
        "$(basename "$SLASHING_DB_DIR")"
else
    warn "Slashing protection DB not found: $SLASHING_DB_DIR"
fi

# Create manifest
cat > "$BACKUP_SUBDIR/manifest.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "hostname": "$(hostname)",
  "contents": {
    "validator-keys": $([ -f "$BACKUP_SUBDIR/validator-keys.tar.gz" ] && echo "true" || echo "false"),
    "validator-wallet": $([ -f "$BACKUP_SUBDIR/validator-wallet.tar.gz" ] && echo "true" || echo "false"),
    "slashing-protection": $([ -f "$BACKUP_SUBDIR/slashing-protection.tar.gz" ] && echo "true" || echo "false")
  }
}
EOF

# Create single encrypted archive
log "Creating encrypted backup archive..."
FINAL_ARCHIVE="$BACKUP_DIR/quantapool-backup-$TIMESTAMP.tar.gz.gpg"

tar -czf - -C "$BACKUP_SUBDIR" . | \
    gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" \
        --symmetric --cipher-algo AES256 \
        --output "$FINAL_ARCHIVE"

# Clean up unencrypted backup
rm -rf "$BACKUP_SUBDIR"

# Set permissions
chmod 600 "$FINAL_ARCHIVE"

log "Backup created: $FINAL_ARCHIVE"

# Remote backup if configured
if [[ -n "$REMOTE_DEST" ]]; then
    log "Syncing to remote destination: $REMOTE_DEST"
    rsync -avz --progress "$FINAL_ARCHIVE" "$REMOTE_DEST/"
    log "Remote sync complete"
fi

# Cleanup old backups (keep last 10)
log "Cleaning old backups..."
ls -t "$BACKUP_DIR"/quantapool-backup-*.tar.gz.gpg 2>/dev/null | tail -n +11 | xargs -r rm

echo ""
log "Backup complete!"
echo ""
echo -e "${GREEN}Backup file: $FINAL_ARCHIVE${NC}"
echo -e "${GREEN}Size: $(du -h "$FINAL_ARCHIVE" | cut -f1)${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT: Store the passphrase from $PASSPHRASE_FILE securely!${NC}"
