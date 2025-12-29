# QuantaPool Infrastructure - Main Terraform Configuration
# Deploys QRL Zond validator infrastructure on Hetzner Cloud

provider "hcloud" {
  token = var.hcloud_token
}

# ============================================================================
# SSH Key
# ============================================================================

resource "hcloud_ssh_key" "quantapool" {
  name       = "quantapool-${var.environment}"
  public_key = file(var.ssh_public_key_path)
  labels     = var.labels
}

# ============================================================================
# Private Network
# ============================================================================

module "networking" {
  source = "./modules/networking"

  environment          = var.environment
  private_network_cidr = var.private_network_cidr
  private_network_zone = var.private_network_zone
  datacenter           = var.datacenter
  labels               = var.labels
}

# ============================================================================
# Primary Validator Node
# ============================================================================

module "primary_validator" {
  source = "./modules/validator-node"

  name            = "quantapool-validator-${var.environment}"
  environment     = var.environment
  server_type     = var.primary_server_type
  datacenter      = var.datacenter
  ssh_key_ids     = [hcloud_ssh_key.quantapool.id]
  network_id      = module.networking.network_id
  subnet_id       = module.networking.subnet_id
  private_ip      = cidrhost(var.private_network_cidr, 10)
  is_primary      = true
  labels          = merge(var.labels, { role = "primary-validator" })

  # Zond configuration
  zond_rpc_url             = var.zond_rpc_url
  stqrl_address            = var.stqrl_address
  deposit_pool_address     = var.deposit_pool_address
  rewards_oracle_address   = var.rewards_oracle_address
  operator_registry_address = var.operator_registry_address
}

# ============================================================================
# Backup Node (Hot Standby)
# ============================================================================

module "backup_validator" {
  source = "./modules/backup-node"
  count  = var.enable_backup_node ? 1 : 0

  name            = "quantapool-backup-${var.environment}"
  environment     = var.environment
  server_type     = var.backup_server_type
  datacenter      = var.datacenter
  ssh_key_ids     = [hcloud_ssh_key.quantapool.id]
  network_id      = module.networking.network_id
  subnet_id       = module.networking.subnet_id
  private_ip      = cidrhost(var.private_network_cidr, 11)
  primary_ip      = module.primary_validator.private_ip
  labels          = merge(var.labels, { role = "backup-validator" })
}

# ============================================================================
# Monitoring Server
# ============================================================================

module "monitoring" {
  source = "./modules/monitoring-server"
  count  = var.enable_monitoring ? 1 : 0

  name            = "quantapool-monitoring-${var.environment}"
  environment     = var.environment
  server_type     = var.monitoring_server_type
  datacenter      = var.datacenter
  ssh_key_ids     = [hcloud_ssh_key.quantapool.id]
  network_id      = module.networking.network_id
  subnet_id       = module.networking.subnet_id
  private_ip      = cidrhost(var.private_network_cidr, 20)
  labels          = merge(var.labels, { role = "monitoring" })

  # Targets to monitor
  primary_validator_ip = module.primary_validator.private_ip
  backup_validator_ip  = var.enable_backup_node ? module.backup_validator[0].private_ip : ""

  # Alert configuration
  discord_webhook_url = var.discord_webhook_url
  telegram_bot_token  = var.telegram_bot_token
  telegram_chat_id    = var.telegram_chat_id

  # Contract configuration
  zond_rpc_url              = var.zond_rpc_url
  stqrl_address             = var.stqrl_address
  deposit_pool_address      = var.deposit_pool_address
  rewards_oracle_address    = var.rewards_oracle_address
  operator_registry_address = var.operator_registry_address
}

# ============================================================================
# Firewall Rules
# ============================================================================

resource "hcloud_firewall" "validator" {
  name   = "quantapool-validator-${var.environment}"
  labels = var.labels

  # SSH (restricted to specific IPs in production)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # gzond P2P
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "30303"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "30303"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # qrysm beacon P2P
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "13000"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "12000"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_firewall" "monitoring" {
  name   = "quantapool-monitoring-${var.environment}"
  labels = var.labels

  # SSH
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Grafana (consider restricting in production)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "3000"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Attach firewalls to servers
resource "hcloud_firewall_attachment" "primary_validator" {
  firewall_id = hcloud_firewall.validator.id
  server_ids  = [module.primary_validator.server_id]
}

resource "hcloud_firewall_attachment" "backup_validator" {
  count       = var.enable_backup_node ? 1 : 0
  firewall_id = hcloud_firewall.validator.id
  server_ids  = [module.backup_validator[0].server_id]
}

resource "hcloud_firewall_attachment" "monitoring" {
  count       = var.enable_monitoring ? 1 : 0
  firewall_id = hcloud_firewall.monitoring.id
  server_ids  = [module.monitoring[0].server_id]
}
