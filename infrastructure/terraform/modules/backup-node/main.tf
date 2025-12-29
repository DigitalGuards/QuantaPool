# QuantaPool Backup Node Module
# Deploys hot standby node (beacon only, validator keys NOT active)

variable "name" {
  description = "Server name"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "server_type" {
  description = "Hetzner server type"
  type        = string
}

variable "datacenter" {
  description = "Hetzner datacenter"
  type        = string
}

variable "ssh_key_ids" {
  description = "SSH key IDs for access"
  type        = list(string)
}

variable "network_id" {
  description = "Private network ID"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID"
  type        = string
}

variable "private_ip" {
  description = "Private IP address"
  type        = string
}

variable "primary_ip" {
  description = "Primary validator private IP (for peer connection)"
  type        = string
}

variable "labels" {
  description = "Resource labels"
  type        = map(string)
}

locals {
  image = "ubuntu-24.04"
}

# Generate JWT secret for execution-consensus client communication
resource "random_bytes" "jwt_secret" {
  length = 32
}

# Cloud-init configuration
data "template_file" "cloud_init" {
  template = <<-EOF
    #cloud-config
    package_update: true
    package_upgrade: true

    packages:
      - curl
      - wget
      - git
      - build-essential
      - jq
      - fail2ban
      - ufw
      - htop
      - tmux
      - unzip

    write_files:
      - path: /etc/quantapool/environment
        permissions: '0600'
        content: |
          ENVIRONMENT=${var.environment}
          IS_PRIMARY=false
          IS_BACKUP=true
          PRIMARY_IP=${var.primary_ip}
          # CRITICAL: Validator service is DISABLED on backup by default
          VALIDATOR_ENABLED=false

      - path: /etc/quantapool/jwt.hex
        permissions: '0600'
        content: |
          ${random_bytes.jwt_secret.hex}

      - path: /etc/ssh/sshd_config.d/hardening.conf
        permissions: '0644'
        content: |
          PermitRootLogin prohibit-password
          PasswordAuthentication no
          ChallengeResponseAuthentication no
          UsePAM yes
          X11Forwarding no
          AllowTcpForwarding no
          MaxAuthTries 3
          ClientAliveInterval 300
          ClientAliveCountMax 2

      # Failover lock file - prevents accidental validator activation
      - path: /etc/quantapool/VALIDATOR_LOCKED
        permissions: '0444'
        content: |
          # CRITICAL SAFETY FILE
          # This file prevents the validator service from starting.
          #
          # To perform a failover:
          # 1. FIRST verify primary validator is STOPPED
          # 2. Run: rm /etc/quantapool/VALIDATOR_LOCKED
          # 3. Run: systemctl start qrysm-validator
          #
          # WARNING: Running two validators with the same keys = SLASHING
          # Created: $(date -Iseconds)

    runcmd:
      # Create directories
      - mkdir -p /opt/quantapool/{gzond,qrysm,validator-keys,data}
      - mkdir -p /var/lib/gzond
      - mkdir -p /var/lib/qrysm/{beacon,validator}

      # Configure firewall
      - ufw default deny incoming
      - ufw default allow outgoing
      - ufw allow 22/tcp comment 'SSH'
      - ufw allow 30303/tcp comment 'gzond P2P TCP'
      - ufw allow 30303/udp comment 'gzond P2P UDP'
      - ufw allow 13000/tcp comment 'qrysm beacon P2P TCP'
      - ufw allow 12000/udp comment 'qrysm beacon P2P UDP'
      - ufw --force enable

      # Configure fail2ban
      - systemctl enable fail2ban
      - systemctl start fail2ban

      # Enable automatic security updates
      - apt-get install -y unattended-upgrades
      - dpkg-reconfigure -plow unattended-upgrades

      # Set up node exporter
      - useradd --no-create-home --shell /bin/false node_exporter || true
      - wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
      - tar xvfz node_exporter-1.7.0.linux-amd64.tar.gz
      - cp node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/
      - chown node_exporter:node_exporter /usr/local/bin/node_exporter
      - |
        cat > /etc/systemd/system/node_exporter.service << 'NODEEXPORTER'
        [Unit]
        Description=Node Exporter
        Wants=network-online.target
        After=network-online.target

        [Service]
        User=node_exporter
        Group=node_exporter
        Type=simple
        ExecStart=/usr/local/bin/node_exporter --web.listen-address=:9100

        [Install]
        WantedBy=multi-user.target
        NODEEXPORTER
      - systemctl daemon-reload
      - systemctl enable node_exporter
      - systemctl start node_exporter
      - rm -rf node_exporter-1.7.0.linux-amd64*

    final_message: "QuantaPool backup node initialized. Validator service DISABLED - use failover procedure to activate."
  EOF
}

# Backup server
resource "hcloud_server" "backup" {
  name        = var.name
  server_type = var.server_type
  image       = local.image
  datacenter  = var.datacenter
  ssh_keys    = var.ssh_key_ids
  labels      = var.labels
  user_data   = data.template_file.cloud_init.rendered

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

# Attach to private network
resource "hcloud_server_network" "backup" {
  server_id  = hcloud_server.backup.id
  network_id = var.network_id
  ip         = var.private_ip

  depends_on = [var.subnet_id]
}

# Volume for blockchain data
resource "hcloud_volume" "data" {
  name      = "${var.name}-data"
  size      = 150  # GB - slightly smaller than primary
  server_id = hcloud_server.backup.id
  automount = true
  format    = "ext4"
  labels    = var.labels
}

# Outputs
output "server_id" {
  description = "Server ID"
  value       = hcloud_server.backup.id
}

output "public_ip" {
  description = "Public IPv4 address"
  value       = hcloud_server.backup.ipv4_address
}

output "private_ip" {
  description = "Private IP address"
  value       = hcloud_server_network.backup.ip
}

output "jwt_secret" {
  description = "JWT secret for execution-consensus communication"
  value       = random_bytes.jwt_secret.hex
  sensitive   = true
}

output "volume_id" {
  description = "Data volume ID"
  value       = hcloud_volume.data.id
}
