# AzaLoop × AssLoop 融合方案：兼容 v8/v9 十层架构的完整开发计划

> 目标：在「AzaLoop v2.0 宿主优先精简实现」之上，**完整保留并兼容 AssLoop v8/v9 的 10 层 + 1 横切架构**，
> 让两层诉求共存：十层作为「规范/宪法模型」，精简核心作为「落地实现」。
> 日期：2026-07-11 | 状态：设计稿

---

## 1. 设计哲学：规范层 ≠ 实现层

v8/v9 的 10 层架构与 AzaLoop v2.0 的精简核心**不是对立关系**，而是两个不同抽象层级：

```
┌─────────────────────────────────────────────────────────────┐
│  规范层（Specification Layer）  ← AssLoop v8/v9 的 10 层       │
│  作用：定义「系统必须由哪些能力维度组成」、层间契约、Guard、   │
│        宪法、纪律、记忆契约。是给 AI 和配置阅读的「宪法」。     │
│  形态：yaml 配置 + SKILL.md + bootstrap-rule.md + 状态分片     │
└─────────────────────────────────────────────────────────────┘
                          ▼ 映射
┌─────────────────────────────────────────────────────────────┐
│  实现层（Implementation Layer）  ← AzaLoop v2.0 精简核心       │
│  作用：用最少模块把规范层的能力真正跑起来。                    │
│  形态：packages/core 下的 <30 个 TS 模块 + MCP Server 暴露。   │
└─────────────────────────────────────────────────────────────┘
```

**核心原则**：
1. 十层是**配置与契约**，不是 80 个目录。每层 = 一组 MCP 工具 + 一段 Prompt 规则 + STATE 里的一个分片。
2. 任一层的「能力」都通过统一的 `aza_*` MCP 工具暴露给 16 个客户端，宿主 LLM 无需感知层编号。
3. `hyperloop.yaml`（v8/v9）与 `.aza/config.json`（v2.0）合并为单一 `azaloop.yaml`，`layers.*.enabled` 控制每层开关——**向后兼容 v8/v9 配置，同时保留 v2.0 的 loop 参数**。

---

## 2. 十层 ↔ 精简模块 完整映射

| 层 | v8/v9 职责 | 实现模块（core/） | 暴露的 MCP 工具 | STATE 分片 |
|----|-----------|-----------------|---------------|-----------|
| **L0 平台** | 16 客户端适配 + 代码智能 + 多项目 | `host/` | `aza_host`(detect/adapter) | `platform` |
| **L1 规范** | Spec 先行 + 宪法 + 变更管理 + PRD | `prd/` | `aza_prd`(generate/save/check/evolve) | `pipeline.open` |
| **L2 记忆** | 三层记忆 + SHA-256 + 压缩 | `memory/` | `aza_memory`(query/list/compress) | `memory` |
| **L3 角色** | 8 核心 + 186 扩展角色动态绑定 | `prompt/`(roles) | `aza_role`(assign) | `current_role` |
| **L4 纪律** | 4 铁律 + 8 反借口 + 3-Strike | `prompt/`(rules) + `quality/` 前置 | （注入式，无独立工具） | `strikes` |
| **L5 技能** | 6 核心 + 6 中国 + 8 段式解剖 + 文档 | `skill/` | `aza_skill`(search/list) | `skills_loaded` |
| **L6 安全** | 8 层防御 + Policy-as-Code + 审计 | `security/` | `aza_security`(scan/report) | `security_findings` |
| **L7 循环** | 状态机 + Guard + 续航 + 硬性终止 | `loop/` + `continuity/` | `aza_loop`(next/status/turbo) | `pipeline`(全) |
| **L8 编排** | 蜂群 + Worktree + 模型路由 | `execution/`(接口预留) | `aza_workflow`(compose/run) | `orchestration` |
| **L9 知识** | 66 技巧 + 上下文感知注入 | `knowledge/` | `aza_knowledge`(inject) | `knowledge_used` |
| **Hook 横切** | session-start→…→on-stop 事件链 | `continuity/` + `audit/` | （Hook 触发，非工具） | `events` |

**兼容性结论**：v8/v9 的每一层都能在精简核心里找到落点；L8 编排在 MVP 仅预留接口（Worktree/模型路由后置），不破坏十层完整性。

---

## 3. 统一配置模型（兼容双规格）

`azaloop.yaml`（合并产物，根目录）：

```yaml
# —— v8/v9 十层开关（规范层）——
version: "10.0"            # 兼容 v8/v9 的 version 字段
project_name: "my-app"

layers:
  L0_platform:     { enabled: true }
  L1_spec:         { enabled: true }
  L2_memory:       { enabled: true }
  L3_roles:        { enabled: true }
  L4_discipline:   { enabled: true }
  L5_skills:       { enabled: true }
  L6_security:     { enabled: true }
  L7_loop:         { enabled: true }
  L8_orchestration:{ enabled: false }   # 接口预留
  L9_knowledge:    { enabled: true }

# —— v2.0 循环参数（实现层）——
loop:
  max_iterations: 50
  full_auto: true
  auto_test: true
  auto_review: true
  retry_count: 3

quality:
  lint: true
  test: true
  build: true
  security: false

memory:
  enabled: true
  max_episodic: 100
  max_semantic: 500

# —— v8/v9 兼容性字段（解析时忽略未知项）——
token_budget: { warning_threshold: 0.8, block_threshold: 0.95 }
gates:
  gate_1_prd_review:   { require_approval: false }   # full_auto 下默认免审
  gate_2_design_review:{ require_approval: false }
  gate_3_final_acceptance: { require_approval: false }
```

读写该配置的模块同时识别 `hyperloop.yaml` 旧字段名，保证 v8/v9 项目 `assloop init` 升级后可直接被 AzaLoop 读取（迁移脚本见 §7）。

---

## 4. 十层在「自动续航」中如何贯穿（核心诉求落地）

自动续航（跨客户端/跨会话/跨模型）不是某层的职责，而是**十层状态全量持久化 + Hook 横切驱动**：

### 4.1 状态全量落盘（L0–L9 都在 STATE 里）
`.aza/STATE.yaml` 同时包含 v8/v9 的 `pipeline`（5 阶段）与 v2.0 的 `loop` 进度：
```yaml
pipeline:
  current_stage: "build"        # v8/v9 5 阶段
  stages: { open:{status:completed}, design:{status:completed}, build:{status:in_progress, current_task:"T005"} }
loop:                              # v2.0 迭代视角
  iteration: 12
  progress: "60%"
  current_story: "STORY-003"
memory:                            # L2
  episodic_ref: "ep-2026-07-11-03"
security_findings: []             # L6
strikes: 0                        # L4
```
换客户端（Cursor→Claude Code→Trae）即换宿主模型，但 STATE 文件不变 → **跨模型续航天然成立**。

### 4.2 Hook 横切事件链（v8/v9 完整 9 事件 → 映射到实现）
| v8/v9 Hook | 实现触发点 | 动作 |
|-----------|-----------|------|
| session-start | 宿主加载 continue.md | 读 STATE → 注入 L1/L2/L3/L9 上下文 |
| pre-tool | `aza_*` 工具调用前 | L4 纪律校验 + L6 工具权限检查 |
| post-tool | 工具调用后 | L2 写进度 + 更新 HEARTBEAT |
| pre-commit | git commit 前 | L6 全量安全扫描 + L4 提交规范 |
| post-task | Story 完成 | L7 推进 pipeline + L2 压缩 |
| pre-phase / post-phase | 阶段切换 | L7 Guard 检查 + L5 文档生成 |
| on-error | 错误 | L2 记录 + L7 三振判定 + L9 建议 |
| on-stop | 会话结束 | **生成 RESUME.md + 快照**（续航关键） |

### 4.3 next_action 链（v2.0 引擎）与 v8/v9 `/assloop:continue` 等价
- v2.0：`aza_loop next` 返回 `next_action`，宿主自动续调。
- v8/v9：`/assloop:continue` 指令读取 STATE 续跑。
- **融合**：`aza_loop next` 内部即执行 v8/v9 的 `continue` 逻辑（Guard 检查→下一任务）。两条入口行为一致，老用户可用老指令，新用户用 MCP 工具。

---

## 5. 各层「规范→实现」详细落地

### L0 平台层
- 规范：capability-matrix.yaml（16+ 客户端分级）、cli-commands.yaml、workspace/ 多项目。
- 实现：`host/` 探测 `.cursor/`、`.claude/`、`.trae/` 等指纹 → 选择 adapter → 注入对应 rules/skill/hook 模板。
- 兼容：保留 v8/v9 的 tier_1~tier_4 分级与 `supports_full_pipeline` 字段。

### L1 规范层
- 规范：constitution.yaml + PRD + specs/{feature}.yaml（spec-kit/OpenSpec）。
- 实现：`prd/` 生成 Markdown+JSON 双格式 PRD；acceptance_criteria 即 v8/v9 的 guard 输入。
- 融合点：v8/v9 的「PRD First」规则直接成为 `aza_prd generate` 的强制前置。

### L2 记忆层
- 规范：三层记忆（工作/情景/长期）+ SHA-256 + 压缩 + RAG 检索。
- 实现：MVP = 工作(STATE) + 情景(`.aza/memory/episodic/`) + 语义(`.aza/memory/semantic/`)；RAG 检索后置，先用关键词匹配。
- 兼容：文件结构对齐 v8/v9 的 `task_plan.md/findings.md/progress.md` 命名，便于老项目迁移。

### L3 角色层
- 规范：think/plan/build/review/test/ship/retro/security 八角色。
- 实现：`prompt/roles/` 下 8 个 md，由 `aza_role assign` 在 pre-task 注入对应系统提示；不做独立 Agent 进程（保持精简）。

### L4 纪律层
- 规范：4 铁律 + 8 反借口 + 3-Strike + 硬性终止。
- 实现：`prompt/rules/bootstrap-rule.md` 常驻注入；`quality/` 门禁前置检查；`strikes` 计数在 STATE，3 次同错停循环。

### L5 技能层
- 规范：6 核心 + 6 中国 + 8 段式解剖 + 文档生成组。
- 实现：`skill/` 目录按 8 段式存放 SKILL.md；`aza_skill search` 供宿主按需调用；文档生成（prd/arch/db/api…）作为 skill 子集，P2 阶段实现。

### L6 安全层
- 规范：8 层防御（数据出境/密钥/PII/等保/SQL注入/XSS/依赖/代码注入）+ 审计报告。
- 实现：`security/` 正则 + AST 扫描，作为质量门禁 Gate4；blocker 级立即终止循环并写 `security_findings`。

### L7 循环层（融合核心）
- 规范：5 阶段状态机 + Guard + HEARTBEAT + 硬性终止 + `/assloop:continue`。
- 实现：`loop/` 状态机驱动 `aza_loop next`；`continuity/` 负责 Stop Hook + RESUME；硬性终止条件见 §4.1 表格。
- **这是 v8/v9 与 v2.0 的真正交汇点**：v2.0 的「Story 循环」运行在 v8/v9 的「5 阶段 pipeline」之内。

### L8 编排层（接口预留，不破坏十层）
- 规范：蜂群 + Git Worktree + 模型路由 + 人机门禁。
- 实现：MVP 仅实现 `aza_workflow compose/run` 的 DAG 描述与串行执行；Worktree 并行、模型路由、swarm 标记为 `enabled:false`，接口与类型保留，后续版本填充。

### L9 知识层
- 规范：66 技巧 + 上下文感知注入引擎。
- 实现：`knowledge/` 按阶段/错误/决策触发注入对应 tips md；MVP 用规则匹配，语义权重后续升级。

### Hook 横切层
- 规范：9 事件链 + 层间事件总线。
- 实现：`continuity/` 注册各事件钩子；`audit/` 记录事件日志供复盘。

---

## 6. 客户端适配（十层 + 精简共同要求）

16 客户端统一通过「MCP Server + 规则文件 + Hook」三件套接入，十层规范自动随规则文件注入：

| 客户端 | 接入 | 十层如何生效 |
|--------|------|------------|
| Cursor | MCP + `.cursor/rules/` + Stop Hook | rules 注入 L1/L4，Hook 触发续航 |
| Claude Code | Plugin(Skills+Agents+Hooks+MCP) | 同上，Hook 最强 |
| Trae/Windsurf | MCP + rules | 规则注入，无原生 Hook 用 RESUME 兜底 |
| VS Code/Cline/Roo/OpenCode… | MCP + rules | 同 Trae |
| 未知客户端 | 通用适配（cli 探测） | 降级为规则文件模式 |

**关键**：无论哪个客户端，宿主 LLM 看到的都是同一套「十层规则 + MCP 工具」，因此跨客户端行为一致。

---

## 7. 迁移与升级路径（兼容 v8/v9 旧项目）

```bash
aza upgrade --from v8or9 --to v10
```
步骤：
1. 备份 `.hyperloop/` → `.hyperloop.bak/`
2. `hyperloop.yaml` 字段映射到 `azaloop.yaml`（layers 开关 + loop 参数合并）
3. `STATE.yaml` 增加 `loop` 分片（默认从 pipeline 推导）
4. `bootstrap-rule.md` 复制为 `prompt/rules/`，保留 v8/v9 全部铁律
5. `L2_memory/tasks/*` 重命名为 `.aza/memory/episodic/`（兼容旧命名软链接）
6. 生成 `migration-report.md`，`aza validate` 通过后完成

v8/v9 用户无需重写任何规则即可在融合方案下运行。

---

## 8. 构建计划（十层与精简同步交付）

每阶段**同时**交付「层规范（yaml/md）+ 实现模块 + MCP 工具」，保证兼容不悬空：

| 阶段 | 交付的层（规范+实现） | 模块 | 验收 |
|------|---------------------|------|------|
| **P0** | 基础设施 | shared + state(SHA-256) | STATE 可存可读 |
| **P1** | L1 规范 + L7 循环(骨架) | prd + loop | "Todo 应用"→prd.json + 状态机 |
| **P2** | L4 纪律 + L6 安全 + L7 续航 | prompt/rules + security + continuity | 单 Story 循环到 done + 杀会话续跑 |
| **P3** | L2 记忆 + L9 知识 | memory + knowledge | 二次会话错误率↓ |
| **P4** | L0 平台 + L3 角色 + L5 技能 | host + prompt/roles + skill | 16 客户端模板 + 角色注入 |
| **P5** | Hook 横切 + L8 接口 | continuity/audit + execution(接口) | 9 事件链跑通 |
| **P6** | 端到端 + 迁移 | mcp-server + 迁移脚本 | 贪吃鼠游戏全自动 + v8 项目升级通过 |
| **P7** | 文档生成 Skill 组 | skill/docs-gen | PRD/架构图/CHANGELOG 自动产出 |

**红线**：任一阶段结束时，`aza audit` 必须报告十层 enabled 状态与实现覆盖率；未实现层标 `interface_only`。

---

## 9. 兼容性验收矩阵

| 维度 | v8/v9 期望 | 融合方案落点 | 是否兼容 |
|------|-----------|------------|---------|
| 十层架构 | 10 层+1 横切 | layers.* 全保留 | ✅ |
| STATE.yaml 状态机 | 5 阶段 + Guard | L7 实现 | ✅ |
| /assloop:continue | 续跑指令 | 等价于 aza_loop next | ✅ |
| bootstrap 铁律 | 4 铁律 + 8 反借口 | prompt/rules 常驻 | ✅ |
| 16 客户端 | tier1–4 分级 | host/ 适配 | ✅ |
| 三层记忆 | 工作/情景/长期 | memory/ | ✅（RAG 后置） |
| 8 层安全 | blocker 终止 | security/ Gate4 | ✅ |
| 模型路由/蜂群 | 概念 | L8 接口预留 | ⚠️（接口兼容，实现后置） |
| 宿主零配置 | —（v2.0 独有） | MCP 复用宿主 LLM | ✅ 新增能力 |

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 十层变回重架构 | 层仅作配置/契约，禁止为每层建独立目录；`aza audit` 监控模块数 <30 |
| 规范与实现脱节 | 每阶段同步交付规范+实现，验收矩阵强制对齐 |
| 旧 v8/v9 项目迁移失败 | 迁移脚本 + `aza validate` 双校验 + 备份 |
| 宿主不遵守层规则 | prompt 强化 + Hook 兜底 + 门禁拦截 |

---

## 11. 结论

融合方案做到：**用 AzaLoop v2.0 的精简核心把 AssLoop v8/v9 的十层架构真实跑起来**。
十层不再是 80 个目录的愿景，而是「一组 MCP 工具 + 一组 Prompt 规则 + STATE 里的分片」。
用户的全部核心诉求（跨客户端/跨会话/跨模型自动续航、输入一句话产工业级应用）在十层框架内完整成立，
且旧 v8/v9 项目可零重写升级。

> 本方案与 `docs/PROJECT-PLAN.md`（精简版）互补：精简版是「最小可用」，本方案是「十层兼容版」。
> 推荐先按精简版跑通 P0–P3，再用本方案补齐 L0/L3/L5/L8/Hook，实现完整十层兼容。
