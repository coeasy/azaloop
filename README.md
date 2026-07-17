# AzaLoop

**PRD-driven autonomous development loop engine for AI coding assistants.**

[中文](#中文) | [English](#english)

---

<a name="english"></a>

## English

AzaLoop is an **MCP server** that drives a full-auto development cycle. Install any of 25+ supported AI coding assistants, run **one command**, and your AI gains the ability to autonomously plan, code, test, and deliver software.

### What makes AzaLoop different

- **PRD auto Competitive Research** — when generating/reviewing a PRD, AzaLoop searches GitHub for similar open-source projects and injects a `## Competitive Research` section (unique vs OpenSpec / Superpowers / ralphy / spec-kit).
- **Thin MCP surface (≤9 tools)** — full Spec → Loop → Quality → Ship spine without exploding tool count.
- **Cross-client resume** — durable `.aza/` STATE + RESUME + `next_action` chain across Cursor / Claude Code / OpenCode and more.
- **No-extra-input cooperative full-auto** — `aza_auto` selects the plan and pauses only when the host coding assistant must implement; the host **must** execute `next_action` → `aza_loop(report_tool)` until `aza_finish(ship)` without asking the user again.
- **L3 inline** — with `autonomy.level: L3`, design, quality, and shipping run inline; only implementation is delegated to the host coding assistant.

### One-Command Setup

```bash
# Auto-detect your AI coding assistant & generate config
npx @azaloop/cli init
```

Then open your AI assistant and type your requirements. AzaLoop handles the rest.

### 能力矩阵（自动从注册表生成）

<!-- AZA_CAPABILITIES_START -->

## AzaLoop 能力矩阵

> 来源: `packages/core/src/evidence/capability-registry.ts` | 总计: 14 | experimental: 2 | verified: 11 | certified: 1

> verified 证据覆盖率: 100% | certified E2E 覆盖率: 100%

| 能力 | 成熟度 | 对齐竞品 | 证据 |
|------|--------|----------|------|
| 跨会话自动续航 | ✅ verified | planning-with-files, comet, ralphy-openspec | 2 测试 / E2E / @2026-07-16 |
| 跨客户端续跑 | ✅ verified | ai-coding-guide, superpowers-zh | 1 测试 / @2026-07-16 |
| PRD 自动 GitHub 竞品研究 | 🏆 certified | claude-skills, OpenSpec | 1 测试 / E2E / client / @2026-07-16 |
| autonomy.level 硬门控 | ✅ verified | loop-engineering | 1 测试 / @2026-07-16 |
| Process Skills 硬门控 | ✅ verified | superpowers, agent-skills | 1 测试 / @2026-07-16 |
| ShellWard DLP 默认扫 tools/call | ✅ verified | shellward | 1 测试 / @2026-07-16 |
| Batch 真 git worktree 并行 | ✅ verified | ralphy, ralphy-openspec, agency-orchestrator | 1 测试 / @2026-07-16 |
| Task Identity 防旧任务污染 | ✅ verified | planning-with-files, comet | 3 测试 / @2026-07-16 |
| Maker/Checker 双轨 | ✅ verified | superpowers, gstack | 1 测试 / @2026-07-16 |
| YAML Workflow 编排 | ✅ verified | agency-orchestrator, OpenSpec | 1 测试 / @2026-07-16 |
| 向量记忆 HNSW | ✅ verified | ruflo, Trellis | 2 测试 / @2026-07-16 |
| 多角色对抗式 PRD 审查 | ✅ verified | gstack, agent-skills | 2 测试 / @2026-07-16 |
| 25+ 客户端模板 | 🧪 experimental | ai-coding-guide, superpowers-zh | — |
| Swarm 推理复用 | 🧪 experimental | ruflo | — |
<!-- AZA_CAPABILITIES_END -->

### Per-Client Quick Start Guides

| Client | Guide | Tier |
|--------|-------|------|
| Cursor | [docs/clients/cursor.md](docs/clients/cursor.md) | T1 Full |
| Claude Code | [docs/clients/claude-code.md](docs/clients/claude-code.md) | T1 Full |
| OpenCode | [docs/clients/opencode.md](docs/clients/opencode.md) | T1 Full |
| Trae | [docs/clients/trae.md](docs/clients/trae.md) | T1 Full |
| VS Code | [docs/clients/vscode.md](docs/clients/vscode.md) | T2 |
| Cline | [docs/clients/cline.md](docs/clients/cline.md) | T2 |
| Roo Code | [docs/clients/roo-code.md](docs/clients/roo-code.md) | T2 |
| Windsurf | [docs/clients/windsurf.md](docs/clients/windsurf.md) | T2 |
| Continue | [docs/clients/continue.md](docs/clients/continue.md) | T2 |
| Claude Desktop | [docs/clients/claude-desktop.md](docs/clients/claude-desktop.md) | T2 |
| GitHub Copilot | [docs/clients/github-copilot.md](docs/clients/github-copilot.md) | T2 |
| Gemini CLI | [docs/clients/gemini-cli.md](docs/clients/gemini-cli.md) | T2 |
| Codex CLI | [docs/clients/codex-cli.md](docs/clients/codex-cli.md) | T2 |
| Comate (百度) | [docs/clients/comate.md](docs/clients/comate.md) | T2 |
| WorkBuddy (腾讯) | [docs/clients/workbuddy.md](docs/clients/workbuddy.md) | T2 |
| Qwen Code (阿里) | [docs/clients/qwen-code.md](docs/clients/qwen-code.md) | T2 |
| Aider | [docs/clients/aider.md](docs/clients/aider.md) | T3 |
| Zed | [docs/clients/zed.md](docs/clients/zed.md) | T3 |
| Goose | [docs/clients/goose.md](docs/clients/goose.md) | T3 |
| Hermes | [docs/clients/hermes.md](docs/clients/hermes.md) | T3 |
| OpenClaw | [docs/clients/openclaw.md](docs/clients/openclaw.md) | T3 |
| Kiro | [docs/clients/kiro.md](docs/clients/kiro.md) | T3 |
| Codeium | [docs/clients/codeium.md](docs/clients/codeium.md) | T3 |
| Droid | [docs/clients/droid.md](docs/clients/droid.md) | T3 |
| OpenHands | [docs/clients/openhands.md](docs/clients/openhands.md) | T3 |

### Quick Install

#### Method 1: One-Command Setup (Recommended)

```bash
# Auto-detect your AI coding assistant & generate config
npx @azaloop/cli init
```

#### Method 2: Interactive Setup Wizard

```bash
# Guided setup with client selection
aza setup

# Or from npx
npx @azaloop/cli setup
```

#### Method 3: Portable Installer (No Node.js Required)

From source (developers):

```bash
pnpm exec aza pack --install
```

Or download a release:

**Windows:**
```powershell
# Download and run the portable installer
irm https://github.com/coeasy/azaloop/releases/latest/download/azaloop-portable.zip |
  Expand-Archive -DestinationPath azaloop
cd azaloop
.\install.ps1
```

**macOS/Linux:**
```bash
# One-line install
curl -fsSL https://github.com/coeasy/azaloop/releases/latest/download/azaloop-portable.zip |
  unzip - && cd azaloop && bash install.sh
```

#### Method 4: Global npm Install

```bash
npm install -g @azaloop/cli @azaloop/mcp-server
```

### Full English Docs

[README.en.md](README.en.md)

---

<a name="中文"></a>

## 中文

**AzaLoop** 是一个 PRD 驱动的自主开发循环引擎，以 MCP 服务器形式运行。安装任意一款支持的 AI 编码助手客户端，运行**一条命令**，你的 AI 就能自动完成从需求到交付的全流程。

### 差异化卖点

- **PRD 自动 GitHub 竞品研究** — 生成/评审 PRD 时自动搜索同类开源项目，写入 `## Competitive Research`（相对 OpenSpec / Superpowers / ralphy / spec-kit 为赛道独有能力，18 竞品清单全缺失）。
- **薄 MCP 工具面（≤9）** — Spec → Loop → Quality → Ship 全脊柱，不膨胀工具数。
- **跨客户端续航** — `.aza/` STATE + RESUME + `next_action` 链式驱动；cursor/trae/opencode/claude-code 切换可续跑。
- **无需追加输入的合作式全自动** — `aza_auto` 自动选择方案，仅在宿主编码助手需要实现代码时暂停；宿主必须立刻执行 `next_action` → `aza_loop(report_tool)` 直到 `aza_finish(ship)`，全程不再询问用户。
- **L3 内联** — `autonomy.level: L3` 时 design / quality / ship 全部内联，只有 implement（写码）委托给宿主编码助手。
- **18 竞品全量对齐** — 覆盖 planning-with-files、spec-kit、OpenSpec、Superpowers、gstack、Ralphy、Ruflo、Trellis、Comet、ShellWard 等 18 个官方项目的核心能力；详见 [docs/competitive-analysis/](docs/competitive-analysis/) 与 `packages/core/src/evidence/capability-registry.ts`（experimental / verified / certified 三档成熟度注册表）。

### 安装方式

#### 方式 1：一行命令（推荐）

```bash
# 自动检测客户端并生成配置
npx @azaloop/cli init
```

#### 方式 2：交互式安装向导

```bash
# 引导式安装，自动选择客户端
aza setup

# 或从 npx 运行
npx @azaloop/cli setup
```

#### 方式 3：便携安装包（无需 Node.js）

从源码一键构建并安装（开发者）：

```bash
# 在 monorepo 根目录
pnpm exec aza pack --install
# 等价于 pnpm build:portable 后运行 dist/portable/install.ps1|install.sh
```

或从 GitHub Release 下载：

**Windows:**
```powershell
irm https://github.com/coeasy/azaloop/releases/latest/download/azaloop-portable.zip |
  Expand-Archive -DestinationPath azaloop
cd azaloop
.\install.ps1
```

**macOS/Linux:**
```bash
curl -fsSL https://github.com/coeasy/azaloop/releases/latest/download/azaloop-portable.zip |
  unzip - && cd azaloop && bash install.sh
```

#### 方式 4：全局 npm 安装

```bash
npm install -g @azaloop/cli @azaloop/mcp-server
```

初始化完成后，在 AI 助手中输入需求，AzaLoop 将自动执行：
```
aza_session(calibrate|continue) → aza_prd(review→approve) → aza_loop(full) ↔ aza_spec/aza_quality + report_tool → aza_finish(ship)
```

### 各客户端快速开始

点击上方 English 表格中的文档链接，查看各客户端的详细配置说明。

### 支持的客户端（25+）

| 层级 | 客户端 | 自动循环 |
|------|--------|----------|
| **T1 完整** | Cursor, Claude Code, OpenCode, Trae | ✅ 全自动 |
| **T2 部分** | VS Code, Cline, Roo Code, Windsurf, Continue, Gemini CLI, Codex CLI, Comate, WorkBuddy, Qwen Code, GitHub Copilot, Claude Desktop | ✅/部分 |
| **T3 基础** | Aider, Zed, Goose, Hermes, OpenClaw, Kiro, Codeium, Droid, OpenHands | ❌ 手动 |

### 特性

- **零 LLM 配置** — 使用 AI 助手的现有模型，无需 API Key
- **PRD 驱动** — 需求 → PRD → Stories → 编码 → 测试 → 交付
- **反射记忆** — 三层记忆（工作/情节/语义）+ 跨会话学习
- **质量门禁** — 五级验证：lint → test → build → security → acceptance
- **三级循环** — 外循环 → 内循环 → 阶段循环，含断路器与完成门
- **10 层架构** — L0(平台) 到 L9(知识)，完全模块化

### 3 分钟入门

```bash
# 1. 创建项目
mkdir my-app && cd my-app

# 2. 初始化 AzaLoop
npx @azaloop/cli init

# 3. 在 AI 助手中打开项目
# 4. 输入需求：帮我创建一个 WebSocket 聊天应用
```

### 架构

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

### 开发

```bash
pnpm install
pnpm check
```

### 项目结构

```
azaloop/
├── packages/
│   ├── shared/      # 共享类型和 schema
│   ├── core/        # 核心循环引擎
│   ├── mcp-server/  # MCP 服务器
│   └── cli/         # CLI 接口 (aza init)
├── templates/       # 25+ 客户端模板
├── docs/            # 文档
│   └── clients/     # 各客户端快速入门
└── scripts/         # 构建和测试脚本
```

### License

MIT
