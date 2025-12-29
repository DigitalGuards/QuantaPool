# QuantaPool Infrastructure Outputs

output "primary_validator_ip" {
  description = "Public IP of primary validator"
  value       = module.primary_validator.public_ip
}

output "primary_validator_private_ip" {
  description = "Private IP of primary validator"
  value       = module.primary_validator.private_ip
}

output "backup_validator_ip" {
  description = "Public IP of backup validator"
  value       = var.enable_backup_node ? module.backup_validator[0].public_ip : null
}

output "backup_validator_private_ip" {
  description = "Private IP of backup validator"
  value       = var.enable_backup_node ? module.backup_validator[0].private_ip : null
}

output "monitoring_ip" {
  description = "Public IP of monitoring server"
  value       = var.enable_monitoring ? module.monitoring[0].public_ip : null
}

output "monitoring_private_ip" {
  description = "Private IP of monitoring server"
  value       = var.enable_monitoring ? module.monitoring[0].private_ip : null
}

output "grafana_url" {
  description = "URL to access Grafana dashboard"
  value       = var.enable_monitoring ? "http://${module.monitoring[0].public_ip}:3000" : null
}

output "network_id" {
  description = "Hetzner private network ID"
  value       = module.networking.network_id
}

output "ssh_connection_primary" {
  description = "SSH connection command for primary validator"
  value       = "ssh root@${module.primary_validator.public_ip}"
}

output "ssh_connection_backup" {
  description = "SSH connection command for backup validator"
  value       = var.enable_backup_node ? "ssh root@${module.backup_validator[0].public_ip}" : null
}

output "ssh_connection_monitoring" {
  description = "SSH connection command for monitoring server"
  value       = var.enable_monitoring ? "ssh root@${module.monitoring[0].public_ip}" : null
}

output "ansible_inventory" {
  description = "Ansible inventory content"
  value       = <<-EOT
    [primary]
    ${module.primary_validator.public_ip} ansible_user=root private_ip=${module.primary_validator.private_ip}

    %{if var.enable_backup_node}
    [backup]
    ${module.backup_validator[0].public_ip} ansible_user=root private_ip=${module.backup_validator[0].private_ip}
    %{endif}

    %{if var.enable_monitoring}
    [monitoring]
    ${module.monitoring[0].public_ip} ansible_user=root private_ip=${module.monitoring[0].private_ip}
    %{endif}

    [validators:children]
    primary
    %{if var.enable_backup_node}backup%{endif}

    [all:vars]
    environment=${var.environment}
    zond_rpc_url=${var.zond_rpc_url}
  EOT
}
