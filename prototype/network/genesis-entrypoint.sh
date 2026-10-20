#!/usr/bin/env bash
set -Eeuo pipefail

# This wrapper configures only the disposable QuantaPool fixture network.
# The upstream generator implementation and client binaries remain unchanged.
grep -qx 'export CHAIN_ID="3151914"' /config/values.env
grep -qx 'export SLOTS_PER_EPOCH=8' /config/values.env
grep -qx 'export SLOT_DURATION_IN_SECONDS=6' /config/values.env
printf '\nexport EPOCHS_PER_EXECUTION_VOTING_PERIOD=64\n' >> /config/values.env
exec /work/upstream-entrypoint.sh "$@"
