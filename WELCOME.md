# Welcome to AzaLoop 🚀

You're **1 command away** from AI-powered autonomous development.

## Quick Start

### Option 1: One-Command Setup

```bash
# Step 1: Initialize in your project
npx @azaloop/cli init

# Step 2: Open your AI coding assistant and type:
# "Create a full-stack chat application"
```

### Option 2: Interactive Setup Wizard

```bash
# Guided setup with client selection
aza setup

# Or from npx
npx @azaloop/cli setup
```

### Option 3: Portable Installer (No Node.js Required)

**Windows:**
```powershell
.\install.ps1
```

**macOS/Linux:**
```bash
bash install.sh
```

AzaLoop will auto-execute: `session_start → PRD → loop → done!`

## Why AzaLoop?

- **Zero config** — Works with your existing AI assistant (Cursor, Claude Code, OpenCode, etc.)
- **Zero API keys** — Uses your AI's model, not its own
- **Full auto-loop** — Drives the entire dev cycle: plan → code → test → verify → deliver
- **25+ clients** — Cursor, VS Code, Claude Code, Windsurf, Cline, and more
- **Portable** — No Node.js or npm required with portable installer

## Docs

| What | Where |
|------|-------|
| Per-client guides | `docs/clients/` |
| Installation (中文) | `docs/CLIENT-INSTALLATION.md` |
| Installation (English) | `docs/CLIENT-INSTALLATION.en.md` |
| English README | `README.en.md` |

## Available Commands

```bash
aza init          # Initialize current project
aza setup         # Interactive setup wizard
aza status        # Show project status
aza health        # Verify MCP server
aza loop          # Advance to next action
aza continue      # Resume from last session
aza upgrade       # Upgrade from v8/v9
```

## How It Works

```
Your idea → PRD → Stories → Code → Tests → Security → Delivery
                        ↻ Auto-loop ↻
```

The AI never stops until your feature is shipped. Each stage has quality gates, memory persistence, and automatic fault recovery.

Happy coding! 🎉
