#!/usr/bin/env bash
set -Eeuo pipefail

network_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${network_dir}/../.." && pwd)"
source_root="${1:?Usage: build-images.sh SOURCE_ROOT GENERATOR_SOURCE}"
generator_source="${2:?Provide the pristine genesis-generator checkout}"
runtime_dir="${repo_root}/findings/native-qrl-prototype"
go_qrl_commit=9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9
qrysm_commit=9b57ae0bbfba13e5f4d9cb0b7c6a45dd02a36de3
generator_commit=97d65b671a7b86602e932b6e2ec1e0a9bd5ca22c

verify_source() {
    local source_dir="$1" expected="$2"
    [[ "$(git -C "${source_dir}" rev-parse HEAD)" == "${expected}" ]]
    [[ -z "$(git -C "${source_dir}" status --porcelain --untracked-files=all)" ]]
}
verify_source "${source_root}/go-qrl" "${go_qrl_commit}"
verify_source "${source_root}/qrysm" "${qrysm_commit}"
verify_source "${generator_source}" "${generator_commit}"
mkdir -p "${runtime_dir}/bin" "${runtime_dir}/generator"
printf '*\n!bin/\n!bin/**\n!generator/\n!generator/**\n' > "${runtime_dir}/.dockerignore"

export GOTOOLCHAIN=go1.26.5 CGO_ENABLED=0 GOMAXPROCS=4
go_bin="${GO_BINARY:-go}"
"${go_bin}" -C "${source_root}/go-qrl" build -p 4 -mod=readonly -trimpath \
    -o "${runtime_dir}/bin/gqrl" ./cmd/gqrl
for component in beacon-chain validator qrysmctl; do
    "${go_bin}" -C "${source_root}/qrysm" build -p 4 -mod=readonly -trimpath \
        -o "${runtime_dir}/bin/${component}" "./cmd/${component}"
done
"${go_bin}" -C "${source_root}/qrysm" build -p 4 -mod=readonly -trimpath \
    -o "${runtime_dir}/bin/deposit" ./cmd/staking-deposit-cli/deposit

cp -a "${generator_source}/apps" "${generator_source}/defaults" \
    "${generator_source}/config-example" "${generator_source}/entrypoint.sh" \
    "${runtime_dir}/generator/"
cp "${network_dir}/genesis-entrypoint.sh" "${runtime_dir}/generator/quantapool-entrypoint.sh"
for target in execution beacon validator generator; do
    revision="${qrysm_commit}"
    repository=https://github.com/cyyber/qrysm.git
    if [[ "${target}" == execution ]]; then
        revision="${go_qrl_commit}"
        repository=https://github.com/cyyber/go-qrl.git
    elif [[ "${target}" == generator ]]; then
        revision="${generator_commit}"
        repository=https://github.com/cyyber/qrl-genesis-generator.git
    fi
    docker build --file "${network_dir}/runtime.Dockerfile" \
        --target "${target}" --tag "quantapool-prototype/${target}:20260914" \
        --label "org.opencontainers.image.revision=${revision}" \
        --label "org.opencontainers.image.source=${repository}" \
        --label "org.quantapool.qrysm.revision=${qrysm_commit}" \
        --label "org.quantapool.execution-voting-period=64" \
        "${runtime_dir}"
done
sha256sum "${runtime_dir}/bin/"* > "${runtime_dir}/binary-sha256.txt"
verify_source "${source_root}/go-qrl" "${go_qrl_commit}"
verify_source "${source_root}/qrysm" "${qrysm_commit}"
verify_source "${generator_source}" "${generator_commit}"
