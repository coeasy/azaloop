# AzaLoop 主体流程贯通性审查 & 孤儿逻辑 & 优化方案

> 分析时间：2026-07-14
> 范围：packages/core、packages/mcp-server、packages/cli、scripts
> 方法：读源码 + 子代理竞品研究（见 `competitor-analysis.md`）

---

## 0. 结论速览

| 你的疑问 | 结论 |
|---------|------|
| 主体流程是否完全贯通？ | ✅ **已贯通**。8 工具 → STATE/RESUME → PRD 门 → 循环（AutoLoopEngine）→ 质量门 → 交付，链路完整且证据确凿。 |
| 是否存在孤儿逻辑？ | ⚠️ **有，且明显**。`mcp-server/src/tools/*.ts`（30+ 文件）是死代码；`PRDGenerator.generateAsync()` 未被主线调用；部分 guard 模块冗余堆叠。 |
| 全自动跨客户端/项目/模型自动续航？ | ✅ 已具备（零 LLM 配置 + STATE/Resume + next_action 链）。 |
| PRD 生成时从 GitHub 搜竞品并自补充？ | ✅ **已实现并接线**（`prd-review-gate.ts`），但默认路径只在 review 阶段触发，generator 自身不调用 live 搜索。 |
| 文件全保存到对应项目文件夹？ | ✅ 已实现（`resolveWorkspaceRoot` + 强制 `workspace_path`）。 |
| 能否多任务一批执行？ | ❌ MCP 主线是单 PRD 顺序；无「批量多特性并行」一等能力（WorkerScheduler 只跑分析型 worker）。 |
| 不存在死循环 / 不存在循环中断？ | ✅ 有断路/死锁/硬停/完成门/递归守卫等多重护栏；⚠️ 但护栏过多存在「过度拦截导致合法全自动中断」的风险，需回归验证。 |
| 优化上下文 / 减少 token？ | ✅ 已有阶段工具分组 + 记忆压缩 + 成本追踪；仍有冗余（每次 review 都发网络请求、review 载荷过大）。 |
| 一键构建安装包？ | ✅ `build:portable` 已产出 `dist/portable/`（含 exe + install 脚本）。 |

---

## 1. 主体流程贯通性（证据链）

```
aza_session(calibrate|continue)          packages/mcp-server/src/unified-handlers.ts: handleAzaSession
        │  → STATE.yaml / ResumeGenerator / CompletionGate
aza_prd(review → approve)                L1_spec/prd-review-gate.ts: PRDReviewGate.review()/approve()
        │   ├─ researchCompetitors()  ──► 写 .aza/competitive-research.md   (GitHub 竞品搜索 ★)
        │   ├─ PRDGenerator.generate() + selfOptimize(5 轮)
        │   ├─ 竞品合并进 PRD overview/goals
        │   ├─ 写 .aza/prd.md / prd.json / prd-multi-role-review.json
        │   ├─ writePlanMd() / ExecutionContract / OpenSpec change folder
        │   └─ next_action → aza_loop(full)
aza_loop(full)                           unified-handlers.ts: handleAzaLoop → handleAutoLoop
        │   → AutoLoopEngine (L7_loop/auto-loop-engine.ts)
        │        ├─ LoopController（外/内/阶段循环）
        │        ├─ WorkerScheduler（13 个 worker，buildDefaultRegistry）★已接线
        │        ├─ CircuitBreaker / DeadlockDetector / HardStopManager
        │        └─ CompletionGate / StageGuards
aza_spec / aza_quality (awaitingAction → report_tool)
aza_finish(ship)                         archive + ship + conventions
```

**判定：贯通。** 从入口到交付每个环节都有实现与接线，且 `next_action` 链驱动跨步骤、跨会话全自动。

---

## 2. 孤儿逻辑清单（按严重度）

### 🔴 P0 — 明确死代码

**2.1 `packages/mcp-server/src/tools/*.ts`（30+ 文件）**
- 文件：`aza-audit.ts`、`aza-budget.ts`、`aza-compliance.ts`、`aza-context.ts`、`aza-continue.ts`、`aza-conventions.ts`、`aza-cost.ts`、`aza-dag.ts`、`aza-doc.ts`、`aza-eval.ts`、`aza-explore.ts`、`aza-finish-work.ts`、`aza-health.ts`、`aza-init.ts`、`aza-memory.ts`、`aza-meta-ext.ts`、`aza-openspec.ts`、`aza-plugin.ts`、`aza-prd.ts`、`aza-quality.ts`、`aza-runstate.ts`、`aza-security.ts`、`aza-session.ts`、`aza-skill.ts`、`aza-style.ts`、`aza-task.ts`、`aza-test-loop.ts` … 共 30+。
- 证据：全仓 `src/` 中**没有任何文件 import `./tools/` 或 `../tools/`**（grep 仅命中 `dist/` 产物与 `unified-handlers.ts` 的字符串匹配）。`mcp-server/src/index.ts` 只从 `./unified-handlers` 装载 8 个 handler。
- 影响：这些文件被 `tsc` 编译进 `dist/tools/`，**徒增构建体积与维护噪音**；且容易让维护者误以为它们生效。
- 建议：删除以收敛，或（若想保留扩展点）用 `legacy-router.ts` 真正挂载其中确有价值的少数（如 `aza-openspec`、`aza-security`），其余删除。

**2.2 `PRDGenerator.generateAsync()`（L1_spec/prd-generator.ts:179）**
- 这是 generator 内部的「live GitHub 搜索」入口，但**主线并不调用它**——`prd-review-gate.review()` 自己直接调 `researchCompetitors()` 并 enrich，再调 `prdGenerator.generate()`（同步、仅用 curated 兜底）。
- 影响：`generateAsync` 成为孤儿，且造成「两处竞品搜索逻辑」心智分裂。
- 建议：删除 `generateAsync`，统一由 `prd-review-gate` 负责竞品搜索（已如此），或反向把 review 的搜索逻辑收进 generator 并让 review 调 generator。

### 🟡 P1 — 子系统未完全驱动 / 冗余

**2.3 13 个 Worker 是否被主线真正触发**
- 接线点：`auto-loop-engine.ts:112` 用 `buildDefaultRegistry()` 建 `WorkerScheduler` 并 `setWorkerScheduler` 给 LoopController ✅ 已接线。
- 但 worker 多为**分析型**（ultralearn/optimize/predict/audit/map/deepdive/document/refactor/benchmark/testgaps/preload/consolidate/scheduler），由 `DEFAULT_TRIGGERS` 触发，**不在核心 next_action 链上**，对「交付产物」贡献间接。
- 风险：若触发器配置不当，worker 实际从不动；且 13 个实现体量大、难全部验证。
- 建议：明确每个 worker 的触发条件与产物落点；把确证有用的（如 `testgaps`、`refactor`）纳入 verify 阶段，其余降级为按需 CLI（`aza <worker>`）。

**2.4 护栏模块堆叠（约 10 个）**
- circuit-breaker / deadlock-detector / hard-stop / completion-gate / recursion-guard / red-flags / sparc-gates / phase-gates / stage-tool-guard / write-guards。
- 风险：**过多重叠守卫可能相互冲突**。`stage-tool-guard` 或 `red-flags` 若误判，会阻断 loop 本应执行的写操作，表现为「循环中断」（与你担心的「不存在循环中断」直接冲突）。
- 建议：做一次「护栏调用图」回归——确认在 T1 全自动路径下，合法 write 不会被守卫误拦；对 red-flags 在 auto 模式下放宽。

### 🟢 P2 — 轻微

**2.5 `writePrdMarkdown` / `writeCompetitiveResearch` 在 review 已调用**，非孤儿；但 `getCuratedCompetitorsSync` 的 curated 池 `stars:0` 为写死占位，竞品列表静态——影响「竞品感知」真实度（见 §4）。

---

## 3. PRD 生成效果优化（你最关心的）

### 3.1 现状（已实现，且比 18 个竞品都强）
`prd-review-gate.review()` 流程：
1. `researchCompetitors(title, desc)` → GitHub API `search/repositories`（带 `GITHUB_TOKEN` 优先），失败兜底到静态 curated 池。
2. `writeCompetitiveResearch(azaDir, research)` → `.aza/competitive-research.md`。
3. 把竞品名/URL/目标/风险合并进 PRD 的 `overview` 与 `goals`。
4. `writePrdMarkdown` → `.aza/prd.md`；`fs.writeFileSync` → `.aza/prd.json`。
5. 自检 + 多角色（CEO/QA/Eng）评审 + 写 `prd-multi-role-review.json`。
6. 生成 `OpenSpec` change folder + `ExecutionContract` + `task-board`。

### 3.2 优化点
| 优化 | 做法 | 收益 |
|------|------|------|
| **竞品结果真正进入 PRD 文档头部** | 在 `prd.md` 顶部固定渲染「竞品对比」段（repo / stars / 差异点），而非仅塞进 overview 文本 | 人审 PRD 时一眼看到竞品，落地你「自补充 PRD」的诉求 |
| **搜索词更聪明** | 用 PRD 的 `productType`/关键词拼 GitHub query（如「prd mcp agent loop」→「autonomous coding agent spec-driven」），并按语言/star 过滤 | 召回更相关竞品 |
| **缓存竞品结果** | 同 title 60 分钟内不重复发 GitHub 请求；落 `.aza/competitive-research.cache.json` | 减网络请求、降延迟 |
| **按复杂度决定是否搜索** | L1/L2 小任务可跳过 live 搜索（curated 即可），L3/L4 才发 API | 直接降 token / 请求数 |
| **stars 真实化** | 兜底池填真实 star 数或标注「未联网」 | 避免误导 |
| **去重 generator 内联竞品逻辑** | 删除 `generateAsync`，让 review 是唯一竞品入口 | 消除 §2.2 孤儿 |

---

## 4. 跨客户端/项目/模型自动续航（已具备，附校验清单）

- ✅ **跨模型**：`README`「零 LLM 配置」——用宿主 AI 的模型，无 API Key；MCP 工具面与模型无关。
- ✅ **跨项目**：`resolveWorkspaceRoot()`（mcp-server/src/index.ts:35）拒绝把 HOME 当 workspace，强制 `workspace_path`，`.aza/`、`openspec/` 落项目根。
- ✅ **跨会话/客户端**：`aza_session action=continue` + `ResumeGenerator` + `STATE.yaml` + `CompletionGate`；`next_action` 链在 Cursor/Claude/OpenCode/Trae 等 T1 客户端自动续跑。
- ✅ **全自动**：`AZA_AUTO_APPROVE_PRD=true` + `auto_approve` 可在 T1 客户端无人值守跑完 review→loop→ship。
- ⚠️ **校验项**：在不同客户端首次接入时，确认 MCP `tools/list` 返回的是 8 工具（非 50 旧名）；确认客户端未把 cwd 设为 HOME（会出现「azaloop 不生效」假象，代码已对此打 warning）。

---

## 5. 多任务一批执行（当前缺口 + 设计建议）

现状：MCP 主线 = 单 PRD → `stories` 顺序处理；`OuterLoop` 顺序多 story；`WorkerScheduler` 只跑分析 worker。
**没有「一次提交 N 个特性/PRD 并行开发」的一等能力。**

借鉴竞品设计（ralphy `--parallel`+`parallel_group`、agency-orchestrator `loop.max_iterations`+`concurrency`）：
- 新增 `aza_loop action=batch` 或 `aza batch`：接收 PRD 列表 / `.aza/batch.yaml`，每个 PRD 独立 worktree + 独立 `.aza/` 状态，并行跑完整 8 工具链；
- 用 `YAMLOrchestrator`（已实现，L8）做 DAG/依赖与 `concurrency` 控制；
- 共享「竞品缓存」与「质量门阈值」，避免重复搜索与阈值漂移；
- 产物各自归档到 `<project>/.aza/runs/<slug>/`，汇总报告回主会话。

---

## 6. 不存在死循环 / 不存在循环中断（护栏 + 风险）

已实现防死循环机制（L7_loop）：
- `circuit-breaker.ts`：按维度/层级熔断。
- `deadlock-detector.ts`：动作记录 + 停滞检测。
- `hard-stop.ts`：`hard_stop_on_security` + 迭代上限。
- `completion-gate.ts`：可验证完成条件。
- `recursion-guard.ts`：禁同名子代理自派发。
- `loop-cost.ts` / `cost-tracker.ts`：预算上限。

**风险**：上述守卫**叠加**后，在 auto 模式下存在「合法写被 stage-tool-guard / red-flags 误拦 → 表现为循环中断」的隐患。
**回归建议**：
1. 在 T1 客户端跑 `scripts/e2e-real-loop.ts` 与 `scripts/verify-spine.ts`，确认 auto 路径不卡守卫。
2. auto 模式下放宽 `red-flags`（仅记录不阻断）；`stage-tool-guard` 对 `aza_spec`/`aza_prd`/`aza_finish` 的写放行做白名单。
3. 保留 `circuit-breaker`+`deadlock-detector`+`hard-stop` 三道硬闸作为「绝不死循环」底线。

---

## 7. 上下文 / token 优化（已有 + 增量）

已有：`STAGE_TOOL_GROUPS`（按阶段只暴露子集工具，缩小 MCP 上下文）、`MemoryCompressor`、`ContextOrchestrator`、`LoopCost`/`CostTracker`、`embedText` 向量记忆。
增量建议：
- review 载荷瘦身：当前 `review()` 一次性做 研究+生成+5 轮自优+多角色评审+写 5+ 文件，对 L1 小任务过重 → 按复杂度分级（L1 跳过多角色评审与 live 搜索）。
- 竞品搜索缓存（§3.2），避免每次 review 发网络请求。
- 跨会话用 `ResumeGenerator` 摘要而非全量回灌；参照 Trellis「仅成功时注入 / 按阶段抽取」。

---

## 8. 一键构建安装包（已具备，验证命令）

- 命令：`pnpm build:portable` （等价于 `pnpm build && npx tsx scripts/build-portable.ts`）。
- 产物：`dist/portable/` → `aza.exe` / `azaloop-mcp.exe` / `cli-bundle.js` / `mcp-bundle.js` / `install.ps1` / `install.sh` / `templates/` / `docs/`。
- 本地安装：`dist/portable/install.ps1`（Windows）或 `install.sh`（mac/linux），或 `pnpm exec aza pack --install`。
- 全局 npm：`npm install -g @azaloop/cli @azaloop/mcp-server`。
- 本次已实际执行 `pnpm build:portable` 验证构建链路（见交付说明）。

---

## 9. 行动清单（优先级）

| 优先级 | 动作 | 文件/命令 |
|-------|------|----------|
| P0 | 删除孤儿 `mcp-server/src/tools/*.ts`（或仅保留有价值者并真正挂载） | `rm packages/mcp-server/src/tools/*.ts` |
| P0 | 删除孤儿 `PRDGenerator.generateAsync()` | L1_spec/prd-generator.ts |
| P1 | 竞品结果固定渲染进 `prd.md` 头部 + 搜索词智能化 + 缓存 | L1_spec/prd-review-gate.ts、github-competitive-research.ts |
| P1 | 守卫回归：确保 T1 auto 路径不被误拦 | scripts/e2e-real-loop.ts、verify-spine.ts |
| P2 | 多任务批量能力（batch worktree + YAMLOrchestrator） | 新增 `aza_loop batch` / `packages/cli` |
| P2 | 13 worker 触发条件与落点明确化 | L0_platform/workers/*、auto-loop-engine.ts |
| P3 | circuit-breaker 错误签名去重 + 向量记忆复用 | L7_loop/circuit-breaker.ts、L2_memory |

---

## 10. 关于「借鉴竞品思路方案」的落地映射

| 竞品思路 | 映射到 AzaLoop |
|---------|---------------|
| loop-engineering circuit breaker + 错误签名折叠 | 升级 `L7_loop/circuit-breaker.ts` |
| OpenSpec `/goal` 可验证完成信号 | 与 `completion-gate.ts` 对齐，减少固定迭代 |
| superpowers subagent 双轨审查 | 强化内循环 Maker/Checker |
| ruflo 向量记忆 / ReasoningBank | 强化 `L2_memory/stores.ts` + `hnsw-index.ts` |
| Trellis 阶段化上下文注入 | 优化 `L2_memory/context-orchestrator.ts` |
| agency-orchestrator 并行编排 | 支撑 §5 多任务批量 |
| ralphy 并行 worktree + parallel_group | 支撑 §5 批量隔离 |
| spec-kit 可复现 zip | 增强 `build:portable` 校验 |

---

## 11. 重构执行记录（2026-07-14）—— 更正上一轮误判

> **更正**：上一轮「30+ 孤儿 tools/*.ts 应删除」的判断**有误**。经逐文件核查
> `unified-handlers.ts` 的 import 链，`mcp-server/src/tools/` 共 28 个文件，其中
> **25 个均被活跃 8-tool 主线 import**；真正未被任何 `src/` 引用、仅被编译进 `dist/`
> 的只有 **3 个**且全部是**有价值**模块：`aza-cost.ts`（CostTracker 令牌成本）、
> `aza-plugin.ts`（PluginLoader 插件加载）、`aza-test-loop.ts`（AutoLoopEngine 自测）。
> 因此策略从「删除」改为「接入主线」。`legacy-router.ts` 也**并非孤儿**（被 `index.ts`
> 调用）。

### 11.1 已落地代码改动
| 改动 | 文件 | 说明 |
|------|------|------|
| 竞品搜索升级为「默认+可见+不可绕过」 | `core/L1_spec/github-competitive-research.ts` | 新增 `runCompetitiveResearch()` 单一入口：解析 `AZA_COMPETITOR_RESEARCH`(默认 `auto`)；L1 用 curated 离线池、L2–L4 走实时 GitHub；24h 磁盘缓存按 query 归一化；永不抛错（失败回退 curated）。`writePrdMarkdown` 新增独立 `## Competitive Research` 章节（含链接/★stars/差异化）。 |
| review 路径改用单入口 | `core/L1_spec/prd-review-gate.ts` | `researchCompetitors+writeCompetitiveResearch` 内联块替换为 `runCompetitiveResearch`；结果写入 `prd.md` 独立章节；`PRDReviewResult.competitive` 暴露 source/count/top/cached 给宿主。 |
| generate 路径不再绕过竞品搜索 | `mcp-server/src/tools/aza-prd.ts` + `unified-handlers.ts` | `handlePRDGenerate` 现也调用 `runCompetitiveResearch` 并写出带竞品章节的 `prd.md`；`generate` 动作透传 `workspace_path`。 |
| 删除孤儿方法 | `core/L1_spec/prd-generator.ts` | 移除无调用方的 `generateAsync()`（其职责已由 `runCompetitiveResearch` 统一承担）。 |
| 3 个有价值模块接入主线 | `unified-handlers.ts` + `tool-registry.ts` | `aza_meta` 新增 `cost`/`cost_status`/`cost_consume`、`plugin`/`plugin_load`/`plugin_unload`/`plugin_list`（替换原 stub）、`test_loop`/`selftest`/`doctor` 动作，映射到 `handleCost`/`handlePlugin`/`handleTestLoop`。 |
| 导出补充 | `core/src/index.ts` | 导出 `runCompetitiveResearch`、`DEFAULT_DIFFERENTIATORS` 及类型。 |

### 11.2 验证
- `pnpm --filter @azaloop/core build` / `pnpm --filter @azaloop/mcp-server build`：通过（无 TS 错误）。
- `pnpm build:portable`：重新产出 `dist/portable/` 与 `dist/azaloop-portable.zip`。
- `scripts/smoke-competitive.mts`：校验 L2 实时/回退、L1 curated、缓存命中、mode=off 跳过、`prd.md` 含 `## Competitive Research` 章节。

### 11.3 尚未做（留给后续，非阻塞）
- 多任务批量 `aza_loop batch`（P2）：参考 ralphy/agency-orchestrator，仍待实现。
- 守卫回归校验：跑 `scripts/e2e-real-loop.ts` / `verify-spine.ts` 确认 T1 全自动路径不被 circuit/completion 守卫误拦。
- 13 个 worker 的触发条件/落点文档化（L0_platform/workers）。
