# QuantaPool Testnet Environment
# QRL Testnet deployment configuration

terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}

module "quantapool" {
  source = "../../"

  hcloud_token        = var.hcloud_token
  environment         = "testnet"
  datacenter          = "fsn1" # Falkenstein
  ssh_public_key_path = var.ssh_public_key_path

  # Server types (testnet can use smaller instances). CPX line phased out;
  # current x86 generation is CX (Intel). ARM (CAX) would need binary rebuild.
  primary_server_type    = "cpx32" # 4 vCPU, 8 GB, 160 GB local (new AMD gen)
  backup_server_type     = "cpx22" # 2 vCPU, 4 GB, 80 GB local
  monitoring_server_type = "cpx22" # 2 vCPU, 4 GB, 80 GB local

  enable_backup_node = true
  enable_monitoring  = false # Hetzner quota: 2 primary IPs. Reuse node #1 monitoring for now.

  # Testnet v2.2 contract addresses (see config/testnet-hyperion.json)
  stqrl_address             = "QA2f23388d1e3986416A36d2Ef113850D6900b69C"
  deposit_pool_address      = "Q109d7C528a67b80eb638D4C85e7C4545ef9Bb9aC"
  validator_manager_address = "QA5b6e85B7713670589e4eAf2F039380Ec2792c8C"
  qrl_rpc_url               = "https://qrlwallet.com/api/qrl-rpc/testnet"

  # Alerting (optional)
  discord_webhook_url = var.discord_webhook_url
  telegram_bot_token  = var.telegram_bot_token
  telegram_chat_id    = var.telegram_chat_id

  labels = {
    project     = "quantapool"
    environment = "testnet"
    managed_by  = "terraform"
  }
}

variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "discord_webhook_url" {
  description = "Discord webhook URL for alerts"
  type        = string
  default     = ""
  sensitive   = true
}

variable "telegram_bot_token" {
  description = "Telegram bot token"
  type        = string
  default     = ""
  sensitive   = true
}

variable "telegram_chat_id" {
  description = "Telegram chat ID"
  type        = string
  default     = ""
}

# Outputs
output "primary_validator_ip" {
  value = module.quantapool.primary_validator_ip
}

output "backup_validator_ip" {
  value = module.quantapool.backup_validator_ip
}

output "monitoring_ip" {
  value = module.quantapool.monitoring_ip
}

output "grafana_url" {
  value = module.quantapool.grafana_url
}

output "ssh_commands" {
  value = {
    primary    = module.quantapool.ssh_connection_primary
    backup     = module.quantapool.ssh_connection_backup
    monitoring = module.quantapool.ssh_connection_monitoring
  }
}

output "ansible_inventory" {
  value     = module.quantapool.ansible_inventory
  sensitive = false
}
