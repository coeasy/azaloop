# Phase Guard（硬规则，违反即停止）

> 本片段由 `aza setup --client <name>` 注入到各客户端 rules 文件。
> 参考实现：comet 的 `comet-hook-guard.mjs`（硬拦截错误阶段 Write/Edit）+
> spec-superflow 的 `guard.mjs`（程序化拦截非法状态转换）。

## 阶段定义

```
open → design → build → verify → archive → done
```

每个阶段只允许执行该阶段专属的工具调用。跳阶段必须经 `aza_loop_next` 推进，**禁止 Agent 自行判断下一步阶段**。

## 写入规则（硬拦截）

| 阶段 | 允许写入 | 禁止写入 |
|---|---|---|
| **open** | `prd.md`、`prd.json`、`.aza/` 状态文件 | `src/**`、`tests/**`、`docs/**`（除 prd 相关） |
| **design** | `design.md`、`tasks.md`、`diagrams/**`、`.aza/` 状态文件 | `src/**`、`prd.json`（已锁定） |
| **build** | `src/**`、`tests/**`、`.aza/` 状态文件 | `prd.json`、`design.md`（已锁定） |
| **verify** | `tests/**`、`test-results/**`、`.aza/` 状态文件 | `src/**` 实现（已锁定，仅可改测试） |
| **archive** | `docs/**`、`archive/**`、`.aza/` 状态文件 | `src/**`、`prd.json`、`design.md`（已锁定） |

## 决策点前置条件（Red Flags）

以下调用若前置条件未满足，将被 **StageToolGuard 硬拦截** 并记录 Red Flag strike：

| 工具调用 | 必须先调用 | Red Flag ID |
|---|---|---|
| `aza_task_design` | `aza_prd_approve` | RF-1 |
| `aza_task_implement` | `aza_prd_approve` | RF-1 |
| `aza_loop_complete` | `aza_quality_check` | RF-2 |
| `aza_doc_generate` | `aza_quality_check` | RF-2 |

## 违规处理

1. **首次违规**：guard 返回 `{ success: false, next_action: { tool: redirectTool, action: 'refine' } }`，引导 Agent 回正确路径
2. **Red Flag 命中**：自动记录 strike（`reason: 'red_flag'`）
3. **3 次 strike**：触发 3-Strike 架构升级，强制回 `design` 阶段质疑架构
4. **PRD/contract drift**：内容 hash 不匹配时，强制回 `open` 阶段重生成

## 支持的客户端拦截机制

- **MCP 服务器层**（所有 MCP 客户端）：`handleToolCall` 入口的 `StageToolGuard.check` + `wrapTool` 的 `isWriteAllowed`
- **客户端 rules 层**（25 个客户端）：本规则文件 + 支持 hooks 的客户端额外用 `pre-tool` hook 程序化拦截
- **CLI 层**（aider 等 CLI-only 客户端）：`aza loop` 持续驱动器内置 guard
