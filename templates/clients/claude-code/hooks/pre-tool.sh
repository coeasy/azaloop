#!/usr/bin/env bash
# Claude Code pre-tool hook for AzaLoop
# Reads .aza/STATE.yaml and checks that the requested tool is allowed in the
# current stage. Exits 1 to block the tool call if the guard rejects it.
#
# Hook protocol: Claude Code invokes this script with the tool name in
# the first positional argument and the tool args (JSON) on stdin.

set -euo pipefail

TOOL_NAME="${1:-}"
if [[ -z "$TOOL_NAME" ]]; then
  echo "[AzaLoop pre-tool] no tool name provided, allowing" >&2
  exit 0
fi

AZA_DIR="${AZA_DIR:-$PWD/.aza}"
STATE_FILE="$AZA_DIR/STATE.yaml"

# If there is no AzaLoop state we cannot enforce — allow the call.
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# Tiny YAML reader — we only need the top-level `current_stage` field,
# which on a single line is easy to extract with grep/sed. If the file
# is more complex the call falls through and we allow the tool.
STAGE="$(grep -E '^[ \t]*current_stage:' "$STATE_FILE" 2>/dev/null | head -1 | sed -E 's/.*current_stage:[[:space:]]*"?([a-z]+)"?.*/\1/' || true)"

if [[ -z "$STAGE" ]]; then
  exit 0
fi

# Stage→allowed-tools matrix (mirrors packages/core/src/L7_loop/stage-tool-guard.ts).
# Unknown tools are allowed (fail-open) so this hook never blocks legitimate work.
case "$STAGE:$TOOL_NAME" in
  open:aza_task_implement|open:aza_task_design|open:aza_quality_check|open:aza_doc_generate)
    echo "[AzaLoop pre-tool] BLOCKED: $TOOL_NAME not allowed in stage $STAGE" >&2
    exit 1 ;;
  design:aza_task_implement|design:aza_quality_check|design:aza_doc_generate)
    echo "[AzaLoop pre-tool] BLOCKED: $TOOL_NAME not allowed in stage $STAGE" >&2
    exit 1 ;;
  build:aza_prd_review|build:aza_prd_modify|build:aza_prd_approve|build:aza_doc_generate)
    echo "[AzaLoop pre-tool] BLOCKED: $TOOL_NAME not allowed in stage $STAGE" >&2
    exit 1 ;;
  verify:aza_task_implement|verify:aza_prd_modify|verify:aza_doc_generate)
    echo "[AzaLoop pre-tool] BLOCKED: $TOOL_NAME not allowed in stage $STAGE" >&2
    exit 1 ;;
  archive:aza_task_implement|archive:aza_prd_modify|archive:aza_quality_check)
    echo "[AzaLoop pre-tool] BLOCKED: $TOOL_NAME not allowed in stage $STAGE" >&2
    exit 1 ;;
  *)
    exit 0 ;;
esac
