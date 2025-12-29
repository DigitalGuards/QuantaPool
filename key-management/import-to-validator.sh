#!/bin/bash
# QuantaPool Key Import to Validator
#
# Imports generated keys to the qrysm validator client.
#
# Usage: ./import-to-validator.sh <keys_directory>

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

VALIDATOR_DATA_DIR="${VALIDATOR_DATA_DIR:-/var/lib/qrysm/validator}"
WALLET_DIR="$VALIDATOR_DATA_DIR/wallet"
WALLET_PASSWORD_FILE="${WALLET_PASSWORD_FILE:-/etc/quantapool/validator-wallet-password}"

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
    echo "Usage: $0 <keys_directory>"
    echo ""
    echo "The keys directory should contain:"
    echo "  - validator_keys/ directory with keystore-*.json files"
    echo "  - deposit_data.json"
    exit 1
fi

KEYS_DIR="$1"

if [[ ! -d "$KEYS_DIR" ]]; then
    error "Keys directory not found: $KEYS_DIR"
fi

# Find keystore directory
KEYSTORE_DIR="$KEYS_DIR"
if [[ -d "$KEYS_DIR/validator_keys" ]]; then
    KEYSTORE_DIR="$KEYS_DIR/validator_keys"
fi

# Count keystores
KEYSTORE_COUNT=$(find "$KEYSTORE_DIR" -name "keystore*.json" 2>/dev/null | wc -l)
if [[ "$KEYSTORE_COUNT" -eq 0 ]]; then
    error "No keystore files found in $KEYSTORE_DIR"
fi

log "Found $KEYSTORE_COUNT keystore(s) to import"

# Check for qrysm validator binary
if ! command -v qrysm-validator &> /dev/null && ! command -v /usr/local/bin/qrysm-validator &> /dev/null; then
    error "qrysm-validator not found. Install it first."
fi

VALIDATOR_CMD="${VALIDATOR_CMD:-/usr/local/bin/qrysm-validator}"

# Check if validator is running
if systemctl is-active --quiet qrysm-validator 2>/dev/null; then
    warn "Validator service is running. Stop it first for safe import."
    read -p "Stop validator and continue? [y/N]: " stop_confirm
    if [[ "$stop_confirm" =~ ^[Yy]$ ]]; then
        systemctl stop qrysm-validator
        log "Validator stopped"
    else
        error "Import cancelled"
    fi
fi

# Create directories
mkdir -p "$VALIDATOR_DATA_DIR"
mkdir -p "$(dirname "$WALLET_PASSWORD_FILE")"

# Get or create wallet password
if [[ ! -f "$WALLET_PASSWORD_FILE" ]]; then
    echo ""
    echo "Creating validator wallet. Enter a secure password:"
    read -s -p "Wallet password: " WALLET_PASS
    echo ""
    read -s -p "Confirm password: " WALLET_PASS_CONFIRM
    echo ""

    if [[ "$WALLET_PASS" != "$WALLET_PASS_CONFIRM" ]]; then
        error "Passwords do not match"
    fi

    echo "$WALLET_PASS" > "$WALLET_PASSWORD_FILE"
    chmod 600 "$WALLET_PASSWORD_FILE"
fi

# Get keystore password
echo ""
echo "Enter the keystore password (used during key generation):"
read -s -p "Keystore password: " KEYSTORE_PASS
echo ""

# Create temporary password file
KEYSTORE_PASS_FILE=$(mktemp)
echo "$KEYSTORE_PASS" > "$KEYSTORE_PASS_FILE"
trap "rm -f $KEYSTORE_PASS_FILE" EXIT

log "Importing keys to validator wallet..."

# Import accounts using qrysm
$VALIDATOR_CMD accounts import \
    --wallet-dir="$WALLET_DIR" \
    --wallet-password-file="$WALLET_PASSWORD_FILE" \
    --keys-dir="$KEYSTORE_DIR" \
    --account-password-file="$KEYSTORE_PASS_FILE" \
    --accept-terms-of-use

# Set permissions
chown -R qrysm:qrysm "$VALIDATOR_DATA_DIR" 2>/dev/null || true
chmod 700 "$WALLET_DIR"

log "Key import complete!"
echo ""

# List imported accounts
log "Verifying imported accounts..."
$VALIDATOR_CMD accounts list \
    --wallet-dir="$WALLET_DIR" \
    --wallet-password-file="$WALLET_PASSWORD_FILE" \
    --accept-terms-of-use

echo ""
echo -e "${GREEN}Keys imported successfully!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Review the imported accounts above"
echo "2. Make a beacon chain deposit for each validator"
echo "3. Start the validator: systemctl start qrysm-validator"
echo "4. Monitor for activation (takes ~4-6 hours after deposit)"
