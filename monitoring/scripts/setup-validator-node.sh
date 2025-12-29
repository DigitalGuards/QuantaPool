#!/bin/bash
#
# QuantaPool Validator Node Monitoring Setup
#
# This script sets up the necessary monitoring components on the validator server:
# 1. Installs and configures node_exporter for system metrics
# 2. Provides instructions for enabling Prometheus metrics on go-zond and qrysm
#
# Run this script on your validator server, not on the monitoring server.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  QuantaPool Validator Node Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Note: Some operations may require sudo access.${NC}"
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
else
    OS=$(uname -s)
fi

echo -e "${GREEN}Detected OS:${NC} $OS"
echo ""

# ============================================
# Node Exporter Installation
# ============================================

NODE_EXPORTER_VERSION="1.7.0"
NODE_EXPORTER_USER="node_exporter"

install_node_exporter() {
    echo -e "${BLUE}Installing Node Exporter v${NODE_EXPORTER_VERSION}...${NC}"

    # Download
    cd /tmp
    wget -q "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz" -O node_exporter.tar.gz

    # Extract
    tar xzf node_exporter.tar.gz

    # Install binary
    sudo cp "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter" /usr/local/bin/
    sudo chmod +x /usr/local/bin/node_exporter

    # Create user
    if ! id "$NODE_EXPORTER_USER" &>/dev/null; then
        sudo useradd --no-create-home --shell /bin/false "$NODE_EXPORTER_USER" || true
    fi

    # Create systemd service
    sudo tee /etc/systemd/system/node_exporter.service > /dev/null << 'EOF'
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

    # Reload and start
    sudo systemctl daemon-reload
    sudo systemctl enable node_exporter
    sudo systemctl start node_exporter

    # Cleanup
    rm -rf /tmp/node_exporter*

    echo -e "${GREEN}Node Exporter installed and running on port 9100${NC}"
}

# Check if node_exporter is already installed
if command -v node_exporter &> /dev/null; then
    INSTALLED_VERSION=$(node_exporter --version 2>&1 | head -1 | grep -oP 'version \K[0-9.]+' || echo "unknown")
    echo -e "${GREEN}Node Exporter already installed:${NC} v${INSTALLED_VERSION}"

    read -p "Do you want to reinstall/upgrade? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo systemctl stop node_exporter 2>/dev/null || true
        install_node_exporter
    fi
else
    install_node_exporter
fi

# ============================================
# Verify node_exporter is running
# ============================================

echo ""
echo -e "${BLUE}Checking node_exporter status...${NC}"
if curl -s http://localhost:9100/metrics > /dev/null 2>&1; then
    echo -e "${GREEN}Node Exporter is running and accessible on port 9100${NC}"
else
    echo -e "${RED}Warning: Node Exporter may not be running properly${NC}"
    echo "Try: sudo systemctl status node_exporter"
fi

# ============================================
# Go-Zond and Qrysm Configuration
# ============================================

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Validator Client Configuration${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}To enable Prometheus metrics, add these flags to your startup scripts:${NC}"
echo ""

echo -e "${GREEN}1. Go-Zond (gzond) - Add to startup command:${NC}"
echo "   --metrics \\"
echo "   --metrics.addr 0.0.0.0 \\"
echo "   --metrics.port 6060"
echo ""
echo "   Metrics will be available at: http://localhost:6060/debug/metrics/prometheus"
echo ""

echo -e "${GREEN}2. Qrysm Beacon Chain - Add to startup command:${NC}"
echo "   --monitoring-host 0.0.0.0 \\"
echo "   --monitoring-port 8080"
echo ""
echo "   Metrics will be available at: http://localhost:8080/metrics"
echo ""

echo -e "${GREEN}3. Qrysm Validator - Add to startup command:${NC}"
echo "   --monitoring-host 0.0.0.0 \\"
echo "   --monitoring-port 8081"
echo ""
echo "   Metrics will be available at: http://localhost:8081/metrics"
echo ""

# ============================================
# Firewall Configuration
# ============================================

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Firewall Configuration${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}If you have a firewall, allow these ports from your monitoring server:${NC}"
echo ""
echo "   Port 6060  - Go-Zond metrics"
echo "   Port 8080  - Beacon Chain metrics"
echo "   Port 8081  - Validator metrics"
echo "   Port 9100  - Node Exporter metrics"
echo ""

# Check for ufw
if command -v ufw &> /dev/null; then
    echo -e "${GREEN}UFW detected. Example commands:${NC}"
    echo "   sudo ufw allow from <MONITORING_SERVER_IP> to any port 6060"
    echo "   sudo ufw allow from <MONITORING_SERVER_IP> to any port 8080"
    echo "   sudo ufw allow from <MONITORING_SERVER_IP> to any port 8081"
    echo "   sudo ufw allow from <MONITORING_SERVER_IP> to any port 9100"
fi

# Check for iptables
if command -v iptables &> /dev/null && [ ! -x "$(command -v ufw)" ]; then
    echo -e "${GREEN}iptables detected. Example commands:${NC}"
    echo "   sudo iptables -A INPUT -p tcp -s <MONITORING_SERVER_IP> --dport 6060 -j ACCEPT"
    echo "   sudo iptables -A INPUT -p tcp -s <MONITORING_SERVER_IP> --dport 8080 -j ACCEPT"
    echo "   sudo iptables -A INPUT -p tcp -s <MONITORING_SERVER_IP> --dport 8081 -j ACCEPT"
    echo "   sudo iptables -A INPUT -p tcp -s <MONITORING_SERVER_IP> --dport 9100 -j ACCEPT"
fi

echo ""

# ============================================
# Verification
# ============================================

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}After updating your validator startup scripts, verify metrics are exposed:${NC}"
echo ""
echo "   curl http://localhost:9100/metrics | head -20   # Node Exporter"
echo "   curl http://localhost:6060/debug/metrics/prometheus | head -20   # Go-Zond"
echo "   curl http://localhost:8080/metrics | head -20   # Beacon Chain"
echo "   curl http://localhost:8081/metrics | head -20   # Validator"
echo ""

# ============================================
# Server IP
# ============================================

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Your Server Information${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Try to get public IP
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "Unable to determine")

# Get local IPs
LOCAL_IPS=$(hostname -I 2>/dev/null || ip addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | head -3 || echo "Unable to determine")

echo -e "${GREEN}Public IP:${NC} $PUBLIC_IP"
echo -e "${GREEN}Local IPs:${NC} $LOCAL_IPS"
echo ""
echo -e "${YELLOW}Use one of these IPs as VALIDATOR_HOST in your monitoring server's .env file${NC}"
echo ""

# ============================================
# Summary
# ============================================

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Setup Complete${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Update go-zond startup script with --metrics flags"
echo "  2. Update beacon-chain startup script with --monitoring flags"
echo "  3. Update validator startup script with --monitoring flags"
echo "  4. Restart the services"
echo "  5. Update VALIDATOR_HOST in your monitoring server's .env file"
echo "  6. Start the monitoring stack: docker compose up -d"
echo ""
echo -e "${GREEN}Done!${NC}"
