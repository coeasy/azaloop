# AzaLoop

**PRD-driven autonomous development loop engine for AI coding assistants.**

[中文](README.md) | [English](README.en.md)

---

AzaLoop is an **MCP server** that drives a full-auto development cycle. Install any of 25+ supported AI coding assistants, run **one command**, and your AI gains the ability to autonomously plan, code, test, and deliver software.

## One-Command Setup

```bash
# Auto-detect your AI coding assistant & generate config
npx @azaloop/cli init

# Or specify a client
npx @azaloop/cli init --client cursor
npx @azaloop/cli init --client opencode
npx @azaloop/cli init --client claude-code
```

**That's it.** `aza init` will:
1. Detect your AI coding assistant (Cursor, VS Code, Claude Code, etc.)
2. Generate the correct MCP config file
3. Create `.aza/` workspace directory (STATE.yaml + RESUME.md + run-state.json)
4. Generate client-specific rules files
5. Verify MCP server availability

### What Happens Next

Open your AI coding assistant in the project and type:

```
User: Create a React + TypeScript todo app
```

AzaLoop will autonomously execute:
```
aza_session_start → aza_prd_generate → aza_loop_next → ... → done!
```

The full 5-stage pipeline runs automatically:
1. **Open** — Requirements → PRD generation & validation
2. **Design** — Task decomposition & architecture design
3. **Build** — TDD: test → implement → test (automated)
4. **Verify** — 5 quality gates (lint → test → build → security → acceptance)
5. **Archive** — Documentation & convention extraction

## Quick Install

```bash
# Global install (for npx usage)
npm install -g @azaloop/mcp-server

# Or local project install
npm install @azaloop/mcp-server
```

## Supported Clients (25+)

| Tier | Clients | Auto-Loop |
|------|---------|-----------|
| **T1 Full** | Cursor, Claude Code, OpenCode, Trae | ✅ Full auto |
| **T2 Partial** | VS Code, Cline, Roo Code, Windsurf, Continue, Gemini CLI, Codex CLI, Comate, Workbuddy, Qwen Code, GitHub Copilot, Claude Desktop | ✅/Partial |
| **T3 Minimal** | Aider, Zed, Goose, Hermes, OpenClaw, Kiro, Codeium, Droid, OpenHands | ❌ Manual |

See [docs/clients/](docs/clients/) for per-client guides and [docs/CLIENT-INSTALLATION.md](docs/CLIENT-INSTALLATION.md) for full Chinese documentation.

## Key Features

- **Zero LLM Config** — Uses your AI assistant's existing model (no API key needed)
- **PRD-Driven** — Requirements → PRD → Stories → Code → Test → Delivery
- **Reflexion Memory** — Three-layer memory (working/episodic/semantic) with cross-session learning
- **Quality Gates** — Five-level verification: lint → test → build → security → acceptance
- **Three-Level Loop** — Outer → Inner → Phase loop hierarchy with circuit breaker & completion gate
- **10-Layer Architecture** — Platform (L0) to Knowledge (L9), fully modular

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AzaLoop 10-Layer Architecture            │
├─────────────────────────────────────────────────────────────┤
│ L9  Knowledge   │ Context injection, technique library     │
│ L8  Orchestration│ DAG builder, swarm coordinator          │
│ L7  Loop        │ OuterLoop → InnerLoop → PhaseLoop        │
│ L6  Security    │ Secret scan, injection defense, PII      │
│ L5  Skills      │ Dynamic skill registry & injection       │
│ L4  Discipline  │ 4 iron rules + 3-strike system           │
│ L3  Roles       │ Maker/Checker/Optimizer dynamic binding  │
│ L2  Memory      │ Working/Episodic/Semantic three-layer    │
│ L1  Spec/PRD    │ PRD generator + 14-dimension checker     │
│ L0  Platform    │ 25+ client detection & adaptation        │
└─────────────────────────────────────────────────────────────┘
```

## Development

```bash
git clone https://github.com/your-org/azaloop.git
cd azaloop
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Project Structure

```
azaloop/
├── packages/
│   ├── shared/      # Shared types and schemas
│   ├── core/        # Core loop engine
│   ├── mcp-server/  # MCP server implementation
│   └── cli/         # CLI interface (aza init)
├── templates/       # 25+ client templates
├── docs/            # Documentation
│   └── clients/     # Per-client quick-start guides
└── scripts/         # Build and test scripts
```

## License

MIT

## How to Get Started (3-Minute Walkthrough)

```bash
# Step 1: Create a new project
mkdir my-awesome-app && cd my-awesome-app

# Step 2: Initialize AzaLoop
npx @azaloop/cli init

# Step 3: Open in your AI coding assistant
# (Cursor, Claude Code, OpenCode, etc.)

# Step 4: Tell it what you want
# "Build a full-stack chat application with WebSockets"
```

AzaLoop handles the rest — planning, coding, testing, and delivery. The AI assistant stays in the loop, reviewing and approving each stage output.
