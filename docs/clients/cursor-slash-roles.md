# Cursor 角色 Slash 命令（gstack 精简映射）

> 不新增 MCP 工具；命令映射到既有 8 工具 + skills。

| 命令 | 意图 | 底层 |
|------|------|------|
| `/aza-ceo` | 战略挑战 / 范围收敛 | `aza_prd` multi_review + CEO 视角 |
| `/aza-cso` | 安全审计 | `aza_quality action=security` |
| `/aza-qa` | 验收 / UI QA | `aza_quality action=check` / `ui_qa` |
| `/aza-review` | 双轨审查 | Maker/Checker + `aza_quality` |
| `/aza-plan` | 写实施计划 | brainstorming → writing-plans skills |
| `/aza-design` | 设计门 | `aza_spec(design)` 或 `aza_prd(explore)` 只读预研 |
| `/aza-ship` | 发布 | `aza_finish(ship)` — 无 quality-passed 会被硬拦 |

## Swarm（经 aza_meta，非独立工具）

| MCP | 说明 |
|-----|------|
| `aza_meta(swarm_status)` | 状态 |
| `aza_meta(swarm_dispatch)` | 派发 |
| `aza_meta(swarm_report)` | 汇报 |

相对 ruflo：有协调器，无 ReasoningBank（P3 延后）。

## 竞品刷新

`aza_meta(competitive_refresh, query=…)` → `runCompetitiveResearch(..., { force: true })`
