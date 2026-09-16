#!/bin/sh
set -eu

monitoring_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v promtool >/dev/null 2>&1; then
    cd "$monitoring_dir/prometheus"
    promtool check rules rules/*.yml
    promtool test rules tests/contract-alerts.test.yml
else
    docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL \
        --security-opt no-new-privileges \
        --volume "$monitoring_dir/prometheus:/rules:ro" --workdir /rules \
        --entrypoint /bin/promtool prom/prometheus:v2.48.0 \
        check rules rules/contract-alerts.yml rules/validator-alerts.yml rules/system-alerts.yml
    docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL \
        --security-opt no-new-privileges \
        --volume "$monitoring_dir/prometheus:/rules:ro" --workdir /rules \
        --entrypoint /bin/promtool prom/prometheus:v2.48.0 \
        test rules tests/contract-alerts.test.yml
fi
