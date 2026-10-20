#!/usr/bin/env bash
set -Eeuo pipefail
grep -qx 'export CHAIN_ID="3151915"' /config/values.env
grep -qx 'export SLOTS_PER_EPOCH=8' /config/values.env
grep -qx 'export SLOT_DURATION_IN_SECONDS=3' /config/values.env
printf '\nexport EPOCHS_PER_EXECUTION_VOTING_PERIOD=64\n' >> /config/values.env
exec /work/upstream-entrypoint.sh "$@"
