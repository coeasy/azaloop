# AzaLoop 0.1.0 完整项目开发方案

> 基于 20+ 参考项目深度调研 + 本地 v2.0 PRD + v3.0 融合方案 + v8/v9 十层架构
> 核心目标：用户输入一句话 → 全自动跨客户端/跨会话/跨模型续航 → 产出工业级应用
> 日期：2026-07-11

---

## 0. 核心设计理念：MCP 能力对齐层

### 问题定义

不同 AI 客户端的基础能力差异巨大：

| 能力维度 | Cursor | Claude Code | Trae | Windsurf | VS Code | Cline | Continue | Roo | Kiro | Aider | Goose | Zed |
|---------|--------|-------------|------|----------|---------|-------|----------|-----|------|-------|-------|-----|
| Stop Hook | 有 | 有(9事件) | 部分 | 简化 | 无 | 3事件 | 无 | 5事件 | 简化 | 无 | 无 | 无 |
| Rules 文件 | .cursor/rules | CLAUDE.md | .trae/rules | .windsurf/ | settings | .clinerules | .continuerules | .roo/ | .kiro/ | CONVENTIONS | config.yaml | .zed/ |
| MCP 支持 | 有 | 有 | 有 | 有 | 有 | 有 | 有 | 有 | 有 | 部分 | 有 | 有 |
| Skills | 有 | Plugin | 部分 | 无 | chatmode | 扩展 | 无 | 模式 | specs | 无 | 无 | ext |
| 原生循环 | Composer | Agent | Agent | Agent | 无 | 有 | 无 | 有 | 无 | 无 | 无 | 无 |

### 解决方案：MCP Server 即能力对齐层

**核心理念**：MCP Server 是"能力均衡器" — 无论客户端缺少什么基础能力（Hook/Rules/Skills/循环），AzaLoop MCP Server 都能通过 MCP 协议补齐。

```
客户端原生能力（各有差异）          AzaLoop MCP Server（统一能力层）
┌─────────────────────────┐      ┌─────────────────────────────────┐
│ Cursor: Hook+Rules+Skill│      │                                 │
│ Claude: 9事件+Plugin   │      │  aza_prd   → PRD 生成（补齐无Spec能力）│
│ Trae: 部分+Rules       │─────▶│  aza_loop  → 循环驱动（补齐无循环能力）│
│ Windsurf: 简化+Rules   │ MCP  │  aza_task  → 任务管理（补齐无编排能力）│
│ VS Code: 仅MCP         │ 协议  │  aza_quality→ 质量门禁（补齐无TDD能力） │
│ Cline: 3事件+Rules     │      │  aza_memory→ 记忆管理（补齐无记忆能力）│
│ Continue: 仅Rules      │      │  aza_context→ 上下文注入（补齐无Rules） │
│ Aider: 无Hook          │      │  aza_continue→续跑指令（补齐无Stop Hook）│
│ Goose: 无Hook          │      │  aza_doc   → 文档生成（补齐无文档能力）│
│ Zed: 仅MCP             │      │  aza_skill → 技能检索（补齐无Skills）  │
└─────────────────────────┘      └─────────────────────────────────┘
                                          │
                                 ┌────────▼────────┐
                                 │  所有客户端获得   │
                                 │  完全相同的能力   │
                                 └─────────────────┘
```

**关键机制：MCP 工具补偿客户端缺陷**

| 客户端缺陷 | MCP 补偿方案 | 效果 |
|-----------|-------------|------|
| 无 Stop Hook | `aza_loop status` + continue.md 规则注入 → 会话启动自动读 RESUME | T2/T3 客户端也能跨会话续航 |
| 无 Rules 支持 | `aza_context calibrate` → MCP 工具返回宪法+铁律+角色上下文 | 无 Rules 的客户端也能注入纪律 |
| 无 Skills | `aza_skill search/list` → MCP 工具检索 Skill 内容并返回 | 无 Skills 的客户端也能使用 8 段式 Skill |
| 无原生循环 | `aza_loop next` → next_action 链式驱动，宿主 LLM 自动续调 | 无循环的客户端也能自动循环 |
| 无 TDD | `aza_quality check` → 五级门禁强制检查 | 无 TDD 的客户端也能质量管控 |
| 无记忆 | `aza_memory query` → 三层记忆读写 | 无记忆的客户端也能跨会话复用 |

### 三级适配策略

| 策略级别 | 客户端 | 能力对齐方式 | 自动化程度 |
|---------|--------|-------------|-----------|
| **T1 完整对齐** | Cursor/Claude Code/Trae/Windsurf | MCP + 原生 Hook → next_action 链全自动 | 100% 自动 |
| **T2 规则对齐** | VS Code/Cline/Continue/Roo/Kiro/OpenHands/Zed/GitHub Copilot | MCP + continue.md 规则注入 → LLM 自觉续跑 | 90% 自动 |
| **T3 手动对齐** | Aider/Droid/Goose/Codeium | MCP + 手动 `aza continue` → 每次会话手动触发 | 70% 自动 |

**关键**：T3 客户端虽然需要手动触发 `aza continue`，但一旦触发后，next_action 链会自动驱动后续所有步骤，直到会话结束。下次会话再手动触发一次即可。自动化程度从 0% 提升到 70%。

### 统一续跑规则（所有客户端共用）

每个客户端的规则文件（`.cursor/rules`/`CLAUDE.md`/`.clinerules`/`.continuerules` 等）都注入同一段续跑指令：

```markdown
# AzaLoop 自动续跑规则（MANDATORY — 会话启动时首先执行）

1. 调用 aza_context status 获取当前状态
2. 如果存在 .aza/RESUME.md：
   - 调用 aza_loop next 续跑（传入 RESUME 中的 current_story）
3. 如果不存在 RESUME.md：
   - 询问用户需求 → 调用 aza_prd generate 生成新 PRD
4. 每次工具返回的 next_action 必须自动执行，不得跳过
5. 跨会话恢复时调用 aza_memory query 获取相关历史经验
```

**效果**：无论是 Cursor 的 `.cursor/rules/continue.mdc` 还是 Aider 的 `CONVENTIONS.md`，注入的指令内容完全相同。宿主 LLM 看到的行为指令一致，跨客户端表现一致。

---

## 核心设计决策

### 架构选择：规范层 + 实现层双轨制

采用 `PROJECT-PLAN-V10.md` 的融合方案：v8/v9 十层作为规范层（配置/契约），v2.0 精简核心作为实现层（代码/模块）。每层 = 一组 MCP 工具 + 一段 Prompt 规则 + STATE 里的一个分片。

**关键差异化壁垒**：宿主 LLM 零配置 — 在 Cursor/Claude Code/Trae 中直接复用宿主模型，无需 API Key。所有竞品（superpowers/Trellis/OpenSpec/comet）都未做到这一点。

### 与现有方案的关系

| 文档 | 角色 | 取舍 |
|------|------|------|
| `docs/PRD.md` | 事实规格 | 作为需求基线，本方案是其分步实现 |
| `docs/PROJECT-PLAN.md` | v2.0 精简版 | 采纳其精简核心 + next_action 链 |
| `docs/PROJECT-PLAN-V10.md` | 十层融合版 | 采纳其规范层+实现层双轨制 |
| `.trae/documents/azaloop-v3-complete-integration-plan.md` | v3.0 完整版 | 采纳其十层详细模块设计 + 客户端矩阵 |
| `docs/assloop-v8/v9-final.md` | 重架构草案 | 十层规范保留，80 目录重架构废弃 |

---

## Task 1: Monorepo 基础设施搭建 (P0)

**目标**：初始化项目骨架，建立可构建的 monorepo

**关键文件**：
- `package.json` — monorepo 根配置
- `pnpm-workspace.yaml` — pnpm 工作区
- `tsconfig.base.json` — TypeScript strict 基线
- `packages/shared/package.json` — 共享包
- `packages/core/package.json` — 核心包

**实现要点**：
1. pnpm monorepo 工作区（参考 `PRD.md` 5.1 节包结构）
2. TypeScript 5.9.3 strict mode
3. 依赖方向：`shared ← core ← mcp-server ← cli`，禁止循环引用
4. Zod schema 定义 PRD/STATE/配置的类型系统

**验收标准**：`pnpm install && pnpm build` 成功，空包可导入

---

## Task 2: 共享类型与 Schema 定义 (P0)

**目标**：定义全局类型系统和数据校验

**关键文件**：
- `packages/shared/src/schemas/prd.schema.ts` — PRD 的 Zod schema
- `packages/shared/src/schemas/state.schema.ts` — STATE.yaml 的 Zod schema
- `packages/shared/src/schemas/config.schema.ts` — azaloop.yaml 配置 schema
- `packages/shared/src/schemas/loop-response.schema.ts` — MCP 工具统一响应格式

**LoopResponse Schema**（next_action 链式驱动核心 — 能力对齐的关键）：
```typescript
{
  success: boolean,
  data: T,
  next_action: { tool: string, action: string, reason: string },
  metadata: { iteration: number, progress: string, tokens_used: number }
}
```

**关键设计**：next_action 是所有客户端能力对齐的基石。无论客户端是否有原生循环能力，只要它能看到 MCP 工具返回的 next_action，宿主 LLM 就会自动续调。这使无循环能力的客户端（如 VS Code Copilot、Aider）也能实现自动循环。

**验收标准**：Zod parse 合法 PRD JSON 通过，非法输入报错

---

## Task 3: STATE 持久化与 SHA-256 校验 (P0)

**目标**：实现跨会话状态持久化（跨模型续航的文件层基础）

**关键文件**：
- `packages/core/src/state/state-manager.ts` — STATE.yaml 读写
- `packages/core/src/state/checksum.ts` — SHA-256 校验
- `packages/core/src/state/heartbeat.ts` — AI 心跳文件

**STATE 结构**（融合 v8/v9 五阶段 + v2.0 迭代视角）：
```yaml
pipeline:
  current_stage: "build"  # open→design→build→verify→archive
  stages: { open: {status:completed}, design: {status:completed}, build: {status:in_progress} }
loop:
  iteration: 12
  progress: "60%"
  current_story: "STORY-003"
  client: "cursor"  # 当前客户端标识（跨客户端切换时更新）
  model: "sonnet-4"  # 当前模型标识（跨模型切换时更新）
memory:
  episodic_ref: "ep-2026-07-11-03"
security_findings: []
strikes: 0
```

**跨客户端/跨模型的关键**：STATE 文件中记录 `client` 和 `model` 字段，当切换客户端/模型时，新会话读取 STATE 可知上次在哪个客户端哪个模型上跑到哪里，无缝续跑。

**验收标准**：写入 STATE → 校验通过 → 杀进程 → 重启读取成功

---

## Task 4: L1 规范层 — PRD 引擎 (P1)

**目标**：从用户自然语言输入生成结构化 PRD

**关键文件**：
- `packages/core/src/L1_spec/prd-generator.ts` — PRD 生成核心
- `packages/core/src/L1_spec/constitution.yaml` — 项目宪法 12 条
- `packages/core/src/L1_spec/change-management.ts` — proposal→spec→design→tasks
- `packages/core/src/L1_spec/templates/prd-template.md` — PRD 模板
- `packages/core/src/L1_spec/templates/arch-template.md` — 7 种架构图模板

**PRD 生成流程**（借鉴 OpenSpec explore→propose→apply + Trellis brainstorm）：
1. 用户输入自然语言需求
2. 解析需求 → 搜索类似开源项目参考
3. Generate → Reflect → Refine 多轮自优化
4. 产出 Markdown + JSON 双格式 PRD
5. acceptance_criteria 必须可测试

**验收标准**：输入"Todo 应用" → 产出合法 prd.json

---

## Task 5: L7 循环层 — 状态机与 next_action 链 (P2)

**目标**：实现 5 阶段状态机 + next_action 链式驱动（能力对齐的核心引擎）

**关键文件**：
- `packages/core/src/L7_loop/state-machine.ts` — 5 阶段状态机
- `packages/core/src/L7_loop/loop-controller.ts` — 循环驱动 + next_action 链
- `packages/core/src/L7_loop/guards.ts` — 各阶段 Guard 守卫
- `packages/core/src/L7_loop/deadlock-detector.ts` — 死循环检测
- `packages/core/src/L7_loop/hard-stop.ts` — 硬性终止

**5 阶段状态机**（借鉴 comet + ralphy-openspec Ralph Loop）：
```
open:    接收需求 → 生成 PRD
design:  拆解 Story → 架构图 → 任务列表
build:   编码 → 单元测试
verify:  五级门禁
archive: 提交 + 记忆归档 + 释放资源
```

**next_action 链如何实现跨客户端能力对齐**：

```
用户在任意客户端输入 "做 Todo 应用"
  → aza_prd generate → 返回 { next_action: { tool: "aza_prd", action: "save" } }
  → aza_prd save → 返回 { next_action: { tool: "aza_loop", action: "next" } }
  → aza_loop next → 返回 { next_action: { tool: "aza_task", action: "verify" } }
  → aza_task verify → 返回 { next_action: { tool: "aza_loop", action: "next" } }
  → ... 自动循环直到 PRD 100% 完成

关键：宿主 LLM 无论是 Cursor 的 Composer 还是 Aider 的 CLI，
看到 next_action 就会自动续调 — 这就是"能力对齐"
```

**硬性终止**（借鉴 comet Guard + superpowers 3-Strike）：
| 条件 | 阈值 | 动作 |
|------|------|------|
| 同一 Story 连续失败 | 3 次 | 停止+升级人工 |
| 总迭代次数 | max_iterations(50) | 停止+报告 |
| 相同操作重复 | 3 次 | 死循环检测停止 |
| 安全 blocker | 任意 | 立即停止 |

**验收标准**：单 Story 自动循环到 done，next_action 链不中断

---

## Task 6: L2 记忆层 — 三层 Reflexion 记忆 (P3)

**目标**：实现跨会话经验复用

**关键文件**：
- `packages/core/src/L2_memory/working-memory.ts` — L1 工作记忆
- `packages/core/src/L2_memory/project-memory.ts` — L2 情景记忆
- `packages/core/src/L2_memory/long-term-memory.ts` — L3 语义记忆
- `packages/core/src/L2_memory/session-catchup.ts` — 新会话恢复协议
- `packages/core/src/L2_memory/compression.ts` — 自动压缩

**三层架构**（借鉴 planning-with-files + Trellis + OpenSpec）：

| 层 | 内容 | 存储 | 生命周期 |
|----|------|------|---------|
| L1 瞬时 | 当前循环上下文 | 内存+STATE | 单次循环 |
| L2 情景 | Reflexion 笔记 | `.aza/memory/episodic/` | 当前项目 |
| L3 语义 | 跨项目经验+用户偏好 | `.aza/memory/semantic/` | 永久 |

**Session-Catchup 协议**（跨客户端恢复关键）：
```
新会话启动 →
  1. 读 STATE.yaml → 恢复工作记忆（含 client/model 字段）
  2. 读 task_plan.md → 恢复项目记忆
  3. 关键词检索相关历史经验 → 注入长期记忆
  4. 生成 catchup-summary → 快速恢复上下文
```

**验收标准**：第二次会话错误率比首次下降 >60%

---

## Task 7: 续航机制 — MCP 能力补偿 + RESUME (P3)

**目标**：实现跨会话/跨模型/跨客户端自动恢复（能力对齐的核心落地）

**关键文件**：
- `packages/core/src/continuity/resume-generator.ts` — RESUME.md 生成
- `packages/core/src/continuity/mcp-continue.ts` — MCP 续跑工具（补偿无 Stop Hook 的客户端）
- `packages/core/src/continuity/catchup-protocol.ts` — 会话恢复协议
- `packages/core/src/continuity/context-injector.ts` — 上下文注入器（补偿无 Rules 的客户端）
- `templates/clients/*/continue.md` — 各客户端续跑规则模板（统一内容）

**三链路续航（能力对齐实现）**：

**链路 A：next_action 链式驱动**（所有客户端通用）
- 每个 MCP 工具返回 next_action → 宿主 LLM 自动续调
- 这是最通用的续航机制，不依赖客户端原生 Hook

**链路 B：Stop Hook + RESUME**（T1 客户端）
- 会话结束 → 触发 onStop → 写入 RESUME.md
- 下次会话 → continue.md 规则 → 读 RESUME → 调 aza_loop next

**链路 C：MCP continue 工具**（T2/T3 客户端补偿）
- 无 Stop Hook 的客户端 → 用户结束会话时不会自动写 RESUME
- MCP 提供 `aza_continue` 工具 → 在每次工具调用后自动检查并更新 RESUME
- T3 客户端：每次新会话手动调 `aza continue` CLI 命令
- T2 客户端：continue.md 规则注入 → LLM 自觉调 `aza_continue`

**上下文注入器（补偿无 Rules 客户端）**：
- `aza_context calibrate` → 返回宪法+铁律+角色+知识上下文
- 无 Rules 支持的客户端（如纯 MCP 模式的 VS Code）通过 MCP 工具获取相同上下文
- 效果：无论客户端是否有 Rules 文件，LLM 都能获取完整的纪律约束

**跨模型兼容性**：
- 状态全部在文件里（Markdown+YAML+JSON），无运行时依赖
- 记忆用 SHA-256 校验，不依赖特定 LLM
- 换 Cursor→Claude Code→Trae → STATE 文件不变 → 跨模型续航天然成立

**验收标准**：杀 Cursor → 用 Claude Code 打开 → 自动读 RESUME → 续跑完成

---

## Task 8: L4 纪律层 + L6 安全层 (P4)

**目标**：实现纪律约束和安全防御

**关键文件**：
- `packages/core/src/L4_discipline/iron-rules.md` — 4 铁律
- `packages/core/src/L4_discipline/anti-rationalizations.md` — 8 反借口
- `packages/core/src/L4_discipline/strike-system.ts` — 3-Strike
- `packages/core/src/L6_security/scanners/secret.ts` — 密钥扫描
- `packages/core/src/L6_security/scanners/sql-injection.ts` — SQL 注入
- `packages/core/src/L6_security/scanners/xss.ts` — XSS
- `packages/core/src/L6_security/scanners/dependency.ts` — 依赖漏洞
- `packages/core/src/L6_security/scanners/code-injection.ts` — 代码注入

**4 铁律**（借鉴 superpowers）：
1. 不假设，验证先
2. 最小化变更范围
3. 精准修改，不"顺便优化"
4. 目标驱动

**8 层安全防御**（借鉴 shellward）：
1. 密钥泄露 2. SQL 注入 3. XSS 4. 依赖漏洞
5. 代码注入 6. Path Traversal 7. 反序列化 8. SSRF

**验收标准**：注入含密钥代码 → 安全 Gate 阻断 + 循环停止

---

## Task 9: 质量门禁 Pipeline (P5)

**目标**：实现五级质量验证

**关键文件**：
- `packages/core/src/quality/pipeline.ts` — 五级门禁
- `packages/core/src/quality/gates/gate1-lint.ts` — tsc+ESLint
- `packages/core/src/quality/gates/gate2-test.ts` — Vitest
- `packages/core/src/quality/gates/gate3-regression.ts` — 基线回归
- `packages/core/src/quality/gates/gate4-security.ts` — 安全扫描
- `packages/core/src/quality/gates/gate5-acceptance.ts` — 验收对照

**五级 Pipeline**（借鉴 superpowers RED-GREEN-REFACTOR）：
```
Gate1: 静态分析 → Gate2: 测试 → Gate3: 回归 → Gate4: 安全 → Gate5: 验收
```

**验收标准**：Story 通过全部 5 级门禁才标记 done

---

## Task 10: L0 平台层 — 客户端适配与能力对齐 (P5)

**目标**：实现跨客户端自动检测、能力对齐和适配

**关键文件**：
- `packages/core/src/L0_platform/client-detection.ts` — 自动检测宿主
- `packages/core/src/L0_platform/capability-matrix.yaml` — 客户端能力矩阵
- `packages/core/src/L0_platform/compensation-strategy.ts` — 能力补偿策略
- `packages/core/src/L0_platform/template-generator.ts` — 配置模板生成器
- `packages/core/src/L0_platform/workspace-manager.ts` — 多项目 Workspace

**能力补偿策略矩阵**（核心设计 — 确保所有客户端获得相同能力）：

| 原生能力缺失 | MCP 补偿工具 | 补偿机制 | 适用客户端 |
|-------------|-------------|---------|-----------|
| 无 Stop Hook | `aza_continue` | 每次工具调用后自动更新 RESUME | T2/T3 全部 |
| 无 Rules 注入 | `aza_context calibrate` | MCP 返回宪法+铁律+角色上下文 | VS Code/Aider/Goose |
| 无 Skills | `aza_skill search/list` | MCP 工具检索 Skill 并返回内容 | Windsurf/Continue/Aider |
| 无原生循环 | `aza_loop next` | next_action 链驱动 LLM 续调 | VS Code/Continue/Aider |
| 无 TDD | `aza_quality check` | 五级门禁强制 | 全部客户端 |
| 无记忆 | `aza_memory query/list` | 三层记忆读写 | 全部客户端 |
| 无文档生成 | `aza_doc generate` | 6 种文档自动生成 | 全部客户端 |

**客户端自动检测**：
```typescript
function detectClient(): ClientInfo {
  if (process.env.CURSOR_TRACE_ID) return { name: 'cursor', tier: 1 };
  if (process.env.CLAUDE_CODE_ENTRYPOINT) return { name: 'claude-code', tier: 1 };
  if (fs.existsSync('.trae/mcp.json')) return { name: 'trae', tier: 1 };
  if (fs.existsSync('.windsurf')) return { name: 'windsurf', tier: 1 };
  if (fs.existsSync('.vscode/mcp.json')) return { name: 'vscode', tier: 2 };
  if (fs.existsSync('.clinerules')) return { name: 'cline', tier: 2 };
  if (fs.existsSync('.continuerules')) return { name: 'continue', tier: 2 };
  // ... 兜底: unknown (T3, 手动模式)
}
```

**16+ 客户端模板列表**：
- `templates/clients/cursor/` — mcp.json + rules/*.mdc + hooks/
- `templates/clients/claude-code/` — plugin.json + agents/ + skills/ + hooks/
- `templates/clients/trae/` — mcp.json + rules/
- `templates/clients/windsurf/` — mcp.json + rules/
- `templates/clients/vscode/` — settings.json + mcp.json
- `templates/clients/cline/` — cline_mcp_settings.json + .clinerules
- `templates/clients/continue/` — config.json + .continuerules
- `templates/clients/roo-code/` — .roo/ + mcp.json
- `templates/clients/kiro/` — .kiro/ + mcp.json
- `templates/clients/aider/` — CONVENTIONS.md + .aider.conf.yml
- `templates/clients/goose/` — config.yaml + mcp.json
- `templates/clients/zed/` — .zed/ + mcp.json
- `templates/clients/github-copilot/` — chatmodes/ + instructions/
- `templates/clients/openhands/` — .openhands/ + mcp.json
- `templates/clients/codeium/` — .codeium/ + mcp.json
- `templates/clients/droid/` — .droid/ + mcp.json

**所有模板都注入相同的 continue.md 续跑规则**，确保跨客户端行为一致。

**验收标准**：`aza init` 自动检测客户端 → 生成对应配置 → 16 客户端全部可跑通

---

## Task 11: L3 角色层 + L5 技能层 + L9 知识层 (P5)

**目标**：实现角色分工、技能管理和知识注入

**关键文件**：
- `packages/core/src/L3_roles/8-core.md` — 8 核心角色
- `packages/core/src/L3_roles/dynamic-binder.ts` — 角色动态绑定
- `packages/core/src/L5_skill/registry.ts` — Skill 注册表
- `packages/core/src/L5_skill/templates/SKILL-TEMPLATE.md` — 8 段式模板
- `packages/core/src/L5_skill/core-skills/` — 6 核心 Skill
- `packages/core/src/L9_knowledge/66-techniques.md` — 66 编程技巧
- `packages/core/src/L9_knowledge/injection-engine.ts` — 上下文感知注入

**8 核心角色**（借鉴 gstack）：
think / plan / build / review / test / ship / observe / decide

**8 段式 Skill 模板**（借鉴 addyosmani/agent-skills）：
1. Frontmatter 2. Overview 3. When to use 4. Process
5. Examples 6. Rationalizations 7. RedFlags 8. Verification

**6 核心文档生成 Skill**：
prd / arch / db / api / test / deploy

**验收标准**：角色提示词生效 + Skill 可检索 + 知识按 Story 类型注入

---

## Task 12: Hook 横切层 — 9 事件链 (P5)

**目标**：实现事件驱动的横切机制（T1 客户端原生触发，T2/T3 通过 MCP 补偿）

**关键文件**：
- `packages/core/src/Hook/event-bus.ts` — 事件总线
- `packages/core/src/Hook/events/session-start.ts` — 读 STATE+注入上下文
- `packages/core/src/Hook/events/pre-tool.ts` — 纪律校验
- `packages/core/src/Hook/events/post-tool.ts` — 写进度+更新 RESUME
- `packages/core/src/Hook/events/pre-commit.ts` — 安全扫描
- `packages/core/src/Hook/events/post-task.ts` — 推进 pipeline
- `packages/core/src/Hook/events/pre-phase.ts` — Guard 检查
- `packages/core/src/Hook/events/post-phase.ts` — 文档生成
- `packages/core/src/Hook/events/on-error.ts` — 记录+三振
- `packages/core/src/Hook/events/on-stop.ts` — 生成 RESUME

**9 事件链跨客户端触发方式**：

| 事件 | T1 客户端触发 | T2/T3 客户端补偿触发 |
|------|-------------|-------------------|
| session-start | 原生 Hook | continue.md 规则 → aza_context status |
| pre-tool | 原生 Hook | MCP 工具内部前置检查 |
| post-tool | 原生 Hook | MCP 工具内部后置更新+RESUME |
| pre-commit | 原生 Hook | aza_quality check 前置 |
| post-task | 原生 Hook | aza_task complete 后置 |
| on-error | 原生 Hook | MCP 工具 catch 块 |
| on-stop | 原生 Hook | 每次工具调用后预写 RESUME（补偿无 Stop Hook） |

**关键设计**：on-stop 事件在 T2/T3 客户端没有原生触发点，因此采用"每次 MCP 工具调用后预写 RESUME"的策略。这样即使会话被强制杀掉，最后一次工具调用时已经写好了 RESUME，下次会话可以恢复。

**验收标准**：T1 客户端 9 事件全触发；T2/T3 通过 MCP 补偿实现等效效果

---

## Task 13: MCP Server + CLI (P6)

**目标**：暴露 MCP 工具和 CLI 命令（能力对齐的统一接口层）

**关键文件**：
- `packages/mcp-server/src/index.ts` — MCP Server 入口
- `packages/mcp-server/src/tools/aza-prd.ts` — PRD 管理
- `packages/mcp-server/src/tools/aza-loop.ts` — 循环控制
- `packages/mcp-server/src/tools/aza-task.ts` — 任务管理
- `packages/mcp-server/src/tools/aza-quality.ts` — 质量检查
- `packages/mcp-server/src/tools/aza-memory.ts` — 记忆管理
- `packages/mcp-server/src/tools/aza-context.ts` — 上下文管理（补偿无 Rules 客户端）
- `packages/mcp-server/src/tools/aza-continue.ts` — 续跑工具（补偿无 Stop Hook 客户端）
- `packages/mcp-server/src/tools/aza-health.ts` — 健康检查
- `packages/mcp-server/src/tools/aza-doc.ts` — 文档生成
- `packages/mcp-server/src/tools/aza-skill.ts` — 技能检索（补偿无 Skills 客户端）
- `packages/mcp-server/src/tools/aza-security.ts` — 安全扫描
- `packages/cli/src/index.ts` — CLI 入口
- `packages/cli/src/commands/init.ts` — aza init
- `packages/cli/src/commands/continue.ts` — aza continue（T3 手动续跑）

**MCP 工具完整列表**（按能力对齐分组）：

| 能力维度 | MCP 工具 | 补偿的客户端缺陷 | 优先级 |
|---------|---------|----------------|--------|
| PRD 生成 | aza_prd | 无 Spec 能力 | P0 |
| 循环驱动 | aza_loop | 无原生循环 | P0 |
| 任务管理 | aza_task | 无编排能力 | P0 |
| 质量门禁 | aza_quality | 无 TDD/质量 | P0 |
| 续跑恢复 | aza_continue | 无 Stop Hook | P0 |
| 上下文注入 | aza_context | 无 Rules | P1 |
| 记忆管理 | aza_memory | 无记忆系统 | P1 |
| 健康检查 | aza_health | 无监控 | P1 |
| 文档生成 | aza_doc | 无文档生成 | P2 |
| 技能检索 | aza_skill | 无 Skills | P2 |
| 安全扫描 | aza_security | 无安全扫描 | P2 |
| 风格学习 | aza_style | 无风格管理 | P2 |

**CLI 命令**：
```bash
aza init                              # 自动检测+生成配置
aza init --client=cursor              # 指定客户端
aza init --client=cursor,claude-code  # 多客户端同时初始化
aza run                               # 启动循环
aza continue                          # 手动续跑（T3 客户端）
aza status                            # 查看状态
aza upgrade --from v8or9 --to v10     # 迁移
aza audit                             # 审计十层覆盖率
```

**验收标准**：在 Cursor/Claude Code/VS Code 中 MCP 工具可调用 + CLI 可用

---

## Task 14: L8 编排层 — 接口预留 (P6)

**目标**：预留蜂群编排和模型路由接口

**关键文件**：
- `packages/core/src/L8_orchestrator/swarm/coordinator.ts` — 蜂群协调器（接口）
- `packages/core/src/L8_orchestrator/worktree/manager.ts` — Git Worktree
- `packages/core/src/L8_orchestrator/model-router.ts` — 模型路由（接口）
- `packages/core/src/L8_orchestrator/yaml-orchestrator.ts` — YAML 编排
- `packages/core/src/L8_orchestrator/scheduler.ts` — 任务调度

**验收标准**：DAG 串行执行可用，Worktree/模型路由接口编译通过

---

## Task 15: 迁移脚本 + azaloop.yaml 统一配置 (P6)

**目标**：兼容 v8/v9 旧项目迁移

**关键文件**：
- `packages/cli/src/commands/upgrade.ts` — 迁移脚本
- `packages/core/src/config/config-loader.ts` — 统一配置加载器
- `azaloop.yaml` 模板 — 合并配置

**验收标准**：v8/v9 项目 `aza upgrade` 后可直接被 AzaLoop 读取

---

## Task 16: 端到端验收 — "贪吃小老鼠游戏" (P7)

**目标**：全自动开发演示

**验收矩阵**：

| 验收项 | 标准 |
|--------|------|
| 输入→产出 | "做贪吃小老鼠游戏" → 5分钟内产出可运行项目 |
| 跨会话续航 | 杀 Cursor → Claude Code 打开 → 自动续跑 |
| 跨模型续航 | Sonnet→GPT-4o→DeepSeek-V3 切换续跑 |
| 跨客户端能力对齐 | 16 客户端全部能 init + 跑通 1 个 Story |
| 安全阻断 | 注入恶意代码 → 安全 Gate 阻断 |
| 跨项目复用 | 项目 A 完成后启动 B → B 复用 A 的成功模式 |
| Token 成本 | 单 Story 平均 < 5000 tokens |
| 文档生成 | PRD/架构图/DB/API/TestPlan 自动产出 |

---

## Task 17: 自身测试 + 跨模型矩阵 (P8)

**目标**：保证稳定性和兼容性

**跨模型×跨客户端测试矩阵**：

| 客户端 | 模型 A | 模型 B | 模型 C | 续航验证 |
|--------|--------|--------|--------|---------|
| Cursor | Sonnet 4 | GPT-4o | DeepSeek-V3 | 杀→切模型→续跑 |
| Claude Code | Opus 4 | Sonnet 4 | Qwen2.5-72b | 杀→切模型→续跑 |
| Trae | Qwen2.5-72b | DeepSeek-V3 | GLM-4 | 杀→切模型→续跑 |
| Cline | Sonnet 4 | Qwen2.5-72b | GPT-4o-mini | 杀→切模型→续跑 |
| VS Code | Copilot | - | - | 手动 aza continue |
| Aider | Sonnet 4 | DeepSeek-V3 | - | 手动 aza continue |

**验收标准**：90%+ 覆盖率 + 20 组合跨模型续航全部成功

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 宿主 LLM 不遵守 next_action 链 | 中 | prompt 强化 + Stop Hook 兜底 + continue.md 注入 |
| 会话中断丢上下文 | 中 | STATE+PRD+记忆三文件持久化 + RESUME 每次工具调用后预写 |
| T2/T3 客户端无 Stop Hook | 高 | aza_continue MCP 工具补偿 + 每次工具调用后预写 RESUME |
| 无 Rules 客户端无法注入纪律 | 中 | aza_context calibrate 通过 MCP 返回宪法+铁律 |
| 完整融合后模块数膨胀 | 中 | 严守"单层 ≤6 模块"红线 + 每阶段评审 |
| PRD 质量差导致偏题 | 中 | acceptance_criteria 必须可测试 + 可选人工 Gate |

---

## 执行路径与估时

| 阶段 | Task | 估时 | 依赖 |
|------|------|------|------|
| P0 | Task 1-3: 地基 | 2天 | 无 |
| P1 | Task 4: PRD 引擎 | 3天 | P0 |
| P2 | Task 5: 循环引擎 | 3天 | P1 |
| P3 | Task 6-7: 记忆+续航 | 3天 | P2 |
| P4 | Task 8: 纪律+安全 | 2天 | P3 |
| P5 | Task 9-12: 质量+客户端+角色+Hook | 4天 | P3-P4 |
| P6 | Task 13-15: MCP+CLI+编排+迁移 | 3天 | P5 |
| P7 | Task 16: 端到端验收 | 2天 | P6 |
| P8 | Task 17: 跨模型测试 | 2天 | P7 |

**总计约 3 周**，P0-P3 为自动续航最小可用闭环（8天），其余并行推进。

---

## 每层竞品借鉴详细映射

### L0 平台层 — 客户端适配与能力对齐

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **Trellis (mindfold-ai)** | - | 17 平台支持、Spec 自动注入、降级策略 | `L0_platform/` spec-injection + 降级链 |
| 2 | **superpowers-zh (jnMetaCode)** | - | 18 工具适配、中文规则 | `L0_platform/` zh-clients + i18n |
| 3 | **Trellis init** | - | `trellis init --cursor --opencode --codex` 多平台初始化 | `aza init --client=cursor,claude-code` |
| 4 | **superpowers (obra)** | 200K+ | 11 客户端插件安装(Claude/Cursor/Codex/Droid/Copilot/Kimi/Pi等) | `templates/clients/` 16+ 客户端模板 |
| 5 | **OpenSpec** | - | 30+ 工具支持、slash 命令跨工具 | 客户端能力矩阵+MCP 统一接口 |

**关键设计**：AzaLoop 的 MCP Server 是能力均衡器。无论客户端缺少 Hook/Rules/Skills/循环，MCP 工具都能补齐。这是 Trellis 和 superpowers 都未做到的 — 它们依赖客户端原生能力，AzaLoop 用 MCP 补偿客户端缺陷。

### L1 规范层 — PRD 引擎与文档生成

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **create-prd-skill (pmYangKun)** | - | 14 章 B 端 PRD 模板、产品定型(商业化/自研)、复杂度分级(L1-L4)、阶段化生成、Mermaid 图表、自检清单 | `L1_spec/prd-generator.ts` 14 章模板+复杂度感知 |
| 2 | **check-prd-skill (pmYangKun)** | - | 14 维度 PRD 审查、P0-P3 分级、Top 10 改进建议、产品类型差异化审查 | `L1_spec/prd-checker.ts` 质量审查引擎 |
| 3 | **agent-skills (addyosmani)** | 48K+ | /spec(需求定义) /plan(任务拆分) /build(增量构建) 全链路 | `L1_spec/` spec→plan→build 链路 |
| 4 | **spec-kit (github)** | - | Constitution 宪法、change→spec→design→tasks 变更管理 | `L1_spec/constitution.yaml` + `change-management.ts` |
| 5 | **OpenSpec (Fission-AI)** | - | propose→specs→design→tasks→archive、Stores 跨仓库 | `L1_spec/specs/` 变更提案+归档 |
| 6 | **ralphy-openspec** | - | /ralphy-plan(创建spec) → /ralphy-implement → /ralphy-validate → /ralphy-archive | `aza_prd` + `aza_loop` 四阶段 |
| 7 | **mattpocock/skills** | - | to-prd(PRD落地为GitHub Issue)、to-issues(任务拆分) | `L1_spec/` PRD→Story 拆解 |
| 8 | **pm-claude-skills (mohitagw)** | - | PM 工作流技能、需求管理、迭代规划 | `L5_skill/` PM 技能组 |

**关键设计**：PRD 生成采用 create-prd-skill 的 14 章模板+复杂度分级（L1 配置级/L2 规则级/L3 模块级/L4 系统级），审查采用 check-prd-skill 的 14 维度+P0-P3 分级。两个工具形成闭环：create 生成初稿 → check 审查漏洞 → 迭代优化。

### L2 记忆层 — 三层 Reflexion 记忆

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **agentmemory (rohitg00)** | 20K+ | 四层记忆(Working/Episodic/Semantic/Procedural)、向量索引、LongMemEval R@5=95.2%、Token 消耗降92% | `L2_memory/` 四层记忆架构+向量检索 |
| 2 | **cognee (topoteretes)** | 26K+ | 开源 AI 记忆平台、知识图谱引擎、语义检索+结构化记忆融合 | `L2_memory/long-term-memory.ts` 语义记忆 |
| 3 | **planning-with-files (OthmanAdi)** | - | 三文件(task_plan/findings/progress)+SHA-256 校验 | `L2_memory/` 三件套+CHECKSUMS.json |
| 4 | **memloop (queyue0728)** | - | 跨终端跨智能体记忆、Git 持久化、一个文件无限记忆 | `L2_memory/` 跨客户端记忆共享 |
| 5 | **Trellis (mindfold-ai)** | - | .trellis/workspace/ 项目记忆、journals 会话日志 | `L2_memory/project-memory.ts` |
| 6 | **OpenSpec** | - | openspec/ 规格沉淀、archive 归档 | `L2_memory/long-term-memory.ts` 规格记忆 |

**关键设计**：借鉴 agentmemory 的四层架构（Working/Episodic/Semantic/Procedural），在 PRD 的三层基础上增加 Procedural（程序记忆 — 沉淀工作流和决策模式）。SHA-256 校验来自 planning-with-files。跨客户端记忆共享来自 memloop 的 Git 持久化思路。

### L3 角色层 — 8 核心角色

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **agency-agents (msitarzewski)** | 120K+ | 144 个专业 AI Agent 角色、12 部门、Shell+Markdown 极简、跨工具兼容 | `L3_roles/` 186 扩展角色库 |
| 2 | **gstack (garrytan)** | - | 21 个 AI Agent、Think→Plan→Build→Review→Test→Ship→Reflect 工作流 | `L3_roles/8-core.md` 8 核心角色 |
| 3 | **agent-skills (addyosmani)** | 48K+ | DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP 6 阶段 | `L3_roles/` 角色到阶段映射 |
| 4 | **agency-orchestrator (jnMetaCode)** | - | 多 Agent 编排协调、任务分派 | `L3_roles/dynamic-binder.ts` 角色路由 |

**关键设计**：8 核心角色来自 gstack（think/plan/build/review/test/ship/observe/decide），186 扩展角色来自 agency-agents 的 144 角色。角色不是独立 Agent 进程，而是 prompt 注入 — 保持精简。

### L4 纪律层 — 4 铁律 + 8 反借口 + 3-Strike

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **superpowers (obra)** | 200K+ | TDD 铁律("NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST")、Red Flags、Common Rationalizations 借口反驳表、verification-before-completion 验证铁律 | `L4_discipline/iron-rules.md` + `anti-rationalizations.md` |
| 2 | **andrej-karpathy-skills (forrestchang)** | - | 4 铁律(不假设/最小化/精准/目标驱动)、70 行 Markdown 犯错率从41%→3% | `L4_discipline/iron-rules.md` 4 铁律 |
| 3 | **agent-skills (addyosmani)** | 48K+ | Anti-Rationalization 表格("写什么spec直接开干"→"没有spec的代码是技术债")、每 skill 带 RedFlags+Rationalizations | `L4_discipline/anti-rationalizations.md` 8 反借口 |
| 4 | **superpowers-zh (jnMetaCode)** | - | 中文纪律规则、18 工具适配 | `i18n/zh-CN/rules.md` 中文铁律 |

**关键设计**：铁律措辞采用 superpowers 的绝对性设计（"NO"/"Delete it"/"Start over"），不是"尽量避免"。反借口表格来自 agent-skills 的 Common Rationalizations — 预判 AI 可能找的借口并写好反驳。3-Strike 来自 superpowers 的"同一错误3次停止"。

### L5 技能层 — 8 段式 Skill 模板

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **anthropics/skills** | 108K+ | 官方技能集合、四大类别、SKILL.md 开放标准 | `L5_skill/` SKILL.md 标准 |
| 2 | **agent-skills (addyosmani)** | 48K+ | 8 段式(Frontmatter→Overview→When→Process→Examples→Rationalizations→RedFlags→Verification)、20 个 skill、7 个 slash 命令 | `L5_skill/templates/SKILL-TEMPLATE.md` 8 段式 |
| 3 | **mattpocock/skills** | - | 21 个 Skills、to-prd/tdd/git-guardrails、npx skills@latest add 一键安装 | `L5_skill/registry.ts` 安装+管理 |
| 4 | **claude-skills (Fokkyp)** | - | Skill 调用、组合、依赖管理 | `L5_skill/composer.ts` Skill 组合 |
| 5 | **Commonly-used-high-value-skills (seaworld008)** | - | 多分类技能库、OpenClaw 兼容导出、快照校验 | `L5_skill/` 多分类+版本校验 |
| 6 | **create-prd-skill / check-prd-skill** | - | PM 技能组(PRD生成/审查)、14章模板+14维度审查 | `L5_skill/core-skills/prd/` |
| 7 | **pm-claude-skills (mohitagw)** | - | PM 工作流技能、需求管理、迭代规划 | `L5_skill/core-skills/` PM 技能 |

**关键设计**：8 段式 Skill 模板来自 agent-skills，这是最核心的借鉴 — Frontmatter/Overview/When/Process/Examples/Rationalizations/RedFlags/Verification 八段结构。6 核心文档 Skill（prd/arch/db/api/test/deploy）融合 create-prd-skill 的 14 章模板和 check-prd-skill 的 14 维度审查。

### L6 安全层 — 8 层防御

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **shellward (jnMetaCode)** | - | 8 层防御(密钥/SQL注入/XSS/依赖/代码注入/PathTraversal/反序列化/SSRF)、Policy-as-Code | `L6_security/scanners/` 8 个扫描器 |
| 2 | **GitHub Secret Scanning** | - | 密钥扫描(200+token类型/180+服务商)、推送保护、AI检测非结构化密码 | `L6_security/scanners/secret.ts` 密钥扫描 |
| 3 | **GitHub Code Scanning** | - | CodeQL 代码漏洞扫描、Copilot Autofix 自动修复 | `L6_security/scanners/code-injection.ts` |
| 4 | **strix (usestrix)** | 29K+ | AI 渗透测试、自然语言→安全扫描全流程 | `L6_security/` 安全扫描流程 |
| 5 | **CodeRabbit** | - | AI PR 审查、inline 建议、安全扫描 | `L6_security/` 提交前扫描 |
| 6 | **Qodo** | - | 安全分析、PR 验证 | `L6_security/` 质量门禁 Gate4 |
| 7 | **agent-skills (addyosmani)** | 48K+ | security-and-hardening skill(OWASP Top 10/认证/Secrets/三层边界) | `L6_security/` 安全检查清单 |

**关键设计**：8 层防御来自 shellward，密钥扫描参考 GitHub Secret Scanning 的 200+ token 类型。安全扫描作为质量门禁 Gate4，blocker 级立即终止循环。

### L7 循环层 — 5 阶段状态机

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **comet (rpamis)** | - | 5 阶段状态机(open→design→build→verify→archive)、/comet 恢复指令、Guard 守卫、HEARTBEAT | `L7_loop/state-machine.ts` + `guards.ts` |
| 2 | **ralphy-openspec** | - | Ralph Loop(AI反复执行直到完成)、STATUS.md 实时状态、BUDGET.md 预算、TASKS.md 任务看板 | `L7_loop/loop-controller.ts` Ralph Loop |
| 3 | **loop-engineering (cobusgreyling)** | - | 7 循环模式(daily_triage/pr_babysitter/ci_sweeper等)、5 building blocks(Automations/Worktrees/Skills/Plugins/Sub-agents)+Memory、loop-audit 评分 | `L7_loop/` 循环模式+审计 |
| 4 | **loop-init (cobusgreyling)** | - | `npx loop-init` 脚手架+预算文件+Loop Ready 评分 | `aza init` + `aza audit` |
| 5 | **loop-cost (cobusgreyling)** | - | Token 花费估算器 | `L7_loop/` 预算追踪 |
| 6 | **agentmemory** | 20K+ | Token 消耗降92%的基准验证 | `L7_loop/` 循环效率验证 |

**关键设计**：5 阶段状态机来自 comet，Ralph Loop 自循环模式来自 ralphy-openspec（AI 反复执行同一 prompt 直到任务完成）。loop-engineering 的 5 building blocks + Memory 理论指导整体架构。next_action 链是 AzaLoop 原创 — 将 comet 的状态机和 ralphy-openspec 的 Ralph Loop 统一为 MCP 工具的 next_action 返回值。

### L8 编排层 — 蜂群+Worktree+模型路由（接口预留）

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **ruflo (ruvnet)** | 45K+ | 蜂群编排(多Agent并行)、GitHub issue/PR/CI/CD/文档/测试/安全审计全流程 | `L8_orchestrator/swarm/` (接口) |
| 2 | **orca (stablyai)** | - | 并行 Worktree IDE、Claude/Codex/OpenCode 并排运行、手机监控 | `L8_orchestrator/worktree/` |
| 3 | **OpenSwarm** | - | Git Worktree 隔离+多角色流水线、Issue→PR 自动闭环、Linear 集成 | `L8_orchestrator/scheduler.ts` |
| 4 | **superpowers (obra)** | 200K+ | using-git-worktrees skill、dispatching-parallel-agents、subagent-driven-development | `L8_orchestrator/` 并行开发 |
| 5 | **Trellis** | - | Git Worktree 并行(来自 Trellis 设计) | `L8_orchestrator/worktree/manager.ts` |

**关键设计**：MVP 仅预留接口，不实现蜂群编排。Worktree 并行标记为 `enabled:false`。接口与类型保留，后续版本填充。

### L9 知识层 — 66 编程技巧 + 上下文感知注入

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **ai-coding-guide (jnMetaCode)** | - | 66 编程技巧、工具选择矩阵 | `L9_knowledge/66-techniques.md` |
| 2 | **awesome-harness-engineering (ai-boost)** | - | Harness Engineering 综合、Context Injection 实践、Terminal Bench 排名提升 | `L9_knowledge/injection-engine.ts` |
| 3 | **agent-knowledge-framework** | - | 独立知识库、结构化可检索、跨项目复用 | `L9_knowledge/` 知识库结构 |
| 4 | **Trellis** | - | .trellis/spec/ 规范注入、trellis-update-spec 学习沉淀 | `L9_knowledge/` 知识沉淀 |
| 5 | **Context Engineering (Karpathy)** | - | 动态上下文编排、上下文管道构建 | `L9_knowledge/injection-engine.ts` |

**关键设计**：66 技巧来自 ai-coding-guide，上下文感知注入借鉴 Context Engineering 理论 — 按 Story 类型动态选择技巧注入。MVP 用规则匹配，语义权重后续升级。

### Hook 横切层 — 9 事件链

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **loop-engineering (cobusgreyling)** | - | 5 building blocks+Memory、事件总线(session-start→pre-tool→post-tool→...) | `Hook/event-bus.ts` 事件总线 |
| 2 | **comet (rpamis)** | - | Hook 事件链、状态机转换触发 | `Hook/events/` 事件处理器 |
| 3 | **Trellis** | - | 4-phase loop(plan→implement→verify→finish) 事件 | `Hook/events/` 阶段事件 |
| 4 | **superpowers** | 200K+ | session-start hook(subagent+skills 自动激活)、compaction 后重新注入 | `Hook/events/session-start.ts` |
| 5 | **loop-audit (cobusgreyling)** | - | Loop Ready 评分、约束+治理评分 | `Hook/` 审计+评分 |

**关键设计**：9 事件链来自 loop-engineering 的事件总线。T1 客户端原生触发，T2/T3 通过 MCP 补偿。on-stop 事件在 T2/T3 采用"每次工具调用后预写 RESUME"策略。

### 质量门禁 — 五级 Pipeline

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **superpowers (obra)** | 200K+ | TDD RED-GREEN-REFACTOR、test-driven-development skill、verification-before-completion skill | `quality/gates/gate2-test.ts` TDD 强制 |
| 2 | **agent-skills (addyosmani)** | 48K+ | /test(测试) /review(代码审查) /code-simplify(简化) slash 命令 | `quality/gates/` 质量检查 |
| 3 | **agent-skills security-and-hardening** | 48K+ | OWASP Top 10、三层边界系统、认证模式 | `quality/gates/gate4-security.ts` |
| 4 | **ralphy-openspec** | - | /ralphy-validate 验收标准验证 | `quality/gates/gate5-acceptance.ts` |
| 5 | **CodeRabbit / Qodo** | - | AI PR 审查、inline 建议 | `quality/gates/gate1-lint.ts` |

**关键设计**：五级 Pipeline(静态分析→测试→回归→安全→验收)来自 PRD 2.3 节。TDD 强制来自 superpowers 的 RED-GREEN-REFACTOR。验收对照来自 ralphy-openspec 的 /ralphy-validate。

### 续航机制 — MCP 能力补偿 + RESUME

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **comet (rpamis)** | - | /comet 恢复指令、断点恢复 | `continuity/` aza continue |
| 2 | **ralphy-openspec** | - | Ralph Loop 续跑、STATUS.md 实时状态、state.db 任务账本 | `continuity/resume-generator.ts` |
| 3 | **Trellis** | - | /trellis:finish-work 归档+日志、workspace journals | `continuity/catchup-protocol.ts` |
| 4 | **planning-with-files** | - | 三文件持久化、SHA-256 校验 | `continuity/` 状态文件 |
| 5 | **memloop** | - | 跨终端跨智能体记忆、Git 持久化 | `continuity/` 跨客户端续跑 |
| 6 | **loop-context (cobusgreyling)** | - | 有状态记忆管理+断路器(circuit breaker) | `continuity/` 断路器 |

**关键设计**：三链路续航是 AzaLoop 原创 — next_action 链(通用)+Stop Hook+RESUME(T1)+MCP continue 工具补偿(T2/T3)。跨客户端/跨模型通过文件状态持久化实现，不依赖特定 LLM。

### MCP 能力对齐层 — 核心差异化

| # | 来源项目 | Stars | 借鉴点 | 落地到 AzaLoop |
|---|---------|-------|--------|---------------|
| 1 | **AzaLoop 原创设计** | - | MCP Server 即能力均衡器 — 补偿客户端缺陷 | `mcp-server/` 全部工具 |
| 2 | **OpenSpec** | - | 30+ 工具 slash 命令统一 | MCP 统一接口 |
| 3 | **superpowers** | 200K+ | 11 客户端插件安装(但仍依赖原生能力) | MCP 补偿原生能力缺陷 |
| 4 | **Trellis** | - | 17 平台支持(但仍需平台原生 Rules) | MCP 补偿无 Rules 客户端 |

**关键差异化**：所有竞品都依赖客户端原生能力(Hook/Rules/Skills)。AzaLoop 独创 MCP 能力补偿 — 无 Stop Hook 用 aza_continue 补偿，无 Rules 用 aza_context calibrate 补偿，无 Skills 用 aza_skill search 补偿，无循环用 aza_loop next + next_action 补偿。这是 AzaLoop 相对于所有竞品的核心壁垒。
