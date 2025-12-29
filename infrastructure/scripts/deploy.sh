#!/bin/bash
# QuantaPool One-Command Deployment
#
# This script deploys complete QuantaPool validator infrastructure on Hetzner Cloud.
#
# Usage: ./deploy.sh [--environment testnet|mainnet] [--skip-terraform] [--skip-ansible]
#
# Prerequisites:
# - Terraform installed (>= 1.5.0)
# - Ansible installed (>= 2.14)
# - Hetzner Cloud API token
# - SSH key pair

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$INFRA_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Defaults
ENVIRONMENT="testnet"
SKIP_TERRAFORM=false
SKIP_ANSIBLE=false
AUTO_APPROVE=false

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

header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

usage() {
    cat << EOF
QuantaPool Infrastructure Deployment

Usage: $0 [OPTIONS]

Options:
    --environment, -e    Environment (testnet or mainnet) [default: testnet]
    --skip-terraform     Skip Terraform deployment (use existing infra)
    --skip-ansible       Skip Ansible provisioning
    --auto-approve       Skip confirmation prompts
    --help, -h           Show this help message

Environment Variables:
    HCLOUD_TOKEN         Hetzner Cloud API token (required)
    SSH_PUBLIC_KEY       Path to SSH public key [default: ~/.ssh/id_ed25519.pub]
    SSH_PRIVATE_KEY      Path to SSH private key [default: ~/.ssh/id_ed25519]
    DISCORD_WEBHOOK_URL  Discord webhook for alerts (optional)
    TELEGRAM_BOT_TOKEN   Telegram bot token (optional)
    TELEGRAM_CHAT_ID     Telegram chat ID (optional)

Examples:
    # Deploy testnet infrastructure
    HCLOUD_TOKEN=xxx ./deploy.sh

    # Deploy mainnet with auto-approval
    HCLOUD_TOKEN=xxx ./deploy.sh --environment mainnet --auto-approve

    # Only run Ansible on existing infrastructure
    ./deploy.sh --skip-terraform
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --skip-terraform)
            SKIP_TERRAFORM=true
            shift
            ;;
        --skip-ansible)
            SKIP_ANSIBLE=true
            shift
            ;;
        --auto-approve)
            AUTO_APPROVE=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

# Validation
if [[ "$ENVIRONMENT" != "testnet" && "$ENVIRONMENT" != "mainnet" ]]; then
    error "Invalid environment: $ENVIRONMENT (must be testnet or mainnet)"
fi

# Check prerequisites
check_prerequisites() {
    header "Checking Prerequisites"

    # Check Terraform
    if ! command -v terraform &> /dev/null; then
        error "Terraform not found. Install from: https://www.terraform.io/downloads"
    fi
    log "Terraform: $(terraform version -json | jq -r '.terraform_version')"

    # Check Ansible
    if ! command -v ansible &> /dev/null; then
        error "Ansible not found. Install with: pip install ansible"
    fi
    log "Ansible: $(ansible --version | head -1)"

    # Check Hetzner token
    if [[ -z "${HCLOUD_TOKEN:-}" ]] && [[ "$SKIP_TERRAFORM" == "false" ]]; then
        error "HCLOUD_TOKEN environment variable is required"
    fi

    # Check SSH keys
    SSH_PUBLIC_KEY="${SSH_PUBLIC_KEY:-$HOME/.ssh/id_ed25519.pub}"
    SSH_PRIVATE_KEY="${SSH_PRIVATE_KEY:-$HOME/.ssh/id_ed25519}"

    if [[ ! -f "$SSH_PUBLIC_KEY" ]]; then
        error "SSH public key not found: $SSH_PUBLIC_KEY"
    fi
    log "SSH public key: $SSH_PUBLIC_KEY"

    if [[ ! -f "$SSH_PRIVATE_KEY" ]]; then
        error "SSH private key not found: $SSH_PRIVATE_KEY"
    fi
    log "SSH private key: $SSH_PRIVATE_KEY"
}

# Display deployment plan
show_plan() {
    header "Deployment Plan"

    echo "Environment:     $ENVIRONMENT"
    echo "Run Terraform:   $([[ "$SKIP_TERRAFORM" == "true" ]] && echo "No" || echo "Yes")"
    echo "Run Ansible:     $([[ "$SKIP_ANSIBLE" == "true" ]] && echo "No" || echo "Yes")"
    echo ""
    echo "This will deploy:"
    echo "  • Primary validator node (gzond + qrysm)"
    echo "  • Backup node (hot standby)"
    echo "  • Monitoring server (Prometheus + Grafana)"
    echo ""

    if [[ "$AUTO_APPROVE" == "false" ]]; then
        read -p "Continue with deployment? [y/N]: " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            error "Deployment cancelled"
        fi
    fi
}

# Run Terraform
run_terraform() {
    header "Deploying Infrastructure with Terraform"

    cd "$INFRA_DIR/terraform/environments/$ENVIRONMENT"

    # Initialize Terraform
    log "Initializing Terraform..."
    terraform init

    # Create tfvars if not exists
    if [[ ! -f "terraform.tfvars" ]]; then
        cat > terraform.tfvars << EOF
hcloud_token        = "$HCLOUD_TOKEN"
ssh_public_key_path = "$SSH_PUBLIC_KEY"
discord_webhook_url = "${DISCORD_WEBHOOK_URL:-}"
telegram_bot_token  = "${TELEGRAM_BOT_TOKEN:-}"
telegram_chat_id    = "${TELEGRAM_CHAT_ID:-}"
EOF
        log "Created terraform.tfvars"
    fi

    # Plan
    log "Planning infrastructure..."
    terraform plan -out=tfplan

    # Apply
    if [[ "$AUTO_APPROVE" == "true" ]]; then
        log "Applying infrastructure (auto-approved)..."
        terraform apply tfplan
    else
        log "Applying infrastructure..."
        terraform apply tfplan
    fi

    # Generate Ansible inventory
    log "Generating Ansible inventory..."
    terraform output -raw ansible_inventory > "$INFRA_DIR/ansible/inventory.ini"

    cd - > /dev/null
}

# Run Ansible
run_ansible() {
    header "Provisioning Nodes with Ansible"

    cd "$INFRA_DIR/ansible"

    # Check inventory exists
    if [[ ! -f "inventory.ini" ]]; then
        error "Ansible inventory not found. Run Terraform first or create inventory.ini"
    fi

    # Wait for SSH to be available
    log "Waiting for nodes to be accessible..."
    sleep 30

    # Deploy validator nodes
    log "Deploying validator nodes..."
    ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook \
        -i inventory.ini \
        --private-key "$SSH_PRIVATE_KEY" \
        playbooks/deploy-node.yml

    # Deploy monitoring
    log "Deploying monitoring stack..."
    ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook \
        -i inventory.ini \
        --private-key "$SSH_PRIVATE_KEY" \
        playbooks/deploy-monitoring.yml

    cd - > /dev/null
}

# Display summary
show_summary() {
    header "Deployment Complete!"

    cd "$INFRA_DIR/terraform/environments/$ENVIRONMENT"

    PRIMARY_IP=$(terraform output -raw primary_validator_ip 2>/dev/null || echo "N/A")
    BACKUP_IP=$(terraform output -raw backup_validator_ip 2>/dev/null || echo "N/A")
    MONITORING_IP=$(terraform output -raw monitoring_ip 2>/dev/null || echo "N/A")
    GRAFANA_URL=$(terraform output -raw grafana_url 2>/dev/null || echo "N/A")

    cd - > /dev/null

    echo "Infrastructure deployed successfully!"
    echo ""
    echo "Node IPs:"
    echo "  Primary Validator: $PRIMARY_IP"
    echo "  Backup Validator:  $BACKUP_IP"
    echo "  Monitoring:        $MONITORING_IP"
    echo ""
    echo "Access:"
    echo "  Grafana Dashboard: $GRAFANA_URL"
    echo "  SSH to primary:    ssh root@$PRIMARY_IP"
    echo "  SSH to backup:     ssh root@$BACKUP_IP"
    echo "  SSH to monitoring: ssh root@$MONITORING_IP"
    echo ""
    echo "Next Steps:"
    echo "  1. Generate validator keys: ./key-management/generate-keys.sh"
    echo "  2. Import keys to validator: ./key-management/import-to-validator.sh"
    echo "  3. Make beacon chain deposit"
    echo "  4. Monitor in Grafana for validator activation"
    echo ""
    echo "For failover: ./scripts/failover.sh"
    echo "For health check: ./scripts/health-check.sh"
}

# Main execution
main() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           QuantaPool Infrastructure Deployment                ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    check_prerequisites
    show_plan

    if [[ "$SKIP_TERRAFORM" == "false" ]]; then
        run_terraform
    else
        log "Skipping Terraform deployment"
    fi

    if [[ "$SKIP_ANSIBLE" == "false" ]]; then
        run_ansible
    else
        log "Skipping Ansible provisioning"
    fi

    show_summary
}

main "$@"
