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
