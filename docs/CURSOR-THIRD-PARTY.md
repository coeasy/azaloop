# 第三方 PC 使用 AzaLoop（Cursor 最佳实践）

面向：**别人的电脑 / 客户项目**如何安装、配置 Cursor，并跑通全自动循环。

---

## 推荐路径（按是否已发布 npm）

| 场景 | 最佳方式 |
|------|----------|
| npm 已发布 `@azaloop/mcp-server` | **方式 A：npx**（最快） |
| 仅有本 monorepo / 未发布 | **方式 B：本地 node 指向 dist**（当前团队机推荐） |
| CI / 纯脚本验证 | **方式 C：`verify-spine.ts`**（无 Cursor UI） |

引擎能力（8 工具 + `next_action`）与宿主无关；Cursor 负责**遵守规则连调工具**。

---

## 方式 A — 第三方 PC（发布后）

在**业务项目根目录**（不是必须 clone azaloop 源码）：

```bash
# 1) 安装（任选其一）
npm install -D @azaloop/mcp-server
# 或直接 npx，无需安装

# 2) 初始化 Cursor 配置
npx @azaloop/cli init --client cursor
```

或手动 `.cursor/mcp.json`：

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

规则：把仓库内 `templates/clients/cursor/rules/azaloop.mdc` 拷到项目 `.cursor/rules/`（`alwaysApply: true`）。

可选命令：拷贝 `templates/clients/cursor/commands/*.md` → `.cursor/commands/`。

然后：

1. 用 Cursor 打开该项目  
2. **Settings → MCP** → 启用 `azaloop`，确认 **8 个工具**  
3. 新开 Agent，粘贴项目根 `AZA-CURSOR-PROMPT.md`（见下方脚本）或下列提示  

---

## 方式 B — 当前 monorepo / 未发布（本机与内部分发）

在 azaloop 源码仓先构建：

```powershell
cd D:\work_code\azaloop\azaloop
pnpm install
pnpm --filter @azaloop/core build
pnpm --filter @azaloop/mcp-server build
```

一键给目标项目写好 Cursor 配置（**最佳**）：

```powershell
# 为本仓配置
node scripts/setup-cursor.mjs --target . --mode local --fresh

# 或给独立 demo 项目配置（推荐测效果）
node scripts/setup-cursor.mjs --target D:\tmp\aza-demo-add --mode local --fresh
```

产物：

- `.cursor/mcp.json` → `node …/packages/mcp-server/dist/server.js`
- `.cursor/rules/azaloop.mdc`
- `.cursor/commands/aza-*.md`
- `.aza/` 初始状态
- `AZA-CURSOR-PROMPT.md` 测试提示词

第三方 PC 若拿到 zip/clone 的 azaloop：同样先 `pnpm build`，再对业务目录执行 `--mode local`（`args` 里是**绝对路径**到 `server.js`）。

---

## Cursor 内测试步骤（验收清单）

1. **打开已配置的项目文件夹**（例如 `D:\tmp\aza-demo-add`）  
2. MCP 面板：`azaloop` 绿色 / Tools =  
   `aza_session, aza_prd, aza_loop, aza_spec, aza_quality, aza_finish, aza_memory, aza_meta`  
3. Agent 粘贴 `AZA-CURSOR-PROMPT.md`  
4. 观察 Agent 是否**不问 Continue**、自动：  
   `calibrate → review(+auto approve) → full → awaitingAction → report_tool → … → ship`  
5. 磁盘检查：`.aza/task_plan.md`、`prd.json`、源码与测试、可选 `benchmark.json`

无 UI 冒烟（在 azaloop 仓）：

```powershell
npx tsx scripts/verify-spine.ts
npx tsx scripts/check-mcp-drift.ts
```

---

## 主路径（给用户/Agent 的一句话）

```
aza_session(calibrate)
→ aza_prd(review, auto_approve=true)
→ aza_loop(full)
↔ aza_spec / aza_quality + aza_loop(report_tool)
→ aza_finish(ship)
```

环境变量：

| 变量 | 作用 |
|------|------|
| `AZA_AUTO_APPROVE_PRD=true` | review 后自动批准，少点一次确认 |

角色斜杠（已放进 commands）：`/aza-ceo` `/aza-plan` `/aza-design` `/aza-qa` `/aza-cso` `/aza-ship`

---

## 故障排查

| 问题 | 处理 |
|------|------|
| MCP 起不来 | 看 Cursor MCP 日志；`local` 模式确认 `dist/server.js` 已 build |
| 工具不是 8 个 | 在用旧包；改指向本仓 `dist` 或清 npx 缓存 |
| Agent 老问「继续吗」 | 确认 `.cursor/rules/azaloop.mdc` 已 alwaysApply；提示词写死禁止 Continue |
| 改了源码不生效 | 重 build mcp-server → Cursor 里 Reload MCP |
| cwd / `.aza` 跑偏 | 必须在「业务项目根」打开 Cursor，勿只开子目录 |

---

## 安全说明

- 第三方项目只跑 MCP + 规则，**不需要**把整个 azaloop monorepo 放进客户仓库（方式 A）。  
- 方式 B 适合内部未发布阶段：MCP `args` 指向共享构建产物即可。  
- `AZA_AUTO_APPROVE_PRD` 仅用于自动化验收；生产需求可关掉，保留人工 `approve`。
