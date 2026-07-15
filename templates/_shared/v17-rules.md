<!-- V17 — 共享规则：所有客户端 `aza setup` / rules 生成器的唯一真相源 -->
# AzaLoop — {{CLIENT_NAME}} 全自动协议（V17 · 8 工具）

你在 **{{CLIENT_NAME}}**（{{CLIENT_TIER}}）中运行 AzaLoop。

## 唯一工具面（必须使用）

`aza_session` · `aza_prd` · `aza_loop` · `aza_spec` · `aza_quality` · `aza_finish` · `aza_memory` · `aza_meta`

遗留名（`aza_task_*` / `aza_context_*` / `aza_auto_loop` / `aza_loop_next`）仅作别名；**主链路禁止以别名作为目标指令**。

## 硬规则

1. **立刻执行 `next_action`**（`wait` / `escalate` / `done` 除外），禁止向用户索要 Continue。
2. 若返回 `data.awaitingAction`：先执行该工具，再 `aza_loop(action=report_tool, tool_name=…)`。
3. 新需求必须走 **PRD 先行**，再进循环。
4. 不要停下来问「是否继续？」。

## 一次对话持续调用规则（V20）

1. 收到 `next_action` 后必须立即执行对应工具，不询问用户
2. `awaitingAction` 视同 `next_action`，自动执行指定工具
3. 工具执行完成后自动调用 `aza_loop(action=report_tool)` 续跑
4. 只有以下情况才停下来：
   - `next_action.action === 'wait'`
   - `next_action.action === 'escalate'`
   - `next_action.action === 'done'`
   - 出现 `hard_stop` 信号
5. `instruction` 字段是强指令，必须遵守

## 会话启动

1. `aza_session(action=continue)`；若无 RESUME 则 `calibrate`
2. 跟随返回的 `next_action`

## PRD 先行

1. `aza_prd(action=review, title, description)` — approve 默认写 OpenSpec
2. 用户确认 → `aza_prd(action=approve)`；或 **`auto_approve=true` / `AZA_AUTO_APPROVE_PRD=true`** 无人值守
3. 批准后：`aza_loop(action=full)`

## 自动循环

```
aza_loop(full)
→ awaitingAction → aza_spec / aza_quality
→ aza_loop(report_tool)
→ … 直到 → aza_finish(ship)
```

## 五阶段

open → design → build → verify → archive。阶段推进只跟随 `next_action` / `aza_loop(full)`，禁止 Agent 自行跳阶段。

## 质量与交付

- verify：`aza_quality(action=check)`（Gate1–7）
- 收工：`aza_finish(action=ship)`
