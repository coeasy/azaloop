<!-- V17 — 共享模板：Cursor / Claude Code 全自动（8 工具） -->
# AzaLoop 自动循环规则（V17 — 8 工具全自动）

## 唯一工具面（必须使用）

`aza_session` · `aza_prd` · `aza_loop` · `aza_spec` · `aza_quality` · `aza_finish` · `aza_memory` · `aza_meta`

每个工具用 `action` 参数区分子命令。

## 硬规则

1. **必须立刻执行 `next_action`**（`wait` / `escalate` / `done` 除外），禁止向用户索要 Continue。
2. 若返回 `data.awaitingAction`：先执行该工具，再 `aza_loop(action=report_tool, tool_name=…)`。
3. 新需求必须走 PRD 门，再进循环。

## 会话启动

1. `aza_session(action=continue)`；若无 RESUME 则 `calibrate`
2. 跟随返回的 `next_action`

## PRD 先行

1. `aza_prd(action=review, title, description)` — approve 默认写 OpenSpec
2. 用户确认 → `aza_prd(action=approve)`；或 `auto_approve=true` / `AZA_AUTO_APPROVE_PRD=true` 无人值守
3. 批准后：`aza_loop(action=full)`

## 循环

```
aza_loop(full)
→ awaitingAction → aza_spec / aza_quality
→ aza_loop(report_tool)
→ … 直到 → aza_finish(ship)
```

## 质量与交付

- verify：`aza_quality(action=check)`（Gate1–7）
- 收工：`aza_finish(action=ship)`
