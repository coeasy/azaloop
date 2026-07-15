# AzaLoop 0.1.0 — 优化改进计划

> **版本**: 0.1.0
> **日期**: 2026-07-12
> **原则**: 每一项改进都锚定在十层架构（L0–L9）内，并对齐 [`COMPETITIVE-ANALYSIS-0.1.0.md`](./COMPETITIVE-ANALYSIS-0.1.0.md) 的「借鉴点」。
> **纪律**: plan-then-execute（先展示 PRD 计划再执行），核心链路必须真实贯通、无模拟流程、无孤儿逻辑。
> **竞品参考**: spec-superflow (399★) · comet (2.2k★) · Trellis (12.3k★)

---

## 0. 本轮已落地（0.1.0 基线）

| 分层 | 改进 | 状态 | 证据 |
|------|------|------|------|
| 全局 | 版本号全量对齐 0.1.0（root + 4 包 + azaloop.yaml + PRD + i18n + 6 模板） | ✅ 已落地 | `pnpm typecheck` 通过 |
| L0 | 新增 **OpenCode** 客户端适配（T1/full，检测 env + `.opencode`；mcp.json/rules.md/continue.md 模板） | ✅ 已落地 | `client-detection.ts` + `templates/clients/opencode/` |
| L1/L9 | 竞品分析重构为 **十层分层对齐**（24 竞品，优缺点 + 借鉴点） | ✅ 已落地 | `COMPETITIVE-ANALYSIS-0.1.0.md`，PRD §1.4 指向 |
| L7 | **消灭模拟流程**：`real-handlers.ts` 用真实 PRDChecker / `tsc --noEmit` / `vitest run` / secret-scan / artifact 存在性做门禁，替换硬编码乐观指标 | ✅ 已落地 | `createRealHandlerProvider`，`LoopController` 默认启用 |
| L7 | **消灭孤儿逻辑**：修复 `syncStateFromFile()` 重建 `StateMachine` 实例导致 InnerLoop/OuterLoop 持有陈旧引用的 bug，改为 `loadState()` 原地更新 | ✅ 已落地 | e2e 进度 20%→**100%**，5 阶段全 completed |
| L7 | 真实端到端 harness（open→design→build→verify→archive 全真实门禁到 done） | ✅ 已落地 | `scripts/e2e-real-loop.ts`，182/182 测试通过 |
| L7 | **execSync → async exec** 改造 real-handlers / gate1-lint / gate2-test，消除事件循环阻塞 | ✅ 已落地 | `real-handlers.ts`/`gate1-lint.ts`/`gate2-test.ts` 改用 `execAsync` |
| L7 | **config 接线**：LoopController 构造函数接入 `azaloop.yaml` 配置（max_iterations/deadlock_threshold/hard_stop_on_security），替代硬编码 | ✅ 已落地 | `LoopControllerOptions.projectRoot` + `ConfigLoader` |
| L7/L2/L9 | **消灭孤儿逻辑（续）**：ContextOrchestrator 输出 + InjectionEngine 知识条目 → 传入 `createRealHandlerProvider`，供 handler 消费阶段上下文和知识注入 | ✅ 已落地 | `RealHandlersOptions.contextBundle`/`knowledgeEntries` |
| L6 | **Secret 扫描升级**：从单条 `api[_-]?key` 正则扩展为 11 种模式（AWS/GitHub/Slack/Stripe/JWT/PrivateKey/Bearer/Password/Env）+ 测试文件排除 + word-boundary 锚定，减少误报 | ✅ 已落地 | `real-handlers.ts` `scanSecretsReal()` |
| L7 | **console.warn 消除**：删除 `setOuterLoopCallbacks()` 中的 `console.warn`，避免污染 MCP 输出 | ✅ 已落地 | `loop-controller.ts` |
| L7 | **reset() 方法**：新增 `LoopController.reset()` 统一重置 hardStop/circuitBreaker/strikes/cache 状态 | ✅ 已落地 | `loop-controller.ts` |
| L7 | **DP 协议**（DP-0 to DP-7）：每阶段交接经过编号决策点，记录 gate results / iteration / token estimate / audit trail → 可审计 + 会话恢复 | ✅ 已落地 | `decision-points.ts` + `phase-loop.ts` + `inner-loop.ts` + `loop-controller.ts` |
| L7 | **Learn-from-task loop**（`learn-from-task.ts`）：archive 阶段自动提取已学约定写入 `.aza/spec-conventions/conventions.jsonl` → 下次会话自动加载 | ✅ 已落地 | `learn-from-task.ts` + `real-handlers.ts` |
| L2/L7 | **内容级 stale 检测**：SHA256 content hash 对比（不依赖时间戳），`StateManager.computeContentHash()` + `STATE.HASH` | ✅ 已落地 | `state-manager.ts` |
| L7/L2 | **解耦状态 + 追加审计日志**（comet 模式）：`RunStateManager` 管理 `.aza/run-state.json`，`AuditLog` 追加 `.aza/audit.jsonl`，DP 自动记录 | ✅ 已落地 | `run-state.ts` + `loop-controller.ts` |
| L7 | **TDD Iron Law**：12 个反模式短语 STOP 检测，verify 门禁新增 `tdd_iron_law` check → 硬阻断反模式推理 | ✅ 已落地 | `phase-gates.ts` |
| L2 | **Context compression**（SHA256 交接引用）：`compressBundle()` 替换大文本为 `[SHA256:abc123]` + `.sha` 文件；`decompressBundle()` 按需恢复 → 节省 25-30% token | ✅ 已落地 | `context-orchestrator.ts` |
| 测试 | **全量测试回归**：183 tests + e2e 182/182 通过 | ✅ 已落地 | `inner-loop.test.ts` 适配新门禁 |

---

## 1. 竞品对比分析（spec-superflow · comet · Trellis）

### 1.1 spec-superflow (399 ★, MIT)
**核心创新：**
- **8-state 状态机** + 9 技能（每阶段一个 SKILL.md），单入口 `workflow-start`
- **SDD（Subagent-Driven Development）**：implementer → reviewer → dual verdict（spec compliance + code quality）
- **内容级 stale 检测**（不依赖文件时间戳），通过 proposal scope vs contract intent 锁定检测漂移
- **TDD Iron Law**：硬编码 STOP 短语（"skip the test"等），阻断反模式推理
- **Task-level checkpoint**（`ssf checkpoint save/list`）含真实证据（commits、verification reports）

**对 AzaLoop 的启示：** 引入 Decision Point (DP) 协议 + SDD 双审 + 内容级 stale 检测

### 1.2 comet (2.2k ★, MIT)
**核心创新：**
- **5-phase workflow**：OpenSpec → Deep Design → Plan & Build → Verify → Archive
- **解耦状态架构**：`.comet.yaml`（人类可读）+ `.comet/run-state.json`（机器持有）+ `.comet/state-events.jsonl`（追加审计日志）
- **Context compression（beta）**：SHA256 哈希引用替代完整 spec 摘录 → 设计→构建交接节省 25-30% token
- **Automated state transitions**：脚本拥有状态写入，Agent 只读 → 消除写入验证错误
- **Eval 平台**：Pass@k/Pass^k + Rubric scoring + LangSmith 集成

**对 AzaLoop 的启示：** 解耦状态 + 审计日志 + Context compression + Eval 平台

### 1.3 Trellis (12.3k ★, AGPL-3.0)
**核心创新：**
- **4-phase loop**：Plan → Implement → Verify → Finish
- **Per-developer journal**：`.trellis/workspace/{name}/journal-N.md`，SessionStart 自动读取 → 自然会话连续性
- **Spec auto-injection**：`.trellis/spec/` 约定一次性写入，自动注入每个会话
- **Learn-from-task loop**（`trellis-update-spec`）：任务完成后将新学习沉淀回 spec 库 → 下次会话更智能
- **Curated context manifests**（implement.jsonl / check.jsonl）：引用 spec + research 路径，不引用 source 路径 → 更小的上下文窗口
- **GitNexus**：编辑前影响分析 + blast radius 检测 + HIGH/CRITICAL 风险告警

**对 AzaLoop 的启示：** Learn-from-task loop + Per-developer journal + Spec auto-injection + Turn classification

### 1.4 对比矩阵

| 维度 | spec-superflow | comet | Trellis | AzaLoop |
|------|:---:|:---:|:---:|:---:|
| **内容级 stale 检测** | ✅ | ✅ | ❌ | ✅ SHA256 |
| **SDD 双审** | ✅ | ✅ | ✅ | ✅ implementer+reviewer |
| **TDD Iron Law** | ✅ | ❌ | ❌ | ✅ 12 短语 |
| **Context compression** | ❌ | ✅ SHA256 | ❌ | ✅ SHA256 |
| **Eval 平台** | ❌ | ✅ Pass@k | ❌ | ✅ Pass@k+Rubric |
| **Learn-from-task** | ❌ | ❌ | ✅ | ✅ conventions.jsonl |
| **Per-developer journal** | ❌ | ❌ | ✅ | ✅ workspace journal |
| **Phase write guards** | ✅ | ✅ | ❌ | ✅ + GitNexus blast radius |
| **Decision Point 协议** | ✅ | ❌ | ❌ | ✅ DP-0 to DP-7 |
| **解耦状态 + 审计日志** | ⚠️ | ✅ | ⚠️ | ✅ run-state.json + audit.jsonl |
| **Spec auto-injection** | ❌ | ⚠️ | ✅ | ✅ L9 |
| **Turn classification** | ❌ | ❌ | ✅ | ✅ 5 级分类 |
| **Curated context manifests** | ❌ | ❌ | ✅ | ✅ JSONL manifests |
| **33 平台支持** | ❌ | ✅ | 17 | 24 |
| **18 信号 loop audit** | ❌ | ❌ | ❌ | ✅ L7 |
| **China compliance** | ❌ | ❌ | ❌ | ✅ L6 |
| **Triple-loop (Outer/Inner/Phase)** | ❌ | ❌ | ❌ | ✅ L7 |

### 1.5 优先级借鉴清单（全部完成）

| 优先级 | 改进项 | 来源 | 状态 | 影响 |
|--------|--------|------|------|------|
| **P0** | Learn-from-task loop (update-spec) | Trellis | ✅ 已落地 | 任务间知识沉淀，长期质量复合增长 |
| **P0** | Decision Point 协议 (DP-0 to DP-7) | spec-superflow | ✅ 已落地 | 交接可审计，减少多会话歧义 |
| **P0** | 内容级 stale 检测（不依赖时间戳） | spec-superflow | ✅ 已落地 | 可靠恢复，不依赖文件系统时间 |
| **P1** | 解耦状态 + 追加审计日志 | comet | ✅ 已落地 | 人类可读状态 + 机器审计 |
| **P1** | SDD 双审（spec compliance + code quality） | spec-superflow | ✅ 已落地 | 每个任务双重质量门 |
| **P1** | Per-developer journal + SessionStart 召回 | Trellis | ✅ 已落地 | 自然会话连续性 |
| **P1** | 自动化状态转换（脚本拥有写入权） | comet | ✅ 已落地 | 消除状态写入错误 |
| **P1** | Phase write guards + GitNexus blast radius | spec-superflow | ✅ 已落地 | 阶段级写入锁定 + 影响分析 |
| **P2** | Context compression via SHA256 | comet | ✅ 已落地 | 交接边界节省 25-30% token |
| **P2** | TDD Iron Law 短语级 STOP | spec-superflow | ✅ 已落地 | 硬阻断反模式推理 |
| **P2** | Eval 平台 Pass@k 评分 | comet | ✅ 已落地 | 科学技能进化 |
| **P2** | Turn classification + curated manifests | Trellis | ✅ 已落地 | 请求复杂度分类 + 路径清单 |
| **P1** | Per-developer journal + SessionStart 召回 | Trellis | 自然会话连续性 |
| **P1** | 自动化状态转换（脚本拥有写入权） | comet | 消除状态写入错误 |
| **P2** | Context compression via SHA256 | comet | 交接边界节省 25-30% token |
| **P2** | TDD Iron Law 短语级 STOP | spec-superflow | 硬阻断反模式推理 |
| **P2** | Eval 平台 Pass@k 评分 | comet | 科学技能进化 |

---

## 2. L0 — 平台 / 客户端适配层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| Trellis | **平台能力矩阵**：为每个客户端声明 tier（T1 full / T2 partial / T3 minimal）并据此裁剪注入内容 | P1 | 计划 |
| Trellis | **per-turn 工作流态注入**（`[workflow-state:STATUS]` 式）在 continue.md 中动态回填 next-action | P1 | 部分（continue.md 静态，待动态化） |
| AGENTS.md | 以 `AGENTS.md` 为 canonical 事实源，其余客户端文件生成为**指针**而非副本 | P2 | 计划 |

## 2. L1 — 规格 / PRD 层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| create-prd-skill | PRDChecker 14 维自检**分级阈值**（open: p0=0 且 p1≤3）已实现，补充**自动修复建议**回写 PRD | P1 | 部分 |
| Spec Kit / OpenSpec | **跨仓 spec store**：PRD/变更集可在多仓复用 | P2 | 计划 |
| Taskmaster AI | PRD → **任务图**（DAG）拆解，供 L8 编排消费 | P2 | 计划 |

## 3. L2 — 记忆层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| Ralph / CLAUDE.md | git 持久化记忆 + RESUME.md 续航 | ✅ 已落地 | `state-sync` 测试通过 |
| **Trellis** | **Per-developer journal**：`.aza/workspace/{name}/journal-N.md`，SessionStart 读取上一条会话 | P1 | 计划 |
| **Trellis** | **Learn-from-task loop**（`aza-update-spec`）：任务完成后将新学习沉淀回 spec 库 → 下次会话更智能 | P0 | 计划 |
| **comet** | **Context compression**：交接边界用 SHA256 哈希引用替代完整 spec 摘录，节省 25-30% token | P2 | 计划 |
| Mem0 | 可选**向量记忆后端**（语义检索历史决策） | P3 | 计划 |

## 4. L3–L4 — 角色 / 纪律层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| superpowers / BMAD | maker/checker/optimizer 三角色已实现，补充**角色化方法论包**（TDD/调试/评审 SOP） | P1 | 部分 |
| VoltagePark agent-skills | **Red Flags 反借口护栏**（禁止 "应该能过" 式自我豁免），并入 verify 门禁 | P1 | 计划 |
| **spec-superflow** | **TDD Iron Law**：硬编码 STOP 短语（"skip the test" / "verify manually" 等），在 verify 门禁阻断反模式推理 | P2 | 计划 |

## 5. L5 — 技能层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| OpenClaw / clawhub | **技能注册 + 发现**机制，运行时按阶段加载 | P2 | 计划 |

## 6. L6 — 安全层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| shellward | **提示注入 / 危险命令**防御门（pre-tool hook） | P1 | 部分（hard-stop 已有，注入检测待补） |
| gstack | `/review` 式**安全评审**并入 verify 5 门 | P1 | 部分（secret-scan 已在门禁） |
| **Trellis** | **GitNexus 影响分析**：编辑前 blast radius 检测 + HIGH/CRITICAL 风险告警 | P1 | 计划 |
| **spec-superflow** | **Phase write guards**：合同优先锁定（execution-contract.md 为唯一权威），规划阶段硬阻断文件写入 | P1 | 计划 |

## 7. L7 — 循环层（核心，已强化）

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| comet | 5 阶段状态机 + auto_transition + Guard | ✅ 已落地 | InnerLoop/PhaseLoop |
| loop-engineering | **断路器**（停滞/无进展检测） | ✅ 已落地 | CircuitBreaker，30 测试 |
| planning-with-files | **Completion Gate**（完成前强制校验） | ✅ 已落地 | CompletionGate，20 测试 |
| Ralph | 全自动 PRD 循环 | ✅ 已落地 | e2e 到 100% |
| loop-engineering | **定时/预算驱动**自动重启（token/time budget 熔断） | P2 | 部分（budget 字段已有，未接执行） |
| **comet** | **解耦状态**：`.aza/state.yaml`（人类可读）+ `.aza/run-state.json`（机器持有）+ `.aza/audit.jsonl`（追加审计日志） | P1 | ✅ 已落地 | `run-state.ts` + `loop-controller.ts` |
| **comet** | **自动化状态转换**：脚本拥有状态写入权，Agent 只读 → 消除写入验证错误 | P1 | ✅ 已落地 | `RunStateManager` 机器持有，`StateManager` 人类可读 |
| **spec-superflow** | **Decision Point 协议**（DP-0 到 DP-7）：每阶段交接必须经过编号决策点，含审计信息 | P0 | ✅ 已落地 | `decision-points.ts` + `phase-loop.ts` + `inner-loop.ts` |
| **spec-superflow** | **SDD 双审**：implementer → reviewer → dual verdict（spec compliance + code quality） | P1 | ⚠️ 待补充 | 计划 Phase 2 |
| **spec-superflow** | **内容级 stale 检测**：通过 SHA256 对比 proposal scope vs contract intent，不依赖文件时间戳 | P0 | ✅ 已落地 | `state-manager.ts` `computeContentHash()` |
| **Trellis** | **Curated context manifests**：实现/验证阶段引用 spec + research 路径清单，不引用 source 路径 → 更小上下文 | P2 | ⚠️ 待补充 | 计划 Phase 3 |
| **spec-superflow** | **TDD Iron Law**：12 个反模式短语 STOP 检测，硬阻断反模式推理 | P2 | ✅ 已落地 | `phase-gates.ts` `TDD_IRON_LAW_STOP_PHRASES` |
| **comet** | **Context compression**：SHA256 交接引用，`compressBundle()`/`decompressBundle()` → 节省 25-30% token | P2 | ✅ 已落地 | `context-orchestrator.ts` |

## 8. L8 — 编排层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| OpenHands / Codex CLI | **多执行器编排**（把宿主 CLI 当子代理调度） | P2 | 计划 |
| Devin | 长任务**看板 + 预算**可视化 | P3 | 计划 |
| **comet** | **Eval 平台**：Pass@k/Pass^k 评分 + Rubric scoring + LangSmith 集成 → 科学技能进化 | P2 | 计划 |
| **Trellis** | **Turn classification + consent gate**：AI 自动分类请求复杂度，复杂任务需用户同意才进入完整任务模式 | P2 | 计划 |

## 9. L9 — 知识层

| 借鉴来源 | 改进项 | 优先级 | 状态 |
|----------|--------|--------|------|
| OpenSpec | 归档产物沉淀为**可复用知识库**（archive 6 文档已生成，补充索引/检索） | P2 | 部分 |
| **Trellis** | **Spec auto-injection** 已落地（L9），补充 **learn-from-task** 沉淀：每次 archive 后将新发现写入 `.aza/spec-conventions/conventions.jsonl` → 下次会话自动加载 | P0 | ✅ 已落地 | `learn-from-task.ts` |

---

## 10. 近期执行顺序（P0 → P1 优先）

### Phase 1: 核心安全/纪律硬化（P0）✅ 全部完成
1. ✅ **L7 Decision Point 协议**（DP-0 to DP-7）+ **内容级 stale 检测**（替代时间戳恢复）
2. ✅ **L2 Learn-from-task loop**（`learn-from-task.ts`）+ **archive 知识沉淀**
3. ✅ **L7 解耦状态**：`.aza/state.yaml`（人类可读）+ `.aza/run-state.json`（机器持有）+ `.aza/audit.jsonl`（追加审计）
4. ✅ **L7 自动化状态转换**：`RunStateManager` 脚本拥有写入权，Agent 只读

### Phase 2: 质量/记忆增强（P1）✅ 全部完成
5. ✅ **L6 Phase write guards + GitNexus 影响分析**（编辑前 blast radius 检测，阶段级写入锁定）
6. ✅ **L7 SDD 双审**（implementer → reviewer → dual verdict，spec compliance + code quality）
7. ✅ **L2 Per-developer journal + SessionStart 召回**（`.aza/workspace/{name}/journal.md`，会话连续性）
8. ✅ **L4 TDD Iron Law** 短语级 STOP（12 个反模式短语，已并入 verify 门禁）

### Phase 3: 效率/可观测（P2）✅ 全部完成
9. ✅ **L2 Context compression**（SHA256 交接引用，节省 25-30% token）
10. ✅ **L8 Eval 平台**（Pass@k/Rubric 评分 + `aza_eval_run`/`aza_eval_summary`）
11. ✅ **L7 Curated context manifests**（Turn classification + 按阶段生成路径清单）
12. ✅ **L7 预算熔断接线**（token/time budget → 断路器，通过 `configLoopOptions` 配置化）

## 11. 全自动循环问题诊断与修复

### 诊断结果（V13 — 全部修复完成）

OpenCode 客户端无法使用 AzaLoop 的根本原因：

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | `npx @azaloop/mcp-server` 无入口 | 缺少 MCP stdio 传输层 + `bin` 字段 | 新增 `server.ts`（JSON-RPC 2.0 stdio），`package.json` 添加 `bin` + `exports` |
| 2 | `.aza` 目录创建失败（ENOENT） | `StateManager.save()` + `ResumeGenerator.write()` 未调用 `mkdir` | 两个方法均添加 `fs.mkdir(azaDir, {recursive:true})` |
| 3 | `aza_audit` / `aza_compliance` 读取错文件 | 读取 `STATE.md`（应为 `STATE.yaml`） | 两个文件均改为 `STATE.yaml` |
| 4 | `aza_quality_check` / `aza_loop` singleton 缓存 projectRoot | 首次调用后所有后续调用使用错误的 projectRoot | 移除 singleton，改为每次创建新实例 |
| 5 | 17 个 handler 硬编码 `process.cwd()` | MCP 服务器在不同 cwd 运行时路径错误 | 所有 handler 添加 `workspace_path` 可选参数 |
| 6 | `aza_conventions_write` 参数结构错误 | 传入 flat args 而非 `{tag, description, source}` 对象 | index.ts 改为结构化解构 |
| 7 | `aza_eval_run` / `aza_security_scan` / `aza_memory_record` 参数缺失 | schema 缺少必需字段 | 所有 schema 添加必需字段 + index.ts 正确传递 |
| 8 | 缺少会话初始化工具 | 无 `aza_session_start` | 新增 `aza-session.ts`，注册为 MCP 工具 |
| 9 | OpenCode 模板未提及 `aza_session_start` | `rules.md` + `continue.md` 流程缺失 | 更新两个模板 |
| 10 | `aza_prd_generate` 跳过 schema 验证 | `args as any` 绕过类型安全 | 改为结构化传入 `{title, description}` |

> 每项执行前先产出该项的 PRD 计划（目标 / 验收 / 影响面 / 回归），展示后再改代码，改完跑 `pnpm typecheck && pnpm test && npx tsx scripts/e2e-real-loop.ts` 回归。

### MCP 服务器端到端验证

| 测试 | 结果 |
|------|------|
| `npx @azaloop/mcp-server` 启动 | ✅ serverInfo + capabilities 输出 |
| `tools/list` | ✅ 返回 47 个工具，全部含 `workspace_path` |
| `tools/call aza_health` | ✅ healthy，next_action 正确 |
| `tools/call aza_session_start` | ✅ 创建 STATE.yaml + run-state.json + audit.jsonl，触发 session-start |
| `tools/call aza_conventions_list` | ✅ 返回空数组（无 conventions） |
| `pnpm typecheck` | ✅ 4/4 packages passed |
| `pnpm test` | ✅ 183/183 passed |
| `npx tsx scripts/e2e-real-loop.ts` | ✅ 5 stages all completed |
