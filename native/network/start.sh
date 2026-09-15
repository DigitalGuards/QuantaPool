#!/usr/bin/env bash
set -Eeuo pipefail
network_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${network_dir}/../.." && pwd)"
runtime_dir="${repo_root}/findings/native-network-20260915"
package_dir="$(cd "${repo_root}/../qrl-package" && pwd)"
enclave=quantapool-native-integrated-20260915
[[ "${QUANTAPOOL_PUBLIC_LOCAL_NETWORK:-}" == "3151916" ]]
[[ "$(git -C "${package_dir}" rev-parse HEAD)" == "04fd3133a7107229531da425dc750129bb691514" ]]
[[ -z "$(git -C "${package_dir}" status --porcelain --untracked-files=all)" ]]
mkdir -p "${runtime_dir}"
if kurtosis enclave inspect "${enclave}" >/dev/null 2>&1; then
    python3 "${network_dir}/verify-network.py" "${enclave}" --output "${runtime_dir}/network.json"
    exit 0
fi
probe_enclave="${enclave}-bind-$(date -u +%H%M%S)"
kurtosis run --enclave "${probe_enclave}" "${network_dir}/bind-probe.star" > "${runtime_dir}/bind-probe.log" 2>&1
python3 "${network_dir}/verify-network.py" "${probe_enclave}" --bind-only > "${runtime_dir}/bind-probe.json"
kurtosis enclave stop "${probe_enclave}" >/dev/null
cleanup_failed() {
    local result=$?
    trap - ERR
    kurtosis enclave stop "${enclave}" >/dev/null 2>&1 || true
    exit "${result}"
}
trap cleanup_failed ERR
kurtosis run --enclave "${enclave}" "${package_dir}/kurtosis.yml" --args-file "${network_dir}/kurtosis.yaml" 2>&1 | python3 "${network_dir}/redact-fixture-log.py" > "${runtime_dir}/kurtosis-start.log"
python3 "${network_dir}/verify-network.py" "${enclave}" --output "${runtime_dir}/network.json"
trap - ERR
