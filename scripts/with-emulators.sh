#!/usr/bin/env bash
# Runs a command with the Firebase emulators available: reuses them when their ports are open,
# otherwise runs the command under `firebase emulators:exec`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
status=$(scripts/emulators.sh status)
if [[ "$status" == *closed* ]]; then
  exec scripts/emulators.sh exec "$*"
else
  exec "$@"
fi
