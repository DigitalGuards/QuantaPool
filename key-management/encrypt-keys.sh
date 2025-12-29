#!/bin/bash
# QuantaPool Key Encryption
#
# Encrypts validator keys with AES-256 for secure storage/backup.
#
# Usage: ./encrypt-keys.sh <keys_directory>

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BACKUP_DIR="${BACKUP_DIR:-/opt/quantapool/backups/keys}"

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <keys_directory>"
    exit 1
fi

KEYS_DIR="$1"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [[ ! -d "$KEYS_DIR" ]]; then
    error "Keys directory not found: $KEYS_DIR"
fi

# Check for GPG
if ! command -v gpg &> /dev/null; then
    error "GPG not installed. Install with: apt install gnupg"
fi

log "Encrypting keys from: $KEYS_DIR"

# Create backup directory
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Create archive
ARCHIVE_NAME="validator-keys-$TIMESTAMP.tar.gz"
ENCRYPTED_NAME="${ARCHIVE_NAME}.gpg"

log "Creating archive..."
tar -czf "/tmp/$ARCHIVE_NAME" -C "$(dirname "$KEYS_DIR")" "$(basename "$KEYS_DIR")"

# Prompt for encryption password
echo ""
echo -e "${YELLOW}Enter encryption password (will be used for decryption):${NC}"
read -s -p "Password: " PASSWORD
echo ""
read -s -p "Confirm password: " PASSWORD_CONFIRM
echo ""

if [[ "$PASSWORD" != "$PASSWORD_CONFIRM" ]]; then
    rm -f "/tmp/$ARCHIVE_NAME"
    error "Passwords do not match"
fi

if [[ ${#PASSWORD} -lt 12 ]]; then
    rm -f "/tmp/$ARCHIVE_NAME"
    error "Password must be at least 12 characters"
fi

# Encrypt with GPG (AES-256)
log "Encrypting with AES-256..."
echo "$PASSWORD" | gpg --batch --yes --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 \
    --output "$BACKUP_DIR/$ENCRYPTED_NAME" \
    "/tmp/$ARCHIVE_NAME"

# Clean up unencrypted archive
rm -f "/tmp/$ARCHIVE_NAME"

# Set secure permissions
chmod 600 "$BACKUP_DIR/$ENCRYPTED_NAME"

log "Encryption complete!"
echo ""
echo -e "${GREEN}Encrypted backup: $BACKUP_DIR/$ENCRYPTED_NAME${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT:${NC}"
echo "• Store the encryption password securely (password manager, offline)"
echo "• Copy backup to multiple secure locations (USB, encrypted cloud)"
echo "• Never store password alongside encrypted backup"
echo ""
echo "To decrypt: ./restore-keys.sh $BACKUP_DIR/$ENCRYPTED_NAME"
