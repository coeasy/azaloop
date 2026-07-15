# AzaLoop 客户端安装与配置指南

支持 **24+ MCP 客户端**，覆盖主流 AI 编码助手。

---

## 目录

1. [一行命令初始化（推荐）](#1-一行命令初始化推荐)
2. [客户端配置](#2-客户端配置)
3. [验证安装](#3-验证安装)
4. [全自动循环流程](#4-全自动循环流程)
5. [故障排查](#5-故障排查)
6. [模板参考](#模板参考)

---

## 1. 一行命令初始化（推荐）

### 方式 A：从源码一键构建并本地安装（portable）

在 AzaLoop monorepo 根目录：

```bash
# 构建 dist/portable（CLI + MCP）并执行本机安装脚本
pnpm exec aza pack --install
# 或
pnpm build:portable
# Windows:  cd dist\portable && .\install.ps1
# macOS/Linux: cd dist/portable && bash install.sh
```

安装目标：`%USERPROFILE%\.azaloop`（Windows）或 `~/.azaloop`（Unix）。安装后可用 `aza --version`，再在业务项目中：

```bash
cd your-project
aza init --client cursor
```

### 方式 B：npx / 包管理器初始化

无需手动配置！只需一条命令即可完成所有客户端配置：

```bash
# 在项目目录中运行
npx @azaloop/cli init
```

`aza init` 会自动：

| 步骤 | 说明 |
|------|------|
| 🔍 检测客户端 | 自动识别 24+ 个客户端（Cursor / VS Code / Claude Code / OpenCode 等） |
| ⚙️ 生成 MCP 配置 | 在正确位置创建 `mcp.json` / `settings.json` / `cline_mcp_settings.json` |
| 📄 生成规则文件 | 创建 `rules.md` / `.clinerules` / `CLAUDE.md` / `AGENTS.md` 等 |
| 📁 创建工作目录 | 初始化 `.aza/` 目录（STATE.yaml + RESUME.md + run-state.json） |
| ✅ 验证可用性 | 确认 MCP 服务器文件存在 |

### 指定客户端

如果自动检测未能识别，可以手动指定：

```bash
# 常用客户端
npx @azaloop/cli init --client cursor
npx @azaloop/cli init --client opencode
npx @azaloop/cli init --client claude-code
npx @azaloop/cli init --client vscode

# 完整列表见下方客户端配置章节
```

### 在 AI 助手中初始化

如果你已经在 AI 助手中，可以直接调用 MCP 工具：

```
使用工具: aza_init
参数: {}
```

效果与 CLI 命令相同，无需离开聊天界面。

---

## 2. 客户端配置

### 安装方式

#### 方式 A：全局安装（推荐）

```bash
npm install -g @azaloop/mcp-server
# 或
pnpm add -g @azaloop/mcp-server
```

#### 方式 B：项目本地安装

```bash
cd your-project
npm install @azaloop/mcp-server
```

#### 方式 C：本地开发（从 monorepo 运行）

```bash
git clone https://github.com/your-org/azaloop.git
cd azaloop
pnpm install
pnpm build
```

所有客户端 MCP 配置通用格式：

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

> **建议**：优先使用 `npx @azaloop/cli init` 自动配置，无需手动编辑 JSON。

### 2.1 OpenCode

**配置文件位置**：项目根 `.opencode/mcp.json`

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

**本地开发**：
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

**规则文件**（可选）：复制 `templates/clients/opencode/rules.md` 到 `.opencode/rules.md`

**自动续跑**：`templates/clients/opencode/continue.md` 定义了会话启动流程：
1. `aza_session_start` — 初始化系统
2. `aza_session(action=calibrate)` — 获取上下文
3. `aza_conventions list` — 加载已学约定
4. `aza_loop next` — 续跑循环

---

### 2.2 Cursor

**推荐**：见 [CURSOR-THIRD-PARTY.md](./CURSOR-THIRD-PARTY.md)（第三方 PC + 本机一键配置）。

**配置文件位置**：项目根 `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["-y", "@azaloop/mcp-server"],
      "env": {
        "AZA_AUTO_APPROVE_PRD": "true"
      }
    }
  }
}
```

本地 monorepo（未发布）可用：

```powershell
node scripts/setup-cursor.mjs --target D:\path\to\your-app --mode local --fresh
```

**规则文件**：`.cursor/rules/azaloop.mdc`（来自 `templates/clients/cursor/rules/`）

**Hooks**（可选）：复制 `templates/clients/cursor/hooks/` 到 `.cursor/hooks/`

**Commands**：复制 `templates/clients/cursor/commands/` 到 `.cursor/commands/`

---

### 2.3 VS Code (GitHub Copilot)

**配置文件位置**：项目根 `.vscode/settings.json`

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

**配置文件位置**：项目根 `.vscode/mcp.json`

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

**指令文件**：复制 `templates/clients/github-copilot/instructions/azaloop.md` 到 `.github/copilot-instructions.md`

---

### 2.4 Claude Desktop

**配置文件位置**：`%APPDATA%\Claude\claude_desktop_config.json`（Windows）
`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）

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

**注意**：Claude Desktop 会在工作区目录创建 `.aza/` 目录。建议在项目目录中启动 Claude Desktop。

---

### 2.5 Claude Code

**配置文件位置**：`~/.claude/settings.json`

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

**Agent 配置**：复制 `templates/clients/claude-code/agents/azaloop.json` 到 `.claude/agents/`

**Plugin 配置**：复制 `templates/clients/claude-code/plugin.json` 到 `.claude/plugins/`

**Skills**：复制 `templates/clients/claude-code/skills/azaloop-skills.json` 到 `.claude/skills/`

---

### 2.6 Cline / Roo Code

**Cline 配置文件位置**：项目根 `cline_mcp_settings.json`

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

**Cline 规则**：复制 `templates/clients/cline/.clinerules` 到项目根

**Roo Code 规则**：复制 `templates/clients/roo-code/.roo/azaloop.md` 到 `.roo/`

---

### 2.7 Trae

**配置文件位置**：项目根 `.trae/mcp.json`

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

**规则文件**：复制 `templates/clients/trae/rules.md` 到 `.trae/rules.md`

---

### 2.8 Windsurf

**配置文件位置**：项目根 `.windsurf/mcp.json`

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

**规则文件**：复制 `templates/clients/windsurf/rules/azaloop.md` 到 `.windsurf/rules/`

---

### 2.9 Continue

**配置文件位置**：项目根 `.continue/config.json`

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

**规则文件**：复制 `templates/clients/continue/.continuerules` 到项目根

---

### 2.10 Zed

**配置文件位置**：项目根 `.zed/mcp.json`

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

### 2.11 Codex CLI

**配置文件位置**：项目根 `codex/mcp.json`

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

**AGENTS.md**：复制 `templates/clients/codex-cli/AGENTS.md` 到项目根

---

### 2.12 Gemini CLI

**配置文件位置**：项目根 `.gemini/mcp.json`

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

### 2.13 其他客户端

| 客户端 | 配置文件位置 | 格式参考 |
|--------|------------|---------|
| Comate | `.comate/rules.md` | `templates/clients/comate/` |
| WorkBuddy | `.workbuddy/rules.md` | `templates/clients/workbuddy/` |
| Droid | `.droid/config.yaml` | `templates/clients/droid/` |
| Kiro | `.kiro/azaloop.md` | `templates/clients/kiro/` |
| Qwen Code | `.qwen/rules.md` | `templates/clients/qwen-code/` |
| OpenClaw | `clawhub.json` | `templates/clients/openclaw/` |
| Goose | `mcp.json` | `templates/clients/goose/` |
| OpenHands | `.openhands/instructions.md` | `templates/clients/openhands/` |
| Hermes | `.hermes/skills/aza-loop.md` | `templates/clients/hermes/` |
| Aider | `.aider.conf.yml` | `templates/clients/aider/` |
| Codeium | `.codeium/azaloop.json` | `templates/clients/codeium/` |

所有客户端 MCP 配置通用格式：

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

## 3. 验证安装

### 3.1 检查 MCP 服务器启动

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | npx @azaloop/mcp-server
```

预期输出（第一行）：
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":...}}
```

### 3.2 测试工具列表

```bash
# 发送 initialize + tools/list
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}\n{"jsonrpc":"2.0","id":3,"method":"tools/list"}' | npx @azaloop/mcp-server | findstr tools
```

预期：返回 45+ 个工具定义。

### 3.3 测试健康检查

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"aza_health","arguments":{}}}' | npx @azaloop/mcp-server
```

预期：返回 `"status":"healthy"`。

### 3.4 验证客户端集成

在客户端中打开任意项目，检查：
1. MCP 工具是否可见（通常在聊天框的 `@` 或 `/` 菜单中）
2. 执行 `aza_health` 是否返回 healthy
3. 执行 `aza_session_start` 是否创建 `.aza/` 目录

---

## 4. 全自动循环流程

### 4.1 首次使用

```
User: "请帮我开发一个 React 待办事项应用"

→ LLM 调用 aza_session_start           # 初始化系统
→ LLM 调用 aza_prd_generate            # 生成 PRD
→ LLM 调用 aza_prd_validate            # 校验 PRD
→ LLM 调用 aza_loop_next               # 进入设计阶段
→ LLM 调用 aza_spec(design)            # 拆解 Story
→ LLM 调用 aza_loop_next               # 进入编码阶段
→ LLM 根据 TDD 铁律编码                 # 先写测试再实现
→ LLM 调用 aza_quality_check           # 五级门禁
→ LLM 调用 aza_loop_next               # 进入归档阶段
→ LLM 调用 aza_doc_generate            # 生成文档
→ LLM 调用 aza_conventions_extract     # 沉淀约定
→ Done!
```

**关键规则**：每次工具返回的 `next_action` 必须自动执行，不得跳过。

### 4.2 续跑

```
→ LLM 调用 aza_session_start           # 初始化
→ LLM 调用 aza_session(calibrate)      # 加载状态
→ LLM 调用 aza_conventions list        # 加载约定
→ LLM 调用 aza_loop next               # 从断点继续
```

---

## 5. 故障排查

### 5.1 MCP 服务器无法启动

**症状**：客户端显示 "Failed to start MCP server" 或类似错误。

**检查项**：
- Node.js 版本 ≥ 18：`node --version`
- 全局安装：`npx @azaloop/mcp-server --version`
- 本地安装：检查 `node_modules/@azaloop/mcp-server` 是否存在
- 路径错误：确认 mcp.json 中的 `command` 和 `args` 指向正确

### 5.2 MCP 工具不可见

**症状**：客户端不显示 AzaLoop 工具。

**检查项**：
- 重启客户端
- 配置文件格式：确认 JSON 格式正确（无多余逗号）
- 客户端版本：确认 MCP 支持版本 ≥ 2024-11-05
- `.vscode/settings.json`：确认 `"mcp.enabled": true`

### 5.3 工具调用报错

**症状**：调用 MCP 工具返回错误。

**常见原因**：
- `.aza/` 目录未创建：先调用 `aza_session_start`
- 权限不足：确认项目目录可写
- `workspace_path` 缺失：大多数工具接受可选 `workspace_path` 参数
- 冲突的 MCP 服务器：确认没有其他 MCP 服务器占用同名工具

### 5.4 stdout 被污染

**症状**：JSON-RPC 响应中包含非 JSON 文本（如 `[Hook] Pre-tool...`）。

**原因**：AzaLoop v0.1.0 V12 版本之后已将 Hook 日志改为 `console.warn`（stderr），不影响 stdout。如果遇到此问题，请更新到最新版本。

### 5.5 Windows 编码问题

**症状**：工具描述中的中文显示为乱码。

**原因**：Windows 控制台编码问题。在 PowerShell 中运行：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
```

---

## 模板参考

所有客户端模板位于 `templates/clients/` 目录：

```
templates/clients/
├── opencode/         # OpenCode (mcp.json + rules.md + continue.md)
├── cursor/           # Cursor (mcp.json + rules + hooks)
├── vscode/           # VS Code Copilot (settings.json + mcp.json)
├── claude-desktop/   # Claude Desktop (claude_desktop_config.json)
├── claude-code/      # Claude Code (agents + plugin + skills)
├── cline/            # Cline (cline_mcp_settings.json + .clinerules)
├── roo-code/         # Roo Code (.roo/azaloop.md)
├── trae/             # Trae (mcp.json + rules)
├── windsurf/         # Windsurf (mcp.json + rules)
├── continue/         # Continue (config.json + .continuerules)
├── zed/              # Zed (mcp.json)
├── aider/            # Aider (.aider.conf.yml + CONVENTIONS.md)
├── github-copilot/   # GitHub Copilot (instructions)
├── codex-cli/        # Codex CLI (AGENTS.md)
├── gemini-cli/       # Gemini CLI (mcp.json + rules)
├── comate/           # Comate (.comate/rules.md)
├── workbuddy/        # WorkBuddy (.workbuddy/rules.md)
├── droid/            # Droid (.droid/config.yaml)
├── kiro/             # Kiro (.kiro/azaloop.md)
├── qwen-code/        # Qwen Code (.qwen/rules.md)
├── openclaw/         # OpenClaw (clawhub.json)
├── goose/            # Goose (mcp.json + config.yaml)
├── openhands/        # OpenHands (.openhands/instructions.md)
├── hermes/           # Hermes (.hermes/skills/)
│  └── ...            # + 更多
```

将对应模板复制到项目对应目录即可完成配置。
