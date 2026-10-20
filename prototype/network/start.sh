#!/usr/bin/env bash
set -Eeuo pipefail

network_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${network_dir}/../.." && pwd)"
package_dir="${QRL_PACKAGE_DIR:-${repo_root}/../qrl-package}"
package_dir="$(cd "${package_dir}" && pwd)"
enclave="${KURTOSIS_ENCLAVE:-quantapool-native-proof-voting64-20260914}"
runtime_dir="${repo_root}/findings/native-qrl-prototype"
probe_enclave="${enclave}-bind"

[[ "${QUANTAPOOL_PUBLIC_LOCAL_NETWORK:-}" == "3151914" ]] || {
    echo "Select this isolated public-fixture network explicitly: QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151914" >&2
    exit 1
}
[[ "${enclave}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]
[[ "$(git -C "${package_dir}" rev-parse HEAD)" == "04fd3133a7107229531da425dc750129bb691514" ]]
[[ -z "$(git -C "${package_dir}" status --porcelain --untracked-files=all)" ]]
mkdir -p "${runtime_dir}"
kurtosis enclave ls

if kurtosis enclave inspect "${enclave}" >/dev/null 2>&1; then
    python3 "${network_dir}/verify-network.py" "${enclave}" --output "${runtime_dir}/network.json"
    exit 0
fi

cleanup_probe() {
    kurtosis enclave stop "${probe_enclave}" >/dev/null 2>&1 || true
}
trap cleanup_probe EXIT
kurtosis run --enclave "${probe_enclave}" "${network_dir}/bind-probe.star" > "${runtime_dir}/preflight.log" 2>&1
python3 "${network_dir}/verify-network.py" "${probe_enclave}" --bind-only > "${runtime_dir}/preflight-bindings.json"
cleanup_probe
trap - EXIT

cleanup_new_network() {
    local status=$?
    trap - ERR
    kurtosis enclave stop "${enclave}" >/dev/null 2>&1 || true
    echo "Stopped only the new prototype enclave after startup validation failed." >&2
    exit "${status}"
}
trap cleanup_new_network ERR
kurtosis run --enclave "${enclave}" "${package_dir}/kurtosis.yml" --args-file "${network_dir}/kurtosis.yaml" > "${runtime_dir}/kurtosis-start.log" 2>&1
python3 "${network_dir}/verify-network.py" "${enclave}" --output "${runtime_dir}/network.json"
trap - ERR
