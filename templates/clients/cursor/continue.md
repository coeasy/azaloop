<!-- 共享模板: templates/clients/_shared/v17-continue.md -->
# AzaLoop Auto-Continue（V17 · 8 工具）

## 会话启动（MANDATORY）

1. `aza_session(action=continue)`；无 RESUME 则 `calibrate`
2. 跟随 `next_action` — 不要问用户是否继续

## 唯一工具面

`aza_session` · `aza_prd` · `aza_loop` · `aza_spec` · `aza_quality` · `aza_finish` · `aza_memory` · `aza_meta`

（`aza_auto_loop` / `aza_task_*` / `aza_context_*` 仅为 legacy 别名，禁止当作主指令。）

## 全自动脊柱

**推荐一键入口（优先）：**

```
aza_auto(user_input="需求描述")
→ HOST_MUST_EXECUTE: 立刻执行 next_action / awaitingAction（禁止问 Continue）
→ aza_loop(report_tool, tool_name=刚执行的工具)
→ 重复直到 aza_finish(ship)
```

> 合作式全自动会在 design/build/verify **暂停等宿主工具**；停下来问用户 = 循环「看起来没跑完」。

**分步等价：**

```
aza_prd(review[, auto_approve=true])
→ aza_loop(full)
→ awaitingAction → aza_spec / aza_quality
→ aza_loop(report_tool)
→ aza_finish(ship)
```

无人值守：设置 `AZA_AUTO_APPROVE_PRD=true` 或 review 时传 `auto_approve=true`。

> 注意：open 阶段工具面必须包含 `aza_loop` + `aza_auto`，否则全自动脊柱无法推进（2026-07-16 已修复）。

## MCP 配置

在客户端配置 `mcp.json`，指向 `@azaloop/mcp-server` 或本地 `packages/mcp-server/dist/server.js`，并设置项目 `cwd`。
