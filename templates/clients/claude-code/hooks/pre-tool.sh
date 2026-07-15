#!/usr/bin/env bash
# Claude Code pre-tool hook for AzaLoop (0.2.x / 8 unified tools)
set -euo pipefail

TOOL_NAME="${1:-}"
if [[ -z "$TOOL_NAME" ]]; then
  echo "[AzaLoop pre-tool] no tool name provided, allowing" >&2
  exit 0
fi

AZA_DIR="${AZA_DIR:-$PWD/.aza}"
STATE_FILE="$AZA_DIR/STATE.yaml"

if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

STAGE="$(grep -E '^[ \t]*current_stage:' "$STATE_FILE" 2>/dev/null | head -1 | sed -E 's/.*current_stage:[[:space:]]*"?([a-z]+)"?.*/\1/' || true)"

if [[ -z "$STAGE" ]]; then
  exit 0
fi

# Block legacy discrete tools + wrong-stage host tools (fail-open on unknown).
case "$STAGE:$TOOL_NAME" in
  open:aza_task_implement|open:aza_task_design|open:aza_quality_check|open:aza_doc_generate)
    echo "[AzaLoop pre-tool] BLOCKED: $TOOL_NAME not allowed in stage $STAGE" >&2
    exit 1 ;;
  design:aza_task_implement|design:aza_quality_check|design:aza_doc_generate|design:aza_finish)
    echo "[AzaLoop pre-tool] BLOCKED: $TOOL_NAME not allowed in stage $STAGE" >&2
    exit 1 ;;
  build:aza_prd|build:aza_prd_review|build:aza_prd_modify|build:aza_prd_approve|build:aza_doc_generate|build:aza_finish)
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
