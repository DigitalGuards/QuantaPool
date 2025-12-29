#!/bin/bash
# QuantaPool Validator Key Generation
#
# This script generates Dilithium validator keys for QRL Zond.
# Keys use ML-DSA-87 (Dilithium) cryptography - NOT ECDSA.
#
# Usage: ./generate-keys.sh <num_validators> [withdrawal_address]
#
# Prerequisites:
# - QRL staking-deposit-cli or equivalent tool installed
# - Sufficient entropy available

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
KEY_OUTPUT_DIR="${KEY_OUTPUT_DIR:-/opt/quantapool/validator-keys}"
NETWORK="${NETWORK:-testnet}"
CHAIN_ID="${CHAIN_ID:-32382}"

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

# Check arguments
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <num_validators> [withdrawal_address]"
    echo ""
    echo "Arguments:"
    echo "  num_validators     Number of validator keys to generate"
    echo "  withdrawal_address (Optional) QRL address for withdrawals"
    echo ""
    echo "Environment variables:"
    echo "  KEY_OUTPUT_DIR     Output directory (default: /opt/quantapool/validator-keys)"
    echo "  NETWORK            Network (testnet or mainnet, default: testnet)"
    exit 1
fi

NUM_VALIDATORS=$1
WITHDRAWAL_ADDRESS="${2:-}"

# Validation
if [[ ! "$NUM_VALIDATORS" =~ ^[0-9]+$ ]] || [[ "$NUM_VALIDATORS" -lt 1 ]]; then
    error "Invalid number of validators: $NUM_VALIDATORS"
fi

if [[ "$NUM_VALIDATORS" -gt 100 ]]; then
    error "Maximum 100 validators per address. Requested: $NUM_VALIDATORS"
fi

# Display warning
echo ""
echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║                 VALIDATOR KEY GENERATION                      ║${NC}"
echo -e "${RED}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  CRITICAL: These keys control your staked funds.              ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  • Store keys securely (encrypted, offline backup)            ║${NC}"
echo -e "${RED}║  • NEVER share keys or commit to version control              ║${NC}"
echo -e "${RED}║  • Each validator requires 40,000 QRL stake                   ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

log "Generating $NUM_VALIDATORS validator key(s) for $NETWORK"
log "Output directory: $KEY_OUTPUT_DIR"

# Create output directory
mkdir -p "$KEY_OUTPUT_DIR"
chmod 700 "$KEY_OUTPUT_DIR"

# Generate timestamp for this batch
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BATCH_DIR="$KEY_OUTPUT_DIR/batch_$TIMESTAMP"
mkdir -p "$BATCH_DIR"
chmod 700 "$BATCH_DIR"

# Check for QRL staking tools
# Note: QRL Zond uses Dilithium keys, not standard ETH2 deposit CLI
# This is a placeholder for actual QRL key generation tool

if command -v qrl-staking-cli &> /dev/null; then
    log "Using qrl-staking-cli for key generation"

    qrl-staking-cli new-mnemonic \
        --num_validators "$NUM_VALIDATORS" \
        --chain "$NETWORK" \
        --keystore_password_file /dev/stdin \
        --folder "$BATCH_DIR" \
        ${WITHDRAWAL_ADDRESS:+--execution_address "$WITHDRAWAL_ADDRESS"}
else
    warn "qrl-staking-cli not found"
    log "Creating placeholder keystore structure..."
    log ""
    log "To generate real Dilithium validator keys:"
    log "1. Install QRL staking deposit CLI from: https://github.com/theQRL/staking-deposit-cli"
    log "2. Run: qrl-staking-cli new-mnemonic --num_validators $NUM_VALIDATORS --chain $NETWORK"
    log ""

    # Create placeholder structure
    for i in $(seq 1 "$NUM_VALIDATORS"); do
        mkdir -p "$BATCH_DIR/validator_keys"
        cat > "$BATCH_DIR/validator_keys/keystore_placeholder_$i.json" << EOF
{
  "_comment": "This is a PLACEHOLDER. Generate real keys with qrl-staking-cli",
  "crypto": {},
  "pubkey": "placeholder_pubkey_$i",
  "path": "m/12381/3600/$((i-1))/0/0",
  "version": 4
}
EOF
    done

    # Create deposit data placeholder
    cat > "$BATCH_DIR/deposit_data.json" << EOF
{
  "_comment": "This is a PLACEHOLDER. Generate real deposit data with qrl-staking-cli",
  "validators": []
}
EOF
fi

# Set secure permissions
chmod -R 600 "$BATCH_DIR"/*
chmod 700 "$BATCH_DIR/validator_keys" 2>/dev/null || true

log "Key generation complete"
log "Output: $BATCH_DIR"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Backup keys: ./encrypt-keys.sh $BATCH_DIR"
echo "2. Import to validator: ./import-to-validator.sh $BATCH_DIR"
echo "3. Make deposit to beacon chain"
echo ""
echo -e "${YELLOW}REMEMBER: Store your mnemonic phrase securely offline!${NC}"
