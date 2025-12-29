#!/bin/bash
# QuantaPool Key Restore
#
# Restores validator keys from encrypted backup.
#
# Usage: ./restore-keys.sh <backup_file>
#
# CRITICAL: Stop the validator before restoring!

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
VALIDATOR_KEYS_DIR="${VALIDATOR_KEYS_DIR:-/opt/quantapool/validator-keys}"
VALIDATOR_WALLET_DIR="${VALIDATOR_WALLET_DIR:-/var/lib/qrysm/validator/wallet}"
SLASHING_DB_DIR="${SLASHING_DB_DIR:-/var/lib/qrysm/validator/slashing-protection}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-/etc/quantapool/backup-passphrase}"

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

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <backup_file>"
    exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "$BACKUP_FILE" ]]; then
    error "Backup file not found: $BACKUP_FILE"
fi

# Safety checks
echo ""
echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║                   KEY RESTORE WARNING                         ║${NC}"
echo -e "${RED}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  CRITICAL: Before restoring keys:                             ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  1. STOP the validator service                                ║${NC}"
echo -e "${RED}║  2. Verify no other validator is using these keys             ║${NC}"
echo -e "${RED}║  3. Backup current keys if they exist                         ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  Running two validators = SLASHING = LOSS OF FUNDS            ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if validator is running
if systemctl is-active --quiet qrysm-validator 2>/dev/null; then
    error "Validator service is RUNNING! Stop it first: systemctl stop qrysm-validator"
fi

# Confirm restore
read -p "Type 'RESTORE' to confirm: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
    error "Restore cancelled"
fi

log "Starting key restore from: $BACKUP_FILE"

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Decrypt and extract
log "Decrypting backup..."

if [[ -f "$PASSPHRASE_FILE" ]]; then
    gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" \
        --decrypt "$BACKUP_FILE" | tar -xzf - -C "$TEMP_DIR"
else
    echo "Enter backup passphrase:"
    gpg --decrypt "$BACKUP_FILE" | tar -xzf - -C "$TEMP_DIR"
fi

# Check manifest
if [[ -f "$TEMP_DIR/manifest.json" ]]; then
    log "Backup manifest:"
    cat "$TEMP_DIR/manifest.json"
    echo ""
fi

# Restore validator keys
if [[ -f "$TEMP_DIR/validator-keys.tar.gz" ]]; then
    log "Restoring validator keys..."
    mkdir -p "$(dirname "$VALIDATOR_KEYS_DIR")"

    # Backup existing if present
    if [[ -d "$VALIDATOR_KEYS_DIR" ]]; then
        mv "$VALIDATOR_KEYS_DIR" "${VALIDATOR_KEYS_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
        warn "Existing keys backed up"
    fi

    tar -xzf "$TEMP_DIR/validator-keys.tar.gz" -C "$(dirname "$VALIDATOR_KEYS_DIR")"
    chmod 700 "$VALIDATOR_KEYS_DIR"
    log "Validator keys restored"
fi

# Restore wallet
if [[ -f "$TEMP_DIR/validator-wallet.tar.gz" ]]; then
    log "Restoring validator wallet..."
    mkdir -p "$(dirname "$VALIDATOR_WALLET_DIR")"

    if [[ -d "$VALIDATOR_WALLET_DIR" ]]; then
        mv "$VALIDATOR_WALLET_DIR" "${VALIDATOR_WALLET_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    tar -xzf "$TEMP_DIR/validator-wallet.tar.gz" -C "$(dirname "$VALIDATOR_WALLET_DIR")"
    chown -R qrysm:qrysm "$VALIDATOR_WALLET_DIR" 2>/dev/null || true
    chmod 700 "$VALIDATOR_WALLET_DIR"
    log "Validator wallet restored"
fi

# Restore slashing protection (CRITICAL!)
if [[ -f "$TEMP_DIR/slashing-protection.tar.gz" ]]; then
    log "Restoring slashing protection database..."
    mkdir -p "$(dirname "$SLASHING_DB_DIR")"

    if [[ -d "$SLASHING_DB_DIR" ]]; then
        mv "$SLASHING_DB_DIR" "${SLASHING_DB_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    tar -xzf "$TEMP_DIR/slashing-protection.tar.gz" -C "$(dirname "$SLASHING_DB_DIR")"
    chown -R qrysm:qrysm "$SLASHING_DB_DIR" 2>/dev/null || true
    log "Slashing protection restored"
else
    warn "No slashing protection in backup - BE CAREFUL!"
fi

echo ""
log "Key restore complete!"
echo ""
echo -e "${GREEN}Restored:${NC}"
echo "  Validator keys: $VALIDATOR_KEYS_DIR"
echo "  Wallet: $VALIDATOR_WALLET_DIR"
echo "  Slashing protection: $SLASHING_DB_DIR"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Verify keys are correct"
echo "2. Start validator: systemctl start qrysm-validator"
echo "3. Monitor for successful attestations"
