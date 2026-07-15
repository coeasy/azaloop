<!-- 共享模板: templates/clients/_shared/v17-continue.md -->
# AzaLoop Auto-Continue（V17 · 9 工具）

## 会话启动（MANDATORY）

1. `aza_session(action=continue)`；无 RESUME 则 `calibrate`
2. 跟随 `next_action` — 不要问用户是否继续

## 唯一工具面

`aza_session` · `aza_auto` · `aza_prd` · `aza_loop` · `aza_spec` · `aza_quality` · `aza_finish` · `aza_memory` · `aza_meta`

（`aza_auto_loop` / `aza_task_*` / `aza_context_*` 仅为 legacy 别名，禁止当作主指令。）

## 一键全自动（推荐）

```
aza_auto(user_input="需求描述")
→ 自动完成：PRD → 循环 → 质量 → 交付
```

**调用 aza_auto 后，宿主 AI 必须立即执行返回的 next_action，不要询问用户。**

## 手动全自动脊柱（备选）

```
aza_prd(review[, auto_approve=true])
→ aza_loop(full)
→ awaitingAction → aza_spec / aza_quality
→ aza_loop(report_tool)
→ aza_finish(ship)
```

无人值守：设置 `AZA_AUTO_APPROVE_PRD=true` 或 review 时传 `auto_approve=true`。

## MCP 配置

在客户端配置 `mcp.json`，指向 `@azaloop/mcp-server` 或本地 `packages/mcp-server/dist/server.js`，并设置项目 `cwd`。
