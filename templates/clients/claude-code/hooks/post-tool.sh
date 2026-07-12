#!/bin/bash
# Claude Code post-tool hook - updates AzaLoop RESUME
# Installed by: aza init --client=claude-code
echo "[AzaLoop] Updating resume after tool call"
npx aza continue 2>/dev/null || true
