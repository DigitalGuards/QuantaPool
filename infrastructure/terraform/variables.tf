# QuantaPool Infrastructure Variables
# Hetzner Cloud deployment for QRL Zond validators

variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Deployment environment (testnet or mainnet)"
  type        = string
  default     = "testnet"

  validation {
    condition     = contains(["testnet", "mainnet"], var.environment)
    error_message = "Environment must be either 'testnet' or 'mainnet'."
  }
}

variable "datacenter" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "fsn1"  # Falkenstein recommended for low latency
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key for server access"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "ssh_private_key_path" {
  description = "Path to SSH private key for provisioning"
  type        = string
  default     = "~/.ssh/id_ed25519"
}

# Primary Validator Node
variable "primary_server_type" {
  description = "Hetzner server type for primary validator"
  type        = string
  default     = "cpx41"  # 8 vCPU, 16GB RAM, 240GB NVMe
}

# Backup Node
variable "backup_server_type" {
  description = "Hetzner server type for backup node"
  type        = string
  default     = "cpx31"  # 4 vCPU, 8GB RAM, 160GB NVMe
}

# Monitoring Server
variable "monitoring_server_type" {
  description = "Hetzner server type for monitoring"
  type        = string
  default     = "cpx11"  # 2 vCPU, 2GB RAM, 40GB
}

variable "enable_backup_node" {
  description = "Whether to deploy a backup/standby node"
  type        = bool
  default     = true
}

variable "enable_monitoring" {
  description = "Whether to deploy monitoring infrastructure"
  type        = bool
  default     = true
}

# Network Configuration
variable "private_network_cidr" {
  description = "CIDR block for private network"
  type        = string
  default     = "10.0.0.0/24"
}

variable "private_network_zone" {
  description = "Network zone for private network"
  type        = string
  default     = "eu-central"
}

# Labels
variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default = {
    project     = "quantapool"
    managed_by  = "terraform"
  }
}

# Alert Configuration
variable "discord_webhook_url" {
  description = "Discord webhook URL for alerts"
  type        = string
  default     = ""
  sensitive   = true
}

variable "telegram_bot_token" {
  description = "Telegram bot token for alerts"
  type        = string
  default     = ""
  sensitive   = true
}

variable "telegram_chat_id" {
  description = "Telegram chat ID for alerts"
  type        = string
  default     = ""
}

# Contract Addresses (Testnet defaults)
variable "stqrl_address" {
  description = "stQRL contract address"
  type        = string
  default     = "0x844A6eB87927780E938908743eA24a56A220Efe8"
}

variable "deposit_pool_address" {
  description = "DepositPool contract address"
  type        = string
  default     = "0x9E800e8271df4Ac91334C65641405b04584B57DC"
}

variable "rewards_oracle_address" {
  description = "RewardsOracle contract address"
  type        = string
  default     = "0x541b1f2c501956BCd7a4a6913180b2Fc27BdE17E"
}

variable "operator_registry_address" {
  description = "OperatorRegistry contract address"
  type        = string
  default     = "0xD370e9505D265381e839f8289f46D02815d0FF95"
}

variable "zond_rpc_url" {
  description = "Zond RPC endpoint URL"
  type        = string
  default     = "https://qrlwallet.com/api/zond-rpc/testnet"
}

# Security: IP allowlists
variable "allowed_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed to SSH (e.g., ['1.2.3.4/32', '5.6.7.8/32']). Empty list allows all (NOT recommended for production)."
  type        = list(string)
  default     = []  # Empty = allow all (for initial setup only)
}

variable "allowed_grafana_ips" {
  description = "List of IP addresses/CIDRs allowed to access Grafana (e.g., ['1.2.3.4/32']). Empty list allows all."
  type        = list(string)
  default     = []  # Empty = allow all
}
