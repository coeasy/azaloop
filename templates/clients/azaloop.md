# AzaLoop V12.2 循环规则 — Goose

> 本文件由 `aza setup --client Goose` 从 `templates/_shared/v12.2-rules.md` 生成。
> 请勿手动编辑——重新运行 `aza setup` 会覆盖。自定义规则请放在客户端专属的 rules 文件中。

## 自动循环驱动（核心）

- 每次工具调用返回的 `next_action` **必须自动执行**，不得跳过
- `next_action.action = 'done'` 时停止循环
- `next_action.action = 'escalate'` 时暂停并通知用户
- **禁止 Agent 自行决定下一步**——必须遵循 `next_action` 链
- 违反自动循环将触发 `stage_violation` strike

## PRD 先行（CP2/CP3）

- 用户提交新需求时，**先调用 `aza_prd_review`** 生成 PRD 摘要
- 展示 PRD 摘要后，等待用户确认（`aza_prd_approve`）
- **60s 无输入自动确认**（V12.2 超时机制）
- 用户可调用 `aza_prd_modify` 提修改意见，或 `aza_prd_cancel` 取消
- PRD approve 后自动生成 `.aza/contract.md`（execution-contract，spec-superflow 模式）
- **禁止跳过 PRD 直接进 build**——StageToolGuard 会硬拦截并记录 Red Flag RF-1

## 状态持久化（comet 模式）

- 每次工具调用自动更新 `.aza/STATE.yaml`（机器拥有写入，Agent 只读）
- 每次工具调用自动预写 `.aza/RESUME.md`（崩溃恢复用）
- 每次状态转换追加到 `.aza/audit.jsonl`（append-only 审计日志）
- 会话启动时调用 `aza_context_calibrate` 恢复状态
- PRD/contract 内容 hash 记录在内存，drift 时强制回 open 阶段

## 工具调用链（主体链路）

```
aza_context_calibrate → aza_prd_review → aza_prd_approve → aza_loop_next →
aza_task_design → aza_task_implement → aza_quality_check → aza_doc_generate → done
```

### 阶段→工具矩阵

| 阶段 | 核心工具 | 说明 |
|---|---|---|
| **open** | `aza_prd_review`、`aza_prd_approve`、`aza_explore` | 需求澄清 + PRD 生成 |
| **design** | `aza_task_design`、`aza_dag` | 任务拆解 + DAG 构建 |
| **build** | `aza_task_implement`、`aza_security_scan`、`aza_style_check` | 实现 + 安全/风格检查 |
| **verify** | `aza_quality_check`、`aza_compliance`、`aza_eval_run` | 质量门 + 合规 + 评估 |
| **archive** | `aza_doc_generate`、`aza_conventions_extract`、`aza_audit` | 文档 + 知识沉淀 + 审计 |

阶段无关工具（所有阶段可用）：`aza_loop_*`、`aza_context_calibrate`、`aza_memory_*`、`aza_skill_*`、`aza_runstate_*`

## Phase Guard（硬规则）

详见 [phase-guard.md](./phase-guard.md)。关键约束：

- open/design/archive 阶段**禁止写 src/ 代码**
- build 阶段**禁止修改 prd.json**
- verify 阶段**禁止修改 src/ 实现**（仅可改测试）
- 跳阶段必须经 `aza_loop_next` 推进

## 健壮性机制

- **3-Strike 架构升级**（spec-superflow）：3 次修复失败 → 质疑架构 → 强制回 design 阶段
- **Recursion Guard**（Trellis）：`aza_task_*`/`aza_quality_check` 禁止嵌套调用
- **break-loop 知识沉淀**（Trellis）：2 次 strike 触发 5 维根因分析，回写 `.aza/spec-conventions/break-loop.jsonl`
- **Circuit Breaker**：4 维度（iteration/token/stagnation/no-progress）× 3 层级（phase/inner/outer）
- **Deadlock Detector**：重复 action 自动检测 + strike

## 会话启动序列

```
1. aza_context_calibrate → 恢复状态
2. 读 .aza/RESUME.md → 了解上次进度
3. aza_loop_status → 查看当前阶段
4. aza_loop_next → 推进循环
```

## Goose 专属配置

- MCP 服务器配置：见 `mcp.json`（或客户端对应配置文件）
- 规则文件路径：`azaloop.md`
- 客户端能力 tier：T3（T1 全自动 / T2 部分 / T3 基础——本客户端已升级为全自动）


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

