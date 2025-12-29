# QuantaPool Monitoring Server Module
# Deploys Prometheus + Grafana + Alertmanager

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

variable "labels" {
  description = "Resource labels"
  type        = map(string)
}

variable "primary_validator_ip" {
  description = "Primary validator private IP"
  type        = string
}

variable "backup_validator_ip" {
  description = "Backup validator private IP"
  type        = string
  default     = ""
}

variable "discord_webhook_url" {
  description = "Discord webhook for alerts"
  type        = string
  default     = ""
}

variable "telegram_bot_token" {
  description = "Telegram bot token"
  type        = string
  default     = ""
}

variable "telegram_chat_id" {
  description = "Telegram chat ID"
  type        = string
  default     = ""
}

variable "zond_rpc_url" {
  description = "Zond RPC URL"
  type        = string
}

variable "stqrl_address" {
  description = "stQRL contract address"
  type        = string
}

variable "deposit_pool_address" {
  description = "DepositPool contract address"
  type        = string
}

variable "rewards_oracle_address" {
  description = "RewardsOracle contract address"
  type        = string
}

variable "operator_registry_address" {
  description = "OperatorRegistry contract address"
  type        = string
}

locals {
  image = "ubuntu-24.04"
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
      - jq
      - fail2ban
      - ufw
      - htop
      - docker.io
      - docker-compose

    write_files:
      - path: /etc/quantapool/environment
        permissions: '0600'
        content: |
          ENVIRONMENT=${var.environment}
          ROLE=monitoring
          PRIMARY_VALIDATOR_IP=${var.primary_validator_ip}
          BACKUP_VALIDATOR_IP=${var.backup_validator_ip}
          DISCORD_WEBHOOK_URL=${var.discord_webhook_url}
          TELEGRAM_BOT_TOKEN=${var.telegram_bot_token}
          TELEGRAM_CHAT_ID=${var.telegram_chat_id}
          ZOND_RPC_URL=${var.zond_rpc_url}
          STQRL_ADDRESS=${var.stqrl_address}
          DEPOSIT_POOL_ADDRESS=${var.deposit_pool_address}
          REWARDS_ORACLE_ADDRESS=${var.rewards_oracle_address}
          OPERATOR_REGISTRY_ADDRESS=${var.operator_registry_address}

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

    runcmd:
      # Create monitoring directories
      - mkdir -p /opt/quantapool/monitoring
      - mkdir -p /var/lib/prometheus
      - mkdir -p /var/lib/grafana
      - mkdir -p /var/lib/alertmanager

      # Configure firewall
      - ufw default deny incoming
      - ufw default allow outgoing
      - ufw allow 22/tcp comment 'SSH'
      - ufw allow 3000/tcp comment 'Grafana'
      - ufw allow from 10.0.0.0/24 to any port 9090 comment 'Prometheus internal'
      - ufw allow from 10.0.0.0/24 to any port 9093 comment 'Alertmanager internal'
      - ufw --force enable

      # Configure fail2ban
      - systemctl enable fail2ban
      - systemctl start fail2ban

      # Enable Docker
      - systemctl enable docker
      - systemctl start docker
      - usermod -aG docker root

      # Enable automatic security updates
      - apt-get install -y unattended-upgrades
      - dpkg-reconfigure -plow unattended-upgrades

    final_message: "QuantaPool monitoring server initialized. Ready for Docker Compose deployment."
  EOF
}

# Monitoring server
resource "hcloud_server" "monitoring" {
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
resource "hcloud_server_network" "monitoring" {
  server_id  = hcloud_server.monitoring.id
  network_id = var.network_id
  ip         = var.private_ip

  depends_on = [var.subnet_id]
}

# Outputs
output "server_id" {
  description = "Server ID"
  value       = hcloud_server.monitoring.id
}

output "public_ip" {
  description = "Public IPv4 address"
  value       = hcloud_server.monitoring.ipv4_address
}

output "private_ip" {
  description = "Private IP address"
  value       = hcloud_server_network.monitoring.ip
}
