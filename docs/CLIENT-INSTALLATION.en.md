# AzaLoop Client Installation & Configuration Guide

Supporting **25+ MCP clients** across major AI coding assistants.

---

## Table of Contents

1. [One-Command Setup (Recommended)](#1-one-command-setup-recommended)
2. [Client Configuration](#2-client-configuration)
3. [Verification](#3-verification)
4. [Full Auto-Loop Flow](#4-full-auto-loop-flow)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. One-Command Setup (Recommended)

No manual configuration needed! Run a single command to configure any supported AI coding assistant:

```bash
# Auto-detect & configure
npx @azaloop/cli init

# Or specify a client
npx @azaloop/cli init --client cursor
npx @azaloop/cli init --client opencode
npx @azaloop/cli init --client claude-code
npx @azaloop/cli init --client vscode
npx @azaloop/cli init --client windsurf
# ... 25+ clients supported
```

### What `aza init` Does Automatically

1. Detects your AI coding assistant (or uses `--client` flag)
2. Creates `.aza/` workspace directory with STATE.yaml, RESUME.md, run-state.json
3. Generates the correct MCP configuration file (`.cursor/mcp.json`, `.opencode/mcp.json`, etc.)
4. Generates client rules files (rules.md, .clinerules, CLAUDE.md, etc.)
5. Creates session continue instructions for auto-loop flow
6. **Total time: < 1 second**

### Initialize from Within AI Chat

If you're already in an AI chat, call the MCP tool directly:

```
Use tool: aza_init
```

The AI will automatically set up everything for your project.

---

## 2. Client Configuration

### Installation Methods

#### Method A: Global Install (Recommended)

```bash
npm install -g @azaloop/mcp-server
# or
pnpm add -g @azaloop/mcp-server
```

#### Method B: Local Project Install

```bash
cd your-project
npm install @azaloop/mcp-server
```

#### Method C: Local Development (Monorepo)

```bash
git clone https://github.com/your-org/azaloop.git
cd azaloop
pnpm install
pnpm build
```

### Common MCP Config Format

All MCP clients use a similar JSON format:

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "env": {}
    }
  }
}
```

> **Tip**: Use `npx @azaloop/cli init` instead of manual JSON editing.

### Per-Client Quick Reference

| Client | Config File | Rules File | Auto-Loop |
|--------|-------------|------------|-----------|
| OpenCode | `.opencode/mcp.json` | `rules.md` | ✅ |
| Cursor | `.cursor/mcp.json` | `rules/azaloop.mdc` | ✅ |
| Claude Code | `.claude/mcp.json` | `CLAUDE.md` | ✅ |
| Trae | `.trae/mcp.json` | `rules.md` | ✅ |
| VS Code | `.vscode/settings.json` | `copilot-instructions.md` | ✅ |
| Windsurf | `.windsurf/mcp.json` | `rules/azaloop.md` | ❌ |
| Cline | `cline_mcp_settings.json` | `.clinerules` | ✅ |
| Roo Code | `.roo/mcp.json` | `azaloop.md` | ✅ |
| Continue | `.continue/config.json` | `.continuerules` | ❌ |
| Claude Desktop | `claude_desktop_config.json` | — | ❌ |
| GitHub Copilot | `.github/mcp.json` | `copilot-instructions.md` | ❌ |
| Gemini CLI | `.gemini/mcp.json` | `rules.md` | ✅ |
| Codex CLI | `mcp.json` | `AGENTS.md` | ✅ |
| Comate | `.comate/mcp.json` | `rules.md` | ✅ |
| WorkBuddy | `.workbuddy/mcp.json` | `rules.md` | ✅ |
| Qwen Code | `.qwen/mcp.json` | `rules.md` | ✅ |
| Zed | `.zed/mcp.json` | — | ❌ |
| Aider | — | `CONVENTIONS.md` | ❌ |
| Goose | `mcp.json` | — | ❌ |
| Hermes | `.hermes/mcp.json` | `skills/aza-loop.md` | ❌ |
| OpenClaw | `mcp.json` | `clawhub.json` | ❌ |
| Kiro | `.kiro/mcp.json` | `azaloop.md` | ❌ |
| Codeium | `.codeium/mcp.json` | — | ❌ |
| Droid | `.droid/mcp.json` | — | ❌ |
| OpenHands | `.openhands/mcp.json` | `instructions.md` | ❌ |

For detailed per-client guides, see [docs/clients/](clients/).

---

## 3. Verification

### Quick Check

In your AI assistant, call:

```
Use tool: aza_health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "state": "ready"
}
```

### Session Start

```
Use tool: aza_session_start
```

Expected response:
```json
{
  "session_started": true,
  "client": "cursor",
  "stages": ["open", "design", "build", "verify", "archive"]
}
```

### Full Pipeline Test

```
User: Create a hello world API
```

AzaLoop should auto-execute: `aza_init` → `aza_session_start` → `aza_prd_generate` → `aza_loop_next` → ... → completion.

### Manual Verification

```bash
# Check if MCP server can start
npx @azaloop/mcp-server --version

# Run verification (if in monorepo)
pnpm test
```

---

## 4. Full Auto-Loop Flow

Once configured, AzaLoop drives a complete development cycle automatically:

```
User Input → aza_session_start → aza_prd_generate → PRD Validation
    → Story Decomposition → aza_loop_next
        → Inner Loop (5 stages):
            1. open:    PRD → Validate
            2. design:  Architecture → Design Docs
            3. build:   TDD (Test → Implement → Pass)
            4. verify:  5 Quality Gates (lint → test → build → security → acceptance)
            5. archive: Documentation → Convention Extraction
        → Next action... until done
    → Delivery
```

### Client Auto-Loop Capabilities

| Capability | T1 Clients | T2 Clients | T3 Clients |
|------------|-----------|-----------|-----------|
| Auto `next_action` chain | ✅ Native | ✅ Via rules | ❌ Manual |
| MCP tools | ✅ | ✅ | ✅/❌ |
| Rules injection | ✅ | ✅ | Partial |
| Hooks | ✅ | ❌ | ❌ |
| Skills | ✅ | Partial | ❌ |

---

## 5. Troubleshooting

### Common Issues

**MCP Server Not Found**
```bash
# Ensure the package is installed
npm list -g @azaloop/mcp-server
# Or reinstall
npm install -g @azaloop/mcp-server
```

**"Tool not found" Error**
- Ensure the MCP server is running (restart your AI assistant)
- Check the config file format is valid JSON
- Run `pnpm build` if using local monorepo

**Config File Not Taking Effect**
- Restart your AI coding assistant after modifying config files
- Some clients (VS Code, Cursor) require a window reload
- Check the config file is in the correct directory (project root)

**Workspace Mode Issues**
- When running from the monorepo, ensure you're in the root directory
- Use `node packages/mcp-server/dist/server.js` instead of `npx` for local dev

### Debug Mode

```bash
# Test MCP server directly
node packages/mcp-server/dist/server.js --debug
```

### Get Help

- Open an issue: https://github.com/your-org/azaloop/issues
- Check per-client guides: [docs/clients/](clients/)

---

## Client-Specific Examples

### OpenCode

Config file: `.opencode/mcp.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "node",
      "args": ["packages/mcp-server/dist/server.js"],
      "env": {}
    }
  }
}
```

Rules: `.opencode/rules.md`

### Cursor

Config file: `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "env": {}
    }
  }
}
```

Rules: `.cursor/rules/azaloop.mdc`

### VS Code (GitHub Copilot)

Config file: `.vscode/settings.json`

```json
{
  "mcp.enabled": true,
  "mcp.servers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"]
    }
  },
  "chat.mcpTools": true
}
```

### Cline

Config file: `cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "disabled": false,
      "autoApprove": [
        "aza_prd_generate",
        "aza_loop_next",
        "aza_loop_status",
        "aza_quality_check"
      ]
    }
  }
}
```

### Continue

Config file: `.continue/config.json`

```json
{
  "mcpServers": [
    {
      "name": "azaloop",
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "env": {}
    }
  ]
}
```

### Claude Desktop

Config: `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "env": {}
    }
  }
}
```

---

*For per-client quick-start guides, see [docs/clients/](clients/).*
