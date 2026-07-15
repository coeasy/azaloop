#!/usr/bin/env bash
set -euo pipefail

# AzaLoop Portable Installer for Linux/macOS
# Usage:
#   curl -fsSL https://github.com/coeasy/azaloop/releases/download/v12.2.0/install.sh | bash
#   bash install.sh
#   bash install.sh --project
#   bash install.sh --client cursor
#   bash install.sh --portable

BANNER='
  ╔══════════════════════════════════════════╗
  ║        AzaLoop Portable Installer        ║
  ║  One-click setup — no Node.js required   ║
  ╚══════════════════════════════════════════╝
'

echo "$BANNER"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.azaloop"
PROJECT=false
CLIENT=""
PORTABLE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT=true; shift ;;
    --client) CLIENT="$2"; shift 2 ;;
    --portable) PORTABLE=true; shift ;;
    --help|-h)
      cat <<EOF
AzaLoop Portable Installer

USAGE:
  bash install.sh                    Install AzaLoop globally
  bash install.sh --project          Install and init current project
  bash install.sh --client cursor    Install for a specific client
  bash install.sh --portable         Extract to current directory (no PATH)
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ "$PORTABLE" = true ]; then
  TARGET_DIR="$SCRIPT_DIR"
  echo "  Portable mode — installing to: $TARGET_DIR"
else
  echo "  Installing to: $TARGET_DIR"
fi

# Step 1: Create target directory
echo ""
echo "  [1/4] Creating installation directory..."
mkdir -p "$TARGET_DIR"

# Step 2: Copy files
echo "  [2/4] Copying AzaLoop files..."

# Detect platform
if [ "$(uname)" == "Darwin" ]; then
  echo "    Platform: macOS"
elif [ "$(uname)" == "Linux" ]; then
  echo "    Platform: Linux"
else
  echo "    Platform: $(uname)"
fi

# Copy executables
cp "$SCRIPT_DIR/aza" "$TARGET_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/azaloop-mcp" "$TARGET_DIR/" 2>/dev/null || true
chmod +x "$TARGET_DIR/aza" "$TARGET_DIR/azaloop-mcp" 2>/dev/null || true
echo "    ✓ Executables"

# Copy bundled JS (fallback)
if [ -f "$SCRIPT_DIR/cli-bundle.js" ]; then
  cp "$SCRIPT_DIR/cli-bundle.js" "$TARGET_DIR/"
  echo "    ✓ CLI bundle"
fi
if [ -f "$SCRIPT_DIR/mcp-bundle.js" ]; then
  cp "$SCRIPT_DIR/mcp-bundle.js" "$TARGET_DIR/"
  echo "    ✓ MCP bundle"
fi

# Copy templates
if [ -d "$SCRIPT_DIR/templates" ]; then
  cp -r "$SCRIPT_DIR/templates" "$TARGET_DIR/"
  echo "    ✓ Templates (25+ clients)"
fi

# Copy docs
if [ -d "$SCRIPT_DIR/docs" ]; then
  cp -r "$SCRIPT_DIR/docs" "$TARGET_DIR/"
  echo "    ✓ Documentation"
fi

# Copy other files
for f in LICENSE README.md README.en.md WELCOME.md; do
  if [ -f "$SCRIPT_DIR/$f" ]; then
    cp "$SCRIPT_DIR/$f" "$TARGET_DIR/"
  fi
done

# Step 3: Add to PATH (shell config + current session)
if [ "$PORTABLE" = false ]; then
  echo ""
  echo "  [3/4] Adding to PATH..."
  SHELL_CONFIG="$HOME/.bashrc"
  if [ -n "${ZSH_VERSION:-}" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
  fi
  if grep -qFq "$TARGET_DIR" "$SHELL_CONFIG" 2>/dev/null; then
    echo "    ✓ Already in shell config PATH"
  else
    echo "export PATH=\"\$PATH:$TARGET_DIR\"" >> "$SHELL_CONFIG"
    echo "    ✓ Added to $SHELL_CONFIG"
  fi
  # Make `aza` available in THIS shell without re-login
  case ":$PATH:" in
    *":$TARGET_DIR:"*) echo "    ✓ Current session PATH already has install dir" ;;
    *) export PATH="$TARGET_DIR:$PATH"; echo "    ✓ Current session PATH updated (aza available now)" ;;
  esac
fi

# Step 4: Initialize project
if [ "$PROJECT" = true ]; then
  echo ""
  echo "  [4/4] Initializing project..."
  CLIENT_ARG=""
  if [ -n "$CLIENT" ]; then
    CLIENT_ARG="--client $CLIENT"
  fi
  "$TARGET_DIR/aza" init $CLIENT_ARG 2>&1
else
  echo ""
  echo "  [4/4] Skipping project init (use --project to init)"
fi

# Done
cat <<EOF

  ✅ AzaLoop installed successfully!

  Commands available:
    aza init          — Initialize current project
    aza setup         — Interactive setup wizard
    aza status        — Show project status
    aza health        — Verify MCP server
    aza loop          — Advance to next action
    aza continue      — Resume from last session
    aza upgrade       — Upgrade from v8/v9

  Documentation:
    $TARGET_DIR/docs/CLIENT-INSTALLATION.md
    $TARGET_DIR/docs/clients/

  Quick start:
    cd your-project
    aza init
    # Open in your AI coding assistant and type your requirements

EOF
