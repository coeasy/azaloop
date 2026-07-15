# AzaLoop V12 三级循环架构 开发计划

> 基于 V11 十层架构 + V12 三级循环架构方案，构建外循环（时间驱动分诊）+ 内循环（目标驱动执行）+ 阶段内循环（质量门控迭代）全自动开发引擎。
> 核心目标：每阶段质量达标才进入下一阶段，不达标自动迭代优化，跨客户端/跨会话/跨模型全自动续航。
> 日期：2026-07-12

---

## 1. 标题

**AzaLoop V12 三级循环架构 — 开发计划（DEV-PLAN-V12）**

本计划是 `docs/PROJECT-PLAN-V12.md`（架构方案）的分阶段实施路线图。V11 已完成十层架构基础（L0-L9 + Hook + 质量门禁 + 续航 + MCP Server + CLI + 16 客户端模板），V12 在此基础上引入三大突破：

1. **三级循环引擎** — 外循环 + 内循环 + 阶段内循环，每阶段 maker/checker 分离 + 质量门控 + 迭代计数 + 升级机制
2. **无 Hook 客户端修复** — MCP 事件模拟器 + 降级策略矩阵，让所有客户端实现等效全自动
3. **深度质量管控** — 断路器 4 维度监控 + loop-audit 18 信号评分 + 完成度门控 5 条件

---

## 2. 开发阶段总览

| 阶段 | 任务 | 优先级 | 依赖 | 估时 |
|------|------|--------|------|------|
| **P0** | 三级循环引擎核心（外循环 + 内循环 + 阶段内循环 + 断路器 + 完成度门控 + loop-audit + 状态机扩展） | P0（最高） | V11 已完成 | 5 天 |
| **P1** | MCP 事件模拟器 + 无 Hook 修复（事件模拟器 + 降级策略 + MCP 事件桥接） | P0 | P0 完成 | 2 天 |
| **P2** | L1 PRD 14 章 + L6 安全 8 层（14 章模板 + 14 维审查 + Policy-as-Code + 中国合规） | P1 | P0 完成 | 3 天 |
| **P3** | L2 SHA-256 + L7 断路器/loop-audit 深化（attestation + JSONL 编排 + 断路器集成 + loop-audit 集成） | P1 | P0、P2 完成 | 3 天 |
| **P4** | L8 DAG + Hook 5 事件 + 质量门禁（DAG 依赖图 + 蜂群接口 + 5 事件模型 + Gate6 loop-audit） | P2 | P0、P3 完成 | 3 天 |
| **P5** | 24 客户端模板 + MCP 新工具（8 新客户端 + 客户端检测扩展 + 3 新 MCP 工具） | P2 | P1、P4 完成 | 3 天 |
| **P6** | 端到端验收 + 跨模型测试（三级循环全自动演示 + 跨模型/跨客户端/跨会话续航矩阵） | P3 | P0-P5 全部完成 | 3 天 |

**总计约 22 天**。P0-P1 为三级循环最小可用闭环（7 天），P2-P4 并行推进，P5-P6 为客户端覆盖与验收。

---

## 3. P0: 三级循环引擎核心

**目标**：构建三级循环（外循环 + 内循环 + 阶段内循环）的完整引擎，包含断路器、完成度门控、loop-audit 评分，并扩展现有状态机以支持三级循环状态。

**依赖**：V11 已完成的 `packages/core/src/L7_loop/` 全部模块（state-machine.ts / loop-controller.ts / guards.ts / deadlock-detector.ts / hard-stop.ts）。

**新增文件目录**：`packages/core/src/L7_loop/`

### P0-1: 创建 `packages/core/src/L7_loop/phase-gates.ts` — 5 阶段质量门控定义

**目标**：定义 5 个阶段（open / design / build / verify / archive）各自独立的质量门控标准，供阶段内循环控制器调用。

**核心设计 — 5 阶段质量门控**：

| 阶段 | 门控名称 | 通过条件 | 不通过时动作 |
|------|---------|---------|-------------|
| **open** | PRD 质量门控 | P0 问题数 = 0 且 P1 问题数 ≤ 3 | 定向修复 P0 问题后重新检查 |
| **design** | 架构设计门控 | 7 种架构图完整（系统/数据流/时序/部署/ER/组件/C4）+ 设计评审通过 | 补充缺失架构图后重新检查 |
| **build** | 编码质量门控 | TDD 强制（先写失败测试再写实现）+ 单元测试 100% 通过 | 修复失败测试后重新检查 |
| **verify** | 验证质量门控 | 5 级门禁全通过（lint/test/regression/security/acceptance） | 修复失败门禁后重新检查 |
| **archive** | 归档质量门控 | 6 种文档完整（PRD/架构/API/测试/部署/变更）+ spec 同步 | 补充缺失文档后重新检查 |

**实现要点**：

```typescript
// phase-gates.ts 核心接口设计
export interface PhaseGate {
  stage: Stage;
  name: string;
  check: (context: PhaseCheckContext) => GateCheckResult;
  refine_action: string;
  refine_tool: string;
}

export interface GateCheckResult {
  passed: boolean;
  p0_count: number;        // open 阶段：P0 问题数
  p1_count: number;        // open 阶段：P1 问题数
  missing_diagrams: string[]; // design 阶段：缺失的架构图
  test_pass_rate: number;  // build 阶段：测试通过率
  failed_gates: string[];  // verify 阶段：失败的门禁
  missing_docs: string[];  // archive 阶段：缺失的文档
  suggestions: string[];   // checker 给出的具体改进建议
}

export const PHASE_GATES: Record<Stage, PhaseGate>;
```

**关键逻辑**：
- `PHASE_GATES.open.check` — 调用 `PRDChecker`（已存在于 `L1_spec/prd-checker.ts`），解析 P0/P1 问题数
- `PHASE_GATES.design.check` — 检查 7 种架构图文件是否存在 + 设计评审标记
- `PHASE_GATES.build.check` — 调用 `QualityPipeline.runGate('gate2-test')`（已存在于 `quality/pipeline.ts`）
- `PHASE_GATES.verify.check` — 调用 `QualityPipeline.runAll()`（已存在于 `quality/pipeline.ts`）
- `PHASE_GATES.archive.check` — 检查 6 种文档文件存在性 + spec 同步标记

**验收标准**：
- 5 个阶段各有独立的 `PhaseGate` 定义
- `PHASE_GATES.open.check` 返回 `passed: false` 当 P0 问题 > 0
- `PHASE_GATES.design.check` 返回 `passed: false` 当架构图数 < 7
- `PHASE_GATES.build.check` 返回 `passed: false` 当测试通过率 < 100%
- 单元测试覆盖 5 个阶段的通过/不通过场景

---

### P0-2: 创建 `packages/core/src/L7_loop/phase-loop.ts` — 阶段内循环控制器

**目标**：实现单阶段内部的"执行 → 检查 → 优化 → 重复"循环，maker/checker 分离，maxIterations 默认 5 次。

**核心设计 — 阶段内循环流程**：

```
┌─────────────────────────────────────────────────┐
│  PhaseLoop.run(stage, story)                    │
│                                                 │
│  for i = 0 to maxIterations (默认 5):           │
│    1. Maker 执行该阶段核心工作                    │
│    2. Checker 独立验证（不同角色 prompt）         │
│    3. 调用 PhaseGate.check()                    │
│    4. 达标? → 返回 {success: true}              │
│    5. 不达标 → Optimizer 根据 suggestions 优化   │
│    6. CircuitBreaker.record() 记录本次迭代      │
│    7. CircuitBreaker 检查是否触发断路            │
│                                                 │
│  超过 maxIterations → 返回 {success: false,     │
│    reason: 'max_iterations_exceeded'}            │
└─────────────────────────────────────────────────┘
```

**实现要点**：

```typescript
// phase-loop.ts 核心接口设计
export interface PhaseLoopOptions {
  maxIterations?: number;        // 默认 5
  maker?: Maker;                 // 执行器（可注入，默认按阶段选择）
  checker?: Checker;             // 检查器（可注入，默认按阶段选择）
  optimizer?: Optimizer;         // 优化器（可注入）
  circuitBreaker?: CircuitBreaker; // 断路器（P0-5 创建）
}

export interface Maker {
  execute(stage: Stage, context: PhaseContext): Promise<WorkResult>;
}

export interface Checker {
  verify(stage: Stage, work: WorkResult, gate: PhaseGate): Promise<GateCheckResult>;
}

export interface PhaseResult {
  success: boolean;
  stage: Stage;
  iterations: number;
  work?: WorkResult;
  reason?: string;           // 失败原因
  history: PhaseIteration[]; // 每次迭代的记录
}

export class PhaseLoop {
  constructor(options?: PhaseLoopOptions);
  async run(stage: Stage, context: PhaseContext): Promise<PhaseResult>;
  getHistory(): PhaseIteration[];
}
```

**maker/checker 分离的关键**：
- Maker 和 Checker 必须是不同的"角色"（通过 prompt 注入不同角色名）
- 例如 build 阶段：Maker 角色为 `builder`，Checker 角色为 `reviewer`（来自 `L3_roles/8-core.md` 的 build/review 角色）
- 每次迭代后 Checker 输出具体改进建议（`suggestions` 数组），不是笼统的"不通过"
- 迭代间保留上下文（`history` 数组记录每次尝试和失败原因）

**auto_transition 机制**：
- 阶段内循环达标后，自动触发下一阶段的内循环
- 由 `InnerLoop`（P0-3）调用 `PhaseLoop.run(nextStage)`

**验收标准**：
- `PhaseLoop.run('open', context)` 在 P0=0 时返回 `success: true`
- `PhaseLoop.run('open', context)` 在 P0>0 时迭代修复，5 次后返回 `success: false`
- Maker 和 Checker 角色不同（可验证 prompt 注入的角色名）
- 每次迭代的 `suggestions` 非空且具体
- 断路器触发时立即终止迭代

---

### P0-3: 创建 `packages/core/src/L7_loop/inner-loop.ts` — 内循环控制器

**目标**：管理单 Story 的 5 阶段流转，每阶段调用 `PhaseLoop`（P0-2），auto_transition 自动推进。

**核心设计 — 内循环流程**：

```
┌─────────────────────────────────────────────────────┐
│  InnerLoop.run(story)                               │
│                                                     │
│  1. 接收 Story（从外循环分派）                        │
│  2. 从 STATE 恢复当前阶段（跨会话续航）              │
│  3. for each stage in [open, design, build,        │
│     verify, archive]:                               │
│       a. 调用 PhaseLoop.run(stage, story)           │
│       b. 成功? → auto_transition 到下一阶段          │
│       c. 失败(maxIterations)? → 记录 blocked        │
│          → 升级外循环 → 返回                         │
│  4. 全部 5 阶段通过 → Story 标记 done               │
│  5. 返回 InnerLoopResult                            │
└─────────────────────────────────────────────────────┘
```

**实现要点**：

```typescript
// inner-loop.ts 核心接口设计
export interface InnerLoopOptions {
  phaseLoop?: PhaseLoop;
  stateMachine?: StateMachine;      // 复用现有状态机
  maxStoryFailures?: number;        // 默认 3，Story 连续失败 3 次升级
  autoTransition?: boolean;         // 默认 true
}

export interface Story {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'failed';
  stage?: Stage;                    // 当前所在阶段
  failure_count?: number;
}

export interface InnerLoopResult {
  story_id: string;
  success: boolean;
  stages_completed: Stage[];
  current_stage?: Stage;
  failure_reason?: string;
  escalated: boolean;               // 是否升级到外循环
  phase_results: PhaseResult[];     // 每阶段的内循环结果
}

export class InnerLoop {
  constructor(options?: InnerLoopOptions);
  async run(story: Story): Promise<InnerLoopResult>;
  resume(story: Story): Promise<InnerLoopResult>; // 跨会话恢复
  getCurrentStory(): Story | null;
}
```

**auto_transition 机制**：
- `PhaseLoop.run()` 返回 `success: true` 后，`InnerLoop` 自动调用 `StateMachine.advance()` 推进到下一阶段
- 然后调用 `PhaseLoop.run(nextStage)` 启动下一阶段的内循环
- 全过程无需人工干预

**跨会话恢复**：
- `InnerLoop.resume(story)` 从 STATE 中读取 `current_stage` 和 `phase_iterations`
- 从中断的阶段内循环继续（保留迭代历史）

**升级机制**：
- 某阶段 `PhaseLoop` 返回 `success: false`（maxIterations 超限）
- `InnerLoop` 将 Story 标记为 `blocked`
- `failure_count++`，如果达到 `maxStoryFailures`（3 次），标记为 `failed` 并升级外循环

**验收标准**：
- 单 Story 从 open 到 archive 全自动流转，5 阶段都返回 `success: true`
- 某阶段失败 5 次后，Story 标记 `blocked`，返回 `escalated: true`
- `resume()` 能从中断的阶段继续（验证 `stages_completed` 正确）
- `autoTransition` 关闭时不自动推进（用于人工审批场景）

---

### P0-4: 创建 `packages/core/src/L7_loop/outer-loop.ts` — 外循环控制器

**目标**：实现时间驱动分诊，分派 Story 给内循环，等待内循环完成，处理升级。

**核心设计 — 外循环流程**：

```
┌──────────────────────────────────────────────────────────┐
│  OuterLoop.run(stories)                                 │
│                                                        │
│  1. Schedule/Cadence — 按优先级排序 Story 队列           │
│  2. Triage — 读取 STATE，确定当前应处理的 Story         │
│  3. 分派 Story → InnerLoop.run(story)                  │
│  4. 等待内循环完成                                       │
│  5. 结果处理:                                            │
│     a. done → Commit/PR → 标记完成 → 回到 Schedule      │
│     b. blocked → Escalate（人工介入或重试）              │
│     c. failed → Human Gate → 决定跳过/降级/终止         │
│  6. 回到 Schedule（处理下一个 Story）                    │
└──────────────────────────────────────────────────────────┘
```

**实现要点**：

```typescript
// outer-loop.ts 核心接口设计
export interface OuterLoopOptions {
  innerLoop?: InnerLoop;
  cadence?: number;                 // 调度间隔（毫秒），默认 0（立即）
  enableHumanGate?: boolean;        // 默认 false
  maxRetries?: number;              // blocked Story 最大重试次数，默认 2
}

export interface TriageResult {
  next_story: Story | null;
  reason: string;
  pending_count: number;
  blocked_count: number;
}

export interface OuterLoopResult {
  total_stories: number;
  completed: number;
  blocked: number;
  failed: number;
  escalated_stories: string[];
  stories: StoryStatus[];
}

export interface StoryStatus {
  id: string;
  title: string;
  status: Story['status'];
  retry_count: number;
}

export class OuterLoop {
  constructor(options?: OuterLoopOptions);
  async run(stories: Story[]): Promise<OuterLoopResult>;
  triage(stories: Story[]): TriageResult;
  handleEscalation(story: Story, reason: string): 'retry' | 'skip' | 'halt';
  getProgress(): OuterLoopProgress;
}
```

**时间驱动分诊机制**：
- `triage()` 按 Story 优先级（P0 > P1 > P2）和依赖关系排序
- 如果有 `blocked` Story 且重试次数 < `maxRetries`，优先重试
- `cadence` 控制调度间隔（用于定时巡检场景）

**升级处理**：
- `handleEscalation()` 接收内循环升级的 blocked Story
- `retry`：重新分派给内循环（重置 failure_count）
- `skip`：跳过该 Story，标记为 `skipped`
- `halt`：停止整个外循环（严重故障）

**与内循环的交互**：
- 外循环分派 Story → 调用 `InnerLoop.run(story)`
- 等待 `InnerLoopResult` 返回
- 根据 `escalated` 字段决定升级处理

**验收标准**：
- 3 个 Story 的队列，前 2 个成功，第 3 个 blocked → 外循环返回 `completed: 2, blocked: 1`
- `triage()` 按优先级正确排序
- `handleEscalation()` 返回 `retry` 时 Story 重新分派
- 跨会话恢复：杀进程后重启，外循环从 STATE 恢复未完成的 Story 队列

---

### P0-5: 创建 `packages/core/src/L7_loop/circuit-breaker.ts` — 断路器

**目标**：4 维度监控（iteration count / token spend / stagnation / no-progress），三级循环每级都有监控点。

**核心设计 — 4 维度断路器**：

| 维度 | 含义 | 默认阈值 | 触发动作 |
|------|------|---------|---------|
| **iteration count** | 单阶段迭代次数过多 | maxIterations=5（阶段内循环）/ maxStoryStages=15（内循环）/ maxStories=50（外循环） | 电路开路 → 停止当前级别 → 升级 |
| **token spend** | Token 花费超预算 | maxTokensPerPhase=50000 / maxTokensPerStory=200000 / maxTokensTotal=1000000 | 电路开路 → 停止 → 报告 |
| **stagnation** | 连续 N 次迭代无进展（质量分不变） | stagnationThreshold=3 | 电路开路 → 停止 → 建议换策略 |
| **no-progress** | 进度指标停滞（如测试通过率不升） | noProgressThreshold=3 | 电路开路 → 停止 → 建议人工介入 |

**三级循环监控点**：

```
外循环监控点：
  - maxStories（总 Story 数上限）
  - maxTokensTotal（总 Token 预算）
  - stagnation（连续 N 个 Story blocked）

内循环监控点：
  - maxStoryStages（单 Story 总阶段迭代上限）
  - maxTokensPerStory（单 Story Token 预算）
  - no-progress（连续 N 阶段无进展）

阶段内循环监控点：
  - maxIterations（单阶段迭代上限，默认 5）
  - maxTokensPerPhase（单阶段 Token 预算）
  - stagnation（连续 N 次质量分不变）
```

**实现要点**：

```typescript
// circuit-breaker.ts 核心接口设计
export type CircuitBreakerDimension =
  | 'iteration_count'
  | 'token_spend'
  | 'stagnation'
  | 'no_progress';

export type CircuitBreakerLevel =
  | 'phase'      // 阶段内循环级别
  | 'inner'      // 内循环级别
  | 'outer';     // 外循环级别

export interface CircuitBreakerConfig {
  maxIterations: number;          // 阶段内循环默认 5
  maxStoryStages: number;         // 内循环默认 15
  maxStories: number;             // 外循环默认 50
  maxTokensPerPhase: number;      // 默认 50000
  maxTokensPerStory: number;      // 默认 200000
  maxTokensTotal: number;         // 默认 1000000
  stagnationThreshold: number;    // 默认 3
  noProgressThreshold: number;    // 默认 3
}

export interface CircuitBreakerState {
  level: CircuitBreakerLevel;
  open: boolean;                   // 电路是否开路
  trippedDimension?: CircuitBreakerDimension;
  tripReason?: string;
  lastQualityScore?: number;
  consecutiveNoProgress: number;
  tokensUsed: number;
}

export class CircuitBreaker {
  constructor(config?: Partial<CircuitBreakerConfig>);
  record(level: CircuitBreakerLevel, metrics: LoopMetrics): CircuitBreakerState;
  isTripped(level: CircuitBreakerLevel): boolean;
  getTripReason(level: CircuitBreakerLevel): string | undefined;
  reset(level?: CircuitBreakerLevel): void;
  getState(level: CircuitBreakerLevel): CircuitBreakerState;
}

export interface LoopMetrics {
  iteration: number;
  qualityScore?: number;           // 质量分（用于 stagnation 检测）
  testPassRate?: number;           // 测试通过率（用于 no-progress 检测）
  tokensUsed?: number;             // Token 消耗
}
```

**断路器与三级循环的集成**：
- `PhaseLoop`（P0-2）每次迭代后调用 `circuitBreaker.record('phase', metrics)`
- `InnerLoop`（P0-3）每阶段完成后调用 `circuitBreaker.record('inner', metrics)`
- `OuterLoop`（P0-4）每 Story 完成后调用 `circuitBreaker.record('outer', metrics)`
- 任何级别 `isTripped()` 返回 `true` 时，该级别立即停止

**验收标准**：
- 阶段内循环 5 次迭代后 `isTripped('phase')` 返回 `true`
- Token 消耗超过 `maxTokensPerPhase` 时断路器触发
- 连续 3 次质量分不变（stagnation）时断路器触发
- 连续 3 次测试通过率不升（no-progress）时断路器触发
- `reset('phase')` 只重置阶段级别，不影响内/外循环级别
- 三级循环各有独立的断路器状态

---

### P0-6: 创建 `packages/core/src/L7_loop/completion-gate.ts` — 完成度门控

**目标**：5 个条件同时满足才允许停止（防止 LLM 提前声明完成）。

**核心设计 — 5 条件完成度门控**（借鉴 planning-with-files Completion Gate）：

| 条件编号 | 条件名称 | 含义 | 检查方式 |
|---------|---------|------|---------|
| **C1** | 所有任务完成 | task_plan.md 中所有 Task 标记为 done | 读取任务文件，检查无 pending/in_progress |
| **C2** | 测试全部通过 | 单元测试 + 集成测试 100% 通过 | 运行 `QualityPipeline.runGate('gate2-test')` |
| **C3** | 质量门禁全通过 | 5 级门禁（lint/test/regression/security/acceptance）全通过 | 运行 `QualityPipeline.runAll()` |
| **C4** | 文档完整 | PRD/架构/API/测试/部署/变更 6 种文档全部存在 | 检查文件存在性 |
| **C5** | spec 同步 | 变更管理中的 spec 与实际代码同步 | 调用 `ChangeManager.verifySync()` |

**关键机制**：只有 C1 ∧ C2 ∧ C3 ∧ C4 ∧ C5 全部为 true 时，`CompletionGate.canStop()` 才返回 `true`。否则阻止停止并返回缺失的条件。

**实现要点**：

```typescript
// completion-gate.ts 核心接口设计
export interface CompletionCondition {
  id: string;                      // 'C1' - 'C5'
  name: string;
  check: (context: CompletionContext) => Promise<ConditionResult>;
}

export interface ConditionResult {
  passed: boolean;
  detail: string;                  // 不通过时的详细原因
  missing_items?: string[];         // 缺失的具体项
}

export interface CompletionGateResult {
  canStop: boolean;                // 5 条件全满足才为 true
  conditions: ConditionResult[];
  blockingConditions: string[];    // 未通过的条件 ID
  summary: string;
}

export interface CompletionContext {
  taskPlanPath?: string;
  stateManager?: StateManager;
  qualityPipeline?: QualityPipeline;
  docPaths?: Record<string, string>;
  changeManager?: ChangeManager;
}

export class CompletionGate {
  constructor(conditions?: CompletionCondition[]);
  async check(context: CompletionContext): Promise<CompletionGateResult>;
  canStop(result: CompletionGateResult): boolean;
  register(condition: CompletionCondition): void;
}

export function createDefaultCompletionGate(): CompletionGate;
```

**与 on-stop Hook 的集成**：
- 当 LLM 尝试停止（触发 on-stop 事件）时，先调用 `CompletionGate.check()`
- 如果 `canStop` 为 `false`，阻止停止并返回 `blockingConditions`
- LLM 收到阻止信息后继续工作（修复缺失条件）

**验收标准**：
- 5 条件全满足时 `canStop` 返回 `true`
- 任一条件不满足时 `canStop` 返回 `false`，`blockingConditions` 非空
- `blockingConditions` 返回具体的缺失项（如 `['C2: 3 tests failing', 'C4: API doc missing']`）
- `register()` 可注册自定义条件

---

### P0-7: 创建 `packages/core/src/L7_loop/loop-audit.ts` — loop-audit 18 信号评分

**目标**：18 信号评分系统，4 级别（L0-L3），评估循环运行质量。

**核心设计 — 18 信号 × 4 级别**（借鉴 loop-engineering loop-audit）：

**4 级别定义**：

| 级别 | 名称 | 含义 | 分数范围 |
|------|------|------|---------|
| **L0** | Non-functional | 循环不工作，无自动化 | 0-20 |
| **L1** | Basic | 基本可用，但缺少质量管控 | 21-50 |
| **L2** | Functional | 功能完善，有质量门控 | 51-80 |
| **L3** | Optimized | 最优运行，有断路器+审计+完成度门控 | 81-100 |

**18 信号列表**：

| 编号 | 信号名称 | 类别 | L0 | L1 | L2 | L3 |
|------|---------|------|----|----|----|-----|
| S1 | 循环自动化程度 | 自动化 | 手动 | next_action 链 | 三级循环 | 三级+auto_transition |
| S2 | 质量门控覆盖 | 质量 | 无 | 单一 | 5 级门禁 | 5 级+阶段门控 |
| S3 | 断路器监控 | 安全 | 无 | 死循环检测 | 4 维度断路器 | 4 维度×3 级别 |
| S4 | 完成度门控 | 安全 | 无 | 无 | 3 条件 | 5 条件 |
| S5 | 迭代限制 | 安全 | 无 | 全局上限 | 阶段+全局上限 | 三级各自上限 |
| S6 | Token 预算 | 成本 | 无 | 无 | 全局预算 | 三级预算 |
| S7 | 跨会话恢复 | 连续性 | 无 | RESUME | RESUME+STATE | RESUME+STATE+记忆 |
| S8 | 跨模型兼容 | 连续性 | 无 | 文件状态 | SHA-256 校验 | attestation |
| S9 | 跨客户端支持 | 连续性 | 1 客户端 | 16 客户端 | 24 客户端 | 24+MCP 模拟 |
| S10 | PRD 质量管控 | 规范 | 无 | 基础生成 | 14 维审查 | 14 章+14 维+内循环 |
| S11 | TDD 强制 | 质量 | 无 | 可选 | 强制 | 强制+内循环 |
| S12 | 安全扫描 | 安全 | 无 | 5 扫描器 | 8 层防御 | 8 层+Policy-as-Code |
| S13 | 记忆系统 | 智能 | 无 | 三层记忆 | 三层+压缩 | 三层+向量检索 |
| S14 | 角色分工 | 智能 | 无 | 单角色 | maker/checker | maker/checker+8 角色 |
| S15 | loop-audit 自评 | 治理 | 无 | 无 | 有 | 有+自动改进 |
| S16 | 文档自动化 | 规范 | 无 | 手动 | 6 种文档 | 6 种+spec 同步 |
| S17 | DAG 依赖管理 | 编排 | 无 | 线性 | DAG | DAG+并行检测 |
| S18 | 事件驱动 | 架构 | 无 | 9 事件 | 9 事件+MCP 桥接 | 5 事件模型+MCP 桥接 |

**实现要点**：

```typescript
// loop-audit.ts 核心接口设计
export interface AuditSignal {
  id: string;                      // 'S1' - 'S18'
  name: string;
  category: 'automation' | 'quality' | 'safety' | 'cost' | 'continuity' | 'spec' | 'intelligence' | 'governance' | 'orchestration' | 'architecture';
  level: 0 | 1 | 2 | 3;           // 当前达到的级别
  score: number;                   // 0-100
  detail: string;                  // 评估依据
}

export interface LoopAuditResult {
  overallScore: number;            // 0-100 总分
  level: 0 | 1 | 2 | 3;           // L0-L3
  signals: AuditSignal[];         // 18 信号详情
  categoryScores: Record<string, number>; // 按类别汇总
  recommendations: string[];       // 改进建议
  timestamp: string;
}

export interface AuditContext {
  hasThreeLevelLoop: boolean;
  hasCircuitBreaker: boolean;
  hasCompletionGate: boolean;
  clientCount: number;
  hasMcpEventSimulator: boolean;
  prdCheckerDimensions: number;
  securityScanners: number;
  hasPolicyAsCode: boolean;
  hasDagBuilder: boolean;
  // ... 其他上下文
}

export class LoopAuditor {
  constructor();
  async audit(context: AuditContext): Promise<LoopAuditResult>;
  getSignal(id: string): AuditSignal | undefined;
  getRecommendations(result: LoopAuditResult): string[];
}

export function calculateLevel(score: number): 0 | 1 | 2 | 3;
```

**评分算法**：
- 每个信号 0-100 分，按当前达到的级别给分（L0=10, L1=30, L2=60, L3=100）
- 总分 = 18 信号加权平均（权重可配置，默认等权）
- `calculateLevel(score)` — 0-20→L0, 21-50→L1, 51-80→L2, 81-100→L3

**验收标准**：
- 18 信号全部可评估，每个信号有 `level` 和 `score`
- `overallScore` 在 0-100 范围内
- `calculateLevel(85)` 返回 `3`（L3）
- `recommendations` 非空且针对未达 L3 的信号给出建议
- 输入空 context（无任何能力）时 `overallScore` < 20（L0）

---

### P0-8: 修改 `packages/core/src/L7_loop/state-machine.ts` — 增加三级循环状态

**目标**：扩展现有 `StateMachine` 类，增加三级循环状态追踪（外循环/内循环/阶段内循环各自的迭代计数和进度）。

**现有状态**（V11）：
- `current_stage`: 当前阶段（open/design/build/verify/archive）
- `stages`: 各阶段状态
- `iteration`: 总迭代数
- `progress`: 进度百分比

**新增状态**（V12）：

```typescript
// state-machine.ts 新增字段
export interface StateMachineState {
  // === 现有字段（V11 保留） ===
  current_stage: Stage;
  stages: Record<Stage, StageInfo>;
  iteration: number;
  progress: string;

  // === V12 新增：三级循环状态 ===
  outer_loop: {
    current_story_id: string | null;
    story_queue: string[];          // 待处理 Story ID 列表
    completed_stories: string[];
    blocked_stories: string[];
    failed_stories: string[];
    total_tokens_used: number;
  };
  inner_loop: {
    current_story: Story | null;
    stages_completed: Stage[];
    story_failure_count: number;
    story_tokens_used: number;
  };
  phase_loop: {
    current_phase_iteration: number;  // 当前阶段内循环迭代次数
    max_phase_iterations: number;     // 默认 5
    phase_history: PhaseIteration[];  // 当前阶段的迭代历史
    phase_tokens_used: number;
    last_quality_score: number | null;
  };
}
```

**新增方法**：

```typescript
// StateMachine 新增方法
export class StateMachine {
  // === 现有方法保留 ===

  // === V12 新增方法 ===
  setOuterLoopState(state: Partial<OuterLoopState>): void;
  getOuterLoopState(): OuterLoopState;
  setInnerLoopState(state: Partial<InnerLoopState>): void;
  getInnerLoopState(): InnerLoopState;
  setPhaseLoopState(state: Partial<PhaseLoopState>): void;
  getPhaseLoopState(): PhaseLoopState;
  resetPhaseLoop(): void;              // 进入新阶段时重置阶段内循环状态
  advanceWithPhaseLoop(): Stage | null; // 推进阶段并重置阶段内循环
}
```

**向后兼容**：
- 现有 `advance()` / `canAdvance()` / `setStageStatus()` 等方法保持不变
- 新增字段有默认值，旧代码不受影响
- `getState()` 返回完整状态（含三级循环字段）

**验收标准**：
- `StateMachine` 构造时三级循环状态有默认值
- `setPhaseLoopState()` / `getPhaseLoopState()` 可正确读写
- `resetPhaseLoop()` 将 `current_phase_iteration` 归零，清空 `phase_history`
- `advanceWithPhaseLoop()` 推进阶段并自动调用 `resetPhaseLoop()`
- 现有 V11 测试全部通过（无破坏性变更）

---

### P0-9: 修改 `packages/core/src/index.ts` — 导出新增模块

**目标**：在 `index.ts` 中导出 P0 新增的全部模块和类型。

**新增导出**：

```typescript
// index.ts 新增导出（在现有 L7 Loop 导出区域追加）

// L7 - Loop (V12 三级循环扩展)
export { PHASE_GATES } from './L7_loop/phase-gates';
export type { PhaseGate, PhaseCheckContext, GateCheckResult } from './L7_loop/phase-gates';
export { PhaseLoop } from './L7_loop/phase-loop';
export type { PhaseLoopOptions, PhaseResult, Maker, Checker, PhaseIteration } from './L7_loop/phase-loop';
export { InnerLoop } from './L7_loop/inner-loop';
export type { InnerLoopOptions, InnerLoopResult, Story } from './L7_loop/inner-loop';
export { OuterLoop } from './L7_loop/outer-loop';
export type { OuterLoopOptions, OuterLoopResult, TriageResult, StoryStatus } from './L7_loop/outer-loop';
export { CircuitBreaker } from './L7_loop/circuit-breaker';
export type { CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerDimension, CircuitBreakerLevel, LoopMetrics } from './L7_loop/circuit-breaker';
export { CompletionGate, createDefaultCompletionGate } from './L7_loop/completion-gate';
export type { CompletionCondition, CompletionGateResult, ConditionResult, CompletionContext } from './L7_loop/completion-gate';
export { LoopAuditor, calculateLevel } from './L7_loop/loop-audit';
export type { AuditSignal, LoopAuditResult, AuditContext } from './L7_loop/loop-audit';
// 同时更新现有 StateMachine 的类型导出（新增三级循环状态类型）
export type { OuterLoopState, InnerLoopState, PhaseLoopState } from './L7_loop/state-machine';
```

**验收标准**：
- `pnpm build` 编译通过，无类型错误
- 从 `@azaloop/core` 可导入 `PhaseLoop` / `InnerLoop` / `OuterLoop` / `CircuitBreaker` / `CompletionGate` / `LoopAuditor` / `PHASE_GATES`
- 所有新增类型可导入

---

### P0 阶段验收标准

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 编译通过 | `pnpm build` 无错误 | 运行构建命令 |
| 单元测试 | P0 新增模块测试 100% 通过 | `pnpm test` |
| 阶段门控 | 5 阶段各有独立门控，通过/不通过场景覆盖 | phase-gates.test.ts |
| 阶段内循环 | open 阶段 P0=0 时通过，P0>0 时迭代修复 | phase-loop.test.ts |
| 内循环 | 单 Story 5 阶段全自动流转 | inner-loop.test.ts |
| 外循环 | 多 Story 队列分派，blocked 升级 | outer-loop.test.ts |
| 断路器 | 4 维度×3 级别均可触发 | circuit-breaker.test.ts |
| 完成度门控 | 5 条件全满足才允许停止 | completion-gate.test.ts |
| loop-audit | 18 信号可评分，4 级别正确 | loop-audit.test.ts |
| 状态机 | 三级循环状态可读写，向后兼容 | state-machine.test.ts（V11 测试也通过） |
| 导出 | 所有新模块可从 `@azaloop/core` 导入 | 导入测试 |

---

## 4. P1: MCP 事件模拟器 + 无 Hook 修复

**目标**：构建 MCP 事件模拟器，让无 Hook 客户端（Trae/Windsurf/VS Code/Roo/OpenCode/Comate/WorkBuddy/Kiro/Gemini CLI/Codex CLI 等）实现等效全自动。修改降级策略矩阵，创建 MCP 事件桥接。

**依赖**：P0 完成（三级循环引擎需要事件驱动）。

### P1-1: 创建 `packages/core/src/continuity/mcp-event-simulator.ts`

**目标**：在每次 MCP 工具调用时自动执行 pre/post hook 逻辑，模拟原生 Hook 事件。

**核心设计 — MCP 事件模拟流程**：

```
每次 MCP 工具调用时：
  ┌─────────────────────────────────────────┐
  │  1. pre-tool 模拟                       │
  │     - 执行纪律检查（iron-rules）         │
  │     - 执行安全预扫描（快速检查）         │
  │     - 检查 Guard 白名单                  │
  │  2. 工具执行                            │
  │     - 正常执行 MCP 工具逻辑              │
  │  3. post-tool 模拟                      │
  │     - 更新 STATE（进度+迭代）            │
  │     - 预写 RESUME（模拟 on-stop）       │
  │     - 记录 ActionRecord（死循环检测）    │
  │  4. 返回 next_action                    │
  │     - 驱动 LLM 续调（模拟原生循环）      │
  └─────────────────────────────────────────┘
```

**实现要点**：

```typescript
// mcp-event-simulator.ts 核心接口设计
export interface EventSimulationResult {
  preToolResult: PreToolResult;
  toolResult: unknown;              // 原始工具返回值
  postToolResult: PostToolResult;
  nextAction?: NextAction;         // 模拟原生循环的续调指令
  shouldBlock: boolean;             // pre-tool 检查是否阻止
  blockReason?: string;
}

export interface PreToolResult {
  disciplinePassed: boolean;        // 纪律检查
  securityQuickScan: SecurityQuickScan;
  guardWhitelist: boolean;          // Guard 白名单
  warnings: string[];
}

export interface PostToolResult {
  stateUpdated: boolean;
  resumeWritten: boolean;
  actionRecorded: boolean;
}

export interface MCPEventSimulatorOptions {
  enablePreTool: boolean;           // 默认 true
  enablePostTool: boolean;          // 默认 true
  enableResumePreWrite: boolean;    // 默认 true（模拟 on-stop）
  enableNextAction: boolean;        // 默认 true（模拟原生循环）
  clientName?: string;              // 当前客户端（决定降级策略）
}

export class MCPEventSimulator {
  constructor(
    stateManager: StateManager,
    resumeGenerator: ResumeGenerator,
    deadlockDetector: DeadlockDetector,
    strikeSystem: StrikeSystem,
    options?: MCPEventSimulatorOptions
  );

  async simulate(
    toolName: string,
    action: string,
    toolExecutor: () => Promise<unknown>,
    context?: SimulationContext
  ): Promise<EventSimulationResult>;

  // 仅执行 pre-tool 模拟（供 MCP 工具内部调用）
  async preTool(toolName: string, action: string): Promise<PreToolResult>;

  // 仅执行 post-tool 模拟
  async postTool(toolName: string, action: string, result: unknown): Promise<PostToolResult>;
}
```

**与现有模块的集成**：
- `preTool` 调用 `StrikeSystem`（L4 纪律）进行纪律检查
- `preTool` 调用安全扫描器（L6）进行快速预扫描
- `postTool` 调用 `StateManager`（state/state-manager.ts）更新状态
- `postTool` 调用 `ResumeGenerator`（continuity/resume-generator.ts）预写 RESUME
- `postTool` 调用 `DeadlockDetector`（L7/deadlock-detector.ts）记录操作
- `simulate` 返回 `nextAction`（来自 `LoopController` 的 next_action 链）

**验收标准**：
- `simulate('aza_prd', 'generate', executor)` 正确执行 pre/post 模拟
- pre-tool 纪律检查失败时 `shouldBlock` 为 `true`
- post-tool 更新 STATE 并预写 RESUME
- `nextAction` 正确返回（模拟原生循环）
- 无 Hook 客户端使用模拟器后，行为与有 Hook 客户端等效

---

### P1-2: 修改 `packages/core/src/L0_platform/compensation-strategy.ts`

**目标**：扩展降级策略矩阵，增加 MCP 事件模拟器策略和 5 级降级策略。

**现有策略**（V11）：7 个补偿策略（Stop Hook / Rules Injection / Skills / Native Loop / TDD / Memory / Document Generation）

**新增策略**（V12）：

| 策略名称 | 缺失能力 | 补偿工具 | 补偿机制 | 适用客户端 |
|---------|---------|---------|---------|-----------|
| MCP Event Simulation | 原生 Hook 事件 | `mcp-event-simulator` | 每次 MCP 调用自动执行 pre/post hook 逻辑 | Trae/Windsurf/VS Code/Roo/OpenCode/Comate/WorkBuddy |
| Loop Audit | 循环审计 | `aza_audit` | 18 信号评分评估循环质量 | 全部客户端 |
| Completion Gate | 完成度门控 | `completion-gate` | 5 条件阻止提前停止 | 全部客户端 |
| Circuit Breaker | 断路器 | `circuit-breaker` | 4 维度监控防止失控 | 全部客户端 |
| Phase Loop | 阶段内循环 | `aza_loop phase` | 每阶段质量门控迭代 | 全部客户端 |

**5 级降级策略矩阵**（V11 是 3 级 T1/T2/T3，V12 扩展为 5 级）：

| 策略级别 | 客户端 | Hook 触发方式 | 自动化程度 |
|---------|--------|-------------|-----------|
| **Full** | Cursor / Claude Code | 原生 Hook + MCP | 100% |
| **Partial-Hook** | Cline / Trae | 部分 Hook + MCP 补偿 | 95% |
| **MCP-Simulated** | Windsurf / VS Code / Roo / OpenCode / Comate / WorkBuddy | MCP 事件模拟器 | 90% |
| **Rule-Injected** | Kiro / Gemini CLI / Codex CLI / Qwen Code | continue.md 规则 + MCP | 85% |
| **Manual-Trigger** | Hermes / OpenClaw / Claude Desktop / Aider / Goose / Zed / Droid / Codeium / GitHub Copilot / OpenHands | 手动 `aza continue` | 75% |

**实现要点**：

```typescript
// compensation-strategy.ts 新增
export type CompensationTier = 'Full' | 'Partial-Hook' | 'MCP-Simulated' | 'Rule-Injected' | 'Manual-Trigger';

export interface CompensationStrategyV12 extends CompensationStrategy {
  tier: CompensationTier;
  automation_level: number;          // 75-100
  mcp_event_simulator: boolean;     // 是否使用 MCP 事件模拟器
}

// 新增策略
const V12_STRATEGIES: CompensationStrategyV12[] = [
  // ... 保留现有 7 个策略并扩展 tier 字段 ...
  // 新增 5 个策略
];

export function getCompensationV12(client: ClientInfo): CompensationStrategyV12[];
export function getTier(clientName: string): CompensationTier;
export function getAutomationLevel(clientName: string): number;
```

**向后兼容**：
- 现有 `getCompensation()` 和 `getAllStrategies()` 保留不变
- 新增 `getCompensationV12()` / `getTier()` / `getAutomationLevel()`

**验收标准**：
- `getTier('cursor')` 返回 `'Full'`
- `getTier('vscode')` 返回 `'MCP-Simulated'`
- `getTier('aider')` 返回 `'Manual-Trigger'`
- `getAutomationLevel('cursor')` 返回 `100`
- `getCompensationV12()` 包含 MCP Event Simulation 策略

---

### P1-3: 创建 `packages/core/src/Hook/mcp-event-bridge.ts`

**目标**：将 MCP 工具调用桥接到事件总线，让无 Hook 客户端也能触发 9 事件链。

**核心设计 — MCP 事件桥接**：

```
MCP 工具调用                    MCP Event Bridge              EventBus
┌──────────┐                   ┌──────────────┐            ┌──────────┐
│ aza_prd  │──┐             ┌─▶│ emit('pre-  │───────────▶│ handler  │
│ generate │  │  simulate   │  │  tool')     │            │ (纪律检查)│
│          │  ├────────────▶│  │             │            │          │
│          │  │             │  │ emit('post- │───────────▶│ handler  │
│          │  │             └─▶│  tool')     │            │(更新状态) │
│          │  │                │             │            │          │
│          │  │                │ emit('on-   │───────────▶│ handler  │
│          │  │                │  stop')     │            │(写RESUME) │
└──────────┘  │                └──────────────┘            └──────────┘
              │                         ▲
              │         ┌───────────────┘
              └────────▶│ MCPEventSimulator
                        │ (P1-1 创建)
                        └───────────────┘
```

**实现要点**：

```typescript
// mcp-event-bridge.ts 核心接口设计
export class MCPEventBridge {
  constructor(
    eventBus: EventBus,
    simulator: MCPEventSimulator
  );

  // 桥接 MCP 工具调用到事件总线
  async bridge(
    toolName: string,
    action: string,
    toolExecutor: () => Promise<unknown>,
    options?: BridgeOptions
  ): Promise<BridgeResult>;

  // 注册事件处理器（映射到 9 事件链）
  registerHandlers(handlers: EventHandlerMap): void;

  // 获取桥接统计
  getStats(): BridgeStats;
}

export interface BridgeOptions {
  emitPreTool?: boolean;         // 默认 true
  emitPostTool?: boolean;        // 默认 true
  emitOnStop?: boolean;          // 默认 true（预写 RESUME）
  emitPrePhase?: boolean;        // 默认 false（阶段转换时触发）
  emitPostPhase?: boolean;       // 默认 false
}

export interface BridgeResult {
  simulationResult: EventSimulationResult;
  eventsEmitted: HookEvent[];    // 实际触发的事件列表
}

export interface EventHandlerMap {
  'session-start'?: EventHandler;
  'pre-tool'?: EventHandler;
  'post-tool'?: EventHandler;
  'pre-commit'?: EventHandler;
  'post-task'?: EventHandler;
  'pre-phase'?: EventHandler;
  'post-phase'?: EventHandler;
  'on-error'?: EventHandler;
  'on-stop'?: EventHandler;
}
```

**与现有 EventBus 的集成**：
- `bridge()` 内部调用 `MCPEventSimulator.simulate()`
- 根据 `BridgeOptions` 决定触发哪些事件
- `emitPreTool` → `eventBus.emit('pre-tool', { tool, action })`
- `emitPostTool` → `eventBus.emit('post-tool', { tool, action, result })`
- `emitOnStop` → `eventBus.emit('on-stop', { reason: 'pre-write' })`（每次工具调用后预写）

**验收标准**：
- `bridge('aza_prd', 'generate', executor)` 触发 pre-tool 和 post-tool 事件
- `eventsEmitted` 包含实际触发的事件列表
- 注册的 handler 被正确调用
- `getStats()` 返回桥接次数和事件触发次数
- 无 Hook 客户端通过桥接后，9 事件链等效触发

---

### P1 阶段验收标准

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| MCP 事件模拟器 | pre/post hook 模拟正确执行 | mcp-event-simulator.test.ts |
| 降级策略矩阵 | 5 级策略 + 24 客户端正确分级 | compensation-strategy.test.ts |
| MCP 事件桥接 | 9 事件链可桥接触发 | mcp-event-bridge.test.ts |
| 无 Hook 等效性 | VS Code（无 Hook）通过模拟器后行为与 Cursor（有 Hook）等效 | 集成测试 |
| 编译通过 | `pnpm build` 无错误 | 构建命令 |

---

## 5. P2: L1 PRD 14 章 + L6 安全 8 层

**目标**：L1 规范层融合 create-prd-skill 14 章模板 + check-prd-skill 14 维审查 + 复杂度分级；L6 安全层融合 shellward 8 层防御 + Policy-as-Code + 中国合规。

**依赖**：P0 完成（阶段内循环需要质量门控引用 PRD 检查和安全扫描结果）。

### P2-1: 修改 `packages/core/src/L1_spec/prd-generator.ts` — 增加 14 章模板 + 复杂度分级

**目标**：PRD 生成支持 14 章 B 端模板 + 产品定型（商业化/自研）+ 复杂度分级（L1-L4）。

**14 章 PRD 模板**：

| 章号 | 章节名称 | 内容 |
|------|---------|------|
| 1 | 产品概述 | 产品名称、定位、目标用户、核心价值 |
| 2 | 市场分析 | 市场规模、竞品分析、差异化定位 |
| 3 | 用户画像 | 目标用户角色、使用场景、痛点分析 |
| 4 | 功能需求 | 核心功能列表、优先级（P0-P3）、用户故事 |
| 5 | 非功能需求 | 性能、可用性、安全性、兼容性 |
| 6 | 信息架构 | 页面结构、导航设计、信息层级 |
| 7 | 交互设计 | 核心交互流程、状态转换、异常处理 |
| 8 | 数据设计 | 数据模型、ER 图、数据字典 |
| 9 | 接口设计 | API 设计、接口规范、认证方案 |
| 10 | 技术架构 | 技术选型、架构图、部署方案 |
| 11 | 安全合规 | 安全要求、合规要求（含中国合规） |
| 12 | 运营计划 | 上线计划、运营指标、迭代节奏 |
| 13 | 风险评估 | 技术风险、业务风险、缓解方案 |
| 14 | 验收标准 | 可测试的验收条件、验收矩阵 |

**复杂度分级**：

| 级别 | 名称 | 含义 | PRD 章节范围 | 示例 |
|------|------|------|-------------|------|
| L1 | 配置级 | 改配置/规则，不改代码 | 章 1,4,14 | 修改 ESLint 规则 |
| L2 | 规则级 | 小范围代码变更 | 章 1,4,5,14 | 添加一个 API 端点 |
| L3 | 模块级 | 新增模块/功能 | 章 1,3,4,5,8,9,10,14 | 新增用户认证模块 |
| L4 | 系统级 | 跨模块/系统级变更 | 全部 14 章 | 微服务架构重构 |

**实现要点**：

```typescript
// prd-generator.ts 修改
export interface PRDGenerationInput {
  requirement: string;
  productType?: 'commercial' | 'self-developed';  // 产品定型
  complexity?: 'L1' | 'L2' | 'L3' | 'L4';          // 复杂度分级
  // ... 现有字段保留
}

export class PRDGenerator {
  // 现有方法保留

  // V12 新增
  generate14Chapters(input: PRDGenerationInput): Promise<PRD14Chapters>;
  determineComplexity(requirement: string): 'L1' | 'L2' | 'L3' | 'L4';
  getChapterTemplate(complexity: string): string[];  // 按复杂度返回所需章节
}
```

**验收标准**：
- 输入"做 Todo 应用" → 生成 14 章 PRD（复杂度 L3）
- 输入"修改 ESLint 规则" → 生成 3 章 PRD（复杂度 L1）
- `determineComplexity()` 正确分级

---

### P2-2: 创建 `packages/core/src/L1_spec/templates/prd-14chapters.md` — 14 章 PRD 模板文件

**目标**：提供 Markdown 格式的 14 章 PRD 模板，供 PRD 生成器引用。

**验收标准**：模板文件包含 14 章的标题和填写指引。

---

### P2-3: 创建 `packages/core/src/L1_spec/templates/prd-complexity-matrix.yaml` — 复杂度分级配置

**目标**：YAML 格式的复杂度分级配置，定义 L1-L4 各自的章节范围和生成参数。

**验收标准**：配置文件包含 4 个复杂度级别的定义，每个级别有 `chapters` 字段。

---

### P2-4: 修改 `packages/core/src/L1_spec/prd-checker.ts` — 增加 14 维审查 + P0-P3 分级

**目标**：PRD 检查器支持 14 维度审查 + 问题 P0-P3 分级 + 双路径（章节维度/降级维度）。

**14 维审查维度**：

| 维度 | 名称 | P0（致命） | P1（严重） | P2（建议） | P3（优化） |
|------|------|-----------|-----------|-----------|-----------|
| D1 | 需求完整性 | 核心功能缺失 | 边界场景缺失 | 细节不明确 | 措辞模糊 |
| D2 | 验收可测性 | 无法测试 | 部分不可测 | 测试条件不足 | 验收标准过宽 |
| D3 | 用户故事 | 无用户故事 | 角色缺失 | 场景不完整 | 缺少异常路径 |
| D4 | 数据设计 | 无数据模型 | 关键表缺失 | 字段不明确 | 索引未规划 |
| D5 | 接口设计 | 无 API 设计 | 认证缺失 | 版本管理缺失 | 缺少错误码 |
| D6 | 技术架构 | 无架构图 | 架构不合理 | 技术选型有风险 | 缺少扩展性设计 |
| D7 | 安全合规 | 安全要求缺失 | 合规缺失 | 安全扫描未规划 | 审计日志缺失 |
| D8 | 性能要求 | 无性能指标 | 指标不合理 | 缺少基准测试 | 缺少容量规划 |
| D9 | 非功能需求 | 完全缺失 | 关键项缺失 | 不够具体 | 缺少监控方案 |
| D10 | 信息架构 | 无页面结构 | 导航不合理 | 层级过深 | 缺少面包屑 |
| D11 | 交互设计 | 无流程图 | 异常处理缺失 | 状态转换不完整 | 缺少加载态 |
| D12 | 运营计划 | 完全缺失 | 上线计划缺失 | 指标不明确 | 迭代节奏不合理 |
| D13 | 风险评估 | 无风险评估 | 关键风险缺失 | 缓解方案不可行 | 缺少监控预警 |
| D14 | 文档一致性 | 章节矛盾 | 术语不统一 | 图文不符 | 格式不统一 |

**实现要点**：

```typescript
// prd-checker.ts 修改
export interface PRDCheckResult {
  // 现有字段保留
  dimensions: DimensionResult[];     // V12 新增：14 维审查结果
  p0_count: number;                  // P0 问题数
  p1_count: number;                  // P1 问题数
  p2_count: number;                  // P2 问题数
  p3_count: number;                  // P3 问题数
  overall_score: number;             // 0-100
  pass: boolean;                     // P0=0 且 P1≤3 时为 true
}

export interface DimensionResult {
  dimension: string;                 // 'D1' - 'D14'
  name: string;
  issues: Issue[];
  score: number;                     // 0-100
}

export interface Issue {
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  description: string;
  suggestion: string;                // 具体修复建议
  location?: string;                 // 在 PRD 中的位置
}

export class PRDChecker {
  // 现有方法保留
  check14Dimensions(prd: unknown): Promise<PRDCheckResult>;  // V12 新增
}
```

**验收标准**：
- 缺少核心功能的 PRD → D1 有 P0 问题
- 验收标准不可测试的 PRD → D2 有 P0 问题
- `pass` 为 `false` 当 `p0_count > 0` 或 `p1_count > 3`
- 每个问题有具体的 `suggestion`

---

### P2-5: 创建 `packages/core/src/L6_security/policy-as-code.ts` — 声明式安全策略

**目标**：Policy-as-Code 声明式安全策略引擎，定义安全规则并自动执行。

**实现要点**：

```typescript
// policy-as-code.ts 核心接口设计
export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  severity: 'blocker' | 'critical' | 'warning' | 'info';
  rule: (context: PolicyContext) => boolean;  // 返回 false 表示违规
  message: string;              // 违规时的消息
  auto_fix?: string;           // 自动修复建议
}

export interface PolicyContext {
  filePath?: string;
  content?: string;
  diff?: string;
  dependencies?: string[];
}

export interface PolicyCheckResult {
  passed: boolean;
  violations: PolicyViolation[];
  blockers: PolicyViolation[];     // severity=blocker 的违规
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  severity: string;
  message: string;
  location?: string;
  auto_fix?: string;
}

export class PolicyAsCode {
  constructor(policies?: SecurityPolicy[]);
  register(policy: SecurityPolicy): void;
  check(context: PolicyContext): PolicyCheckResult;
  checkBatch(contexts: PolicyContext[]): PolicyCheckResult;
  loadFromYaml(path: string): void;
}
```

**验收标准**：
- 定义 ≥20 条安全策略（覆盖 8 层防御）
- `blocker` 级违规时 `passed` 为 `false`
- 可从 YAML 文件加载策略

---

### P2-6: 创建 `packages/core/src/L6_security/scanners/prompt-injection.ts` — 提示注入检测

**目标**：检测代码/文档中的 LLM 提示注入攻击。

**验收标准**：能检测常见提示注入模式（"ignore previous instructions"等），返回 `SecurityFinding`。

---

### P2-7: 创建 `packages/core/src/L6_security/scanners/data-exfiltration.ts` — 数据外泄链检测

**目标**：检测代码中的数据外泄风险（如向外部 API 发送敏感数据）。

**验收标准**：能检测可疑的外部数据传输模式。

---

### P2-8: 创建 `packages/core/src/L6_security/scanners/mcp-poisoning.ts` — MCP 工具投毒扫描

**目标**：检测 MCP 工具配置中的投毒风险。

**验收标准**：能检测可疑的 MCP 工具配置（如恶意 URL、权限过大等）。

---

### P2-9: 创建 `packages/core/src/L6_security/compliance-checker.ts` — 中国合规体检

**目标**：检查中国合规要求（网络安全法/PIPL/等保2.0）。

**实现要点**：

```typescript
// compliance-checker.ts 核心接口设计
export interface ComplianceCheck {
  law: '网络安全法' | 'PIPL' | '等保2.0';
  requirement: string;
  check: (context: ComplianceContext) => ComplianceResult;
}

export interface ComplianceResult {
  compliant: boolean;
  gaps: string[];           // 不合规项
  recommendations: string[];
}

export class ComplianceChecker {
  constructor(checks?: ComplianceCheck[]);
  check(law: string, context: ComplianceContext): ComplianceResult;
  checkAll(context: ComplianceContext): Record<string, ComplianceResult>;
}
```

**验收标准**：
- 覆盖网络安全法、PIPL、等保 2.0 三部法规
- 数据未加密存储 → PIPL 不合规
- 无日志审计 → 等保 2.0 不合规

---

### P2-10: 创建 `packages/core/src/L6_security/policy.yaml` — Policy-as-Code 配置模板

**目标**：YAML 格式的安全策略配置模板。

**验收标准**：包含 ≥20 条策略定义。

---

### P2 阶段验收标准

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 14 章 PRD 生成 | 输入需求 → 生成 14 章 PRD | prd-generator.test.ts |
| 复杂度分级 | L1-L4 正确分级 | determineComplexity() 测试 |
| 14 维审查 | 14 维度全部可检查 | prd-checker.test.ts |
| P0-P3 分级 | 问题正确分级 | 审查结果验证 |
| Policy-as-Code | ≥20 条策略可执行 | policy-as-code.test.ts |
| 提示注入检测 | 常见注入模式可检测 | prompt-injection.test.ts |
| 数据外泄检测 | 可疑传输可检测 | data-exfiltration.test.ts |
| MCP 投毒扫描 | 可疑配置可检测 | mcp-poisoning.test.ts |
| 中国合规 | 3 部法规可检查 | compliance-checker.test.ts |
| 编译通过 | `pnpm build` 无错误 | 构建命令 |

---

## 6. P3: L2 SHA-256 + L7 断路器/loop-audit 深化

**目标**：L2 记忆层增加 SHA-256 attestation + JSONL 上下文编排；L7 循环层将断路器和 loop-audit 深度集成到三级循环中。

**依赖**：P0、P2 完成。

### P3-1: 修改 `packages/core/src/state/checksum.ts` — 增加 SHA-256 attestation

**目标**：在现有 SHA-256 校验基础上增加 attestation（锁定 PRD/PLAN 哈希，防篡改）。

**实现要点**：

```typescript
// checksum.ts 新增
export interface Attestation {
  file: string;                     // 文件路径
  hash: string;                    // SHA-256 哈希
  timestamp: string;
  lockedBy: string;                // 锁定者（阶段名）
}

export class AttestationStore {
  lock(filePath: string, stage: Stage): Attestation;
  verify(filePath: string): boolean;   // 验证文件哈希是否与锁定时一致
  unlock(filePath: string): void;
  getAll(): Attestation[];
}

// 现有 computeChecksum / verifyChecksum / ChecksumStore 保留
```

**验收标准**：
- `lock()` 锁定文件哈希
- `verify()` 文件被篡改后返回 `false`
- `unlock()` 解除锁定

---

### P3-2: 创建 `packages/core/src/L2_memory/context-orchestrator.ts` — JSONL 精确上下文注入

**目标**：用 JSONL 格式精确编排上下文注入（而非全量注入），按阶段和任务类型选择性地注入上下文。

**实现要点**：

```typescript
// context-orchestrator.ts 核心接口设计
export interface ContextEntry {
  type: 'constitution' | 'iron_rules' | 'role' | 'skill' | 'knowledge' | 'memory' | 'prd' | 'arch';
  priority: number;                 // 注入优先级
  content: string;
  token_estimate: number;
}

export interface OrchestrationPlan {
  stage: Stage;
  entries: ContextEntry[];
  total_tokens: number;
  max_tokens: number;
}

export class ContextOrchestrator {
  constructor(maxTokens?: number);   // 默认 100000
  plan(stage: Stage, story?: Story): OrchestrationPlan;
  inject(plan: OrchestrationPlan): string;  // 返回组装后的上下文
  loadJSONL(path: string): ContextEntry[];   // 从 JSONL 文件加载
  saveJSONL(path: string, entries: ContextEntry[]): void;
}
```

**借鉴**：Trellis 的 implement.jsonl / check.jsonl — 按阶段精确注入而非全量。

**验收标准**：
- `plan('open')` 返回 PRD 相关上下文（constitution + prd_template）
- `plan('build')` 返回编码相关上下文（iron_rules + skill + knowledge）
- 总 Token 不超过 `maxTokens`
- JSONL 可读写

---

### P3-3: 修改 `packages/core/src/continuity/resume-generator.ts` — 增加 5-Question Reboot Test

**目标**：RESUME 生成器增加 5-Question Reboot Test，确保跨会话恢复的完整性。

**5-Question Reboot Test**（借鉴 planning-with-files）：

| 问题 | 含义 | 检查方式 |
|------|------|---------|
| Q1 | 当前在做什么任务？ | STATE 中 `current_story` 非空 |
| Q2 | 任务进行到哪个阶段？ | STATE 中 `current_stage` 有效 |
| Q3 | 阶段内循环迭代到第几次？ | STATE 中 `phase_iteration` 有值 |
| Q4 | 上次失败的检查项是什么？ | `phase_history` 最后一条的 `suggestions` |
| Q5 | 下一步该做什么？ | `next_action` 字段有值 |

**实现要点**：

```typescript
// resume-generator.ts 新增
export interface RebootTestResult {
  passed: boolean;
  answers: Record<string, string>;   // Q1-Q5 的答案
  missing: string[];                  // 无法回答的问题
}

export class ResumeGenerator {
  // 现有方法保留
  rebootTest(state: StateMachineState): RebootTestResult;  // V12 新增
  generateWithRebootTest(stateManager: StateManager, extra?: Partial<ResumeData>): Promise<ResumeData>;
}
```

**验收标准**：
- 5 个问题都能回答时 `passed` 为 `true`
- `missing` 返回无法回答的问题编号
- `generateWithRebootTest()` 生成的 RESUME 包含 5 问答案

---

### P3-4: 断路器集成到三级循环 — 修改 `phase-loop.ts` / `inner-loop.ts` / `outer-loop.ts`

**目标**：将 P0-5 创建的 `CircuitBreaker` 深度集成到三级循环的每一级。

**集成点**：

| 循环级别 | 集成位置 | 监控维度 |
|---------|---------|---------|
| 阶段内循环 | `PhaseLoop.run()` 每次迭代后 | iteration_count / token_spend / stagnation / no_progress |
| 内循环 | `InnerLoop.run()` 每阶段完成后 | iteration_count / token_spend / no_progress |
| 外循环 | `OuterLoop.run()` 每 Story 完成后 | iteration_count / token_spend / stagnation |

**实现要点**：
- `PhaseLoop` 构造时注入 `CircuitBreaker` 实例
- 每次迭代后调用 `circuitBreaker.record('phase', metrics)`
- `isTripped('phase')` 为 `true` 时立即终止迭代，返回 `success: false`
- `InnerLoop` 和 `OuterLoop` 同理

**验收标准**：
- 阶段内循环断路器触发时，`PhaseResult.success` 为 `false`，`reason` 为 `'circuit_breaker_tripped'`
- 内循环断路器触发时，Story 标记 `blocked`
- 外循环断路器触发时，外循环停止

---

### P3-5: loop-audit 集成到循环运行 — 修改 `loop-controller.ts` / 新增审计入口

**目标**：将 P0-7 创建的 `LoopAuditor` 集成到循环运行中，支持实时审计和按需审计。

**实现要点**：

```typescript
// loop-controller.ts 修改
export class LoopController {
  // 现有字段保留
  private auditor: LoopAuditor;       // V12 新增

  // V12 新增
  async audit(): Promise<LoopAuditResult>;
  getAuditContext(): AuditContext;     // 从当前运行状态构建审计上下文
}
```

**验收标准**：
- `loopController.audit()` 返回 18 信号评分
- 审计上下文从当前运行状态自动构建
- V12 完成后 `overallScore` 应达到 L2（51-80）

---

### P3 阶段验收标准

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| SHA-256 attestation | 文件篡改可检测 | checksum.test.ts |
| JSONL 上下文编排 | 按阶段精确注入 | context-orchestrator.test.ts |
| 5-Question Reboot | 5 问可回答 | resume-generator.test.ts |
| 断路器集成 | 三级循环均可触发断路 | 集成测试 |
| loop-audit 集成 | 实时审计可用 | loop-controller.test.ts |
| 编译通过 | `pnpm build` 无错误 | 构建命令 |

---

## 7. P4: L8 DAG + Hook 5 事件 + 质量门禁

**目标**：L8 编排层增加 DAG 依赖图 + 蜂群接口；Hook 层升级为 5 事件模型 + MCP 事件桥接；质量门禁增加 Gate6 loop-audit。

**依赖**：P0、P3 完成。

### P4-1: 创建 `packages/core/src/L8_orchestrator/dag-builder.ts` — DAG 依赖图构建

**目标**：构建任务依赖 DAG，检测可并行任务。

**实现要点**：

```typescript
// dag-builder.ts 核心接口设计
export interface DAGNode {
  id: string;
  task: string;
  dependsOn: string[];       // 依赖的任务 ID
  priority?: number;
  estimatedTokens?: number;
}

export interface DAGLevel {
  level: number;
  nodes: DAGNode[];          // 同一 level 的节点可并行
}

export class DAGBuilder {
  constructor();
  addNode(node: DAGNode): void;
  build(): DAGLevel[];        // 拓扑排序，返回分层结构
  detectParallel(): DAGLevel[];  // 检测可并行任务
  detectCycles(): string[];  // 检测循环依赖
  getCriticalPath(): string[];    // 关键路径
  toDot(): string;           // 输出 Graphviz DOT 格式
}
```

**验收标准**：
- 有依赖关系的任务正确分层
- 无依赖的任务在同一 level（可并行）
- 循环依赖可检测
- 关键路径正确计算

---

### P4-2: 创建 `packages/core/src/L8_orchestrator/swarm/coordinator.ts` — 蜂群协调器

**目标**：蜂群协调器接口，支持层次/网状/自适应三种编排模式。

**实现要点**：

```typescript
// swarm/coordinator.ts 核心接口设计（接口预留，MVP 不完整实现）
export type SwarmMode = 'hierarchical' | 'mesh' | 'adaptive';

export interface SwarmAgent {
  id: string;
  role: string;
  capabilities: string[];
  status: 'idle' | 'busy' | 'failed';
}

export class SwarmCoordinator {
  constructor(mode?: SwarmMode);
  registerAgent(agent: SwarmAgent): void;
  dispatch(task: string, agentId?: string): string | null;
  getAvailableAgents(): SwarmAgent[];
  getMode(): SwarmMode;
  // MVP: 接口预留，enabled: false
}
```

**验收标准**：接口编译通过，可注册 agent 和分派任务。

---

### P4-3: 修改 `packages/core/src/L8_orchestrator/model-router.ts` — 复杂度分级路由

**目标**：按任务复杂度自动路由到不同模型（简单→小模型，复杂→大模型）。

**实现要点**：

```typescript
// model-router.ts 修改
export interface ModelRoute {
  complexity: 'L1' | 'L2' | 'L3' | 'L4';
  model: string;
  maxTokens: number;
  estimatedCost: number;
}

export class ModelRouter {
  // 现有方法保留
  route(taskComplexity: string): ModelRoute;  // V12 新增
  estimateComplexity(task: string): 'L1' | 'L2' | 'L3' | 'L4';
}
```

**验收标准**：L1→小模型，L4→大模型，路由正确。

---

### P4-4: 创建 `packages/core/src/Hook/events/completion-gate.ts` — 完成度门控事件

**目标**：on-stop 事件触发时调用 CompletionGate 检查。

**实现要点**：

```typescript
// Hook/events/completion-gate.ts
export function createCompletionGateHandler(
  completionGate: CompletionGate
): EventHandler {
  return async (payload: EventPayload) => {
    if (payload.event !== 'on-stop') return;
    const result = await completionGate.check(/* context */);
    if (!completionGate.canStop(result)) {
      // 阻止停止，返回缺失条件
      throw new Error(`Cannot stop: ${result.blockingConditions.join(', ')}`);
    }
  };
}
```

**验收标准**：on-stop 事件触发时，CompletionGate 检查通过才允许停止。

---

### P4-5: 修改 `packages/core/src/Hook/event-bus.ts` — 增加 MCP 事件桥接支持

**目标**：EventBus 支持 MCP 事件桥接（P1-3 创建的 `MCPEventBridge`）。

**实现要点**：

```typescript
// event-bus.ts 修改
export class EventBus {
  // 现有方法保留
  private mcpBridge?: MCPEventBridge;  // V12 新增

  setMCPBridge(bridge: MCPEventBridge): void;  // V12 新增
  isMCPBridged(): boolean;                    // V12 新增
}
```

**验收标准**：设置 MCP 桥接后，`isMCPBridged()` 返回 `true`。

---

### P4-6: 创建 `packages/core/src/quality/gates/gate6-loop-audit.ts` — loop-audit 评分门禁

**目标**：第 6 级质量门禁，基于 loop-audit 评分。

**实现要点**：

```typescript
// quality/gates/gate6-loop-audit.ts
export interface LoopAuditGateConfig {
  minScore: number;        // 默认 60（L2 门槛）
  minLevel: 0 | 1 | 2 | 3; // 默认 2
}

export function createLoopAuditGate(
  auditor: LoopAuditor,
  config?: LoopAuditGateConfig
): GateExecutor;
```

**验收标准**：
- loop-audit 评分 < 60 时门禁不通过
- 评分 ≥ 60 时门禁通过

---

### P4-7: 修改 `packages/core/src/quality/pipeline.ts` — 增加 Gate6

**目标**：质量门禁 Pipeline 从 5 级扩展为 6 级。

**实现要点**：
- 在现有 5 级门禁后追加 Gate6: loop-audit
- 提供 `createDefaultPipeline()` 工厂函数注册全部 6 级门禁

**验收标准**：`runAll()` 返回 6 个 gate 结果。

---

### P4-8: 修改 `packages/core/src/quality/gates/gate4-security.ts` — 融合 Policy-as-Code

**目标**：安全门禁融合 shellward Policy-as-Code（P2-5 创建）。

**验收标准**：Gate4 同时运行扫描器和 Policy-as-Code 检查。

---

### P4 阶段验收标准

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| DAG 依赖图 | 正确分层 + 并行检测 | dag-builder.test.ts |
| 蜂群协调器 | 接口编译通过 | 编译检查 |
| 模型路由 | 复杂度分级正确 | model-router.test.ts |
| 完成度门控事件 | on-stop 时触发检查 | completion-gate-handler.test.ts |
| EventBus MCP 桥接 | 桥接状态可查询 | event-bus.test.ts |
| Gate6 loop-audit | 评分 < 60 时不通过 | gate6-loop-audit.test.ts |
| 6 级门禁 | runAll 返回 6 个结果 | pipeline.test.ts |
| Gate4 Policy-as-Code | 策略违规可阻断 | gate4-security.test.ts |
| 编译通过 | `pnpm build` 无错误 | 构建命令 |

---

## 8. P5: 24 客户端模板 + MCP 新工具

**目标**：新增 8 个客户端模板（共 24 个），扩展客户端检测，新增 3 个 MCP 工具。

**依赖**：P1、P4 完成。

### P5-1: 创建 `templates/clients/gemini-cli/` — Gemini CLI 模板

**文件**：
- `.gemini/settings.json` — Gemini CLI 配置
- `mcp.json` — MCP 配置
- `continue.md` — 续跑规则（统一内容）

**验收标准**：模板文件完整，`aza init --client=gemini-cli` 可生成。

---

### P5-2: 创建 `templates/clients/codex-cli/` — Codex CLI 模板

**文件**：
- `AGENTS.md` — Codex CLI agent 配置
- `mcp.json` — MCP 配置
- `continue.md` — 续跑规则

**验收标准**：同上。

---

### P5-3: 创建 `templates/clients/hermes/` — Hermes 模板

**文件**：
- `.hermes/skills/` — Skills 目录
- `mcp.json` — MCP 配置
- `continue.md` — 续跑规则

**验收标准**：同上。

---

### P5-4: 创建 `templates/clients/openclaw/` — OpenClaw 模板

**文件**：
- `clawhub.json` — OpenClaw 配置
- `mcp.json` — MCP 配置
- `continue.md` — 续跑规则

**验收标准**：同上。

---

### P5-5: 创建 `templates/clients/claude-desktop/` — Claude Desktop 模板

**文件**：
- `claude_desktop_config.json` — Claude Desktop 配置
- `continue.md` — 续跑规则

**验收标准**：同上。

---

### P5-6: 创建 `templates/clients/comate/` — Comate 模板

**文件**：
- `.comate/config.yaml` — Comate 配置
- `mcp.json` — MCP 配置
- `continue.md` — 续跑规则

**验收标准**：同上。

---

### P5-7: 创建 `templates/clients/workbuddy/` — WorkBuddy 模板

**文件**：
- `.workbuddy/config.json` — WorkBuddy 配置
- `mcp.json` — MCP 配置
- `continue.md` — 续跑规则

**验收标准**：同上。

---

### P5-8: 创建 `templates/clients/qwen-code/` — Qwen Code 模板

**文件**：
- `.qwen/settings.json` — Qwen Code 配置
- `mcp.json` — MCP 配置
- `continue.md` — 续跑规则

**验收标准**：同上。

---

### P5-9: 修改 `packages/core/src/L0_platform/client-detection.ts` — 增加 8 个新客户端检测

**目标**：客户端检测器支持 24 个客户端。

**新增检测逻辑**：

```typescript
// client-detection.ts 新增检测
if (fs.existsSync('.gemini/settings.json')) return { name: 'gemini-cli', tier: 2 };
if (fs.existsSync('AGENTS.md') && !fs.existsSync('.claude')) return { name: 'codex-cli', tier: 2 };
if (fs.existsSync('.hermes/skills')) return { name: 'hermes', tier: 3 };
if (fs.existsSync('clawhub.json')) return { name: 'openclaw', tier: 3 };
if (fs.existsSync('claude_desktop_config.json')) return { name: 'claude-desktop', tier: 3 };
if (fs.existsSync('.comate/config.yaml')) return { name: 'comate', tier: 2 };
if (fs.existsSync('.workbuddy/config.json')) return { name: 'workbuddy', tier: 2 };
if (fs.existsSync('.qwen/settings.json')) return { name: 'qwen-code', tier: 2 };
```

**验收标准**：
- 24 个客户端全部可检测
- `getAllClients()` 返回 24 个客户端信息
- 每个客户端有正确的 `tier` 分级

---

### P5-10: 修改 `packages/core/src/L0_platform/capability-matrix.yaml` — 增加 8 个新客户端能力矩阵

**目标**：能力矩阵覆盖 24 个客户端。

**验收标准**：YAML 文件包含 24 个客户端的能力定义。

---

### P5-11: 创建 `packages/mcp-server/src/tools/aza-audit.ts` — loop-audit 评分工具

**目标**：MCP 工具 `aza_audit`，运行 loop-audit 评分。

**实现要点**：

```typescript
// aza-audit.ts
export const azaAuditTool = {
  name: 'aza_audit',
  description: 'Run loop-audit to score the loop quality (18 signals, L0-L3 levels)',
  inputSchema: { /* 无参数或可选 verbose */ },
  handler: async () => {
    const auditor = new LoopAuditor();
    const result = await auditor.audit(context);
    return formatResult(result);  // LoopResponse 格式
  }
};
```

**验收标准**：MCP 工具可调用，返回 18 信号评分 + 总分 + 级别。

---

### P5-12: 创建 `packages/mcp-server/src/tools/aza-compliance.ts` — 合规检查工具

**目标**：MCP 工具 `aza_compliance`，运行中国合规体检。

**验收标准**：MCP 工具可调用，返回 3 部法规的合规结果。

---

### P5-13: 创建 `packages/mcp-server/src/tools/aza-dag.ts` — DAG 依赖管理工具

**目标**：MCP 工具 `aza_dag`，管理任务依赖图。

**验收标准**：MCP 工具可调用，返回分层结构和并行检测结果。

---

### P5-14: 修改 `packages/mcp-server/src/index.ts` — 注册 3 个新工具

**目标**：MCP Server 注册 `aza_audit` / `aza_compliance` / `aza_dag` 三个新工具。

**验收标准**：MCP Server 启动后 3 个新工具可发现。

---

### P5 阶段验收标准

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 8 个新客户端模板 | 每个模板文件完整 | 文件检查 |
| 24 客户端检测 | 全部可检测 | client-detection.test.ts |
| 能力矩阵 | 24 客户端覆盖 | YAML 验证 |
| aza_audit 工具 | 可调用 + 返回评分 | MCP 工具测试 |
| aza_compliance 工具 | 可调用 + 返回合规结果 | MCP 工具测试 |
| aza_dag 工具 | 可调用 + 返回 DAG | MCP 工具测试 |
| MCP Server | 15 个工具全部可发现 | MCP 工具列表检查 |
| `aza init` | 24 客户端全部可 init | 集成测试 |
| 编译通过 | `pnpm build` 无错误 | 构建命令 |

---

## 9. P6: 端到端验收 + 跨模型测试

**目标**：三级循环全自动端到端演示 + 跨模型/跨客户端/跨会话续航矩阵测试。

**依赖**：P0-P5 全部完成。

### P6-1: 端到端三级循环演示

**目标**：输入"做贪吃小老鼠游戏" → 三级循环全自动产出可运行项目。

**验收矩阵**：

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 输入→产出 | "做贪吃小老鼠游戏" → 产出可运行项目 | 手动验证 |
| 外循环 | Story 队列正确分派 | 外循环日志 |
| 内循环 | 单 Story 5 阶段全自动流转 | 内循环日志 |
| 阶段内循环 | 每阶段质量门控迭代（open: PRD 14 维检查; build: TDD; verify: 6 级门禁） | 阶段内循环日志 |
| auto_transition | 阶段间自动推进无人工干预 | 日志无手动操作 |
| 断路器 | 无异常触发（正常路径不触发断路） | 断路器状态检查 |
| 完成度门控 | 5 条件全满足才完成 | CompletionGate 结果 |
| loop-audit | 评分 ≥ L2（51-80） | aza_audit 结果 |

---

### P6-2: 阶段不达标升级测试

**目标**：验证阶段内循环不达标时的升级机制。

**验收矩阵**：

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| PRD 阶段不达标 | open 阶段 P0>0 → 迭代修复 → 5 次不达标 → 升级 | 日志 |
| Build 阶段不达标 | build 阶段测试失败 → TDD 修复 → 5 次不达标 → 升级 | 日志 |
| Verify 阶段不达标 | verify 阶段门禁失败 → 修复 → 5 次不达标 → 升级 | 日志 |
| Story blocked | 阶段升级后 Story 标记 blocked | Story 状态 |
| 外循环分诊 | blocked Story 被外循环重新分派或跳过 | 外循环日志 |

---

### P6-3: 跨会话续航测试

**目标**：杀客户端 → 重新打开 → 自动续跑。

**验收矩阵**：

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| STATE 恢复 | 杀 Cursor → Claude Code 打开 → 读 STATE → 续跑 | 手动验证 |
| RESUME 恢复 | 读 RESUME.md → 恢复到中断点 | RESUME 内容验证 |
| 5-Question Reboot | 5 问全部可回答 | RebootTest 结果 |
| 阶段内循环恢复 | 从中断的迭代继续（保留迭代历史） | phase_history 验证 |
| SHA-256 完整性 | 文件未被篡改 → 校验通过 | attestation 验证 |

---

### P6-4: 跨模型续航测试

**目标**：不同模型切换续跑。

**验收矩阵**：

| 客户端 | 模型 A | 模型 B | 模型 C | 续航验证 |
|--------|--------|--------|--------|---------|
| Cursor | Sonnet 4 | GPT-4o | DeepSeek-V3 | 杀→切模型→续跑 |
| Claude Code | Opus 4 | Sonnet 4 | Qwen2.5-72B | 杀→切模型→续跑 |
| Trae | Qwen2.5-72B | DeepSeek-V3 | GLM-4 | 杀→切模型→续跑 |
| Cline | Sonnet 4 | Qwen2.5-72B | GPT-4o-mini | 杀→切模型→续跑 |
| VS Code | Copilot | - | - | 手动 aza continue |

**验收标准**：20 组合跨模型续航全部成功。

---

### P6-5: 跨客户端能力对齐测试

**目标**：24 客户端全部能 `aza init` + 跑通 1 个 Story（含阶段内循环）。

**验收矩阵**：

| 客户端分组 | 客户端 | init | 跑通 Story | 自动化程度 |
|-----------|--------|------|-----------|-----------|
| T1 Full | Cursor / Claude Code | ✅ | ✅ | 100% |
| T2 Partial-Hook | Cline / Trae | ✅ | ✅ | 95% |
| T3 MCP-Simulated | Windsurf / VS Code / Roo / OpenCode / Comate / WorkBuddy | ✅ | ✅ | 90% |
| T4 Rule-Injected | Kiro / Gemini CLI / Codex CLI / Qwen Code | ✅ | ✅ | 85% |
| T5 Manual-Trigger | Hermes / OpenClaw / Claude Desktop / Aider / Goose / Zed / Droid / Codeium / GitHub Copilot / OpenHands / Continue | ✅ | ✅ | 75% |

**验收标准**：24 客户端全部 `aza init` 成功 + 至少 1 个 Story 跑通。

---

### P6-6: 无 Hook 客户端全自动测试

**目标**：验证 MCP 事件模拟器让无 Hook 客户端实现等效全自动。

**验收矩阵**：

| 客户端 | 原生 Hook | MCP 模拟器 | pre-tool 模拟 | post-tool 模拟 | on-stop 模拟 | next_action 链 | 三级循环 |
|--------|----------|-----------|---------------|---------------|-------------|--------------|---------|
| VS Code | 无 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Windsurf | 简化 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Roo | 5 事件 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Comate | 无 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WorkBuddy | 无 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**验收标准**：无 Hook 客户端通过 MCP 模拟器后，三级循环全自动运行。

---

### P6-7: 安全阻断测试

**目标**：验证安全层在三级循环中的阻断能力。

**验收矩阵**：

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 密钥泄露 | 注入含密钥代码 → Gate4 阻断 → verify 阶段内循环修复 | 安全扫描结果 |
| SQL 注入 | 注入 SQL 注入代码 → Gate4 阻断 | 安全扫描结果 |
| Policy-as-Code | blocker 级违规 → 立即终止循环 | Policy 检查结果 |
| 中国合规 | 不合规项 → 合规报告 | 合规检查结果 |
| 提示注入 | 检测提示注入 → 阻断 | 扫描结果 |

---

### P6-8: loop-audit 评分测试

**目标**：验证 loop-audit 18 信号评分系统。

**验收矩阵**：

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 18 信号评分 | 全部可评分 | aza_audit 输出 |
| 4 级别 | L0-L3 正确分级 | calculateLevel() |
| 改进建议 | 未达 L3 的信号有建议 | recommendations |
| Gate6 | 评分 < 60 时门禁不通过 | Gate6 结果 |

---

### P6 阶段验收标准

| 验收项 | 标准 |
|--------|------|
| 端到端演示 | 三级循环全自动产出可运行项目 |
| 阶段不达标升级 | 升级机制正确触发 |
| 跨会话续航 | 杀→重开→续跑成功 |
| 跨模型续航 | 20 组合全部成功 |
| 跨客户端对齐 | 24 客户端全部可 init + 跑通 |
| 无 Hook 全自动 | MCP 模拟器等效 |
| 安全阻断 | 8 层防御全部可阻断 |
| loop-audit | 18 信号评分 ≥ L2 |

---

## 10. 每阶段验收标准汇总

### P0 验收标准

| 编号 | 验收项 | 通过条件 |
|------|--------|---------|
| P0-V1 | 编译通过 | `pnpm build` 无错误 |
| P0-V2 | 单元测试 | P0 新增 8 个模块测试 100% 通过 |
| P0-V3 | phase-gates | 5 阶段门控通过/不通过场景覆盖 |
| P0-V4 | phase-loop | open 阶段 P0=0 时通过，P0>0 时迭代 |
| P0-V5 | inner-loop | 单 Story 5 阶段全自动流转 |
| P0-V6 | outer-loop | 多 Story 队列分派 + blocked 升级 |
| P0-V7 | circuit-breaker | 4 维度 × 3 级别均可触发 |
| P0-V8 | completion-gate | 5 条件全满足才允许停止 |
| P0-V9 | loop-audit | 18 信号可评分，L0-L3 正确 |
| P0-V10 | state-machine | 三级循环状态可读写，V11 测试不破坏 |
| P0-V11 | index.ts 导出 | 所有新模块可从 `@azaloop/core` 导入 |

### P1 验收标准

| 编号 | 验收项 | 通过条件 |
|------|--------|---------|
| P1-V1 | MCP 事件模拟器 | pre/post hook 模拟正确执行 |
| P1-V2 | 降级策略矩阵 | 5 级策略 + 24 客户端正确分级 |
| P1-V3 | MCP 事件桥接 | 9 事件链可桥接触发 |
| P1-V4 | 无 Hook 等效性 | VS Code 行为与 Cursor 等效 |
| P1-V5 | 编译通过 | `pnpm build` 无错误 |

### P2 验收标准

| 编号 | 验收项 | 通过条件 |
|------|--------|---------|
| P2-V1 | 14 章 PRD | 输入需求 → 生成 14 章 PRD |
| P2-V2 | 复杂度分级 | L1-L4 正确分级 |
| P2-V3 | 14 维审查 | 14 维度全部可检查 |
| P2-V4 | P0-P3 分级 | 问题正确分级，P0=0 且 P1≤3 时通过 |
| P2-V5 | Policy-as-Code | ≥20 条策略可执行 |
| P2-V6 | 3 个新扫描器 | 提示注入/数据外泄/MCP 投毒可检测 |
| P2-V7 | 中国合规 | 3 部法规可检查 |
| P2-V8 | 编译通过 | `pnpm build` 无错误 |

### P3 验收标准

| 编号 | 验收项 | 通过条件 |
|------|--------|---------|
| P3-V1 | SHA-256 attestation | 文件篡改可检测 |
| P3-V2 | JSONL 上下文编排 | 按阶段精确注入，Token 不超限 |
| P3-V3 | 5-Question Reboot | 5 问可回答 |
| P3-V4 | 断路器集成 | 三级循环均可触发断路 |
| P3-V5 | loop-audit 集成 | 实时审计可用 |
| P3-V6 | 编译通过 | `pnpm build` 无错误 |

### P4 验收标准

| 编号 | 验收项 | 通过条件 |
|------|--------|---------|
| P4-V1 | DAG 依赖图 | 正确分层 + 并行检测 + 循环检测 |
| P4-V2 | 蜂群协调器 | 接口编译通过 |
| P4-V3 | 模型路由 | 复杂度分级路由正确 |
| P4-V4 | 完成度门控事件 | on-stop 时触发检查 |
| P4-V5 | EventBus MCP 桥接 | 桥接状态可查询 |
| P4-V6 | Gate6 loop-audit | 评分 < 60 时不通过 |
| P4-V7 | 6 级门禁 | runAll 返回 6 个结果 |
| P4-V8 | Gate4 Policy-as-Code | 策略违规可阻断 |
| P4-V9 | 编译通过 | `pnpm build` 无错误 |

### P5 验收标准

| 编号 | 验收项 | 通过条件 |
|------|--------|---------|
| P5-V1 | 8 个新客户端模板 | 每个模板文件完整 |
| P5-V2 | 24 客户端检测 | 全部可检测 + tier 正确 |
| P5-V3 | 能力矩阵 | 24 客户端覆盖 |
| P5-V4 | aza_audit | MCP 工具可调用 |
| P5-V5 | aza_compliance | MCP 工具可调用 |
| P5-V6 | aza_dag | MCP 工具可调用 |
| P5-V7 | MCP Server | 15 个工具全部可发现 |
| P5-V8 | `aza init` | 24 客户端全部可 init |
| P5-V9 | 编译通过 | `pnpm build` 无错误 |

### P6 验收标准

| 编号 | 验收项 | 通过条件 |
|------|--------|---------|
| P6-V1 | 端到端演示 | 三级循环全自动产出可运行项目 |
| P6-V2 | 阶段不达标升级 | 升级机制正确触发 |
| P6-V3 | 跨会话续航 | 杀→重开→续跑成功 |
| P6-V4 | 跨模型续航 | 20 组合全部成功 |
| P6-V5 | 跨客户端对齐 | 24 客户端全部可 init + 跑通 |
| P6-V6 | 无 Hook 全自动 | MCP 模拟器等效 |
| P6-V7 | 安全阻断 | 8 层防御全部可阻断 |
| P6-V8 | loop-audit | 18 信号评分 ≥ L2 |

---

## 附录 A: 风险与缓解

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| 三级循环复杂度过高 | 中 | 高 | 严格模块隔离 + 单元测试覆盖 + 逐步集成 |
| 断路器误触发 | 中 | 中 | 阈值可配置 + 支持手动 reset |
| MCP 事件模拟器性能开销 | 低 | 中 | 快速预扫描 + 可关闭模拟 |
| 24 客户端测试矩阵爆炸 | 高 | 中 | 自动化测试 + 分组验证 |
| PRD 14 章生成质量 | 中 | 高 | 14 维审查 + P0-P3 分级 + 阶段内循环修复 |
| SHA-256 attestation 误报 | 低 | 低 | 支持手动 unlock |
| loop-audit 评分主观性 | 中 | 低 | 18 信号客观化 + 可配置权重 |

---

## 附录 B: 文件变更清单

### 新增文件（P0-P5）

| 阶段 | 文件路径 | 说明 |
|------|---------|------|
| P0 | `packages/core/src/L7_loop/phase-gates.ts` | 5 阶段质量门控定义 |
| P0 | `packages/core/src/L7_loop/phase-loop.ts` | 阶段内循环控制器 |
| P0 | `packages/core/src/L7_loop/inner-loop.ts` | 内循环控制器 |
| P0 | `packages/core/src/L7_loop/outer-loop.ts` | 外循环控制器 |
| P0 | `packages/core/src/L7_loop/circuit-breaker.ts` | 断路器 |
| P0 | `packages/core/src/L7_loop/completion-gate.ts` | 完成度门控 |
| P0 | `packages/core/src/L7_loop/loop-audit.ts` | loop-audit 18 信号评分 |
| P1 | `packages/core/src/continuity/mcp-event-simulator.ts` | MCP 事件模拟器 |
| P1 | `packages/core/src/Hook/mcp-event-bridge.ts` | MCP 事件桥接 |
| P2 | `packages/core/src/L1_spec/templates/prd-14chapters.md` | 14 章 PRD 模板 |
| P2 | `packages/core/src/L1_spec/templates/prd-complexity-matrix.yaml` | 复杂度分级配置 |
| P2 | `packages/core/src/L6_security/policy-as-code.ts` | Policy-as-Code 引擎 |
| P2 | `packages/core/src/L6_security/scanners/prompt-injection.ts` | 提示注入检测 |
| P2 | `packages/core/src/L6_security/scanners/data-exfiltration.ts` | 数据外泄检测 |
| P2 | `packages/core/src/L6_security/scanners/mcp-poisoning.ts` | MCP 投毒扫描 |
| P2 | `packages/core/src/L6_security/compliance-checker.ts` | 中国合规体检 |
| P2 | `packages/core/src/L6_security/policy.yaml` | Policy-as-Code 配置 |
| P3 | `packages/core/src/L2_memory/context-orchestrator.ts` | JSONL 上下文编排 |
| P4 | `packages/core/src/L8_orchestrator/dag-builder.ts` | DAG 依赖图 |
| P4 | `packages/core/src/L8_orchestrator/swarm/coordinator.ts` | 蜂群协调器 |
| P4 | `packages/core/src/Hook/events/completion-gate.ts` | 完成度门控事件 |
| P4 | `packages/core/src/quality/gates/gate6-loop-audit.ts` | Gate6 loop-audit 门禁 |
| P5 | `templates/clients/gemini-cli/*` | Gemini CLI 模板 |
| P5 | `templates/clients/codex-cli/*` | Codex CLI 模板 |
| P5 | `templates/clients/hermes/*` | Hermes 模板 |
| P5 | `templates/clients/openclaw/*` | OpenClaw 模板 |
| P5 | `templates/clients/claude-desktop/*` | Claude Desktop 模板 |
| P5 | `templates/clients/comate/*` | Comate 模板 |
| P5 | `templates/clients/workbuddy/*` | WorkBuddy 模板 |
| P5 | `templates/clients/qwen-code/*` | Qwen Code 模板 |
| P5 | `packages/mcp-server/src/tools/aza-audit.ts` | loop-audit MCP 工具 |
| P5 | `packages/mcp-server/src/tools/aza-compliance.ts` | 合规检查 MCP 工具 |
| P5 | `packages/mcp-server/src/tools/aza-dag.ts` | DAG 管理 MCP 工具 |

### 修改文件（P0-P5）

| 阶段 | 文件路径 | 修改内容 |
|------|---------|---------|
| P0 | `packages/core/src/L7_loop/state-machine.ts` | 增加三级循环状态字段和方法 |
| P0 | `packages/core/src/index.ts` | 导出新增模块 |
| P1 | `packages/core/src/L0_platform/compensation-strategy.ts` | 增加 5 级降级策略 + MCP 模拟策略 |
| P2 | `packages/core/src/L1_spec/prd-generator.ts` | 增加 14 章模板 + 复杂度分级 |
| P2 | `packages/core/src/L1_spec/prd-checker.ts` | 增加 14 维审查 + P0-P3 分级 |
| P3 | `packages/core/src/state/checksum.ts` | 增加 SHA-256 attestation |
| P3 | `packages/core/src/continuity/resume-generator.ts` | 增加 5-Question Reboot Test |
| P3 | `packages/core/src/L7_loop/phase-loop.ts` | 集成断路器 |
| P3 | `packages/core/src/L7_loop/inner-loop.ts` | 集成断路器 |
| P3 | `packages/core/src/L7_loop/outer-loop.ts` | 集成断路器 |
| P3 | `packages/core/src/L7_loop/loop-controller.ts` | 集成 loop-audit |
| P4 | `packages/core/src/L8_orchestrator/model-router.ts` | 增加复杂度分级路由 |
| P4 | `packages/core/src/Hook/event-bus.ts` | 增加 MCP 桥接支持 |
| P4 | `packages/core/src/quality/pipeline.ts` | 增加 Gate6 |
| P4 | `packages/core/src/quality/gates/gate4-security.ts` | 融合 Policy-as-Code |
| P5 | `packages/core/src/L0_platform/client-detection.ts` | 增加 8 个新客户端检测 |
| P5 | `packages/core/src/L0_platform/capability-matrix.yaml` | 增加 8 个新客户端能力 |
| P5 | `packages/mcp-server/src/index.ts` | 注册 3 个新工具 |

---

## 附录 C: 估时与执行路径

| 阶段 | 估时 | 依赖 | 可并行 |
|------|------|------|--------|
| P0 | 5 天 | V11 完成 | - |
| P1 | 2 天 | P0 | - |
| P2 | 3 天 | P0 | 与 P1 并行 |
| P3 | 3 天 | P0、P2 | - |
| P4 | 3 天 | P0、P3 | 与 P2 后半段并行 |
| P5 | 3 天 | P1、P4 | - |
| P6 | 3 天 | P0-P5 全部 | - |

**总计约 22 天**。P0-P1 为三级循环最小可用闭环（7 天），P2-P4 并行推进（约 6 天重叠），P5-P6 为客户端覆盖与验收（6 天）。
