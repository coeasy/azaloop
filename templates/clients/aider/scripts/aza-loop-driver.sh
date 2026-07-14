#!/usr/bin/env bash
# aza-loop-driver.sh — Aider CLI auto-loop driver wrapper
#
# Runs the AzaLoop auto-loop from the command line, printing the next_action
# after each step so Aider (or any other CLI agent) can observe the chain and
# follow it. This is the fallback for T3 CLI-only clients.
#
# Usage:
#   ./aza-loop-driver.sh [--max-iterations N] [--dry-run] [--task <title>] [--description <desc>]
#
# Exit codes:
#   0 — loop completed (action=done)
#   1 — usage error
#   2 — loop stopped (action=stop or escalate)
#   3 — loop hit max-iterations cap

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
MAX_ITER=50
DRY_RUN=""
TASK=""
DESCRIPTION=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-iterations) MAX_ITER="$2"; shift 2 ;;
    --dry-run) DRY_RUN="--dry-run"; shift ;;
    --task) TASK="$2"; shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

# Build the aza loop command. Prefer npx so the wrapper works before
# `aza` is on PATH (e.g. in a fresh checkout).
cmd=(npx --no-install aza loop
  --max-iterations "$MAX_ITER")
[[ -n "$DRY_RUN" ]] && cmd+=("$DRY_RUN")
[[ -n "$TASK" ]] && cmd+=(--task "$TASK")
[[ -n "$DESCRIPTION" ]] && cmd+=(--description "$DESCRIPTION")

echo "[aza-loop-driver] running: ${cmd[*]}"

# Run and capture exit code.
"${cmd[@]}"
rc=$?

case "$rc" in
  0) echo "[aza-loop-driver] ✅ loop completed"; exit 0 ;;
  1) echo "[aza-loop-driver] ⚠ loop stop/escalate"; exit 2 ;;
  *) echo "[aza-loop-driver] ⚠ loop ended (rc=$rc)"; exit "$rc" ;;
esac
