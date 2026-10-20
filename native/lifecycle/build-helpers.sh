#!/usr/bin/env bash
set -Eeuo pipefail

helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${helper_dir}/../.." && pwd)"
source_root="${1:?Usage: build-helpers.sh PRISTINE_SOURCE_ROOT}"
runtime_dir="${repo_root}/findings/native-network-20260915"

verify_source() {
    [[ "$(git -C "$1" rev-parse HEAD)" == "$2" ]]
    [[ -z "$(git -C "$1" status --porcelain --untracked-files=all)" ]]
}
verify_source "${source_root}/qrysm" 3b816311ac3e86b7a7af40a062ae290318554f7a
verify_source "${source_root}/go-qrl" 9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9
mkdir -p "${runtime_dir}/bin"
export GOTOOLCHAIN=go1.26.5 GOWORK=off CGO_ENABLED=0 GOMAXPROCS=2
go -C "${source_root}/qrysm" build -p 2 -mod=readonly -trimpath \
    -o "${runtime_dir}/bin/key-fixture" "${helper_dir}/key-fixture.go"
go -C "${source_root}/go-qrl" build -p 2 -mod=readonly -trimpath \
    -o "${runtime_dir}/bin/predict-address" "${helper_dir}/predict-address.go"
go -C "${repo_root}/native/proofs" build -p 2 -mod=readonly -tags=develop \
    -o "${runtime_dir}/bin/analyze-finality" ./cmd/analyze-finality
sha256sum "${runtime_dir}/bin/key-fixture" "${runtime_dir}/bin/predict-address" \
    "${runtime_dir}/bin/analyze-finality" > "${runtime_dir}/lifecycle-helper-sha256.txt"
verify_source "${source_root}/qrysm" 3b816311ac3e86b7a7af40a062ae290318554f7a
verify_source "${source_root}/go-qrl" 9b404c38a63bfebe07cfd07b5f5d144d1c2cf9b9
