#!/bin/bash
# QuantaPool Health Check Script
#
# Quickly check the status of all QuantaPool infrastructure components.
#
# Usage: ./health-check.sh [--json] [--verbose]

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration (load from environment or inventory)
PRIMARY_HOST="${PRIMARY_HOST:-}"
BACKUP_HOST="${BACKUP_HOST:-}"
MONITORING_HOST="${MONITORING_HOST:-}"
SSH_USER="${SSH_USER:-root}"
SSH_KEY="${SSH_KEY:-~/.ssh/id_ed25519}"

JSON_OUTPUT=false
VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--json] [--verbose]"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# Try to load hosts from Terraform output
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -z "$PRIMARY_HOST" ]]; then
    # Try testnet first
    if [[ -d "$INFRA_DIR/terraform/environments/testnet" ]]; then
        cd "$INFRA_DIR/terraform/environments/testnet"
        PRIMARY_HOST=$(terraform output -raw primary_validator_ip 2>/dev/null || echo "")
        BACKUP_HOST=$(terraform output -raw backup_validator_ip 2>/dev/null || echo "")
        MONITORING_HOST=$(terraform output -raw monitoring_ip 2>/dev/null || echo "")
        cd - > /dev/null
    fi
fi

ssh_cmd() {
    local host=$1
    shift
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 "${SSH_USER}@${host}" "$@" 2>/dev/null
}

check_status() {
    local name=$1
    local check=$2

    if $check; then
        echo -e "${GREEN}✓${NC} $name"
        return 0
    else
        echo -e "${RED}✗${NC} $name"
        return 1
    fi
}

check_service() {
    local host=$1
    local service=$2

    ssh_cmd "$host" "systemctl is-active $service" 2>/dev/null | grep -q "active"
}

get_metric() {
    local host=$1
    local port=$2
    local metric=$3

    ssh_cmd "$host" "curl -s http://localhost:$port/metrics 2>/dev/null | grep '^$metric' | head -1 | awk '{print \$2}'" || echo "N/A"
}

# JSON results array
declare -a JSON_RESULTS=()

add_json_result() {
    local component=$1
    local status=$2
    local details=$3

    JSON_RESULTS+=("{\"component\":\"$component\",\"status\":\"$status\",\"details\":\"$details\"}")
}

# Header
if [[ "$JSON_OUTPUT" == "false" ]]; then
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║           QuantaPool Infrastructure Health Check              ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
fi

OVERALL_STATUS=0

# Check Primary Validator
if [[ -n "$PRIMARY_HOST" ]]; then
    if [[ "$JSON_OUTPUT" == "false" ]]; then
        echo -e "${BLUE}Primary Validator ($PRIMARY_HOST)${NC}"
        echo "─────────────────────────────────────"
    fi

    # SSH connectivity
    if ssh_cmd "$PRIMARY_HOST" "echo ok" > /dev/null; then
        if [[ "$JSON_OUTPUT" == "false" ]]; then
            check_status "SSH connectivity" true
        fi
        add_json_result "primary_ssh" "ok" "connected"

        # Services
        for service in gzond qrysm-beacon qrysm-validator; do
            if check_service "$PRIMARY_HOST" "$service"; then
                if [[ "$JSON_OUTPUT" == "false" ]]; then
                    check_status "$service service" true
                fi
                add_json_result "primary_$service" "ok" "running"
            else
                if [[ "$JSON_OUTPUT" == "false" ]]; then
                    check_status "$service service" false
                fi
                add_json_result "primary_$service" "error" "not running"
                OVERALL_STATUS=1
            fi
        done

        # gzond sync status
        if [[ "$VERBOSE" == "true" ]]; then
            SYNC_STATUS=$(ssh_cmd "$PRIMARY_HOST" "curl -s -X POST -H 'Content-Type: application/json' --data '{\"jsonrpc\":\"2.0\",\"method\":\"eth_syncing\",\"params\":[],\"id\":1}' http://localhost:8545" | jq -r '.result')
            if [[ "$JSON_OUTPUT" == "false" ]]; then
                echo "  gzond sync: $SYNC_STATUS"
            fi
        fi

        # Beacon sync status
        if [[ "$VERBOSE" == "true" ]]; then
            BEACON_STATUS=$(ssh_cmd "$PRIMARY_HOST" "curl -s http://localhost:3500/eth/v1/node/health" && echo "synced" || echo "syncing")
            if [[ "$JSON_OUTPUT" == "false" ]]; then
                echo "  Beacon status: $BEACON_STATUS"
            fi
        fi
    else
        if [[ "$JSON_OUTPUT" == "false" ]]; then
            check_status "SSH connectivity" false
        fi
        add_json_result "primary_ssh" "error" "connection failed"
        OVERALL_STATUS=1
    fi

    [[ "$JSON_OUTPUT" == "false" ]] && echo ""
fi

# Check Backup Validator
if [[ -n "$BACKUP_HOST" ]]; then
    if [[ "$JSON_OUTPUT" == "false" ]]; then
        echo -e "${BLUE}Backup Validator ($BACKUP_HOST)${NC}"
        echo "─────────────────────────────────────"
    fi

    if ssh_cmd "$BACKUP_HOST" "echo ok" > /dev/null; then
        if [[ "$JSON_OUTPUT" == "false" ]]; then
            check_status "SSH connectivity" true
        fi
        add_json_result "backup_ssh" "ok" "connected"

        # Services (validator should be stopped on backup)
        for service in gzond qrysm-beacon; do
            if check_service "$BACKUP_HOST" "$service"; then
                if [[ "$JSON_OUTPUT" == "false" ]]; then
                    check_status "$service service" true
                fi
                add_json_result "backup_$service" "ok" "running"
            else
                if [[ "$JSON_OUTPUT" == "false" ]]; then
                    check_status "$service service" false
                fi
                add_json_result "backup_$service" "warning" "not running"
            fi
        done

        # Validator should be stopped on backup
        if ! check_service "$BACKUP_HOST" "qrysm-validator"; then
            if [[ "$JSON_OUTPUT" == "false" ]]; then
                check_status "Validator DISABLED (correct for backup)" true
            fi
            add_json_result "backup_validator_disabled" "ok" "correctly disabled"
        else
            if [[ "$JSON_OUTPUT" == "false" ]]; then
                echo -e "${RED}WARNING: Validator running on backup node!${NC}"
            fi
            add_json_result "backup_validator_disabled" "warning" "validator running - check for slashing risk"
        fi

        # Check lock file
        if ssh_cmd "$BACKUP_HOST" "test -f /etc/quantapool/VALIDATOR_LOCKED"; then
            if [[ "$JSON_OUTPUT" == "false" ]]; then
                check_status "Lock file present" true
            fi
            add_json_result "backup_lock_file" "ok" "present"
        else
            if [[ "$JSON_OUTPUT" == "false" ]]; then
                check_status "Lock file present" false
            fi
            add_json_result "backup_lock_file" "warning" "missing"
        fi
    else
        if [[ "$JSON_OUTPUT" == "false" ]]; then
            check_status "SSH connectivity" false
        fi
        add_json_result "backup_ssh" "error" "connection failed"
    fi

    [[ "$JSON_OUTPUT" == "false" ]] && echo ""
fi

# Check Monitoring
if [[ -n "$MONITORING_HOST" ]]; then
    if [[ "$JSON_OUTPUT" == "false" ]]; then
        echo -e "${BLUE}Monitoring Server ($MONITORING_HOST)${NC}"
        echo "─────────────────────────────────────"
    fi

    if ssh_cmd "$MONITORING_HOST" "echo ok" > /dev/null; then
        if [[ "$JSON_OUTPUT" == "false" ]]; then
            check_status "SSH connectivity" true
        fi
        add_json_result "monitoring_ssh" "ok" "connected"

        # Docker services
        for container in prometheus grafana alertmanager; do
            if ssh_cmd "$MONITORING_HOST" "docker ps --format '{{.Names}}' | grep -q $container"; then
                if [[ "$JSON_OUTPUT" == "false" ]]; then
                    check_status "$container container" true
                fi
                add_json_result "monitoring_$container" "ok" "running"
            else
                if [[ "$JSON_OUTPUT" == "false" ]]; then
                    check_status "$container container" false
                fi
                add_json_result "monitoring_$container" "error" "not running"
            fi
        done

        # Grafana accessibility
        if ssh_cmd "$MONITORING_HOST" "curl -s http://localhost:3000/api/health" | grep -q "ok"; then
            if [[ "$JSON_OUTPUT" == "false" ]]; then
                check_status "Grafana API" true
            fi
            add_json_result "monitoring_grafana_api" "ok" "healthy"
        fi
    else
        if [[ "$JSON_OUTPUT" == "false" ]]; then
            check_status "SSH connectivity" false
        fi
        add_json_result "monitoring_ssh" "error" "connection failed"
    fi

    [[ "$JSON_OUTPUT" == "false" ]] && echo ""
fi

# Output JSON if requested
if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "{"
    echo "  \"timestamp\": \"$(date -Iseconds)\","
    echo "  \"overall_status\": \"$([ $OVERALL_STATUS -eq 0 ] && echo "healthy" || echo "degraded")\","
    echo "  \"checks\": ["
    printf '%s\n' "${JSON_RESULTS[@]}" | sed 's/$/,/' | sed '$ s/,$//'
    echo "  ]"
    echo "}"
else
    # Summary
    echo "─────────────────────────────────────"
    if [[ $OVERALL_STATUS -eq 0 ]]; then
        echo -e "${GREEN}Overall Status: HEALTHY${NC}"
    else
        echo -e "${YELLOW}Overall Status: DEGRADED${NC}"
    fi
    echo ""
fi

exit $OVERALL_STATUS
