#!/usr/bin/env bash
set -Eeuo pipefail
lifecycle_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${lifecycle_dir}/../.." && pwd)"
runtime_dir="${repo_root}/findings/native-qrl-prototype/lifecycle"
package_dir="$(cd "${repo_root}/../qrl-package" && pwd)"
enclave=quantapool-native-lifecycle-20260914
[[ "${QUANTAPOOL_PUBLIC_LOCAL_NETWORK:-}" == "3151915" ]]
[[ "$(git -C "${package_dir}" rev-parse HEAD)" == "04fd3133a7107229531da425dc750129bb691514" ]]
[[ -z "$(git -C "${package_dir}" status --porcelain --untracked-files=all)" ]]
mkdir -p "${runtime_dir}"
if kurtosis enclave inspect "${enclave}" >/dev/null 2>&1; then
    python3 "${lifecycle_dir}/../network/verify-network.py" "${enclave}" --chain-id 3151915 --output "${runtime_dir}/network.json"
    exit 0
fi
[[ "$(docker image inspect quantapool-prototype/generator:20260914 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "97d65b671a7b86602e932b6e2ec1e0a9bd5ca22c" ]]
docker build --file "${lifecycle_dir}/generator.Dockerfile" --tag quantapool-lifecycle/generator:20260914 "${lifecycle_dir}" > "${runtime_dir}/generator-build.log" 2>&1
kurtosis run --enclave "${enclave}-bind" "${lifecycle_dir}/../network/bind-probe.star" > "${runtime_dir}/bind-probe.log" 2>&1
python3 "${lifecycle_dir}/../network/verify-network.py" "${enclave}-bind" --bind-only > "${runtime_dir}/bind-probe.json"
kurtosis enclave stop "${enclave}-bind" >/dev/null
cleanup_failed() {
    local result=$?
    trap - ERR
    kurtosis enclave stop "${enclave}" >/dev/null 2>&1 || true
    exit "${result}"
}
trap cleanup_failed ERR
kurtosis run --enclave "${enclave}" "${package_dir}/kurtosis.yml" --args-file "${lifecycle_dir}/kurtosis.yaml" > "${runtime_dir}/kurtosis-start.log" 2>&1
python3 "${lifecycle_dir}/../network/verify-network.py" "${enclave}" --chain-id 3151915 --output "${runtime_dir}/network.json"
trap - ERR
