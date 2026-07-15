# AzaLoop V12 三级循环架构方案

> 基于 V11 十层架构，新增三级循环引擎、MCP 事件模拟器、24 客户端全覆盖
> 核心目标：用户输入一句话 → 全自动跨客户端/跨会话/跨模型续航 → 产出工业级应用
> 日期：2026-07-12

---

## 目录

1. [标题与概述](#1-标题与概述)
2. [核心设计理念：三级循环引擎](#2-核心设计理念三级循环引擎)
3. [5 阶段各自的内循环设计](#3-5-阶段各自的内循环设计)
4. [MCP 事件模拟器设计](#4-mcp-事件模拟器设计)
5. [24 客户端适配矩阵](#5-24-客户端适配矩阵)
6. [十层架构各层竞品借鉴详细映射](#6-十层架构各层竞品借鉴详细映射)
7. [三级循环完整流程图](#7-三级循环完整流程图)
8. [核心数据结构](#8-核心数据结构)
9. [关键设计决策](#9-关键设计决策)
10. [风险与缓解](#10-风险与缓解)

---

## 1. 标题与概述

### 1.1 文档定位

本文档是 AzaLoop 项目的 **V12 三级循环架构方案**，是 V11 十层架构的演进版本。V11 已经完成了十层规范层与实现层双轨制的搭建（L0-L9 + Hook 横切层 + 质量门禁），并基于 MCP 能力对齐层实现了跨客户端/跨会话/跨模型的基础续航能力。V12 在此基础上完成三大核心突破：

- **三级循环引擎**：将 V11 的单循环 5 阶段状态机升级为「外循环 + 内循环 + 阶段内循环」三级嵌套循环，让每个阶段都有独立的质量门控与迭代优化能力。
- **MCP 事件模拟器**：彻底修复无 Hook 客户端的续航问题，让 24 个客户端全部实现等效全自动循环。
- **24 客户端全覆盖**：在原有 16 个客户端基础上新增 8 个客户端（Gemini CLI / Codex CLI / Hermes / OpenClaw / Claude Desktop / Comate / WorkBuddy / Qwen Code），并通过降级策略矩阵保证每个客户端都获得一致能力。

### 1.2 核心目标

```
用户输入一句话（"做贪吃小老鼠游戏"）
  ↓ 三级循环全自动驱动
  ↓ 24 客户端任意切换、跨会话/跨模型无缝续跑
  ↓ 每阶段质量达标才推进、不达标自动迭代优化
产出工业级应用（可运行 + 文档完整 + 安全合规）
```

### 1.3 与历史版本的关系

| 文档 | 角色 | V12 取舍 |
|------|------|---------|
| `docs/PRD.md` | 事实规格 | 作为需求基线，V12 是其三级循环实现 |
| `docs/PROJECT-PLAN-V10.md` | 十层融合版 | 采纳其规范层+实现层双轨制 |
| `docs/PROJECT-PLAN-V11.md` | MCP 能力对齐版 | 采纳十层架构 + MCP 能力对齐层，新增三级循环 |
| `docs/assloop-v8/v9-final.md` | 重架构草案 | 十层规范保留，重架构废弃 |

### 1.4 V12 相对 V11 的增量

| 维度 | V11 | V12 |
|------|-----|-----|
| 循环结构 | 单循环 5 阶段状态机 | 三级循环（外循环+内循环+阶段内循环） |
| 阶段质量门控 | 阶段转换无质量验证 | 每阶段独立质量门控，达标才推进 |
| 阶段内迭代 | 无 | 每阶段 maker/checker 分离 + 迭代优化 |
| 无 Hook 客户端 | continue.md 规则注入（依赖 LLM 自觉） | MCP 事件模拟器（工具层面强制执行） |
| 客户端数量 | 16 | 24（+8） |
| PRD 引擎 | 基础生成 | 14 章模板 + 复杂度分级 L1-L4 + 14 维审查 |
| 安全防御 | 5 个扫描器 | 8 层防御 + Policy-as-Code + 中国合规 |
| 循环治理 | 死循环检测 | 断路器(4 维度) + loop-audit(18 信号) + Completion Gate |
| 状态完整性 | SHA-256 校验 | SHA-256 + attestation + 5-Question Reboot Test |
| 上下文编排 | 全量注入 | JSONL 精确注入 + loop-context 压缩 |
| 任务依赖 | 线性任务列表 | DAG 依赖图 + 并行检测 |

### 1.5 核心差异化壁垒

所有竞品（superpowers / Trellis / OpenSpec / comet / loop-engineering）都依赖客户端原生能力（Hook/Rules/Skills）。AzaLoop 独创两条核心壁垒：

1. **MCP 能力补偿层**（V11 已建立）：MCP Server 即能力均衡器 —— 无 Stop Hook 用 `aza_continue` 补偿，无 Rules 用 `aza_context calibrate` 补偿，无 Skills 用 `aza_skill search` 补偿，无循环用 `aza_loop next` + `next_action` 链补偿。
2. **三级循环引擎**（V12 新增）：将 comet 的状态机、ralphy-openspec 的 Ralph Loop、loop-engineering 的多级循环模式、planning-with-files 的双循环（`/plan-loop` 外 + `/plan-goal` 内）、superpowers 的 TDD 循环统一为三级嵌套循环，并在每一级都接入断路器监控。

---

## 2. 核心设计理念：三级循环引擎

### 2.1 为什么需要三级循环

V11 的 5 阶段状态机（open→design→build→verify→archive）是一个**单循环**：阶段之间线性流转，没有阶段内部的质量迭代。这带来三个问题：

1. **阶段间无质量门控**：open 阶段生成的 PRD 即使质量很差，也会直接进入 design，导致后续全部偏题。
2. **阶段内无迭代**：build 阶段编码后测试失败，没有"红→绿→重构"的 TDD 循环，只能整段重来。
3. **缺少跨 Story 调度**：多个 Story 之间没有时间驱动的分诊机制，无法按优先级和预算分派。

GitHub 上的热门竞品普遍采用多级循环模式：

| 竞品 | 循环模式 |
|------|---------|
| planning-with-files | `/plan-loop`（外循环）+ `/plan-goal`（内循环）双循环 |
| ralphy-openspec | Ralph Loop（AI 反复执行）× OpenSpec 生命周期（plan→implement→validate→archive） |
| Trellis | 4 阶段循环（Plan→Implement→Verify→Finish），每阶段有 maker/checker 子代理 |
| loop-engineering | Scheduled Automation + 7 种循环模式 + Circuit Breaker |
| comet | 5 阶段状态机 + auto_transition + Guard 脚本 |
| superpowers | TDD RED-GREEN-REFACTOR 循环 + verification-before-completion |

V12 综合这些模式，设计了**三级嵌套循环**：外循环负责跨 Story 调度，内循环负责单 Story 推进，阶段内循环负责单阶段质量门控迭代。

### 2.2 三级循环总览

```
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   外循环（Outer Loop — 时间驱动分诊，跨 Story 级别）                          ║
║   ┌──────────────────────────────────────────────────────────────────────┐ ║
║   │  Schedule/Cadence → Triage → Read STATE → 分派 Story →              │ ║
║   │  等待内循环完成 → Human Gate? → Commit/PR/Escalate → 回到 Schedule    │ ║
║   └───────────────────────────────┬──────────────────────────────────────┘ ║
║                                   │ 分派 Story                              ║
║                                   ▼                                        ║
║   内循环（Inner Loop — 目标驱动执行，单 Story 级别）                          ║
║   ┌──────────────────────────────────────────────────────────────────────┐ ║
║   │  接收 Story → 推进 5 阶段流水线(open→design→build→verify→archive) →  │ ║
║   │  每阶段有阶段内循环 → 全部通过? → Story 完成 / 失败 3 次? → 升级外循环  │ ║
║   └───────────────────────────────┬──────────────────────────────────────┘ ║
║                                   │ 每阶段触发                               ║
║                                   ▼                                        ║
║   阶段内循环（Phase Loop — 质量门控迭代，单阶段内部）                          ║
║   ┌──────────────────────────────────────────────────────────────────────┐ ║
║   │  执行(Maker) → 质量检查(Checker) → 达标? → 进入下一阶段               │ ║
║   │  不达标? → 优化 → 重复执行 → 3 次不达标? → 升级内循环 → Story blocked  │ ║
║   └──────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### 2.3 外循环（Outer Loop — 时间驱动分诊）

**职责**：跨 Story 级别的调度与分诊。负责按时间节拍发现任务、分派任务、在人工门控后提交归档。

**流程**：`Schedule/Cadence → Triage → Read STATE → 分派 Story → 等待内循环 → Human Gate → Commit/PR → 回到 Schedule`

```
外循环（Outer Loop）— 时间驱动分诊
┌─────────────────────────────────────────────────────────────────┐
│  1. Schedule / Cadence                                         │
│     时间节拍触发器（每日/每 PR/每 CI 周期/事件触发）               │
│     借鉴：loop-engineering 的 Scheduled Automation               │
│                                                                 │
│  2. Triage（分诊）                                              │
│     扫描任务源 → 优先级排序 → 预算评估（BUDGET.md）                │
│     借鉴：ralphy-openspec 的 BUDGET.md + TASKS.md 看板           │
│                                                                 │
│  3. Read STATE                                                  │
│     读取 .aza/STATE.yaml → 恢复上下文（含 client/model/phase）   │
│     借鉴：planning-with-files 的三文件恢复 + SHA-256 校验        │
│                                                                 │
│  4. 分派 Story                                                  │
│     从看板取出最高优先级 Story → 委派给内循环执行                   │
│     借鉴：loop-engineering 的 sub-agent dispatch                 │
│                                                                 │
│  5. 等待内循环完成                                               │
│     内循环返回 success/blocked → 决定下一步                       │
│                                                                 │
│  6. Human Gate（人工门控）                                       │
│     敏感操作（Commit/PR/Escalate）需人工确认                       │
│     借鉴：comet 的 Human-in-the-loop + planning-with-files Gate  │
│                                                                 │
│  7. Commit / PR / Escalate                                      │
│     成功 → Commit/PR；失败 → Escalate 升级                       │
│                                                                 │
│  8. 回到 Schedule                                                │
│     更新 STATE → 回到节拍等待下一次触发                            │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计**：
- 外循环是**时间驱动**而非事件驱动 —— 由 Schedule/Cadence 节拍触发，借鉴 loop-engineering 的 `daily_triage` / `pr_babysitter` / `ci_sweeper` 等定时循环模式。
- 外循环维护**看板**（TASKS.md + STATUS.md），借鉴 ralphy-openspec 的任务账本设计。
- 外循环有独立的**预算追踪**（BUDGET.md），借鉴 ralphy-openspec 的 Token/时间预算。

### 2.4 内循环（Inner Loop — 目标驱动执行）

**职责**：单 Story 级别的执行推进。负责将一个 Story 从 open 推进到 archive，每经过一个阶段时触发该阶段的阶段内循环。

**流程**：`接收 Story → 推进 5 阶段流水线 → 每阶段有阶段内循环 → 全部通过 → Story 完成`

```
内循环（Inner Loop）— 目标驱动执行，单 Story 级别
┌─────────────────────────────────────────────────────────────────┐
│  接收 Story（来自外循环分派）                                    │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────┐    阶段内循环     ┌──────────┐                   │
│  │  open    │ ───────────────▶ │  design  │                     │
│  │ PRD 生成 │   达标才推进      │ 架构设计  │                     │
│  └──────────┘                  └────┬─────┘                     │
│         ▲                            │ 达标才推进                │
│         │                            ▼                           │
│         │   ┌──────────┐    阶段内循环                            │
│         │   │  build   │ ───────────────▶ ┌──────────┐           │
│         │   │  编码    │   达标才推进      │  verify  │           │
│         │   └──────────┘                  │  验证    │           │
│         │                                  └────┬─────┘         │
│         │                                       │ 达标才推进     │
│         │                                       ▼               │
│         │                                  ┌──────────┐         │
│         │                                  │ archive  │         │
│         │                                  │  归档    │         │
│         │                                  └────┬─────┘         │
│         │                                       │               │
│         └──── 全部通过 ◀─────────────────────────┘               │
│                  │                                             │
│                  ▼                                             │
│           Story 完成 → 返回外循环                                │
│                                                                 │
│  失败处理：某阶段 3 次不达标 → Story 标记 blocked → 升级外循环    │
└─────────────────────────────────────────────────────────────────┘
```

**5 阶段流水线**（借鉴 comet 的 5 阶段状态机 + ralphy-openspec 的生命周期）：

| 阶段 | 职责 | 输入 | 输出 |
|------|------|------|------|
| open | 接收需求 → 生成 PRD | 自然语言需求 | prd.json + prd.md |
| design | 拆解 Story → 架构图 → 任务列表 | prd.json | arch.md + tasks DAG |
| build | 编码 → 单元测试 | tasks DAG | 源码 + 测试 |
| verify | 五级门禁验证 | 源码 + 测试 | 验证报告 |
| archive | 提交 + 记忆归档 + 释放资源 | 验证通过 | Commit + 文档 |

**关键设计**：
- 内循环是**目标驱动** —— 以"完成这个 Story"为目标，借鉴 ralphy-openspec 的 Ralph Loop（AI 反复执行直到完成）。
- 内循环的 5 阶段流转由 `auto_transition` 驱动（借鉴 comet）—— 阶段内循环达标后自动进入下一阶段，无需人工介入。
- 内循环有**3 次失败升级机制** —— 单个 Story 连续 3 次失败则标记 blocked，升级到外循环重新分诊（借鉴 superpowers 的 3-Strike）。

### 2.5 阶段内循环（Phase Loop — 质量门控迭代）

**职责**：单阶段内部的质量门控迭代。这是三级循环中最内层、最关键的一级 —— 它保证"每个阶段的质量达标才进入下一阶段"。

**流程**：`执行 → 质量检查 → 达标? → 下一阶段 / 不达标? → 优化 → 重复 → 3 次不达标 → 升级`

```
阶段内循环（Phase Loop）— 质量门控迭代，单阶段内部
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌─────────────┐                                               │
│   │  1. 执行     │  Maker 执行器（制造者角色）                    │
│   │  (Maker)    │  执行该阶段核心工作                              │
│   └──────┬──────┘                                               │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐                                               │
│   │  2. 检查     │  Checker 检查器（审查者角色，与 Maker 分离）     │
│   │ (Checker)   │  独立验证执行结果 + 输出具体改进建议               │
│   └──────┬──────┘                                               │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐    达标                                       │
│   │  3. 质量门控 │ ───────────────▶  进入下一阶段（auto_transition）│
│   │ (Quality    │                                                │
│   │   Gate)    │    不达标                                      │
│   │            │ ───────────────┐                               │
│   └─────────────┘               │                               │
│                                 ▼                               │
│                         ┌─────────────┐                         │
│                         │  4. 优化     │  Optimizer 根据 Checker │
│                         │(Optimizer)  │  建议定向修复            │
│                         └──────┬──────┘                         │
│                                │                                │
│                                ▼                                │
│                         ┌─────────────┐                         │
│                         │  5. 重复     │  回到 1. 执行（保留上下文） │
│                         └──────┬──────┘                         │
│                                │                                │
│                                ▼                                │
│                         迭代计数 < max?                          │
│                         ├─ 是 → 回到 1. 执行                    │
│                         └─ 否 → 3 次不达标 → 升级内循环           │
│                                  → Story 标记 blocked            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**阶段内循环的核心机制**：

1. **Maker / Checker 分离**（借鉴 Trellis）—— 执行器（制造者）和检查器（审查者）必须是不同的"角色"（通过 prompt 注入不同角色身份）。制造者容易对自己的产出盲目自信，独立审查者能发现盲点。
2. **质量门控（Quality Gate）**（借鉴 comet Guard + planning-with-files Completion Gate）—— 每个阶段有独立的验收标准，达标才放行。
3. **迭代计数器** —— 最大迭代次数默认 5 次，借鉴 superpowers 的 3-Strike（3 次不达标升级）。
4. **具体改进建议** —— Checker 每次必须输出具体改进建议（不是笼统"不通过"），借鉴 agent-skills 的 Red Flags 明确提示。
5. **上下文保留** —— 迭代间保留每次尝试和失败原因，供断路器监控和下次优化参考。
6. **auto_transition**（借鉴 comet）—— 达标后自动触发下一阶段的内循环，无需人工介入。

**断路器在三级循环的接入点**：

断路器（Circuit Breaker，借鉴 loop-engineering）在三级循环的每一级都有监控点，防止任意级别失控：

| 循环级别 | 断路器监控维度 | 触发动作 |
|---------|--------------|---------|
| 阶段内循环 | 单阶段迭代次数 / Token 消耗 / 停滞 / 无进展 | 停止该阶段 → 升级内循环 |
| 内循环 | 单 Story 总迭代 / 阶段切换停滞 / 预算超限 | Story 标记 blocked → 升级外循环 |
| 外循环 | 总任务数 / 总预算 / 看板积压 | 停止调度 → 报告人工 |

### 2.6 三级循环的借鉴来源总览

| 循环级别 | 模式 | 借鉴来源 |
|---------|------|---------|
| 外循环 | 时间驱动分诊 + 跨 Story 调度 | loop-engineering Scheduled Automation + Triage；ralphy-openspec BUDGET.md/TASKS.md 看板 |
| 内循环 | 目标驱动执行 + 5 阶段流转 | ralphy-openspec Ralph Loop；comet 5 阶段状态机 + auto_transition；Trellis 4 阶段循环 |
| 阶段内循环 | 质量门控迭代 + maker/checker | superpowers RED-GREEN-REFACTOR；comet Guard/auto_transition；planning-with-files Completion Gate；Trellis maker/checker |
| 双循环组合 | 外循环 + 内循环 | planning-with-files `/plan-loop`（外）+ `/plan-goal`（内）；ralphy-openspec Ralph Loop × OpenSpec 生命周期 |
| 循环治理 | 断路器 + 审计 | loop-engineering Circuit Breaker（4 维度）+ loop-audit（18 信号） |

---

## 3. 5 阶段各自的内循环设计

每个流水线阶段（open / design / build / verify / archive）都有独立的阶段内循环。下表完整展示每阶段的内循环流程、质量门控标准与借鉴来源。

### 3.1 阶段内循环总表

| 阶段 | 内循环流程 | 质量门控标准 | 借鉴来源 |
|------|-----------|-------------|---------|
| **open（PRD 生成）** | 生成初稿 → 14 维自检 → P0 问题 = 0? → 通过 / P0 > 0? → 定向修复 → 重复 | P0 问题数 = 0 且 P1 ≤ 3；acceptance_criteria 全部可测试 | create-prd-skill 多轮自优化 + check-prd-skill 14 维 + OpenSpec propose→specs 迭代 + spec-kit Constitution |
| **design（架构设计）** | 设计架构 → 架构评审 → 7 种图完整? → 通过 / 缺失? → 补充 → 重复 | 7 种架构图完整（用例/类/时序/组件/部署/ER/数据流）+ 设计评审通过 + DAG 依赖无环 | comet `/comet-design` + superpowers brainstorming + spec-kit `/plan` + OpenSpec DAG 依赖 |
| **build（编码）** | TDD Red → Green → Refactor → 单元测试通过? → 下一任务 / 失败? → 修复 → 重复 | TDD 强制（NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST）+ 单元测试 100% 通过 + 纪律铁律校验 | superpowers RED-GREEN-REFACTOR + Trellis maker/checker + ralphy Ralph Loop + Karpathy 4 铁律 |
| **verify（验证）** | 5 级门禁 → 全通过? → 通过 / 某级失败? → 修复 → 重复 | 5 级门禁全通过（Gate1 静态分析 / Gate2 测试 / Gate3 回归 / Gate4 安全 / Gate5 验收），安全 blocker 可选降级 | comet `/comet-verify` + loop-engineering verifier sub-agent + gstack `/review` + shellward 安全门 |
| **archive（归档）** | 生成文档 → 文档审查 → 完整? → 通过 / 缺失? → 补充 → 重复 | 6 种文档完整（PRD/架构/DB/API/TestPlan/部署）+ spec 同步归档 + 记忆沉淀 | comet `/comet-archive` + Trellis `/trellis:finish-work` + ralphy-openspec `/ralphy-archive` + OpenSpec archive |

### 3.2 open 阶段内循环 — PRD 生成与自检

```
open 阶段内循环
   │
   ▼
┌───────────────────────────────────────────────────┐
│  Maker：PRD 生成器                                  │
│  1. 解析自然语言需求                                │
│  2. 产品定型（商业化/自研 × 业务型/工具型/交易型/   │
│     基础服务型）                                    │
│  3. 复杂度分级（L1 配置级 / L2 规则级 /             │
│     L3 模块级 / L4 系统级）                         │
│  4. 按 14 章模板生成 PRD                            │
│  5. 生成 Mermaid 架构图                             │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────────────────────┐
│  Checker：PRD 审查器（独立角色）                    │
│  14 维度审查：                                       │
│  1. 需求完整性  2. 用户画像  3. 场景覆盖             │
│  4. 功能拆解    5. 非功能需求  6. 数据模型           │
│  7. 接口设计    8. 安全合规    9. 验收标准           │
│  10. 优先级    11. 风险    12. 里程碑               │
│  13. 依赖      14. 度量指标                         │
│  按 P0-P3 分级输出问题清单 + Top 10 改进建议         │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
              P0 问题 = 0 且 P1 ≤ 3?
              ├─ 是 → 质量门控通过 → 进入 design（auto_transition）
              └─ 否 → Optimizer 定向修复 → 回到 Maker（保留上下文）
                       └─ 5 次仍不达标 → 升级内循环 → Story blocked
```

**14 章 PRD 模板**（借鉴 create-prd-skill）：
1. 文档元信息 2. 项目背景 3. 产品定位 4. 用户画像 5. 场景与用例 6. 功能需求 7. 非功能需求 8. 数据模型 9. 接口设计 10. 安全与合规 11. 验收标准 12. 优先级与排期 13. 风险与依赖 14. 度量指标

**关键设计**：
- PRD 生成采用**复杂度感知** —— L1（配置级）不强制 14 章，L4（系统级）强制全 14 章，避免小需求被硬写成大 PRD。
- 审查采用 check-prd-skill 的**双路径**：章节路径（按 14 章审查）+ 降级维度路径（按能力降级审查），适应不同复杂度。

### 3.3 design 阶段内循环 — 架构设计

```
design 阶段内循环
   │
   ▼
┌───────────────────────────────────────────────────┐
│  Maker：架构设计师                                  │
│  1. 拆解 Story（PRD → Story 列表）                  │
│  2. 选择架构模式                                    │
│  3. 生成 7 种架构图                                 │
│  4. 构建任务 DAG 依赖图（OpenSpec 借鉴）             │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────────────────────┐
│  Checker：架构评审员（独立角色）                     │
│  1. 7 种图完整性检查                                │
│  2. DAG 无环检测（依赖关系合理性）                   │
│  3. 并行机会检测（无依赖任务可并行）                 │
│  4. 设计评审打分                                    │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
              7 图完整 + 评审通过 + DAG 无环?
              ├─ 是 → 质量门控通过 → 进入 build（auto_transition）
              └─ 否 → Optimizer 补充缺失图 / 修复依赖 → 回到 Maker
```

**7 种架构图**：用例图 / 类图 / 时序图 / 组件图 / 部署图 / ER 图 / 数据流图。

### 3.4 build 阶段内循环 — TDD 编码

```
build 阶段内循环（逐任务）
   │
   ▼
┌───────────────────────────────────────────────────┐
│  Maker：编码者                                      │
│  TDD Iron Law（借鉴 superpowers）：                  │
│  NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST    │
│                                                     │
│  RED   → 先写失败的测试                              │
│  GREEN → 写最小代码让测试通过                        │
│  REFACTOR → 重构优化（测试保持绿色）                │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────────────────────┐
│  Checker：测试验证器（独立角色）                     │
│  1. 单元测试 100% 通过?                              │
│  2. 纪律铁律校验（4 铁律 + 8 反借口）               │
│  3. 卡尔帕西 4 铁律（先想再写/简单优先/外科手术式/   │
│     目标驱动）                                       │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
              测试通过 + 铁律校验通过?
              ├─ 是 → 质量门控通过 → 下一个任务
              │       全部任务完成? → 进入 verify
              └─ 否 → Optimizer 修复 → 回到 RED/GREEN
```

**关键设计**：TDD 铁律采用 superpowers 的绝对性措辞（"NO PRODUCTION CODE"/"DELETE IT"/"START OVER"），不是"尽量先写测试"。反借口表格来自 agent-skills —— 预判 AI 可能找的借口（"先实现功能再补测试"→"没有测试的代码是技术债"）。

### 3.5 verify 阶段内循环 — 五级门禁

```
verify 阶段内循环
   │
   ▼
┌───────────────────────────────────────────────────┐
│  Maker：验证执行器                                  │
│  5 级门禁流水线：                                    │
│  Gate1 静态分析（tsc + ESLint）                     │
│  Gate2 单元/集成测试（Vitest）                       │
│  Gate3 回归测试（基线对照）                         │
│  Gate4 安全扫描（8 层防御）                         │
│  Gate5 验收对照（PRD acceptance_criteria）          │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────────────────────┐
│  Checker：门禁审查员（独立角色）                     │
│  逐级判定通过/失败 + 具体修复建议                    │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
              5 级全通过?
              ├─ 是 → 质量门控通过 → 进入 archive
              └─ 否 → Optimizer 定向修复失败级 → 回到 Maker
                       └─ 安全 blocker? → 立即停止（不进入修复循环）
```

**安全降级策略**：Gate4 安全扫描发现 high/critical 级别 finding 时立即停止（blocker 级不进入修复循环），只有 low/medium 级别才进入修复循环。

### 3.6 archive 阶段内循环 — 归档

```
archive 阶段内循环
   │
   ▼
┌───────────────────────────────────────────────────┐
│  Maker：归档器                                      │
│  1. 生成 6 种文档（PRD/架构/DB/API/TestPlan/部署）  │
│  2. 记忆沉淀（成功模式写入语义记忆）                │
│  3. 释放工作记忆                                    │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────────────────────┐
│  Checker：文档审查员（独立角色）                     │
│  1. 6 种文档完整性检查                              │
│  2. spec 同步检查（OpenSpec archive 一致性）        │
│  3. 记忆沉淀完整性                                  │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
              文档完整 + spec 同步?
              ├─ 是 → 质量门控通过 → Story 完成 → 返回外循环
              └─ 否 → Optimizer 补充缺失文档 → 回到 Maker
```

---

## 4. MCP 事件模拟器设计

### 4.1 问题定义：无 Hook 客户端的续航困境

V11 的续航机制依赖两条链路：原生 Hook + RESUME（T1 客户端）和 continue.md 规则注入（T2/T3 客户端）。但 T2/T3 客户端存在根本缺陷：

- **无 Stop Hook**：会话结束时不触发 onStop 事件，无法自动写 RESUME，下次会话丢失上下文。
- **规则注入是"建议"**：continue.md 规则依赖 LLM 自觉执行，LLM 可能忽略规则直接干活。
- **无 pre/post tool hook**：工具调用前无法做纪律校验，工具调用后无法自动更新进度。

V11 采用"每次 MCP 工具调用后预写 RESUME"作为补偿，但这仍然是被动写入，缺少主动的事件触发链。

### 4.2 解决方案：MCP 事件模拟器

**核心理念**：在 MCP 工具层面模拟完整的 Hook 事件链。无论客户端是否有原生 Hook，每次 MCP 工具调用时，AzaLoop 在工具内部自动执行 pre-tool / post-tool / on-stop 等事件逻辑。

**规则注入是"建议"，MCP 模拟器是"强制"** —— 模拟器在工具层面执行，不依赖 LLM 遵守规则。

### 4.3 MCP 工具调用的事件模拟流程

```
每次 MCP 工具调用时：
  ┌─────────────────────────────────────────────────────────────┐
  │  1. pre-tool 模拟（模拟 PreToolUse hook）                  │
  │     ├─ 纪律校验：4 铁律 + 8 反借口检查                     │
  │     ├─ 阶段白名单：当前阶段允许的工具集（借鉴 comet Guard）  │
  │     ├─ 输入审计：提示注入检测 / PII 检测（借鉴 shellward） │
  │     └─ JSONL 上下文加载：精确注入相关上下文（借鉴 Trellis） │
  │                                                             │
  │  2. 工具执行                                                │
  │     └─ 正常执行 MCP 工具核心逻辑                            │
  │                                                             │
  │  3. post-tool 模拟（模拟 PostToolUse hook）                │
  │     ├─ 更新 STATE：写入进度 / 迭代计数 / 阶段状态          │
  │     ├─ 输出扫描：密钥泄露 / 代码注入检测（借鉴 shellward）  │
  │     ├─ 预写 RESUME：每次调用后预写续跑指令（补偿 on-stop）  │
  │     └─ Run Ledger 追加：记录本次工具调用（借鉴             │
  │        planning-with-files Run Ledger）                     │
  │                                                             │
  │  4. 返回 next_action                                        │
  │     └─ 驱动 LLM 续调（模拟原生循环）                        │
  └─────────────────────────────────────────────────────────────┘
```

**5 类模拟的 Hook 事件**（借鉴 planning-with-files）：

| 模拟事件 | 触发时机 | 模拟逻辑 | 借鉴来源 |
|---------|---------|---------|---------|
| `UserPromptSubmit` 模拟 | 会话启动读 STATE 时 | continue.md 规则触发 `aza_context status` → 加载宪法+铁律+角色 | planning-with-files UserPromptSubmit |
| `PreToolUse` 模拟 | 每次 MCP 工具调用前 | 工具内部前置：纪律校验 + 阶段白名单 + 输入审计 + JSONL 加载 | planning-with-files PreToolUse + comet Guard + Trellis inject-subagent-context |
| `PostToolUse` 模拟 | 每次 MCP 工具调用后 | 工具内部后置：更新 STATE + 输出扫描 + 预写 RESUME + Run Ledger | planning-with-files PostToolUse |
| `Stop` 模拟 | 工具调用返回后 | Completion Gate 检查（5 条件全满足才允许停止）+ 预写 RESUME | planning-with-files Stop + Completion Gate |
| `PreCompact` 模拟 | 上下文压缩前 | loop-context 压缩（Summarize→Prune→Inject）+ 重新注入铁律 | planning-with-files PreCompact + loop-engineering loop-context |

### 4.4 Completion Gate — 阻止"假完成"

借鉴 planning-with-files 的 Completion Gate：当 LLM 试图结束会话时，模拟 Stop 事件检查 5 个条件**全部满足**才允许停止，否则阻止并继续循环：

```
Completion Gate（5 条件同时满足才允许停止）
  ├─ 1. 当前 Story 所有阶段状态 = completed
  ├─ 2. 5 级质量门禁全部通过
  ├─ 3. 无安全 blocker 未处理
  ├─ 4. 文档完整（6 种文档已生成）
  └─ 5. 5-Question Reboot Test 通过（借鉴 planning-with-files）

5-Question Reboot Test：
  Q1. 当前任务目标是什么？
  Q2. 已经完成了什么？
  Q3. 还剩什么没做？
  Q4. 下一步具体做什么？
  Q5. 是否有遗漏或风险？
  → 5 个问题都能明确回答 → 允许停止
  → 任一模糊 → 阻止停止，继续循环
```

### 4.5 降级策略矩阵

借鉴 Trellis 的 Capability Matrix（17 平台降级策略 Full/Partial/Pull-based/Workflow-only），AzaLoop 设计 5 级降级策略，覆盖 24 个客户端：

| 策略级别 | 客户端 | Hook 触发方式 | 自动化程度 | 详细机制 |
|---------|--------|-------------|-----------|---------|
| **Full** | Cursor / Claude Code | 原生 Hook + MCP 双驱动 | 100% | 9 事件原生触发 + next_action 链全自动；Stop Hook 原生写 RESUME |
| **Partial-Hook** | Cline / Trae | 部分 Hook + MCP 补偿 | 95% | 客户端部分事件原生触发（如 pre-tool）；缺失事件由 MCP 模拟器补齐 |
| **MCP-Simulated** | Windsurf / VS Code / Roo / OpenHands / Comate / WorkBuddy | MCP 事件模拟器 | 90% | 完全无原生 Hook；每次 MCP 工具调用模拟 pre/post-tool + 预写 RESUME |
| **Rule-Injected** | Kiro / Gemini CLI / Codex CLI / GitHub Copilot / Continue / Zed | continue.md 规则 + MCP | 85% | 会话启动规则注入 + MCP 模拟器；LLM 需遵守 continue.md 调用工具 |
| **Manual-Trigger** | Hermes / OpenClaw / Claude Desktop / Aider / Goose / Droid / Codeium / Qwen Code | 手动 `aza continue` | 75% | 每次新会话手动触发 `aza continue` CLI；触发后 next_action 链自动驱动到会话结束 |

**降级链**：当高级策略不可用时，自动降级到下一级：

```
Full → Partial-Hook → MCP-Simulated → Rule-Injected → Manual-Trigger
 原生     部分 Hook     MCP 模拟器      规则注入        手动触发
100%      95%           90%             85%             75%
```

**关键设计**：
- 自动化程度从 0%（纯手动）提升到 75%（Manual-Trigger 最底层）—— 即使最弱的客户端，一旦手动触发 `aza continue`，next_action 链也会自动驱动到会话结束。
- 降级策略由 `L0_platform/compensation-strategy.ts` 在 `aza init` 时自动检测并配置。
- 24 客户端的 continue.md 模板内容完全相同，宿主 LLM 看到的行为指令一致。

### 4.6 MCP 事件模拟器实现文件

| 文件 | 职责 | 借鉴来源 |
|------|------|---------|
| `packages/core/src/continuity/mcp-event-simulator.ts` | MCP 事件模拟器核心 | planning-with-files 5 事件 + comet Guard |
| `packages/core/src/Hook/mcp-event-bridge.ts` | MCP 工具调用 → 事件桥接 | loop-engineering 事件总线 |
| `packages/core/src/L0_platform/compensation-strategy.ts` | 降级策略矩阵 | Trellis Capability Matrix |
| `packages/core/src/L7_loop/completion-gate.ts` | Completion Gate（5 条件 + 5-Question） | planning-with-files Completion Gate |
| `packages/core/src/L7_loop/circuit-breaker.ts` | 断路器（4 维度监控） | loop-engineering Circuit Breaker |

### 4.7 MCP 事件模拟器伪代码

```typescript
// MCP 事件模拟器：包装所有 MCP 工具调用
class McpEventSimulator {
  // 每次 MCP 工具调用经此包装
  async wrap(toolName: string, args: unknown, exec: Function): Promise<LoopResponse> {
    // 1. pre-tool 模拟
    await this.simulatePreTool(toolName, args);

    // 2. 工具执行
    const result = await exec(args);

    // 3. post-tool 模拟
    await this.simulatePostTool(toolName, result);

    // 4. Completion Gate 检查（模拟 Stop 事件）
    const gateResult = this.completionGate.check();
    if (gateResult.canStop) {
      // 全部满足 → 允许结束
      await this.resumeGenerator.write();
      return { ...result, next_action: undefined };
    }

    // 5. 不满足 → 返回 next_action 驱动续调
    const nextAction = this.loopController.next();
    return { ...result, next_action: nextAction };
  }

  private async simulatePreTool(tool: string, args: unknown) {
    // 纪律校验
    this.discipline.check(args);
    // 阶段白名单（当前阶段允许的工具集）
    this.guard.allowTool(this.state.phase, tool);
    // 输入审计（提示注入 / PII）
    this.security.scanInput(args);
    // JSONL 上下文加载
    await this.contextOrchestrator.load(tool);
  }

  private async simulatePostTool(tool: string, result: unknown) {
    // 更新 STATE
    this.stateManager.update(result);
    // 输出扫描（密钥泄露 / 代码注入）
    this.security.scanOutput(result);
    // 预写 RESUME（补偿 on-stop）
    await this.resumeGenerator.preWrite(result);
    // Run Ledger 追加
    this.runLedger.append(tool, result);
  }
}
```

---

## 5. 24 客户端适配矩阵

### 5.1 客户端能力矩阵总表

AzaLoop 支持 24 个客户端，分原有 16 个 + 新增 8 个。下表是完整的能力矩阵（★ = 完整支持，△ = 部分支持，× = 不支持，由 MCP 补偿）：

#### 5.1.1 原有 16 个客户端

| # | 客户端 | 降级策略 | Hook | Rules | MCP | Skills | 原生循环 | Stop Hook | 自动化 |
|---|--------|---------|------|-------|-----|--------|---------|-----------|--------|
| 1 | Cursor | Full | ★ | ★ | ★ | ★ | ★ | ★ | 100% |
| 2 | Claude Code | Full | ★ | ★ | ★ | ★ | ★ | ★ | 100% |
| 3 | Trae | Partial-Hook | △ | ★ | ★ | × | ★ | × | 95% |
| 4 | Windsurf | MCP-Simulated | × | ★ | ★ | × | ★ | × | 90% |
| 5 | VS Code | MCP-Simulated | × | × | ★ | × | × | × | 90% |
| 6 | Cline | Partial-Hook | × | ★ | ★ | ★ | ★ | × | 95% |
| 7 | Continue | Rule-Injected | × | ★ | ★ | × | × | × | 85% |
| 8 | Roo Code | MCP-Simulated | × | ★ | ★ | ★ | ★ | × | 90% |
| 9 | Kiro | Rule-Injected | × | ★ | ★ | × | × | × | 85% |
| 10 | GitHub Copilot | Rule-Injected | × | ★ | ★ | × | × | × | 85% |
| 11 | OpenHands | MCP-Simulated | × | ★ | ★ | × | × | × | 90% |
| 12 | Aider | Manual-Trigger | × | ★ | × | × | × | × | 75% |
| 13 | Goose | Manual-Trigger | × | × | ★ | × | × | × | 75% |
| 14 | Zed | Rule-Injected | × | ★ | ★ | × | × | × | 85% |
| 15 | Codeium | Manual-Trigger | × | ★ | ★ | × | × | × | 75% |
| 16 | Droid | Manual-Trigger | × | ★ | ★ | × | × | × | 75% |

#### 5.1.2 新增 8 个客户端

| # | 客户端 | 降级策略 | Hook | Rules | MCP | Skills | 原生循环 | Stop Hook | 自动化 |
|---|--------|---------|------|-------|-----|--------|---------|-----------|--------|
| 17 | Gemini CLI | Rule-Injected | × | ★ | ★ | △ | × | × | 85% |
| 18 | Codex CLI | Rule-Injected | × | ★ | ★ | × | × | × | 85% |
| 19 | Hermes | Manual-Trigger | × | △ | ★ | ★ | × | × | 75% |
| 20 | OpenClaw | Manual-Trigger | × | △ | ★ | ★ | × | × | 75% |
| 21 | Claude Desktop | Manual-Trigger | × | × | ★ | ★ | × | × | 75% |
| 22 | Comate | MCP-Simulated | × | ★ | ★ | × | △ | × | 90% |
| 23 | WorkBuddy | MCP-Simulated | × | ★ | ★ | × | △ | × | 90% |
| 24 | Qwen Code | Manual-Trigger | × | ★ | ★ | × | × | × | 75% |

### 5.2 新增 8 客户端配置说明

| 客户端 | 配置目录 | Rules 文件 | MCP 配置 | 续跑模板 | 检测标志 |
|--------|---------|-----------|---------|---------|---------|
| Gemini CLI | `templates/clients/gemini-cli/` | `.gemini/rules` | `mcp.json` | `continue.md` | `.gemini/` 目录存在 |
| Codex CLI | `templates/clients/codex-cli/` | `AGENTS.md` | `mcp.json` | `continue.md` | `AGENTS.md` 存在 |
| Hermes | `templates/clients/hermes/` | `.hermes/skills/` | `mcp.json` | `continue.md` | `.hermes/` 目录存在 |
| OpenClaw | `templates/clients/openclaw/` | `clawhub.json` | `mcp.json` | `continue.md` | `clawhub.json` 存在 |
| Claude Desktop | `templates/clients/claude-desktop/` | `claude_desktop_config.json` | 内置 MCP | `continue.md` | `claude_desktop_config.json` |
| Comate | `templates/clients/comate/` | `.comate/` | `mcp.json` | `continue.md` | `.comate/` 目录存在 |
| WorkBuddy | `templates/clients/workbuddy/` | `.workbuddy/` | `mcp.json` | `continue.md` | `.workbuddy/` 目录存在 |
| Qwen Code | `templates/clients/qwen-code/` | `.qwen/` | `mcp.json` | `continue.md` | `.qwen/` 目录存在 |

### 5.3 客户端能力补偿映射

无论客户端缺失什么能力，MCP 工具都能补齐：

| 缺失能力 | MCP 补偿工具 | 补偿机制 | 适用客户端 |
|---------|-------------|---------|-----------|
| 无 Stop Hook | `aza_continue` | 每次工具调用后预写 RESUME + Completion Gate 阻止假完成 | 除 Cursor/Claude Code 外全部 |
| 无 Rules 注入 | `aza_context calibrate` | MCP 返回宪法+铁律+角色上下文 | VS Code/Aider/Goose/Claude Desktop |
| 无 Skills | `aza_skill search/list` | MCP 工具检索 Skill 内容并返回 | Windsurf/Continue/Aider/Gemini CLI/Codex CLI |
| 无原生循环 | `aza_loop next` | next_action 链驱动 LLM 续调 | VS Code/Continue/Kiro/Copilot/Gemini CLI/Codex CLI |
| 无 TDD | `aza_quality check` | 五级门禁强制 | 全部客户端 |
| 无记忆 | `aza_memory query/list` | 三层记忆读写 | 全部客户端 |
| 无文档生成 | `aza_doc generate` | 6 种文档自动生成 | 全部客户端 |
| 无 Hook 事件 | MCP 事件模拟器 | 工具层面模拟 pre/post-tool 事件 | Windsurf/VS Code/Roo/OpenHands/Comate/WorkBuddy |

### 5.4 客户端自动检测

```typescript
// 24 客户端自动检测（扩展自 V11 的 16 客户端）
function detectClient(): ClientInfo {
  // T1 - Full
  if (process.env.CURSOR_TRACE_ID) return { name: 'cursor', tier: 1, strategy: 'Full' };
  if (process.env.CLAUDE_CODE_ENTRYPOINT) return { name: 'claude-code', tier: 1, strategy: 'Full' };
  // T1 - Partial-Hook
  if (fs.existsSync('.trae/mcp.json')) return { name: 'trae', tier: 1, strategy: 'Partial-Hook' };
  // T1/T2 - MCP-Simulated
  if (fs.existsSync('.windsurf')) return { name: 'windsurf', tier: 1, strategy: 'MCP-Simulated' };
  if (fs.existsSync('.comate')) return { name: 'comate', tier: 2, strategy: 'MCP-Simulated' };
  if (fs.existsSync('.workbuddy')) return { name: 'workbuddy', tier: 2, strategy: 'MCP-Simulated' };
  // T2 - Rule-Injected
  if (fs.existsSync('.vscode/mcp.json')) return { name: 'vscode', tier: 2, strategy: 'MCP-Simulated' };
  if (fs.existsSync('.clinerules')) return { name: 'cline', tier: 2, strategy: 'Partial-Hook' };
  if (fs.existsSync('.continuerules')) return { name: 'continue', tier: 2, strategy: 'Rule-Injected' };
  if (fs.existsSync('.roo')) return { name: 'roo-code', tier: 2, strategy: 'MCP-Simulated' };
  if (fs.existsSync('.kiro')) return { name: 'kiro', tier: 2, strategy: 'Rule-Injected' };
  if (fs.existsSync('.openhands')) return { name: 'openhands', tier: 2, strategy: 'MCP-Simulated' };
  // 新增 8 客户端检测
  if (fs.existsSync('.gemini')) return { name: 'gemini-cli', tier: 2, strategy: 'Rule-Injected' };
  if (fs.existsSync('AGENTS.md')) return { name: 'codex-cli', tier: 2, strategy: 'Rule-Injected' };
  if (fs.existsSync('.hermes')) return { name: 'hermes', tier: 3, strategy: 'Manual-Trigger' };
  if (fs.existsSync('clawhub.json')) return { name: 'openclaw', tier: 3, strategy: 'Manual-Trigger' };
  if (fs.existsSync('claude_desktop_config.json')) return { name: 'claude-desktop', tier: 3, strategy: 'Manual-Trigger' };
  if (fs.existsSync('.qwen')) return { name: 'qwen-code', tier: 3, strategy: 'Manual-Trigger' };
  // T3 - Manual-Trigger
  if (fs.existsSync('.aider.conf.yml')) return { name: 'aider', tier: 3, strategy: 'Manual-Trigger' };
  if (fs.existsSync('config.yaml') && hasGooseMarker()) return { name: 'goose', tier: 3, strategy: 'Manual-Trigger' };
  if (fs.existsSync('.zed')) return { name: 'zed', tier: 3, strategy: 'Rule-Injected' };
  if (fs.existsSync('.codeium')) return { name: 'codeium', tier: 3, strategy: 'Manual-Trigger' };
  if (fs.existsSync('.droid')) return { name: 'droid', tier: 3, strategy: 'Manual-Trigger' };
  // 兜底
  return { name: 'unknown', tier: 3, strategy: 'Manual-Trigger' };
}
```

### 5.5 统一续跑规则（24 客户端共用）

所有客户端的规则文件都注入同一段续跑指令，确保宿主 LLM 看到的行为指令完全一致：

```markdown
# AzaLoop 三级循环自动续跑规则（MANDATORY — 会话启动时首先执行）

1. 调用 aza_context status 获取当前状态（恢复 STATE：含 client/model/phase/iteration）
2. 如果存在 .aza/RESUME.md：
   - 调用 aza_loop next 续跑（三级循环：外循环→内循环→阶段内循环）
3. 如果不存在 RESUME.md：
   - 询问用户需求 → 调用 aza_prd generate 生成新 PRD（14 章模板）
4. 每次工具返回的 next_action 必须自动执行，不得跳过（next_action 链驱动）
5. 跨会话恢复时调用 aza_memory query 获取相关历史经验
6. 工具内部自动执行 MCP 事件模拟（pre-tool/post-tool/Completion Gate）
```

**效果**：无论是 Cursor 的 `.cursor/rules/continue.mdc` 还是 Aider 的 `CONVENTIONS.md`，注入的指令内容完全相同。

---

## 6. 十层架构各层竞品借鉴详细映射

V12 在 V11 十层架构基础上，每一层都深度融合 GitHub 热门竞品的最佳实践。下表逐层列出借鉴的 GitHub 项目、借鉴点、落地到 AzaLoop 的具体实现。

### 6.1 L0 平台层 — 客户端适配与能力对齐

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **Trellis (mindfold-ai)** | 17 平台支持、Spec 自动注入、4 级降级策略(Full/Partial/Pull-based/Workflow-only) | `L0_platform/compensation-strategy.ts` 5 级降级策略矩阵（Full/Partial-Hook/MCP-Simulated/Rule-Injected/Manual-Trigger） |
| 2 | **superpowers-zh (jnMetaCode)** | 18 工具适配、中文规则 | `L0_platform/` zh-clients + `i18n/zh-CN/rules.md` 中文铁律 |
| 3 | **Trellis init** | `trellis init --cursor --opencode --codex` 多平台一键初始化 | `aza init --client=cursor,claude-code` 多客户端同时初始化 |
| 4 | **superpowers (obra)** 200K+ | 11 客户端插件安装(Claude/Cursor/Codex/Droid/Copilot/Kimi/Pi 等) | `templates/clients/` 24 客户端模板（V11 的 16 + V12 新增 8） |
| 5 | **OpenSpec (Fission-AI)** | 30+ 工具支持、slash 命令跨工具统一 | MCP 统一接口 + 客户端能力矩阵 |
| 6 | **comet (rpamis)** | 29 平台支持、Node 跨平台运行时 | `L0_platform/` 跨平台运行时 + 模板哈希校验 |

**关键设计**：AzaLoop 的 MCP Server 是能力均衡器。无论客户端缺少 Hook/Rules/Skills/循环，MCP 工具都能补齐。V12 新增 MCP 事件模拟器，让完全无 Hook 的客户端也能模拟完整事件链。

### 6.2 L1 规范层 — PRD 引擎与文档生成

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **create-prd-skill (pmYangKun)** | 14 章 B 端 PRD 模板、产品定型(商业化/自研×业务型/工具型/交易型/基础服务型)、复杂度分级(L1-L4)、4 阶段生成、阶段 4 自检、Mermaid 图表 | `L1_spec/prd-generator.ts` 14 章模板 + 复杂度感知生成；`templates/prd-14chapters.md` |
| 2 | **check-prd-skill (pmYangKun)** | 14 维度审查、P0-P3 分级、双路径(章节/降级维度)、产品类型差异化审查、Top 10 改进建议 | `L1_spec/prd-checker.ts` 14 维审查引擎 + P0-P3 分级 |
| 3 | **agent-skills (addyosmani)** 48K+ | /spec(需求定义) /plan(任务拆分) /build(增量构建) 全链路 slash 命令 | `L1_spec/` spec→plan→build 链路 |
| 4 | **spec-kit (github)** | Constitution 宪法、change→spec→design→tasks 变更管理、Presets/Extensions 优先级栈 | `L1_spec/constitution.yaml` + `change-management.ts` |
| 5 | **OpenSpec (Fission-AI)** | propose→specs→design→tasks→archive、DAG 依赖图(artifact 依赖)、schema 驱动、跨仓库 schema 社区目录 | `L1_spec/specs/` 变更提案 + 归档 + DAG 依赖 |
| 6 | **ralphy-openspec** | /ralphy-plan(创建 spec) → /ralphy-implement → /ralphy-validate → /ralphy-archive、Ralph Loop(AI 反复执行直到完成) | `aza_prd` + `aza_loop` 四阶段 + 内循环 Ralph Loop |
| 7 | **mattpocock/skills** | to-prd(PRD 落地为 GitHub Issue)、to-issues(任务拆分) | `L1_spec/` PRD→Story 拆解 |
| 8 | **pm-claude-skills (mohitagw)** | PM 工作流技能、需求管理、迭代规划 | `L5_skill/` PM 技能组 |

**关键设计**：PRD 生成采用 create-prd-skill 的 14 章模板 + 复杂度分级（L1 配置级/L2 规则级/L3 模块级/L4 系统级），审查采用 check-prd-skill 的 14 维度 + P0-P3 分级。两个工具在 open 阶段内循环形成闭环：create 生成初稿 → check 审查漏洞 → 迭代优化直到 P0=0。

### 6.3 L2 记忆层 — 三层 Reflexion 记忆

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **planning-with-files (OthmanAdi)** | 三文件模式(task_plan/findings/progress)、SHA-256 attestation、5 类 Hook 事件、5-Question Reboot Test、3-Strike Error Protocol、Run Ledger | `L2_memory/` 三件套 + `state/checksum.ts` SHA-256 attestation + `continuity/resume-generator.ts` 5-Question Reboot Test |
| 2 | **Trellis (mindfold-ai)** | JSONL 精确上下文注入(implement.jsonl/check.jsonl)、模板哈希、journals 会话日志 | `L2_memory/context-orchestrator.ts` JSONL 编排（精确注入而非全量） |
| 3 | **agentmemory (rohitg00)** 20K+ | 四层记忆(Working/Episodic/Semantic/Procedural)、向量索引、LongMemEval R@5=95.2%、Token 消耗降 92% | `L2_memory/` 四层记忆架构 + 向量检索基准 |
| 4 | **cognee (topoteretes)** 26K+ | 开源 AI 记忆平台、知识图谱引擎、语义检索+结构化记忆融合 | `L2_memory/long-term-memory.ts` 语义记忆 |
| 5 | **memloop (queyue0728)** | 跨终端跨智能体记忆、Git 持久化、一个文件无限记忆 | `L2_memory/` 跨客户端记忆共享 |
| 6 | **loop-engineering (cobusgreyling)** | loop-context 动态状态层(Summarize→Prune→Inject) | `L2_memory/compression.ts` 上下文压缩 |

**关键设计**：SHA-256 attestation 锁定 PRD/PLAN 哈希，篡改可检测。JSONL 精确注入取代全量注入（借鉴 Trellis 的 implement.jsonl/check.jsonl）—— 只注入当前阶段相关的上下文，降低 Token 消耗。loop-context 的 Summarize→Prune→Inject 在上下文压缩前执行。

### 6.4 L3 角色层 — 8 核心角色

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **gstack (garrytan)** | 23 个 AI Agent 专家角色、Think→Plan→Build→Review→Test→Ship→Reflect 工作流、回旋镖循环(计划 vs 现实对比) | `L3_roles/8-core.md` 8 核心角色(think/plan/build/review/test/ship/observe/decide) |
| 2 | **agency-agents (msitarzewski)** 120K+ | 144 个专业 AI Agent 角色、12 部门、Shell+Markdown 极简、跨工具兼容 | `L3_roles/` 186 扩展角色库 |
| 3 | **agency-orchestrator (jnMetaCode)** | DAG 编排、216 中文角色、`ao compose` AI 智能编排、10 种 LLM(7 种免 key) | `L3_roles/dynamic-binder.ts` 角色路由 + `L8_orchestrator/dag-builder.ts` |
| 4 | **agent-skills (addyosmani)** 48K+ | DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP 6 阶段角色映射 | `L3_roles/` 角色到阶段映射 |

**关键设计**：8 核心角色来自 gstack，角色不是独立 Agent 进程，而是 prompt 注入 —— 保持精简。maker/checker 分离通过注入不同角色身份实现（如 build 阶段 Maker=编码者，Checker=测试验证者）。

### 6.5 L4 纪律层 — 4 铁律 + 8 反借口 + 3-Strike

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **superpowers (obra)** 200K+ | TDD Iron Law("NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST")、14 Red Flags、11 Common Rationalizations 借口反驳表、subagent-driven-development、verification-before-completion、11 客户端插件 | `L4_discipline/iron-rules.md` + `anti-rationalizations.md` + `strike-system.ts` |
| 2 | **andrej-karpathy-skills (forrestchang)** | 4 铁律(先想再写/简单优先/外科手术式改动/目标驱动)、70 行 Markdown、犯错率从 41%→3% | `L4_discipline/iron-rules.md` 4 铁律 |
| 3 | **agent-skills (addyosmani)** 48K+ | Anti-Rationalization 表格("写什么 spec 直接开干"→"没有 spec 的代码是技术债")、每 skill 带 RedFlags+Rationalizations | `L4_discipline/anti-rationalizations.md` 8 反借口 |
| 4 | **superpowers-zh (jnMetaCode)** | 中文纪律规则、18 工具适配 | `i18n/zh-CN/rules.md` 中文铁律 |

**关键设计**：铁律措辞采用 superpowers 的绝对性设计（"NO"/"Delete it"/"Start over"），不是"尽量避免"。3-Strike 来自 superpowers 的"同一错误 3 次停止" —— 在阶段内循环中表现为"3 次不达标升级"。Karpathy 的 4 铁律（70 行 Markdown 让犯错率从 41% 降到 3%）证明了"简洁即力量"。

### 6.6 L5 技能层 — 8 段式 Skill 模板

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **agent-skills (addyosmani)** 48K+ | 8 段式(Frontmatter/Overview/When/Process/Examples/Rationalizations/RedFlags/Verification)、20 个 skill、7 slash 命令(/spec/plan/build/test/review/code-simplify/ship) | `L5_skill/templates/SKILL-TEMPLATE.md` 8 段式 |
| 2 | **anthropics/skills** 108K+ | 官方技能集合、四大类别、SKILL.md 开放标准 | `L5_skill/` SKILL.md 标准 |
| 3 | **mattpocock/skills** | 21 个 Skills、to-prd/tdd/git-guardrails、`npx skills@latest add` 一键安装 | `L5_skill/registry.ts` 安装+管理 |
| 4 | **claude-skills (Fokkyp)** | Skill 调用、组合、依赖管理 | `L5_skill/composer.ts` Skill 组合 |
| 5 | **Commonly-used-high-value-skills (seaworld008)** | 多分类技能库、OpenClaw 兼容导出、快照校验 | `L5_skill/` 多分类 + 版本校验 |
| 6 | **create-prd-skill / check-prd-skill** | PM 技能组(PRD 生成/审查)、14 章模板 + 14 维审查 | `L5_skill/core-skills/prd/` |
| 7 | **loop-engineering (cobusgreyling)** | 5 building blocks(Automations/Worktrees/Skills/Plugins/Sub-agents)+Memory、7 循环模式 | `L5_skill/` Skill 作为 building block 之一 |

**关键设计**：8 段式 Skill 模板来自 agent-skills —— Frontmatter/Overview/When/Process/Examples/Rationalizations/RedFlags/Verification 八段结构。其中 Rationalizations 和 RedFlags 两段直接来自 superpowers，预判 AI 偷懒借口并写好反驳。

### 6.7 L6 安全层 — 8 层防御 + Policy-as-Code

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **shellward (jnMetaCode)** | 8 层防御链(L1 提示守卫→L2 输入审计→L3 工具拦截→L4 输出扫描→L5 安全门→L6 数据流守卫→L7 出站守卫→L8 会话守卫)、37 条注入规则、PII 检测、MCP 工具投毒扫描、rug-pull 检测、DLP 模型、Policy-as-Code、中国合规体检(网安法/PIPL/等保2.0/数据出境/AI 标识) | `L6_security/policy-as-code.ts` + `scanners/` 8 个扫描器 + `compliance-checker.ts` 中国合规 |
| 2 | **gstack (garrytan)** | OWASP Top 10、STRIDE 威胁建模、回旋镖循环(计划 vs 现实) | `L6_security/` 安全检查清单 + STRIDE 建模 |
| 3 | **agent-skills (addyosmani)** 48K+ | security-and-hardening skill(OWASP Top 10/认证/Secrets/三层边界) | `L6_security/` 安全检查清单 |
| 4 | **GitHub Secret Scanning** | 密钥扫描(200+ token 类型/180+ 服务商)、推送保护、AI 检测非结构化密码 | `L6_security/scanners/secret.ts` 密钥扫描 |
| 5 | **strix (usestrix)** 29K+ | AI 渗透测试、自然语言→安全扫描全流程 | `L6_security/` 安全扫描流程 |

**8 层防御链**（借鉴 shellward，对应 MCP 事件模拟器的 pre/post-tool 模拟）：

| 层 | 防御 | 对应模拟事件 |
|----|------|------------|
| L1 提示守卫 | 提示注入拦截 | pre-tool 模拟：输入审计 |
| L2 输入审计 | PII 检测 + 37 条注入规则 | pre-tool 模拟：输入审计 |
| L3 工具拦截 | 阶段白名单 + MCP 投毒扫描 | pre-tool 模拟：阶段白名单 |
| L4 输出扫描 | 密钥泄露 + 代码注入检测 | post-tool 模拟：输出扫描 |
| L5 安全门 | 安全门禁 Gate4 | verify 阶段内循环 |
| L6 数据流守卫 | 数据流追踪 | post-tool 模拟 |
| L7 出站守卫 | DLP 数据外泄检测 | post-tool 模拟 |
| L8 会话守卫 | 会话级异常检测 | on-stop 模拟 |

**Policy-as-Code**（借鉴 shellward）：安全策略以声明式 YAML 配置（`policy.yaml`），而非硬编码规则 —— 便于审计和调整。

### 6.8 L7 循环层 — 三级循环 + 断路器 + loop-audit

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **loop-engineering (cobusgreyling)** | 5 building blocks(Automations/Worktrees/Skills/Plugins/Sub-agents)+Memory、7 循环模式(daily_triage/pr_babysitter/ci_sweeper 等)、Circuit Breaker(4 维度:iteration/token/stagnation/no-progress)、loop-audit(18 信号/4 级别 L0-L3)、loop-context(Summarize→Prune→Inject) | `L7_loop/outer-loop.ts` 外循环 + `circuit-breaker.ts` 断路器 + `loop-audit.ts` 18 信号评分 |
| 2 | **comet (rpamis)** | 5 阶段状态机(open→design→build→verify→archive)、Guard 脚本、HEARTBEAT 防漂移、auto_transition、29 平台、Node 跨平台运行时 | `L7_loop/state-machine.ts` + `guards.ts` + `inner-loop.ts` 内循环 + auto_transition |
| 3 | **ralphy-openspec** | Ralph Loop(AI 反复执行直到完成)、STATUS.md 实时状态、BUDGET.md 预算、TASKS.md 任务看板、state.db 任务账本 | `L7_loop/loop-controller.ts` Ralph Loop + 外循环看板/预算 |
| 4 | **planning-with-files (OthmanAdi)** | `/plan-loop` 外循环 + `/plan-goal` 内循环、Completion Gate(5 条件)、5-Question Reboot Test、3-Strike Error Protocol、SHA-256 attestation、Run Ledger | `L7_loop/outer-loop.ts` + `inner-loop.ts` 双循环 + `completion-gate.ts` Completion Gate |
| 5 | **superpowers (obra)** 200K+ | TDD RED-GREEN-REFACTOR 循环、verification-before-completion、subagent-driven-development | `L7_loop/phase-loop.ts` build 阶段内循环 TDD |
| 6 | **Trellis (mindfold-ai)** | 4 阶段循环(Plan→Implement→Verify→Finish)、maker/checker sub-agent 分离、17 平台降级策略 | `L7_loop/phase-loop.ts` maker/checker 分离 |
| 7 | **loop-context (cobusgreyling)** | 有状态记忆管理 + 断路器(circuit breaker) | `L7_loop/circuit-breaker.ts` |

**三级循环落地**：
- `outer-loop.ts` — 外循环控制器（Schedule/Triage/分派/Human Gate/Commit）
- `inner-loop.ts` — 内循环控制器（5 阶段流转 + auto_transition + 3 次失败升级）
- `phase-loop.ts` — 阶段内循环控制器（maker/checker + 质量门控 + 迭代优化）
- `circuit-breaker.ts` — 断路器（4 维度监控，三级循环每级都有监控点）
- `loop-audit.ts` — loop-audit 18 信号评分
- `phase-gates.ts` — 5 阶段质量门控定义
- `completion-gate.ts` — Completion Gate（5 条件 + 5-Question Reboot Test）

### 6.9 L8 编排层 — DAG 依赖图 + 蜂群接口

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **OpenSpec (Fission-AI)** | DAG 依赖图(artifact 依赖关系)、并行检测、schema 驱动 | `L8_orchestrator/dag-builder.ts` DAG 构建 + 并行检测 |
| 2 | **ruflo (ruvnet)** 45K+ | Swarm 协调(层次/网状/自适应)、100+ agent、Learning Loop、12 个自动 worker、33 个插件 | `L8_orchestrator/swarm/coordinator.ts` 蜂群协调器(接口) |
| 3 | **agency-orchestrator (jnMetaCode)** | DAG 编排、216 中文角色、`ao compose` AI 智能编排、10 种 LLM(7 种免 key) | `L8_orchestrator/yaml-orchestrator.ts` YAML 编排 + `ao compose` 式智能分派 |
| 4 | **orca (stablyai)** | 并行 Worktree IDE、Claude/Codex/OpenCode 并排运行、手机监控 | `L8_orchestrator/worktree/manager.ts` Worktree 并行(接口) |
| 5 | **superpowers (obra)** 200K+ | using-git-worktrees skill、dispatching-parallel-agents、subagent-driven-development | `L8_orchestrator/` 并行开发接口 |
| 6 | **gstack (garrytan)** | 23 专家角色、Think→Plan→Build→Review→Test→Ship→Reflect | `L8_orchestrator/scheduler.ts` 任务调度 |

**关键设计**：MVP 仅预留接口，不实现蜂群编排。Worktree 并行标记为 `enabled:false`。DAG 依赖图在 design 阶段内循环构建，用于检测任务间依赖关系和无依赖任务的并行机会。

### 6.10 L9 知识层 — 66 编程技巧 + 上下文感知注入

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **ai-coding-guide (jnMetaCode)** | 66 编程技巧、工具选择矩阵 | `L9_knowledge/66-techniques.md` |
| 2 | **awesome-harness-engineering (ai-boost)** | Harness Engineering 综合、Context Injection 实践、Terminal Bench 排名提升 | `L9_knowledge/injection-engine.ts` |
| 3 | **Context Engineering (Karpathy)** | 动态上下文编排、上下文管道构建 | `L9_knowledge/injection-engine.ts` 上下文感知注入 |
| 4 | **agent-knowledge-framework** | 独立知识库、结构化可检索、跨项目复用 | `L9_knowledge/` 知识库结构 |
| 5 | **Trellis (mindfold-ai)** | .trellis/spec/ 规范注入、trellis-update-spec 学习沉淀 | `L9_knowledge/` 知识沉淀 |

**关键设计**：66 技巧来自 ai-coding-guide，上下文感知注入按 Story 类型动态选择技巧注入。MVP 用规则匹配，语义权重后续升级。JSONL 精确注入（借鉴 Trellis）取代全量注入，降低 Token 消耗。

### 6.11 Hook 横切层 — 5 事件模型 + MCP 事件桥接

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **planning-with-files (OthmanAdi)** | 5 类 Hook 事件(UserPromptSubmit/PreToolUse/PostToolUse/Stop/PreCompact)、Completion Gate、Run Ledger | `Hook/mcp-event-bridge.ts` MCP 事件桥接 + `Hook/events/completion-gate.ts` |
| 2 | **loop-engineering (cobusgreyling)** | 事件总线(session-start→pre-tool→post-tool→…)、5 building blocks | `Hook/event-bus.ts` 事件总线 |
| 3 | **comet (rpamis)** | Hook 守卫(PreToolUse 拦截 + 阶段白名单)、HEARTBEAT 防漂移、状态机转换触发 | `Hook/events/pre-tool.ts` 阶段白名单 |
| 4 | **Trellis (mindfold-ai)** | inject-subagent-context.py(PreToolUse Task hook 加载 JSONL)、模板哈希 | `Hook/events/pre-tool.ts` JSONL 上下文加载 |
| 5 | **superpowers (obra)** 200K+ | session-start hook(subagent+skills 自动激活)、compaction 后重新注入 | `Hook/events/session-start.ts` |

**关键设计**：V12 将 V11 的 9 事件简化为 planning-with-files 的 5 类核心事件模型，并在 MCP 事件模拟器中完整模拟这 5 类事件。T1 客户端原生触发，T2/T3 通过 MCP 事件模拟器补偿。on-stop(Stop 事件)在 T2/T3 采用 Completion Gate + 预写 RESUME 策略。

### 6.12 质量门禁 — 六级 Pipeline

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **superpowers (obra)** 200K+ | TDD RED-GREEN-REFACTOR、test-driven-development skill、verification-before-completion skill | `quality/gates/gate2-test.ts` TDD 强制 |
| 2 | **loop-engineering (cobusgreyling)** | loop-audit 18 信号评分、Loop Ready 评分、约束+治理评分 | `quality/gates/gate6-loop-audit.ts` loop-audit 门禁 |
| 3 | **agent-skills (addyosmani)** 48K+ | /test(测试) /review(代码审查) /code-simplify(简化) slash 命令 | `quality/gates/` 质量检查 |
| 4 | **shellward (jnMetaCode)** | Policy-as-Code、中国合规体检 | `quality/gates/gate4-security.ts` Policy-as-Code 融合 |
| 5 | **ralphy-openspec** | /ralphy-validate 验收标准验证 | `quality/gates/gate5-acceptance.ts` 验收对照 |
| 6 | **gstack (garrytan)** | OWASP Top 10、STRIDE 威胁建模 | `quality/gates/gate4-security.ts` 威胁建模 |

**六级 Pipeline**（V11 五级 + V12 新增 Gate6）：

```
Gate1 静态分析(tsc+ESLint) → Gate2 测试(Vitest/TDD) → Gate3 回归(基线对照)
→ Gate4 安全(8 层防御+Policy-as-Code) → Gate5 验收(PRD 对照) → Gate6 loop-audit(18 信号评分)
```

**关键设计**：Gate6 loop-audit 是 V12 新增 —— 运行 `aza audit` 输出 0-100 分评分（含三级循环信号），低于阈值（默认 60 分）则 verify 阶段内循环不通过。

### 6.13 续航机制 — MCP 能力补偿 + 三链路

| # | 借鉴的 GitHub 项目 | 借鉴点 | 落地到 AzaLoop 的具体实现 |
|---|------------------|--------|------------------------|
| 1 | **comet (rpamis)** | /comet 恢复指令、断点恢复 | `continuity/mcp-continue.ts` aza continue |
| 2 | **ralphy-openspec** | Ralph Loop 续跑、STATUS.md 实时状态、state.db 任务账本 | `continuity/resume-generator.ts` |
| 3 | **Trellis (mindfold-ai)** | /trellis:finish-work 归档+日志、workspace journals | `continuity/catchup-protocol.ts` |
| 4 | **planning-with-files (OthmanAdi)** | 三文件持久化、SHA-256 attestation、5-Question Reboot Test | `continuity/` 状态文件 + attestation |
| 5 | **memloop (queyue0728)** | 跨终端跨智能体记忆、Git 持久化 | `continuity/` 跨客户端续跑 |
| 6 | **loop-engineering (cobusgreyling)** | loop-context 有状态记忆管理 + 断路器 | `continuity/` 断路器 |

**三链路续航**（AzaLoop 原创）：
- **链路 A：next_action 链式驱动**（24 客户端通用）—— 每个 MCP 工具返回 next_action，宿主 LLM 自动续调。
- **链路 B：原生 Hook + RESUME**（Full 客户端）—— 会话结束触发 onStop 写 RESUME，下次会话读 RESUME 续跑。
- **链路 C：MCP 事件模拟器**（MCP-Simulated/Rule-Injected/Manual-Trigger 客户端）—— 每次工具调用模拟 pre/post-tool + 预写 RESUME + Completion Gate 阻止假完成。

---

## 7. 三级循环完整流程图

下图使用 ASCII 艺术展示从用户输入到工业级应用产出的完整三级循环流程。

### 7.1 端到端三级循环总览

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                        用户输入一句话："做贪吃小老鼠游戏"                           ║
╚══════════════════════════════════════════════════════════════════════════════════╝
                                        │
                                        ▼
                ┌───────────────────────────────────────────────┐
                │  aza init → 自动检测客户端（24 选 1）            │
                │  生成对应配置 + 注入统一续跑规则 continue.md      │
                │  配置降级策略（Full/Partial-Hook/MCP-Sim/...）  │
                └───────────────────────┬───────────────────────┘
                                        │
   ╔════════════════════════════════════╧═════════════════════════════════════════╗
   ║  外循环 Outer Loop（时间驱动分诊，跨 Story 级别）                              ║
   ║                                                                               ║
   ║  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐                 ║
   ║  │ Schedule │──▶│ Triage   │──▶│ Read     │──▶│ 分派     │                 ║
   ║  │ /Cadence │   │ 优先级   │   │ STATE    │   │ Story    │                 ║
   ║  │ 节拍触发 │   │ + 预算   │   │ 恢复上下文│   │ 委派     │                 ║
   ║  └──────────┘   └──────────┘   └──────────┘   └────┬─────┘                 ║
   ║       ▲                                              │                      ║
   ║       │              ┌───────────────────────────────┘                      ║
   ║       │              ▼                                                      ║
   ║  ┌────┴─────┐   ┌──────────┐   ┌────────────────────────┐                    ║
   ║  │ 回到     │◀──│ Commit   │◀──│ Human Gate?            │                    ║
   ║  │ Schedule │   │ /PR/     │   │ 人工门控（敏感操作）    │                    ║
   ║  │          │   │ Escalate │   │ 敏感操作需人工确认      │                    ║
   ║  └──────────┘   └──────────┘   └────────────────────────┘                    ║
   ╚═════════════════════════════════════════════════════════════════════════════╝
                                        │ 分派 Story
                                        ▼
   ╔══════════════════════════════════════════════════════════════════════════════╗
   ║  内循环 Inner Loop（目标驱动执行，单 Story 级别）                              ║
   ║                                                                               ║
   ║   接收 Story ──────────────────────────────────────────────────────▶ Story?   ║
   ║        │                                                           完成?     ║
   ║        ▼                                                              │      ║
   ║   ┌─────────┐  达标   ┌─────────┐  达标   ┌─────────┐  达标          │      ║
   ║   │  open   │────────▶│ design  │────────▶│ build   │─────────┐      │      ║
   ║   │ PRD生成 │ 阶段内  │ 架构设计 │ 阶段内  │ TDD编码 │ 阶段内  │      │      ║
   ║   └─────────┘ 循环    └─────────┘ 循环    └─────────┘ 循环    ▼      │      ║
   ║        ▲                                              ┌─────────┐  │      ║
   ║        │                                    达标       │ verify  │  │      ║
   ║        │                              ┌──────────────▶│ 五级门禁│  │      ║
   ║        │                              │ 阶段内循环    └─────────┘  │      ║
   ║        │                              │                   │ 达标   │      ║
   ║        │                              │                   ▼        │      ║
   ║        │                              │              ┌─────────┐   │      ║
   ║        │                              │              │ archive │   │      ║
   ║        │                              │              │ 归档    │   │      ║
   ║        │                              │              └────┬────┘   │      ║
   ║        │                              │                   │        │      ║
   ║        │                              └───────────────────┴────────┘      ║
   ║        │ 失败 3 次                                              │          ║
   ║        └──────────────── Story 标记 blocked → 升级外循环 ◀──────┘ 否       ║
   ║                                                                          是  ║
   ╚══════════════════════════════════════════════════════════════════════════╝
                                        │ 每阶段触发
                                        ▼
   ╔══════════════════════════════════════════════════════════════════════════════╗
   ║  阶段内循环 Phase Loop（质量门控迭代，单阶段内部）                              ║
   ║                                                                               ║
   ║   ┌─────────┐      ┌─────────┐      ┌─────────────┐                         ║
   ║   │ 执行     │─────▶│ 质量检查 │─────▶│ 达标?      │                         ║
   ║   │ (Maker) │      │(Checker)│      │ Quality    │                         ║
   ║   └─────────┘      └─────────┘      │ Gate       │                         ║
   ║        ▲                            └──────┬──────┘                         ║
   ║        │                                   │                              ║
   ║        │              ┌────────────────────┼──────────────┐               ║
   ║        │              │ 是(达标)            │ 否(不达标)   │               ║
   ║        │              ▼                    ▼              │               ║
   ║        │     ┌──────────────┐    ┌──────────────┐         │               ║
   ║        │     │ 进入下一阶段 │    │ 优化          │         │               ║
   ║        │     │ auto_        │    │(Optimizer)   │         │               ║
   ║        │     │ transition   │    │ 根据建议修复  │         │               ║
   ║        │     └──────────────┘    └──────┬───────┘         │               ║
   ║        │                               │ 迭代计数 < 5?    │               ║
   ║        └───────────────────────────────┘ 是 ─────────────┘               ║
   ║                                            │ 否(3 次不达标)               ║
   ║                                            ▼                              ║
   ║                                   ┌──────────────────┐                    ║
   ║                                   │ 升级内循环        │                    ║
   ║                                   │ Story blocked    │                    ║
   ║                                   └──────────────────┘                    ║
   ╚════════════════════════════════════════════════════════════════════════════╝
                                        │
                                        ▼ 每次工具调用经 MCP 事件模拟器
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  MCP 事件模拟器（包装所有 MCP 工具调用）                                    │
   │                                                                            │
   │  pre-tool 模拟 ──▶ 工具执行 ──▶ post-tool 模拟 ──▶ 返回 next_action        │
   │  · 纪律校验       · 核心逻辑    · 更新 STATE       · 驱动 LLM 续调          │
   │  · 阶段白名单                   · 输出扫描         · Completion Gate        │
   │  · 输入审计(PII)                · 预写 RESUME        检查                    │
   │  · JSONL 上下文加载             · Run Ledger                                 │
   └──────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼ 断路器监控（4 维度）
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  断路器 Circuit Breaker（4 维度监控，三级循环每级都有监控点）                 │
   │                                                                            │
   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
   │  │ iteration    │  │ token        │  │ stagnation  │  │ no-progress  │   │
   │  │ 迭代次数监控 │  │ Token 消耗   │  │ 停滞检测     │  │ 无进展检测   │   │
   │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
   │         │                │                 │                │             │
   │         └────────────────┴─────────────────┴────────────────┘             │
   │                                  │ 任一维度超阈值                        │
   │                                  ▼                                       │
   │                         停止当前循环级别 → 升级                            │
   └──────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  产出：工业级应用                                                          │
   │  · 可运行代码（TDD 100% 通过）                                             │
   │  · 完整文档（PRD/架构/DB/API/TestPlan/部署 6 种）                           │
   │  · 安全合规（8 层防御 + 中国合规体检通过）                                  │
   │  · 跨客户端/跨会话/跨模型无缝续航                                           │
   └──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 next_action 链式驱动详解

```
用户在任意客户端输入 "做贪吃小老鼠游戏"
  │
  ├─▶ continue.md 规则触发 → aza_context status（恢复 STATE）
  │      │
  │      ▼ 返回 next_action
  ├─▶ aza_prd generate（open 阶段 Maker：生成 14 章 PRD）
  │      │ post-tool 模拟：更新 STATE + 预写 RESUME
  │      ▼ 返回 next_action: { tool: "aza_prd", action: "check" }
  ├─▶ aza_prd check（open 阶段 Checker：14 维审查）
  │      │ P0 > 0? → Optimizer 修复 → 回到 generate（阶段内循环）
  │      │ P0 = 0? → 返回 next_action
  │      ▼ 返回 next_action: { tool: "aza_loop", action: "next" }
  ├─▶ aza_loop next（auto_transition → design 阶段）
  │      ▼ 返回 next_action: { tool: "aza_task", action: "design" }
  ├─▶ aza_task design（design 阶段 Maker：7 图 + DAG）
  │      ▼ 返回 next_action: { tool: "aza_quality", action: "design_check" }
  ├─▶ aza_quality design_check（design Checker：评审）
  │      │ 7 图完整? → 通过
  │      ▼ 返回 next_action: { tool: "aza_loop", action: "next" }
  ├─▶ aza_loop next（auto_transition → build 阶段）
  │      ▼ 返回 next_action: { tool: "aza_task", action: "build" }
  ├─▶ aza_task build（build 阶段：TDD Red→Green→Refactor 循环）
  │      ▼ 返回 next_action: { tool: "aza_quality", action: "check" }
  ├─▶ aza_quality check（verify 阶段：5 级门禁）
  │      │ 某级失败? → 修复 → 重复（阶段内循环）
  │      │ 全通过? → 返回 next_action
  │      ▼ 返回 next_action: { tool: "aza_loop", action: "next" }
  ├─▶ aza_loop next（auto_transition → archive 阶段）
  │      ▼ 返回 next_action: { tool: "aza_doc", action: "generate" }
  ├─▶ aza_doc generate（archive：6 种文档 + 记忆沉淀）
  │      ▼ Completion Gate 检查（5 条件全满足）
  │      ▼ 返回 next_action: undefined（允许停止）

关键：宿主 LLM 看到 next_action 就自动续调 —— 这就是"能力对齐"
无论 Cursor 的 Composer 还是 Aider 的 CLI，行为完全一致
```

---

## 8. 核心数据结构

### 8.1 STATE 结构

STATE.yaml 是跨会话/跨客户端/跨模型续航的核心。V12 在 V11 基础上增加 `phase`（阶段内循环）和 `iteration`（三级迭代计数）字段。

```yaml
# .aza/STATE.yaml — 三级循环状态
pipeline:
  current_stage: "build"          # open→design→build→verify→archive
  stages:
    open:    { status: "completed", started_at: "...", completed_at: "..." }
    design:  { status: "completed", started_at: "...", completed_at: "..." }
    build:   { status: "in_progress", started_at: "...", error: null }
    verify:  { status: "pending" }
    archive: { status: "pending" }

# V12 新增：三级循环状态
loops:
  outer:                          # 外循环
    cadence: "manual"             # Schedule 节拍（manual/daily/event）
    triage_at: "2026-07-12T10:00"
    board:                        # 任务看板
      pending: ["STORY-004", "STORY-005"]
      in_progress: ["STORY-003"]
      done: ["STORY-001", "STORY-002"]
      blocked: []
    budget:                       # 预算追踪
      tokens_used: 12500
      tokens_budget: 50000
      time_used_min: 12
  inner:                          # 内循环
    current_story: "STORY-003"
    story_attempts: 1             # 该 Story 失败次数（3 次升级）
    max_story_attempts: 3
  phase:                          # 阶段内循环（V12 新增）
    current: "build"              # 当前阶段
    iteration: 2                  # 当前阶段内循环迭代次数
    max_iterations: 5             # 阶段内循环最大迭代
    history:                      # 迭代历史（供断路器监控）
      - { iter: 1, result: "fail", reason: "test_timeout", suggestions: "..." }
      - { iter: 2, result: "pending" }
    maker_role: "coder"           # Maker 角色
    checker_role: "tester"       # Checker 角色（与 Maker 分离）

# V11 保留：跨客户端/跨模型字段
client: "cursor"                  # 当前客户端（切换时更新）
model: "sonnet-4"                 # 当前模型（切换时更新）

loop:                             # 兼容 V11 的循环字段
  iteration: 12                   # 总迭代次数
  progress: "60%"
  current_story: "STORY-003"
  max_iterations: 50

memory:
  episodic_ref: "ep-2026-07-11-03"
  semantic_keys: ["react-game-loop", "canvas-rendering"]

security_findings: []
strikes: 0
prd_id: "prd-2026-07-12-01"

# V12 新增：完整性保护
attestation:                     # SHA-256 attestation（借鉴 planning-with-files）
  prd_hash: "sha256:a1b2c3..."    # PRD 内容哈希
  plan_hash: "sha256:d4e5f6..."   # 任务计划哈希
  verified: true                  # 篡改检测

updated_at: "2026-07-12T10:30:00"
```

**Zod Schema 定义**（`packages/shared/src/schemas/state.schema.ts` 扩展）：

```typescript
// V12 扩展的 STATE Schema
export const PhaseLoopSchema = z.object({
  current: z.enum(['open', 'design', 'build', 'verify', 'archive']),
  iteration: z.number().int().min(0).default(0),
  max_iterations: z.number().int().default(5),
  history: z.array(z.object({
    iter: z.number().int(),
    result: z.enum(['pass', 'fail', 'pending']),
    reason: z.string().optional(),
    suggestions: z.string().optional(),
  })).default([]),
  maker_role: z.string().default('maker'),
  checker_role: z.string().default('checker'),
});

export const OuterLoopSchema = z.object({
  cadence: z.enum(['manual', 'daily', 'event']).default('manual'),
  triage_at: z.string().optional(),
  board: z.object({
    pending: z.array(z.string()).default([]),
    in_progress: z.array(z.string()).default([]),
    done: z.array(z.string()).default([]),
    blocked: z.array(z.string()).default([]),
  }).default({}),
  budget: z.object({
    tokens_used: z.number().int().default(0),
    tokens_budget: z.number().int().default(50000),
    time_used_min: z.number().int().default(0),
  }).default({}),
});

export const InnerLoopSchema = z.object({
  current_story: z.string().optional(),
  story_attempts: z.number().int().min(0).default(0),
  max_story_attempts: z.number().int().default(3),
});

// 跨客户端/跨模型关键字段（V11 保留）
export const LoopSchema = z.object({
  iteration: z.number().int().min(0).default(0),
  progress: z.string().default('0%'),
  current_story: z.string().optional(),
  client: z.string().default('unknown'),      // 当前客户端
  model: z.string().default('unknown'),       // 当前模型
  max_iterations: z.number().int().default(50),
});

export const StateSchema = z.object({
  pipeline: z.object({
    current_stage: z.enum(['open', 'design', 'build', 'verify', 'archive']).default('open'),
    stages: z.record(z.enum(['open', 'design', 'build', 'verify', 'archive']), StageSchema),
  }),
  loops: z.object({              // V12 新增：三级循环
    outer: OuterLoopSchema.default({}),
    inner: InnerLoopSchema.default({}),
    phase: PhaseLoopSchema,
  }),
  loop: LoopSchema,              // V11 兼容字段（含 client/model）
  memory: MemoryRefSchema.default({}),
  security_findings: z.array(SecurityFindingSchema).default([]),
  strikes: z.number().int().min(0).default(0),
  prd_id: z.string().optional(),
  attestation: z.object({        // V12 新增：SHA-256 attestation
    prd_hash: z.string().optional(),
    plan_hash: z.string().optional(),
    verified: z.boolean().default(true),
  }).default({}),
  updated_at: z.string(),
});
```

### 8.2 LoopResponse 结构（含 next_action）

LoopResponse 是所有 MCP 工具的统一返回格式，`next_action` 是跨客户端能力对齐的基石。

```typescript
// packages/shared/src/schemas/loop-response.schema.ts
export const NextActionSchema = z.object({
  tool: z.string(),              // 下一个要调用的 MCP 工具
  action: z.string(),            // 该工具的具体操作
  reason: z.string(),            // 为什么要调这个（供 LLM 理解）
  payload: z.record(z.unknown()).optional(), // 传递参数
});

export const LoopResponseMetadataSchema = z.object({
  iteration: z.number().int(),   // 当前迭代次数
  progress: z.string(),          // 进度百分比
  tokens_used: z.number().int().optional(),
  stage: z.string().optional(),   // 当前阶段
  loop_level: z.enum(['outer', 'inner', 'phase']).optional(), // V12 新增：循环级别
  phase_iteration: z.number().int().optional(),               // V12 新增：阶段内循环迭代
});

export const LoopResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  next_action: NextActionSchema.optional(),  // 核心字段：驱动 LLM 续调
  error: z.string().optional(),
  metadata: LoopResponseMetadataSchema.optional(),
});
```

**next_action 工作原理**：

```typescript
// 示例：aza_prd generate 的返回
{
  success: true,
  data: { prd_id: "prd-2026-07-12-01", chapters: 14 },
  next_action: {
    tool: "aza_prd",
    action: "check",
    reason: "PRD 已生成，需进入 14 维审查（open 阶段内循环 Checker）",
    payload: { prd_id: "prd-2026-07-12-01" }
  },
  metadata: {
    iteration: 3,
    progress: "10%",
    stage: "open",
    loop_level: "phase",      // 当前在阶段内循环
    phase_iteration: 1       // 阶段内第 1 次迭代
  }
}
```

**关键设计**：`next_action` 为 `undefined` 时表示 Completion Gate 通过、允许停止。否则 LLM 必须自动续调 `next_action` 指定的工具 —— 这是 24 客户端能力对齐的核心。

### 8.3 PhaseGate 定义

PhaseGate 定义每个阶段内循环的质量门控标准。每个阶段有独立的验收条件、最大迭代次数和升级策略。

```typescript
// packages/core/src/L7_loop/phase-gates.ts

export interface PhaseGate {
  stage: 'open' | 'design' | 'build' | 'verify' | 'archive';
  name: string;
  max_iterations: number;          // 最大迭代次数（默认 5）
  maker_role: string;              // Maker 角色（制造者）
  checker_role: string;            // Checker 角色（审查者，与 Maker 分离）
  criteria: PhaseGateCriteria[];   // 质量门控条件（全部满足才通过）
  escalate_after: number;          // 超过此次数升级（默认 3）
  on_escalate: 'block_story' | 'human_review';
}

export interface PhaseGateCriteria {
  id: string;
  description: string;
  check: (work: unknown, state: State) => boolean;
  severity: 'blocker' | 'major' | 'minor';  // blocker 级不进修复循环
}

// 5 阶段质量门控定义
export const PHASE_GATES: Record<string, PhaseGate> = {
  open: {
    stage: 'open',
    name: 'PRD 生成与自检门控',
    max_iterations: 5,
    maker_role: 'prd-writer',
    checker_role: 'prd-reviewer',
    criteria: [
      { id: 'p0_zero', description: 'P0 问题数 = 0', severity: 'blocker',
        check: (work) => work.p0Count === 0 },
      { id: 'p1_limit', description: 'P1 问题数 ≤ 3', severity: 'major',
        check: (work) => work.p1Count <= 3 },
      { id: 'acceptance_testable', description: 'acceptance_criteria 全部可测试', severity: 'blocker',
        check: (work) => work.acceptanceAllTestable },
    ],
    escalate_after: 3,
    on_escalate: 'block_story',
  },
  design: {
    stage: 'design',
    name: '架构设计门控',
    max_iterations: 5,
    maker_role: 'architect',
    checker_role: 'arch-reviewer',
    criteria: [
      { id: 'diagrams_complete', description: '7 种架构图完整', severity: 'blocker',
        check: (work) => work.diagrams.length === 7 },
      { id: 'dag_acyclic', description: 'DAG 依赖无环', severity: 'blocker',
        check: (work) => work.dagAcyclic },
      { id: 'review_passed', description: '设计评审通过', severity: 'major',
        check: (work) => work.reviewScore >= 70 },
    ],
    escalate_after: 3,
    on_escalate: 'block_story',
  },
  build: {
    stage: 'build',
    name: 'TDD 编码门控',
    max_iterations: 5,
    maker_role: 'coder',
    checker_role: 'tester',
    criteria: [
      { id: 'tdd_red_first', description: 'TDD 铁律：先写失败测试', severity: 'blocker',
        check: (work) => work.testWrittenFirst },
      { id: 'unit_tests_pass', description: '单元测试 100% 通过', severity: 'blocker',
        check: (work) => work.testPassRate === 1.0 },
      { id: 'iron_rules', description: '4 铁律校验通过', severity: 'major',
        check: (work) => work.ironRulesPassed },
    ],
    escalate_after: 3,
    on_escalate: 'block_story',
  },
  verify: {
    stage: 'verify',
    name: '五级门禁验证',
    max_iterations: 5,
    maker_role: 'verifier',
    checker_role: 'gate-reviewer',
    criteria: [
      { id: 'gate1_lint', description: 'Gate1 静态分析通过', severity: 'major',
        check: (work) => work.gate1Passed },
      { id: 'gate2_test', description: 'Gate2 测试通过', severity: 'blocker',
        check: (work) => work.gate2Passed },
      { id: 'gate3_regression', description: 'Gate3 回归通过', severity: 'major',
        check: (work) => work.gate3Passed },
      { id: 'gate4_security', description: 'Gate4 安全通过', severity: 'blocker',
        check: (work) => work.gate4Passed },
      { id: 'gate5_acceptance', description: 'Gate5 验收通过', severity: 'blocker',
        check: (work) => work.gate5Passed },
    ],
    escalate_after: 3,
    on_escalate: 'block_story',
  },
  archive: {
    stage: 'archive',
    name: '归档门控',
    max_iterations: 3,
    maker_role: 'archiver',
    checker_role: 'doc-reviewer',
    criteria: [
      { id: 'docs_complete', description: '6 种文档完整', severity: 'blocker',
        check: (work) => work.docs.length === 6 },
      { id: 'spec_synced', description: 'spec 同步归档', severity: 'major',
        check: (work) => work.specSynced },
      { id: 'memory_persisted', description: '记忆沉淀完成', severity: 'minor',
        check: (work) => work.memoryPersisted },
    ],
    escalate_after: 3,
    on_escalate: 'human_review',
  },
};
```

### 8.4 Completion Gate 定义

```typescript
// packages/core/src/L7_loop/completion-gate.ts

export interface CompletionGate {
  // 5 个条件全部满足才允许停止
  conditions: CompletionCondition[];
}

export interface CompletionCondition {
  id: string;
  description: string;
  check: (state: State) => boolean;
}

export const COMPLETION_GATE: CompletionCondition[] = [
  {
    id: 'all_stages_done',
    description: '当前 Story 所有阶段状态 = completed',
    check: (state) => Object.values(state.pipeline.stages)
      .every(s => s.status === 'completed'),
  },
  {
    id: 'quality_gates_passed',
    description: '5 级质量门禁全部通过',
    check: (state) => state.pipeline.stages.verify.status === 'completed',
  },
  {
    id: 'no_security_blockers',
    description: '无安全 blocker 未处理',
    check: (state) => !state.security_findings
      .some(f => f.severity === 'critical' || f.severity === 'high'),
  },
  {
    id: 'docs_complete',
    description: '文档完整（6 种文档已生成）',
    check: (state) => state.pipeline.stages.archive.status === 'completed',
  },
  {
    id: 'reboot_test_passed',
    description: '5-Question Reboot Test 通过',
    check: (state) => runRebootTest(state).passed,
  },
];
```

### 8.5 断路器定义

```typescript
// packages/core/src/L7_loop/circuit-breaker.ts

export interface CircuitBreaker {
  // 4 维度监控（借鉴 loop-engineering）
  dimensions: BreakerDimension[];
}

export interface BreakerDimension {
  name: 'iteration' | 'token' | 'stagnation' | 'no-progress';
  threshold: number;          // 阈值
  current: number;            // 当前值
  level: 'phase' | 'inner' | 'outer'; // 监控的循环级别
  action: 'stop_phase' | 'block_story' | 'stop_outer';
}

export const BREAKER_DIMENSIONS: BreakerDimension[] = [
  // 迭代次数监控
  { name: 'iteration', threshold: 5, current: 0, level: 'phase', action: 'stop_phase' },
  { name: 'iteration', threshold: 50, current: 0, level: 'inner', action: 'block_story' },
  { name: 'iteration', threshold: 200, current: 0, level: 'outer', action: 'stop_outer' },
  // Token 消耗监控
  { name: 'token', threshold: 50000, current: 0, level: 'inner', action: 'block_story' },
  { name: 'token', threshold: 500000, current: 0, level: 'outer', action: 'stop_outer' },
  // 停滞检测（相同状态持续 N 次）
  { name: 'stagnation', threshold: 3, current: 0, level: 'phase', action: 'stop_phase' },
  { name: 'stagnation', threshold: 5, current: 0, level: 'inner', action: 'block_story' },
  // 无进展检测（迭代后输出无变化）
  { name: 'no-progress', threshold: 3, current: 0, level: 'phase', action: 'stop_phase' },
  { name: 'no-progress', threshold: 5, current: 0, level: 'inner', action: 'block_story' },
];
```

---

## 9. 关键设计决策

### 9.1 决策一：三级循环而非单循环

**决策**：将 V11 的单循环 5 阶段状态机升级为三级嵌套循环（外循环 + 内循环 + 阶段内循环）。

**理由**：
- V11 的单循环存在三个缺陷：阶段间无质量门控、阶段内无迭代、缺少跨 Story 调度。
- GitHub 热门竞品普遍采用多级循环模式：planning-with-files 的 `/plan-loop`(外)+`/plan-goal`(内)双循环、ralphy-openspec 的 Ralph Loop × OpenSpec 生命周期、Trellis 的 4 阶段 maker/checker 循环、loop-engineering 的 Scheduled Automation + 7 种循环模式。
- 三级循环让每个阶段都有独立的质量门控与迭代优化能力，保证"质量达标才推进"。

**三级职责划分**：
- **外循环**（时间驱动分诊，跨 Story 级别）：Schedule/Cadence → Triage → Read STATE → 分派 Story → Human Gate → Commit/PR → 回到 Schedule。借鉴 loop-engineering Scheduled Automation + ralphy-openspec 看板/预算。
- **内循环**（目标驱动执行，单 Story 级别）：接收 Story → 推进 5 阶段流水线 → 每阶段有阶段内循环 → 全部通过 → Story 完成。借鉴 ralphy-openspec Ralph Loop + comet auto_transition。
- **阶段内循环**（质量门控迭代，单阶段内部）：执行 → 质量检查 → 达标? → 下一阶段 / 不达标? → 优化 → 重复 → 3 次不达标 → 升级。借鉴 superpowers RED-GREEN-REFACTOR + comet Guard + planning-with-files Completion Gate。

**断路器三级接入**：断路器（Circuit Breaker）在三级循环的每一级都有监控点，4 个维度（iteration/token/stagnation/no-progress）防止任意级别失控。阶段内循环超阈值 → 升级内循环；内循环超阈值 → Story blocked 升级外循环；外循环超阈值 → 停止调度报告人工。

**风险**：三级嵌套增加复杂度。缓解：严守"单层 ≤6 模块"红线 + loop-audit 18 信号评分 + 断路器兜底 + 每级独立可测试。

### 9.2 决策二：MCP 事件模拟器而非纯规则注入

**决策**：用 MCP 事件模拟器修复无 Hook 客户端，而非依赖 continue.md 规则注入。

**理由**：
- V11 的 continue.md 规则注入是"建议"——依赖 LLM 自觉执行，LLM 可能忽略规则直接干活。MCP 事件模拟器在工具层面执行，是"强制"——不依赖 LLM 遵守规则。
- 无 Hook 客户端的根本问题是会话结束时不触发 onStop 事件，无法自动写 RESUME。MCP 模拟器在每次工具调用时自动执行 pre/post-tool 逻辑 + 预写 RESUME + Completion Gate 阻止假完成。
- 模拟 5 类 Hook 事件（UserPromptSubmit/PreToolUse/PostToolUse/Stop/PreCompact），覆盖 planning-with-files 的完整事件模型。

**机制**：每次 MCP 工具调用时：pre-tool 模拟（纪律校验 + 阶段白名单 + 输入审计 + JSONL 加载）→ 工具执行 → post-tool 模拟（更新 STATE + 输出扫描 + 预写 RESUME + Run Ledger）→ 返回 next_action（驱动 LLM 续调）。

**降级策略矩阵**：5 级降级（Full 100% / Partial-Hook 95% / MCP-Simulated 90% / Rule-Injected 85% / Manual-Trigger 75%），覆盖 24 客户端。即使最弱的客户端，一旦手动触发 `aza continue`，next_action 链也会自动驱动到会话结束。

**风险**：MCP 模拟器增加每次工具调用的开销。缓解：模拟逻辑轻量（纯文件操作 + 规则匹配），JSONL 精确注入降低 Token 消耗，且只在无原生 Hook 的客户端启用模拟。

### 9.3 决策三：24 客户端全覆盖

**决策**：在 V11 的 16 客户端基础上新增 8 个客户端（Gemini CLI / Codex CLI / Hermes / OpenClaw / Claude Desktop / Comate / WorkBuddy / Qwen Code），实现 24 客户端全覆盖。

**理由**：
- 用户明确要求兼容国内外主流客户端。
- 竞品已支持大量平台：Trellis 17 平台、superpowers-zh 18 工具、comet 29 平台。
- gstack 的设计理念是"新增 host 只需一个配置文件，零代码改动"——AzaLoop 的 MCP 能力补偿层让新增客户端成本极低（一个模板目录 + 检测标志）。

**新增 8 客户端配置**：每个客户端一个 `templates/clients/<name>/` 目录，含 Rules 文件 + mcp.json + 统一 continue.md。降级策略由 `compensation-strategy.ts` 在 `aza init` 时自动检测配置。

**关键设计**：24 客户端的 continue.md 模板内容完全相同，宿主 LLM 看到的行为指令一致。能力差异由 MCP 工具补偿，不依赖客户端原生能力。

**风险**：24 客户端测试矩阵庞大（24 × N 模型组合）。缓解：按降级策略分组测试，同策略客户端行为一致，只需每组测一个代表客户端。

### 9.4 决策四：14 章 PRD + 复杂度分级

**决策**：融合 create-prd-skill 的 14 章 B 端 PRD 模板 + 复杂度分级（L1-L4），而非 V11 的简化版 PRD。

**理由**：
- 工业级应用需要完整 PRD，V11 的简化版无法覆盖业务型/交易型/基础服务型产品的全部维度。
- 复杂度分级（L1 配置级/L2 规则级/L3 模块级/L4 系统级）让小需求不被硬写成大 PRD —— L1 不强制 14 章，L4 强制全 14 章。
- 产品定型（商业化/自研 × 业务型/工具型/交易型/基础服务型）让 PRD 生成更有针对性。
- 审查采用 check-prd-skill 的 14 维度 + P0-P3 分级 + 双路径（章节/降级维度），在 open 阶段内循环形成 create → check → 修复 → 重复直到 P0=0 的闭环。

**14 章模板**：文档元信息 / 项目背景 / 产品定位 / 用户画像 / 场景与用例 / 功能需求 / 非功能需求 / 数据模型 / 接口设计 / 安全与合规 / 验收标准 / 优先级与排期 / 风险与依赖 / 度量指标。

**风险**：14 章 PRD 生成消耗较多 Token。缓解：复杂度感知 —— L1/L2 只生成相关章节，L3/L4 才生成全 14 章；JSONL 精确注入降低上下文成本。

### 9.5 决策五：8 层安全 + Policy-as-Code

**决策**：将 V11 的 5 个安全扫描器升级为 shellward 的 8 层防御链 + Policy-as-Code + 中国合规体检。

**理由**：
- 工业级应用需要纵深防御，5 个扫描器（密钥/SQL/XSS/依赖/代码注入）不足以覆盖现代威胁。
- shellward 的 8 层防御链（提示守卫 → 输入审计 → 工具拦截 → 输出扫描 → 安全门 → 数据流守卫 → 出站守卫 → 会话守卫）覆盖了 LLM 时代的特有威胁（提示注入、MCP 工具投毒、rug-pull）。
- Policy-as-Code 让安全策略以声明式 YAML 配置而非硬编码规则，便于审计和调整。
- 中国合规体检（网安法/PIPL/等保 2.0/数据出境/AI 标识）是国内外差异化的关键 —— 这是国外竞品（superpowers/Trellis/OpenSpec）完全不具备的能力。

**8 层防御对应 MCP 事件模拟**：L1-L3（提示守卫/输入审计/工具拦截）对应 pre-tool 模拟；L4-L7（输出扫描/安全门/数据流/出站）对应 post-tool 模拟；L8（会话守卫）对应 on-stop 模拟。安全防御与三级循环的 MCP 事件模拟器天然融合。

**风险**：8 层安全扫描可能误报导致循环阻塞。缓解：安全 finding 分级（low/medium/high/critical），只有 high/critical 级 blocker 立即停止，low/medium 进入修复循环；Policy-as-Code 允许配置白名单。

---

## 10. 风险与缓解

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|------|------|------|---------|
| 1 | **宿主 LLM 不遵守 next_action 链** | 中 | 高 | prompt 强化（next_action 含 reason 供 LLM 理解）+ Stop Hook 兜底（Full 客户端）+ continue.md 注入（Rule-Injected 客户端）+ MCP 事件模拟器 Completion Gate 阻止假完成 |
| 2 | **三级循环嵌套复杂度膨胀** | 中 | 中 | 严守"单层 ≤6 模块"红线 + 每阶段评审 + loop-audit 18 信号评分 + 断路器 4 维度兜底 + 每级独立可测试 |
| 3 | **无 Hook 客户端会话中断丢上下文** | 高 | 高 | MCP 事件模拟器每次工具调用后预写 RESUME + SHA-256 attestation 校验完整性 + 5-Question Reboot Test 验证恢复 + Completion Gate 阻止假完成 |
| 4 | **阶段内循环死循环（不达标反复迭代）** | 中 | 高 | 断路器 4 维度监控（iteration/stagnation/no-progress 超 5 次停止）+ 3-Strike Error Protocol（3 次不达标升级）+ Checker 输出具体改进建议（非笼统"不通过"） |
| 5 | **14 章 PRD 生成消耗过多 Token** | 中 | 中 | 复杂度感知（L1/L2 只生成相关章节，L4 才全 14 章）+ JSONL 精确注入取代全量注入 + loop-context Summarize→Prune→Inject 压缩 |
| 6 | **8 层安全扫描误报阻塞循环** | 低 | 中 | 安全 finding 分级（blocker 立即停 / major 修复循环 / minor 记录）+ Policy-as-Code 白名单配置 + 安全降级策略（low/medium 进修复循环） |
| 7 | **24 客户端测试矩阵庞大** | 高 | 中 | 按降级策略分组测试（同策略行为一致，每组测一个代表）+ 跨模型矩阵抽样 + 自动化测试覆盖核心路径 |
| 8 | **MCP 事件模拟器增加每次调用开销** | 中 | 低 | 模拟逻辑轻量（纯文件操作 + 规则匹配）+ 只在无原生 Hook 客户端启用 + JSONL 精确注入降低上下文成本 |
| 9 | **maker/checker 角色分离无效（同一 LLM 自审自）** | 中 | 中 | prompt 注入不同角色身份（Maker=制造者，Checker=审查者）+ 不同 system prompt + 强制 Checker 输出 Red Flags + 借鉴 superpowers subagent-driven-development 隔离 |
| 10 | **DAG 依赖图构建错误导致任务乱序** | 低 | 中 | design 阶段内循环 Checker 做 DAG 无环检测 + 并行机会检测 + OpenSpec schema 驱动校验 |
| 11 | **跨模型状态不兼容** | 低 | 高 | 状态全部用文件（Markdown+YAML+JSON）无运行时依赖 + SHA-256 attestation 校验 + client/model 字段记录切换历史 |
| 12 | **中国合规体检规则过时** | 中 | 中 | Policy-as-Code 声明式配置（`policy.yaml`）可独立更新 + 合规检查器版本化 + 不阻断主流程（降级为 warning） |

### 10.1 风险优先级与应对路径

```
高概率 × 高影响（必须优先解决）：
  ├─ 风险 3：无 Hook 客户端丢上下文 → MCP 事件模拟器 + 预写 RESUME + Completion Gate
  └─ 风险 7：24 客户端测试矩阵 → 分组测试 + 代表客户端抽样

中概率 × 高影响（需要重点监控）：
  ├─ 风险 1：LLM 不遵守 next_action → prompt 强化 + Completion Gate 阻止
  └─ 风险 4：阶段内循环死循环 → 断路器 + 3-Strike + 具体建议

低概率 × 高影响（需要兜底方案）：
  └─ 风险 11：跨模型状态不兼容 → 文件持久化 + SHA-256 校验
```

### 10.2 验证矩阵

| 验证项 | 验证标准 | 借鉴来源 |
|--------|---------|---------|
| 三级循环端到端 | 输入"做贪吃小老鼠游戏" → 三级循环全自动产出可运行项目 | comet + ralphy-openspec |
| PRD 阶段内循环 | 输入需求 → PRD 生成 → 14 维自检发现 P0 → 自动修复 → 重复 → P0=0 进入 design | create-prd-skill + check-prd-skill |
| Build 阶段内循环 | 编码 → 测试失败 → TDD 修复 → 重复 → 测试通过进入 verify | superpowers RED-GREEN-REFACTOR |
| Verify 阶段内循环 | 5 级门禁 → Gate2 失败 → 修复 → 重复 → 全通过进入 archive | loop-engineering verifier |
| 阶段不达标升级 | 某阶段 5 次迭代不达标 → 升级内循环 → Story blocked → 外循环分诊 | superpowers 3-Strike |
| 跨会话续航 | 杀 Cursor → Claude Code 打开 → 自动续跑（从中断的阶段内循环继续） | comet + planning-with-files |
| 跨模型续航 | Sonnet → GPT-4o → DeepSeek-V3 切换续跑 | AzaLoop 原创文件持久化 |
| 24 客户端全覆盖 | 24 客户端全部能 `aza init` + 跑通 1 个 Story（含阶段内循环） | Trellis + superpowers |
| 无 Hook 客户端全自动 | Trae/Windsurf/VS Code 全自动三级循环（MCP 事件模拟器） | AzaLoop 原创模拟器 |
| 安全阻断 | 注入含密钥代码 → 安全 Gate4 阻断 → verify 阶段内循环修复 | shellward + gstack |
| loop-audit 评分 | 运行 `aza audit` → 输出 0-100 分评分（含三级循环信号） | loop-engineering loop-audit |
| 断路器触发 | 单阶段迭代 5 次 / 停滞 3 次 → 断路器停止 → 升级 | loop-engineering Circuit Breaker |
| Completion Gate | LLM 试图提前结束 → 5 条件检查 → 不满足则阻止停止继续循环 | planning-with-files Completion Gate |

---

## 附录：竞品借鉴项目速查表

| 项目 | 主要借鉴层 | 核心借鉴点 |
|------|-----------|-----------|
| planning-with-files | L2/L7/Hook/续航 | 三文件模式 + SHA-256 attestation + 5 类 Hook 事件 + `/plan-loop` 外循环 + `/plan-goal` 内循环 + Completion Gate + 5-Question Reboot Test + 3-Strike Error Protocol + Run Ledger |
| comet | L0/L7/Hook | 5 阶段状态机(open→design→build→verify→archive) + Guard 脚本 + HEARTBEAT 防漂移 + auto_transition + 29 平台 + Node 跨平台运行时 |
| Trellis | L0/L2/L7/Hook | 4 阶段循环(Plan→Implement→Verify→Finish) + JSONL 精确上下文注入(implement.jsonl/check.jsonl) + 17 平台降级策略(Full/Partial/Pull-based/Workflow-only) + 模板哈希 + maker/checker |
| loop-engineering | L5/L7/Hook/质量 | 5 构建块(Automations/Worktrees/Skills/Plugins/Sub-agents) + Memory + 7 循环模式 + Circuit Breaker(4 维度:iteration/token/stagnation/no-progress) + loop-audit(18 信号/4 级别 L0-L3) + loop-context(Summarize→Prune→Inject) |
| superpowers | L4/L5/L7/质量 | 7 阶段强制工作流 + TDD Iron Law(NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST) + 14 Red Flags + 11 Common Rationalizations + subagent-driven-development + verification-before-completion + 11 客户端插件 |
| agent-skills | L1/L3/L4/L5/质量 | 8 段式 Skill 模板(Frontmatter/Overview/When/Process/Examples/Rationalizations/RedFlags/Verification) + 7 slash 命令(/spec/plan/build/test/review/code-simplify/ship) |
| spec-kit | L1 | Constitution→specify→plan→tasks→implement + Presets/Extensions 优先级栈 + 30+ AI 编码代理集成 |
| OpenSpec | L1/L8 | propose→specs→design→tasks→archive + DAG 依赖图(artifact 依赖) + schema 驱动 + 跨仓库 schema 社区目录 |
| ralphy-openspec | L1/L7/续航 | /ralphy-plan→/ralphy-implement→/ralphy-validate→/ralphy-archive + Ralph Loop(AI 反复执行直到完成) + STATUS.md + BUDGET.md + TASKS.md + state.db |
| create-prd-skill | L1/L5 | 14 章 B 端 PRD 模板 + 产品定型(商业化/自研×业务型/工具型/交易型/基础服务型) + 复杂度分级 L1-L4 + 4 阶段生成 + 阶段 4 自检 + Mermaid 图表 |
| check-prd-skill | L1/L5 | 14 维度审查 + P0-P3 分级 + 双路径(章节/降级维度) + 产品定型差异化审查 |
| shellward | L6/质量 | 8 层防御链(L1 提示守卫→L2 输入审计→L3 工具拦截→L4 输出扫描→L5 安全门→L6 数据流守卫→L7 出站守卫→L8 会话守卫) + 37 条注入规则 + PII 检测 + MCP 工具投毒扫描 + rug-pull 检测 + DLP 模型 + Policy-as-Code + 中国合规体检(网安法/PIPL/等保2.0/数据出境/AI 标识) |
| ruflo | L8 | Swarm 协调(层次/网状/自适应) + 100+ agent + Learning Loop + 12 个自动 worker + 33 个插件 |
| gstack | L3/L6/L8 | 23 专家角色 + Think→Plan→Build→Review→Test→Ship→Reflect + OWASP Top 10 + STRIDE + 回旋镖循环(计划 vs 现实对比) |
| agency-orchestrator | L3/L8 | DAG 编排 + 216 中文角色 + ao compose AI 智能编排 + 10 种 LLM(7 种免 key) |
| andrej-karpathy-skills | L4 | 4 铁律(先想再写/简单优先/外科手术式改动/目标驱动) + 70 行 Markdown + 犯错率 41%→3% |

---

> 本文档为 AzaLoop V12 三级循环架构方案，基于 V11 十层架构演进而来。三级循环引擎（外循环+内循环+阶段内循环）、MCP 事件模拟器、24 客户端全覆盖是 V12 的三大核心突破。所有设计均经过 20+ GitHub 热门竞品的最佳实践验证。
