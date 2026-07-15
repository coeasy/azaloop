# AzaLoop — PRD 驱动的自主开发循环引擎

## Product Requirements Document (PRD)

**版本**: 0.4.0
**创建日期**: 2026-04-22
**最后更新**: 2026-07-14
**状态**: In Progress (0.4.0 — PRD 深度 / 竞品补全 / 严格门禁 / 瘦上下文续航 / 一键 pack)
**最近更新**: 2026-07-14 PRD 生成接入 GitHub 竞品研究；校验 P0+加权≥85；continue/calibrate 瘦包；escalate 软恢复；`aza pack` 一键构建安装包

---

## 1. 产品概述

### 1.1 愿景

AzaLoop 是一个 **PRD 驱动的自主开发循环引擎**，支持从用户自然语言输入自动生成结构化 PRD 文档，并基于 PRD 进行自动化迭代开发，直到所有需求全部实现或达到最大循环次数。

**核心能力**：
- **宿主 LLM 零配置** — 在 Cursor / Claude Code 中直接使用宿主模型，无需 API Key
- **PRD 驱动循环** — 用户需求 → PRD 生成 → 自动拆解 Story → 循环编码 → 测试验证 → 完成交付
- **Reflexion 记忆反馈** — 工作 / 情景 / 语义三层记忆，跨会话经验复用
- **质量门禁** — Lint → Test → Build → Security → Acceptance 五级验证
- **多客户端支持** — Cursor / VS Code / Claude Code / Trae 等 16 个 MCP 客户端
- **自动续航** — Stop Hook + next_action 链式驱动，跨会话全自动

**v2.0 核心改进**：
- **架构精简** — 从 80 个目录精简至 <30 个，代码量减少 50%+
- **功能聚焦** — 移除非核心功能（浏览器自动化、联邦、CI/CD 生成等）
- **模块合并** — 消除 6 对重复模块
- **死代码清理** — 删除所有废弃和孤儿模块

### 1.2 核心理念

```
用户需求 → PRD 生成 → 自动拆解 Story → 循环编码 → 测试验证 → 完成交付
             ↑                                          ↓
             └──── Reflexion 记忆反馈 ────────────────────┘
```

**核心设计原则：宿主 LLM 优先**

在 Cursor 或 Claude Code 中运行时，AzaLoop **不需要**自己的 LLM API Key。宿主环境本身就是 AI Agent，AzaLoop 通过以下方式复用宿主能力：

| 宿主环境 | AzaLoop 的角色 | LLM 谁提供 | 需要 API Key？ |
|---------|-----------|-----------|--------------|
| **Cursor 编辑器** | MCP Server + Rules + Skill + Hook | Cursor 订阅的所有模型 | 否 |
| **Trae** | MCP Server + Rules | Trae 内置模型 | 否 |
| **Windsurf** | MCP Server + Rules | Windsurf 订阅模型 | 否 |
| **VS Code (Copilot)** | MCP Server | Copilot 订阅模型 | 否 |
| **Claude Code** | Plugin（Skills + Agents + MCP） | Claude 订阅 | 否 |
| **独立 CLI** | 自动检测 Host Adapter | 宿主 CLI 提供 | 否（需安装宿主） |

### 1.3 目标用户

| 用户角色 | 使用场景 |
|---------|---------|
| 独立开发者 | 快速将想法转化为可运行项目 |
| 产品经理 | 从模糊需求生成规范 PRD |
| 技术 Lead | 自动化 PoC/原型开发 |
| 团队 | 标准化需求到交付的流程 |

### 1.4 竞品参考

> **对齐原则**：竞品按 **十层架构（L0–L9）** 映射，不把 AzaLoop 当独立 IDE 与 Cursor/Claude Code 直接比。完整 24 个竞品分层分析（含优缺点）见 [docs/COMPETITIVE-ANALYSIS-0.1.0.md](docs/COMPETITIVE-ANALYSIS-0.1.0.md)。

**十层竞品对齐总表（节选）**

| 层 | 对齐竞品 | 主要借鉴点 |
|----|---------|------------|
| **L0 平台适配** | Trellis、OpenSpec、AGENTS.md | 平台能力矩阵、per-turn 工作流态注入、canonical 指令面 |
| **L1 规格/PRD** | OpenSpec、Spec Kit、Kiro、ralphy-openspec、create-prd-skill | 14 章模板 + 14 维自检、artifact 流、Ralph Loop×生命周期 |
| **L2 记忆** | Trellis journals、Mem0、CLAUDE.md | 工作日志模式、语义记忆抽象、分层记忆（反单体） |
| **L3 角色** | superpowers、OpenHands、Devin | research/implement/check 分离、执行沙箱、自主度标杆 |
| **L4 纪律** | superpowers TDD、Karpathy 4 铁律 | RED-GREEN-REFACTOR 绝对铁律、反借口表 |
| **L5 技能** | agent-skills、OpenClaw | Red Flags 护栏、skill 注册发现 |
| **L6 安全** | shellward、gstack | 工具级 PII/注入强制扫描、评审门禁 |
| **L7 循环** | Ralph、loop-engineering、comet、planning-with-files | 三级循环、断路器、Completion Gate、Run Ledger、Reboot Test |
| **L8 编排** | loop-engineering swarm、Codex/Gemini/Claude Code CLI | sub-agent 分派、worktree 隔离、hook 续航 |
| **L9 知识** | OpenSpec Stores、Trellis spec distillation | 跨仓知识共享、经验蒸馏回语义记忆 |

**核心差异化壁垒**：宿主 LLM 优先 + MCP 能力补偿层 + 三级循环引擎 + Completion Gate 防假完成 + 24 客户端等价全自动。

---

## 2. 核心功能

### 2.1 PRD 自动生成引擎

**功能**：从用户自然语言输入生成结构化 PRD 文档

| 能力 | 说明 |
|------|------|
| 用户输入解析 | 支持自然语言文本，智能补全模糊输入 |
| GitHub 参考搜索 | 自动搜索类似开源项目作为参考 |
| PRD 文档生成 | 生成 Markdown + JSON 双格式 PRD |
| PRD 多轮自优化 | Generate → Reflect → Refine 自优化循环 |
| PRD 增量更新 | 支持 evolve/merge/patch 增量更新 |

**PRD 结构**：
```json
{
  "version": "2.0.0",
  "title": "项目名称",
  "description": "项目描述",
  "requirements": [
    {
      "id": "REQ-001",
      "title": "需求标题",
      "description": "详细描述",
      "priority": "P0",
      "status": "pending",
      "acceptance_criteria": ["条件1", "条件2"],
      "tasks": [
        {
          "id": "TASK-001",
          "title": "任务标题",
          "status": "pending",
          "files": [],
          "tests": []
        }
      ]
    }
  ],
  "loop_config": {
    "max_iterations": 50,
    "auto_test": true,
    "auto_review": true
  }
}
```

### 2.2 PRD 驱动的开发循环引擎

**功能**：基于 PRD 自动执行开发循环

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      开发循环引擎                                          │
│                                                                          │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌────────┐  ┌──────┐                    │
│  │ 读取  │─▶│ 规划  │─▶│ 执行  │─▶│ 验证   │─▶│ 完成  │──┐               │
│  │ PRD  │  │ 任务  │  │ 编码  │  │ 测试   │  │ 交付  │  │               │
│  └──────┘  └──────┘  └──────┘  └────────┘  └──────┘  │               │
│      ▲                                                 │               │
│      │    ┌──────────┐  ┌──────────┐                   │               │
│      └────│ Reflexion │◀─│ 更新 PRD  │◀──────────────────┘               │
│           │ 记忆更新  │  │ 状态同步  │                                    │
│           └──────────┘  └──────────┘                                    │
│                                                                        │
│  终止条件: PRD 100% 完成 OR 达到最大循环次数 OR 质量收敛                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**循环控制参数**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_iterations` | 50 | 最大循环次数 |
| `halt_on_failure` | false | 遇到失败时是否停止 |
| `auto_test` | true | 每次编码后自动运行测试 |
| `auto_review` | true | 每次编码后自动代码审查 |
| `retry_count` | 3 | 单个任务失败后的重试次数 |
| `full_auto` | true | Story 之间不停顿，直到 done |

### 2.3 质量门禁系统

**功能**：五级质量验证 Pipeline

```
┌─────────────────────────────────────────────────────┐
│              质量门禁 Pipeline                        │
│                                                      │
│  Gate 1: 静态分析                                     │
│  ├── TypeScript 类型检查 (tsc --noEmit)               │
│  ├── ESLint 规则检查                                  │
│  └── 通过 → 进入 Gate 2 / 失败 → 回到编码             │
│                                                      │
│  Gate 2: 自动测试                                     │
│  ├── 单元测试 (Vitest)                                │
│  ├── 集成测试                                        │
│  └── 通过 → 进入 Gate 3 / 失败 → 回到编码             │
│                                                      │
│  Gate 3: 基线回归检测                                 │
│  ├── 保存修改前的测试快照（baseline）                   │
│  ├── 运行修改后的测试                                  │
│  └── 新增失败 = 0 → 进入 Gate 4 / 否则回到编码         │
│                                                      │
│  Gate 4: 安全扫描（可选）                              │
│  ├── 依赖漏洞检查                                     │
│  ├── 密钥泄露扫描                                     │
│  └── 通过 → 进入 Gate 5 / 失败 → 标记需人工审查        │
│                                                      │
│  Gate 5: 验收标准对照                                 │
│  ├── 逐条验证 acceptance_criteria                     │
│  └── 全部通过 → 标记完成 / 部分失败 → 精确回到失败条件   │
└─────────────────────────────────────────────────────┘
```

### 2.4 Reflexion 记忆系统

**功能**：三层记忆架构，跨会话经验复用

```
┌────────────────────────────────────────────────────┐
│                  记忆系统                            │
│                                                     │
│  Layer 1: 瞬时记忆 (Working Memory)                 │
│  ├── 当前循环的上下文、中间结果                        │
│  ├── 当前任务的代码快照                               │
│  └── 生命周期: 单次循环                              │
│                                                     │
│  Layer 2: 情景记忆 (Episodic Memory)                 │
│  ├── 每次循环的 Reflexion 笔记                       │
│  ├── 成功和失败模式的结构化记录                        │
│  └── 生命周期: 当前项目                              │
│                                                     │
│  Layer 3: 语义记忆 (Semantic Memory)                  │
│  ├── 跨项目的通用经验                                │
│  ├── 用户偏好（代码风格、技术栈倾向）                   │
│  └── 生命周期: 永久（跨项目）                         │
└────────────────────────────────────────────────────┘
```

**量化效果**：
- 重复错误率降低 > 60%
- 跨项目经验复用率 > 30%

### 2.5 多客户端适配层

**功能**：支持 16 个 MCP 客户端

| 客户端 | 集成方式 | 优先级 |
|--------|---------|--------|
| **Cursor** | MCP Server + Rules + Skill + Hook | P0 |
| **Claude Code** | Plugin（Skills + Agents + Hooks + MCP） | P0 |
| **VS Code** | MCP Server + Settings | P0 |
| **Trae** | MCP Server + Rules | P0 |
| **Windsurf** | MCP Server + Rules | P0 |
| **Cline** | MCP Server + Rules | P1 |
| **其他** | MCP Server 通用协议 | P2 |

---

## 3. MCP 工具接口

### 3.1 统一工具面（P0 — 恰好 8 个）

| 工具名 | 说明 | 主要 action |
|--------|------|-------------|
| `aza_session` | 会话生命周期 | init, start, calibrate, status, continue, health |
| `aza_prd` | PRD 闸门 | review, approve, modify, cancel, generate, validate |
| `aza_loop` | 循环驱动 | next, status, complete, full, report_tool, circuit, gate, audit |
| `aza_spec` | 规格/实现 | design, implement, verify, explore, propose, apply, archive, dag |
| `aza_quality` | 质量门禁 | check, security, compliance, eval, style |
| `aza_finish` | 交付归档 | work, archive, ship, conventions_* |
| `aza_memory` | 记忆 | query, record |
| `aza_meta` | 诊断/扩展 | skills_*, runstate_*, audit_log_*, worktree, swarm, stores, dlp_scan |

遗留复合名（如 `aza_task_design`、`aza_context_calibrate`）经 legacy-router / `LEGACY_TOOL_MAP` 薄适配到上表，**禁止**再维护第二套业务实现。

### 3.2 全自动脊柱（Cursor）

```
aza_session(calibrate)
→ aza_prd(review, auto_approve=true)
→ aza_loop(full)
→ awaitingAction: aza_spec / aza_quality
→ aza_loop(report_tool)
→ aza_finish(ship)
```

### 3.3 工具响应格式

所有工具返回统一格式：

```json
{
  "success": true,
  "data": { ... },
  "next_action": {
    "tool": "aza_loop",
    "action": "next",
    "reason": "当前 Story 完成，继续下一个"
  },
  "metadata": {
    "iteration": 5,
    "progress": "60%",
    "tokens_used": 1250
  }
}
```

---

## 4. 配置管理

### 4.1 项目配置

`.aza/config.json`：

```json
{
  "version": "2.0.0",
  "client": "cursor",
  "loop": {
    "max_iterations": 50,
    "full_auto": true,
    "auto_test": true,
    "auto_review": true,
    "retry_count": 3
  },
  "quality": {
    "lint": true,
    "test": true,
    "build": true,
    "security": false
  },
  "memory": {
    "enabled": true,
    "max_episodic": 100,
    "max_semantic": 500
  }
}
```

### 4.2 客户端配置

每个客户端有独立的配置模板：

| 客户端 | 配置文件 | 说明 |
|--------|---------|------|
| Cursor | `.cursor/mcp.json` + `.cursor/rules/` | MCP + Rules |
| Claude Code | `.claude-plugin/plugin.json` | Plugin 配置 |
| VS Code | `.vscode/settings.json` + `.vscode/mcp.json` | Settings + MCP |
| Trae | `.trae/mcp.json` + `.trae/rules/` | MCP + Rules |

---

## 5. 技术架构

### 5.1 包结构

```
azaloop/
├── packages/
│   ├── shared/          # 共享类型、工具、常量
│   ├── core/            # 核心引擎
│   ├── mcp-server/      # MCP 工具暴露层
│   ├── cli/             # CLI 入口
│   └── vscode-extension/ # VS Code 扩展
├── templates/           # 16 客户端模板
├── bin/                 # CLI 入口
├── dist/                # 构建产物
└── docs/                # 文档
```

### 5.2 Core 模块结构（v2.0）

```
packages/core/src/
├── loop/              # 循环引擎核心
├── prd/               # PRD 解析与管理
├── verify/            # 验证与质量门禁
├── memory/            # 记忆系统
├── context/           # 上下文管理
├── continuity/        # 续航机制
├── quality/           # 质量管线
├── workflow/          # 工作流引擎
├── skill/             # Skill 管理
├── security/          # 安全防护
├── audit/             # 审计日志
├── budget/            # 预算控制
├── approval/          # 审批流程
├── config/            # 配置管理
├── host/              # 宿主适配器
├── prompt/            # Prompt 构建
├── llm/               # LLM 提供者
├── i18n/              # 国际化
├── git/               # Git 操作
├── foundation/        # 基础类型/工具/常量
├── state/             # 状态持久化
├── execution/         # 执行引擎
├── planning/          # 规划系统
├── knowledge/         # 知识系统
├── roles/             # 角色系统
└── index.ts           # Barrel export
```

### 5.3 依赖关系

```
shared ← core ← mcp-server ← cli
                  ↑
            vscode-extension
```

**原则**：单向依赖，禁止循环引用

---

## 6. 开发流程

### 6.1 快速开始

```bash
# 安装
npm install -g azaloop

# 初始化项目
cd your-project
aza init --cursor --full-auto

# 在 Agent 中说
"帮我做一个 Todo 应用"
```

### 6.2 标准工作流

```
1. 会话续航
   aza_session(action:"calibrate"|continue) → 跟随 next_action

2. PRD 闸门（含 GitHub 竞品自补充）
   aza_prd(action:"review") → aza_prd(action:"approve")
   产物落盘: .aza/prd.md | prd.json | competitive-research.md | contract.md | openspec/changes/...

3. 开发循环（合作式全自动）
   aza_loop(action:"full")
   → 若 awaitingAction: 执行 aza_spec / aza_quality → aza_loop(report_tool, tool_name=...)
   → 重复直到 done

4. 交付
   aza_quality(action:"check") → aza_finish(action:"ship")
```

无人值守：设置 `AZA_AUTO_APPROVE_PRD=true` 或 `auto_approve=true`，review 后自动 approve 并进入 `aza_loop(full)`。
### 6.3 全自动模式

```json
{
  "loop": {
    "full_auto": true,
    "max_iterations": 100
  }
}
```

全自动模式下：
- Story 之间不停顿
- 自动提交代码
- 自动运行测试
- 自动继续下一个 Story

---

## 7. 非功能需求

### 7.1 性能要求

| 指标 | 目标值 |
|------|--------|
| MCP 工具响应时间 | < 100ms |
| PRD 生成时间 | < 30s |
| 单次循环时间 | < 5min |
| 内存占用 | < 500MB |

### 7.2 可靠性要求

| 指标 | 目标值 |
|------|--------|
| 构建成功率 | > 99% |
| 测试通过率 | > 95% |
| 循环完成率 | > 90% |
| 崩溃恢复率 | 100% |

### 7.3 安全要求

| 要求 | 说明 |
|------|------|
| 路径遍历防护 | `isPathInside` 检查 |
| 输入校验 | Zod schema 验证 |
| 命令注入防护 | `spawnSync` 替代 `execSync` |
| 敏感数据保护 | 不存储 API Key |

---

## 8. 重构计划（v2.0）

### 8.1 重构目标

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| core/src 文件数 | 577 | <200 |
| core/src 代码行数 | 92,463 | <40,000 |
| core/src 目录数 | 80 | <30 |
| 模块重复数 | 6 对 | 0 |
| 死代码模块 | 7+ | 0 |

### 8.2 重构阶段

| 阶段 | 内容 | 时间 |
|------|------|------|
| Phase 1 | 清理死代码与重复模块 | Week 1 |
| Phase 2 | 功能模块降级 | Week 2 |
| Phase 3 | Core 模块重组 | Week 3 |
| Phase 4 | 代码精简与优化 | Week 4 |
| Phase 5 | MCP Server 精简 | Week 5 |
| Phase 6 | 文档与 PRD 更新 | Week 6 |

### 8.3 详细方案

参见 [docs/REFACTOR-V2.0-PLAN.md](docs/REFACTOR-V2.0-PLAN.md)

---

## 9. 0.1.0 优化改进（审计驱动）

> 基于全量代码审计（2026-07-12），发现大量已实现但未接线的模块（孤儿逻辑）和优化机会。以下为 7 Phase 改进计划。

### 9.1 Phase 1: 上下文优化（省 30-50% Token）

| 改进项 | 当前状态 | 目标状态 | 涉及文件 |
|--------|---------|---------|---------|
| ContextOrchestrator 接线 | 孤儿，零调用 | 写入 per-stage JSONL + 注入 maker/checker | `context-orchestrator.ts`, `loop-controller.ts` |
| InjectionEngine 接线 | 孤儿，零调用 | design 阶段注入技术知识 | `injection-engine.ts`, `inner-loop.ts` |
| Token 预算统一 | 3 处断开（200K/50K/无） | azaloop.yaml 统一配置 + 传播到 CircuitBreaker | `config.schema.ts`, `circuit-breaker.ts` |
| 硬编码 token 估算 | `estimateTokens=ceil(len/4)` | 接真实 tokenizer 或明确标注为启发式 | `real-handlers.ts`, `context-orchestrator.ts` |

### 9.2 Phase 2: 批量执行（2-4x 速度提升）

| 改进项 | 当前状态 | 目标状态 | 涉及文件 |
|--------|---------|---------|---------|
| 质量门并行化 | 6 Gate 串行执行 | Gate1-4 `Promise.all` 并行，Gate5 依赖 Gate4 | `quality/pipeline.ts` |
| 多 Story 并行 | OuterLoop 每 cycle 1 story | DAG builder 识别无依赖 story，并行 InnerLoop | `outer-loop.ts`, `dag-builder.ts` |
| DAG Builder 接线 | 存在但未在 design 阶段调用 | design 阶段自动构建任务依赖图 | `inner-loop.ts`, `dag-builder.ts` |
| Scheduler 并行化 | 串行 `while` 循环 | 独立任务 `Promise.all` | `scheduler.ts` |

### 9.3 Phase 3: 检查器缓存（消除重复 30-60s 调用）

| 改进项 | 当前状态 | 目标状态 | 涉及文件 |
|--------|---------|---------|---------|
| tsc 结果缓存 | 每次 checker 重跑 | 按源文件 mtime/hash 缓存，未变不重跑 | `real-handlers.ts` |
| vitest 结果缓存 | 每次 checker 重跑 | 同上 | `real-handlers.ts` |
| secret-scan 缓存 | 每次 verify 重跑 | 按 commit hash 缓存 | `real-handlers.ts` |
| build/verify 去重 | 两个阶段跑相同 tsc/vitest | 同次 next() 内共享缓存 | `real-handlers.ts` |
| execSync → exec | 同步阻塞事件循环 | 异步 exec | `gate1-lint.ts`, `gate2-test.ts` |

### 9.4 Phase 4: 孤儿逻辑消除（O-1 到 O-8）

| 编号 | 孤儿类型 | 当前状态 | 修复方案 |
|------|---------|---------|---------|
| O-4 | DynamicBinder 角色注入 | 孤儿，PhaseLoop 无角色 prompt | PhaseLoop 执行前注入 maker/checker 角色 prompt |
| O-5 | DAG Builder design 阶段调用 | 存在但未调用 | design 阶段自动 build DAG |
| O-6 | Gate6 loop-audit 信号 | 注册但传空信号 | 收集真实 18 信号并传递 |
| O-7 | SHA-256 attestation 接入 CompletionGate | CompletionGate 未调用 | 评估 attestation.verified + 调用 evaluate() |
| O-8 | 3-Strike 触发 RESUME | V12 路径未检查 strikes | 添加 strike 检查 + 触发 resumeGenerator |
| O-extra | AutoLoopEngine CircuitBreaker 可见性 | 间接集成，无直接状态 | 暴露 breaker 状态到引擎层 |

### 9.5 Phase 5: 开源基建

| 缺失项 | 优先级 | 说明 |
|--------|--------|------|
| README.md | P0 | 定位、架构图、快速开始、客户端矩阵、贡献指南 |
| LICENSE (MIT) | P0 | 开源许可证 |
| .github/workflows/ci.yml | P0 | typecheck + test + e2e-real-loop CI |
| CONTRIBUTING.md | P1 | 开发环境、分支规范、PR 模板 |
| SECURITY.md | P1 | 漏洞报告流程 |
| CHANGELOG.md | P1 | v0.1.0 条目 |
| package.json publishConfig | P1 | 发布配置（npm registry, files, repository） |
| .gitignore 补全 | P1 | tsbuildinfo, .DS_Store, coverage, .qoder/.trae/.uploads |

### 9.6 Phase 6: MCP 工具修复

| 改进项 | 当前状态 | 目标状态 |
|--------|---------|---------|
| 3 个缺失 schema | `set_condition`/`reset_conditions`/`stage_iterations` 无 schema | 补齐 schema 定义 |
| 工具漂移 | 33 handler vs 32 schema | 统一注册，消除漂移 |

### 9.7 Phase 7: 回归验证

| 验证项 | 命令 |
|--------|------|
| 类型检查 | `pnpm typecheck` |
| 单元测试 | `pnpm test` |
| 端到端真实循环 | `npx tsx scripts/e2e-real-loop.ts` |
| MCP 工具一致性 | 验证 33 handler = 33 schema |

---

## 9. 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| v2.0.0 | 2026-07-09 | 架构精简，核心聚焦，移除非核心功能 |
| v1.0.7 | 2026-06-26 | 工业级稳定版本 |
| v1.0.0 | 2026-06-23 | 正式发布 1.0.0 |
| v0.2.4 | 2026-06-21 | 全自动循环优化 |
| v0.2.0 | 2026-06-17 | God Class 拆分 |
| v0.1.0 | 2026-05-10 | 110+ MCP 工具 |

---

## 10. 附录

### 10.1 术语表

| 术语 | 说明 |
|------|------|
| PRD | Product Requirements Document，产品需求文档 |
| Story | 从 PRD 拆解的可执行任务 |
| Loop | 开发循环，一次迭代执行一个 Story |
| Reflexion | 自我反思，从经验中学习 |
| MCP | Model Context Protocol，模型上下文协议 |
| Pipeline | 质量验证管线 |
| Gate | 质量门禁关卡 |

### 10.2 参考文档

| 文档 | 说明 |
|------|------|
| [README.md](README.md) | 项目说明 |
| [CHANGELOG.md](CHANGELOG.md) | 版本历史 |
| [docs/REFACTOR-V2.0-PLAN.md](docs/REFACTOR-V2.0-PLAN.md) | v2.0 重构方案 |
| [docs/quick-start.md](docs/quick-start.md) | 快速开始 |
| [docs/INSTALL.md](docs/INSTALL.md) | 安装指南 |
| [docs/mcp.md](docs/mcp.md) | MCP 工具参考 |
| [docs/CLIENT-COMPATIBILITY.md](docs/CLIENT-COMPATIBILITY.md) | 客户端兼容性 |

---

**文档结束**
