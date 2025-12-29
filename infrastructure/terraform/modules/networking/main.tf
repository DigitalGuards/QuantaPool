# QuantaPool Networking Module
# Creates private network infrastructure for validator nodes

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "private_network_cidr" {
  description = "CIDR block for private network"
  type        = string
}

variable "private_network_zone" {
  description = "Network zone"
  type        = string
}

variable "datacenter" {
  description = "Hetzner datacenter"
  type        = string
}

variable "labels" {
  description = "Resource labels"
  type        = map(string)
}

# Private Network
resource "hcloud_network" "main" {
  name     = "quantapool-${var.environment}"
  ip_range = var.private_network_cidr
  labels   = var.labels
}

# Subnet
resource "hcloud_network_subnet" "main" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = var.private_network_zone
  ip_range     = var.private_network_cidr
}

# Outputs
output "network_id" {
  description = "Network ID"
  value       = hcloud_network.main.id
}

output "subnet_id" {
  description = "Subnet ID"
  value       = hcloud_network_subnet.main.id
}

output "network_cidr" {
  description = "Network CIDR"
  value       = hcloud_network.main.ip_range
}
