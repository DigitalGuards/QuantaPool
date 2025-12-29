#!/bin/bash
# QuantaPool Infrastructure Destroy
#
# Tears down all QuantaPool infrastructure.
# WARNING: This is destructive and irreversible!
#
# Usage: ./destroy.sh [--environment testnet|mainnet] [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ENVIRONMENT="testnet"
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --environment|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

echo ""
echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║           ⚠️  INFRASTRUCTURE DESTRUCTION ⚠️                     ║${NC}"
echo -e "${RED}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  This will DESTROY all QuantaPool infrastructure:             ║${NC}"
echo -e "${RED}║    • Primary validator server                                 ║${NC}"
echo -e "${RED}║    • Backup validator server                                  ║${NC}"
echo -e "${RED}║    • Monitoring server                                        ║${NC}"
echo -e "${RED}║    • All data volumes                                         ║${NC}"
echo -e "${RED}║    • Private network                                          ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  THIS ACTION CANNOT BE UNDONE!                                ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}Environment: $ENVIRONMENT${NC}"
echo ""

if [[ "$FORCE" == "false" ]]; then
    read -p "Type 'DESTROY' to confirm: " confirm
    if [[ "$confirm" != "DESTROY" ]]; then
        echo "Destruction cancelled."
        exit 0
    fi
fi

echo ""
echo -e "${YELLOW}Destroying infrastructure...${NC}"
echo ""

cd "$INFRA_DIR/terraform/environments/$ENVIRONMENT"

terraform destroy \
    -var="hcloud_token=${HCLOUD_TOKEN:-}" \
    ${FORCE:+-auto-approve}

echo ""
echo -e "${GREEN}Infrastructure destroyed.${NC}"
