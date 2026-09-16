#!/usr/bin/env bash
set -Eeuo pipefail
# Configure this disposable fixture through upstream-supported YAML parameters.
grep -qx 'export CHAIN_ID="3151916"' /config/values.env
grep -qx 'export SLOTS_PER_EPOCH=8' /config/values.env
grep -qx 'export SLOT_DURATION_IN_SECONDS=3' /config/values.env
printf '\nexport EPOCHS_PER_EXECUTION_VOTING_PERIOD=64\nexport GENESIS_FORK_VERSION="0x31519160"\nexport KEYSTORE_PASSWORD="password"\n' >> /config/values.env
export QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151916
# Upstream uses xtrace while constructing fixture-only mnemonic arguments.
# Send that trace to a closed-purpose sink, keeping secrets out of logs.
exec 9>/dev/null
export BASH_XTRACEFD=9
[[ "${1:-}" == all ]]
/work/upstream-entrypoint.sh el 2>&1 | python3 /work/redact-fixture-log.py
python3 /work/qualify-genesis.py
/work/upstream-entrypoint.sh all 2>&1 | python3 /work/redact-fixture-log.py
