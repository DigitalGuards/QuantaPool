# QuantaPool Testnet Environment
# Zond Testnet deployment configuration

terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}

module "quantapool" {
  source = "../../"

  hcloud_token        = var.hcloud_token
  environment         = "testnet"
  datacenter          = "fsn1"  # Falkenstein
  ssh_public_key_path = var.ssh_public_key_path

  # Server types (testnet can use smaller instances)
  primary_server_type    = "cpx31"  # 4 vCPU, 8GB RAM
  backup_server_type     = "cpx21"  # 3 vCPU, 4GB RAM
  monitoring_server_type = "cpx11"  # 2 vCPU, 2GB RAM

  enable_backup_node = true
  enable_monitoring  = true

  # Testnet contract addresses
  stqrl_address             = "0x844A6eB87927780E938908743eA24a56A220Efe8"
  deposit_pool_address      = "0x9E800e8271df4Ac91334C65641405b04584B57DC"
  rewards_oracle_address    = "0x541b1f2c501956BCd7a4a6913180b2Fc27BdE17E"
  operator_registry_address = "0xD370e9505D265381e839f8289f46D02815d0FF95"
  zond_rpc_url              = "https://qrlwallet.com/api/zond-rpc/testnet"

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
