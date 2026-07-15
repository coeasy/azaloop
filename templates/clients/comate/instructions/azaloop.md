<!-- V17 — 共享规则：所有客户端 `aza setup` / rules 生成器的唯一真相源 -->
# AzaLoop — Comate 全自动协议（V17 · 8 工具）

你在 **Comate**（T2）中运行 AzaLoop。

## 唯一工具面（必须使用）

`aza_session` · `aza_prd` · `aza_loop` · `aza_spec` · `aza_quality` · `aza_finish` · `aza_memory` · `aza_meta`

遗留名（`aza_task_*` / `aza_context_*` / `aza_auto_loop` / `aza_loop_next`）仅作别名；**主链路禁止以别名作为目标指令**。

## 硬规则

1. **立刻执行 `next_action`**（`wait` / `escalate` / `done` 除外），禁止向用户索要 Continue。
2. 若返回 `data.awaitingAction`：先执行该工具，再 `aza_loop(action=report_tool, tool_name=…)`。
3. 新需求必须走 **PRD 先行**，再进循环。
4. 不要停下来问「是否继续？」。

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

# Phase Guard（硬规则，违反即停止）

> 本片段由 `aza setup --client <name>` 注入。阶段推进跟随 MCP `next_action`。

## 阶段定义

```
open → design → build → verify → archive → done
```

每个阶段只允许执行该阶段允许的统一工具。跳阶段必须经 `aza_loop(action=full|next)` / `report_tool` 推进，**禁止 Agent 自行判断下一阶段**。

## 写入规则（硬拦截）

| 阶段 | 允许写入 | 禁止写入 |
|---|---|---|
| **open** | `prd.md`、`prd.json`、`.aza/`、`openspec/**` | `src/**`、`tests/**`（除探测） |
| **design** | `design.md`、`tasks.md`、`openspec/**`、`.aza/` | `src/**`、锁定后的 `prd.json` |
| **build** | `src/**`、`tests/**`、`.aza/` | 锁定后的 PRD/design 主文档 |
| **verify** | `tests/**`、`.aza/` | 无关大范围 `src/**` 改动 |
| **archive** | `docs/**`、`.aza/`、CHANGELOG | 锁定实现 |

## 决策点前置条件（Red Flags）

| 工具调用 | 必须先完成 | Red Flag |
|---|---|---|
| `aza_spec(design\|implement)` | `aza_prd(approve)` | RF-1 |
| `aza_finish(ship)` | `aza_quality(check)` 通过 | RF-2 |

## 违规处理

1. **首次**：返回失败 + `next_action` 引导回正确工具
2. **Red Flag**：记录 strike
3. **3 次 strike**：强制回 design
4. **PRD/contract drift**：强制回 open
