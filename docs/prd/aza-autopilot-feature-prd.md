# AzaLoop 新功能产品规格文档（PRD）：闭环自续航引擎 Autopilot

**版本**：0.5.0（Draft）
**创建日期**：2026-07-14
**状态**：Draft — 待 Stakeholder Alignment
**作者**：Product（PM）
**关联文档**：
- 主产品 PRD：`docs/PRD.md`（v0.4.0，In Progress）
- 流程贯通性审计：`analysis/flow-review-and-optimization.md`
- 竞品对比方案：`analysis/competitor-analysis.md`（18 个开源项目）
- 源码实证：本次 `packages/mcp-server/src/tools/aza-loop.ts`、`packages/core/src/L7_loop/*`

---

## 1. 背景与问题陈述（Why）

### 1.1 现状审计结论（源码实测，已校正）

对 `packages/core`、`packages/mcp-server`、`scripts` 的源码核查结论：

| 维度 | 结论 |
|------|------|
| 主体流程是否贯通 | ✅ **已贯通**。8 个统一 MCP 工具（session / prd / loop / spec / quality / finish / memory / skill）经 `handleToolCall` → 阶段门禁 → 各 handler → `next_action` 链驱动到交付，happy path 全有代码支撑、无断点。 |
| 孤儿逻辑 | ⚠️ **存在，且已定位**。见 1.1.1。 |
| 跨客户端/项目/模型自动续航 | ✅ 已具备基础能力（零 LLM 配置 + `STATE.yaml` + `ResumeGenerator` + `aza_session(continue)` + `next_action` 链），但 `loop(full)` 单次仅跑 20 步即返回 `awaiting_agent`，**依赖宿主配合续跑**，否则停在 `paused`（软挂起，非死锁）。 |
| PRD 生成时 GitHub 竞品搜索并自补充 | ✅ 已实现（`L1_spec/prd-review-gate.ts` 调 `researchCompetitors` → 写 `.aza/competitive-research.md` → 合并进 PRD overview/goals），但默认路径仅 review 阶段触发，且结果未固定渲染进 `prd.md` 头部。 |
| 文件全保存到项目文件夹 | ✅ 已实现（`resolveWorkspaceRoot` + 强制 `workspace_path`，`.aza/`、`openspec/` 落项目根）。 |
| 多任务一批执行 | ❌ **缺失**。MCP 主线是单 PRD 顺序执行，无"一批 N 个特性/PRD 并行开发"的一等能力。 |
| 不存在死循环 / 不存在循环中断 | ⚠️ 有多重护栏（circuit-breaker / deadlock-detector / hard-stop / completion-gate / recursion-guard），但 (a) `deadlock_threshold=3` 状态仅存内存 `controllerCache`，**跨进程/重启即重置**；(b) `DEFAULT_BLOCK_COUNT_LIMIT=5` 与 `deadlock_threshold=3` 是两套独立阈值，易混淆；(c) 护栏叠加存在"合法写被 `red-flags`/`stage-tool-guard` 误拦 → 表现为循环中断"的隐患。 |
| 优化上下文 / 减少 token | ✅ 已有阶段工具分组 + 记忆压缩 + 成本追踪；仍有冗余（每次 review 都发网络请求、review 载荷过大、语义记忆只读不写、working 层未调用）。 |
| 一键构建安装包 | ✅ `build:portable` 已产出 `dist/portable/`（含 `aza.exe`/`azaloop-mcp.exe`/`install.ps1|sh`），可本地安装。 |

#### 1.1.1 已定位的孤儿逻辑（P0，须随本特性清理）

1. **`AutoLoopEngine`（`packages/core/src/L7_loop/auto-loop-engine.ts:57`）为死代码。**
   证据：`mcp-server/src/tools/aza-test-loop.ts:19` 导入它，但 `handleTestLoop` 未注册进 `tool-registry.ts` 的 8 工具表，也不被 `index.ts`/`unified-handlers.ts` 引入。生产路径用 `AutoLoopDriver`+`AutoLoopScheduler`。
2. **`aza-test-loop.ts` 整文件为死代码**（无任何调用方）。
3. **12 个 L0 Worker（`WorkerScheduler`）生产环境全部失活。**
   证据：仅在 `AutoLoopEngine.buildDefaultRegistry` 内 `setWorkerScheduler` 接线；而生产 `buildController/buildDriver/buildScheduler`（`aza-loop.ts:33/384/414`）**从不调用** `LoopController.setWorkerScheduler`（`loop-controller.ts:283` 提供但无人调用）。
4. **三层记忆写入不对称**：`aza-memory` 读 `ProjectMemory`(episodic)+`LongTermMemory`(semantic)，但 `record` 只写 ProjectMemory（语义层只读不写），`working-memory.ts` 未被 `aza_memory` 调用。
5. **`LEGACY_TOOL_MAP`（`unified-handlers.ts:736`）** 仅做旧名映射，无独立实现（可接受，但需确认无遗留调用）。

> 注：先前 `analysis/flow-review-and-optimization.md` §2.3 称「WorkerScheduler（13 个 worker）已接线」，与本次源码实测不符，**以本 PRD 结论为准**——生产路径未接线，Worker 为孤儿。

### 1.2 竞品空白（详见 `analysis/competitor-analysis.md`）

调研 18 个同类开源项目（planning-with-files / spec-kit / OpenSpec / gstack / loop-engineering / superpowers / ralphy / ruflo / Trellis / comet / agency-orchestrator / agent-skills 等）结论：

- **赛道空白 #1**：18 个竞品**无一内置「GitHub 同类/竞品仓库自动搜索 + 自补充 PRD」**。AzaLoop 已占住该位置，但需从"已接线可被绕过"升级为"默认且可见"。
- **赛道空白 #2**：无第二家同时做到「收敛工具面（8 工具）+ 跨客户端统一 + 竞品感知」三者合一。
- **可借鉴**：loop-engineering 的 circuit-breaker 错误签名去重、OpenSpec 的 `/goal` 可验证完成信号、ralphy 的并行 worktree + `parallel_group`、agency-orchestrator 的 YAML 编排 + 增量传参、Trellis 的按阶段上下文注入、spec-kit 的字节级可复现打包。

### 1.3 用户痛点与业务成本

- **痛点**：用户在不同客户端（Cursor/Claude Code/Trae/VS Code）、不同项目、不同模型间切换时，循环常"断在半路"需人工重启；PRD 缺竞品参照导致需求方向偏差；大需求无法并行交付；长任务 token 成本高；分发靠 `npm -g` 对非 Node 用户门槛高。
- **成本**：若本迭代不解决自动续航与孤儿逻辑，全自动交付成功率低 → 口碑与留存受损；赛道竞品正快速补齐 Spec 驱动，AzaLoop 的"竞品感知"差异化窗口期有限。

---

## 2. 目标（Goals — 可衡量）

| # | 目标 | 衡量方式 | 成功阈值（上线 30 天） |
|---|------|---------|----------------------|
| G1 | 跨客户端/跨会话全自动交付成功率提升 | 一次 `aza_session(calibrate)` 起、无人工干预跑到 `aza_finish(ship)` 的会话占比 | ≥ 70%（基线待上线首周测量，目标 ≥ 40%） |
| G2 | 核心流程零孤儿逻辑、零软挂起 | 死代码删除率 + `loop(full)` 在 T1 客户端无人值守跑通 e2e 比例 | 死代码删除 100%；e2e 通关率 ≥ 95% |
| G3 | PRD 竞品覆盖与可见性 | 生成的 `prd.md` 含"竞品对比"段的比例 | ≥ 90%（L3/L4 任务 100%） |
| G4 | 多任务吞吐 | 单批次并行 PRD/特性数（worktree 隔离） | 支持 ≥ 4 并发，单批吞吐 ≥ 2× 串行 |
| G5 | Token / 请求下降 | 单 PRD 平均输入 token 与 GitHub 请求数 | token 降 ≥ 30%，GitHub 请求降 ≥ 60%（靠缓存+按复杂度分级） |
| G6 | 分发门槛下降 | 便携包本地安装成功率（非 Node 用户） | ≥ 98% |

---

## 3. 非目标（Non-Goals）

1. **不做自研 LLM / 推理服务**：继续零 LLM 配置，复用宿主模型。原因：定位与成本所限。
2. **不在本版重做 12 个 L0 Worker 的分析能力**：本版只"清理孤儿 + 明确触发契约"，不扩展 Worker 功能集。原因：范围过大，列为 P2 后续。
3. **不做 Web UI / 可视化看板**：本版交付物仍为 CLI + MCP + Markdown 工件。原因：保持轻量，Web 控制台单列 initiative。
4. **不内置商业化计费 / 多租户**：开源 MIT 定位不变。
5. **不做非 GitHub 的代码平台竞品搜索**（如 GitLab 私有仓）：本版仅 GitHub 公开仓库。原因：鉴权与合规复杂度。
6. **不承诺 100% 无死循环**（理论不可达）：本版做到"确定性格、可恢复、可观测"三重保障。

---

## 4. 用户故事（User Stories）

- **作为独立开发者**，我希望在 Cursor 里跑了 30 步后关掉电脑，第二天打开 Claude Code 能自动从断点续跑并完成交付，以便我无需手动重启循环。
- **作为产品经理**，我希望 AzaLoop 生成 PRD 时自动搜出 GitHub 上同类项目并把"竞品对比"写进 PRD 头部，以便我一眼看到差异化空间。
- **作为技术 Lead**，我希望一次性提交 4 个特性，AzaLoop 用独立 worktree 并行开发并汇总报告，以便我一天拿到多个可用模块。
- **作为运维/分发负责人**，我希望对非 Node 同事给一个 exe + install 脚本就能装好，以便降低落地门槛。
- **作为开源贡献者**，我希望 `aza-loop` 主线没有死代码与失活 Worker，以便我改代码时不被误导。
- **作为重度用户**，我希望长任务里 AzaLoop 自动压缩上下文、复用记忆，以便 token 费用可控、不超窗口。
- **边界故事**：作为自动模式运行者，我希望即使某个阶段守卫误判，循环也不会永久中断，而是升级/记录后继续或明确报错，以便不会出现"静默卡死"。

---

## 5. 需求（Requirements — MoSCoW）

### F0 孤儿逻辑清理与护栏收敛（P0 — 核心流程无错误）【Must】

> 目标：让"核心流程无错误"成立——删除死代码、收敛失活子系统、统一阈值。

- **F0-1** 删除 `AutoLoopEngine`（`auto-loop-engine.ts`）及 `aza-test-loop.ts`；若需保留自测，改为 `scripts/` 下独立脚本而非 MCP 工具。
  - 验收：`grep -rn "AutoLoopEngine" packages/` 除 `scripts/` 外无引用；`tsc` 构建无未使用告警；`dist/tools/aza-test-loop.js` 不再产出。
- **F0-2** 对 12 个 L0 Worker 做"契约明确化"：要么在 `buildController` 中按需 `setWorkerScheduler`（仅接入 verify 阶段确有价值的 `testgaps`/`refactor`），要么在文档中标注为"按需 CLI（`aza <worker>`）"并移除自动接线假象。
  - 验收：生产路径 Worker 行为可解释、可测；不再存在"定义但永不被调用"的 Worker。
- **F0-3** 统一循环终止阈值：将 `deadlock_threshold`（内存态）与 `DEFAULT_BLOCK_COUNT_LIMIT` 收敛为单一可持久化配置项，写入 `STATE.yaml`，**跨重启保留**。
  - 验收：`STATE.yaml` 含 `deadlock` 字段；重启后 `DeadlockDetector` 从该字段恢复而非清零。
- **F0-4** 护栏调用图回归：在 T1 客户端跑 `scripts/e2e-real-loop.ts` + `verify-spine.ts`，确认合法 write 不被 `red-flags`/`stage-tool-guard` 误拦；auto 模式对 `red-flags` 仅记录不阻断。
  - 验收：e2e 自动路径不卡守卫；误拦率为 0（或记录不阻断）。
- **F0-5** 修复三层记忆写入不对称：语义层（`LongTermMemory`）新增写入路径；`working-memory` 接入 `aza_memory` 调用；明确每层读写契约。
  - 验收：跨会话语义检索命中率 measurable；working 层被实际调用。

### F1 跨端 / 跨项目 / 跨模型自动续航（P0）【Must】

> 目标：不同客户端、不同项目、不同模型之间"自动续航、断点续跑"，消除软挂起。

- **F1-1** `aza_session(continue)` 幂等化：重复调用不产生重复状态；从 `STATE.yaml`/`ResumeGenerator` 精确恢复阶段、迭代计数、待执行动作。
  - 验收：同一会话连续两次 `continue` 状态一致；`paused` 状态可被 `continue` 无人工干预推进。
- **F1-2** 消除 `loop(full)` 软挂起：当宿主未在 20 步内 `report_tool`，引擎进入"持久化待续"并能在下次任意客户端调用时自动恢复，而非停在 `paused` 需人工。
  - 验收：模拟宿主失联后重连，循环自行续跑至完成，无需人工触发。
- **F1-3** 跨模型无关：工具面与模型解耦，切换宿主模型（如 Cursor 的 Claude ↔ Trae 的 GPT）不丢失 `STATE`。
  - 验收：同一项目在两种宿主模型下各跑一半，状态连续。
- **F1-4** 跨客户端恢复清单：首次接入时校验 MCP `tools/list` 返回 8 工具（非旧 30+ 名）、cwd 非 HOME（否则打 warning 并拒绝），输出"续航就绪检查表"。
  - 验收：错误配置下给出明确可操作提示。

### F2 PRD 自演进：GitHub 竞品搜索 + 自补充 + 可视对比（P0 / P1）【Must + Should】

> 目标：PRD 生成时自动搜 GitHub 相似/竞品项目，并入 PRD 与对比方案，默认且可见。

- **F2-1（P0）** `researchCompetitors` 成为 PRD 生成唯一竞品入口；删除 `PRDGenerator.generateAsync` 内联竞品逻辑（消除双入口孤儿）。
  - 验收：单入口；`grep generateAsync` 无残留。
- **F2-2（P0）** 竞品结果**固定渲染进 `prd.md` 头部**「竞品对比」段（repo / stars / 差异点 / 风险），并同步写 `.aza/competitive-research.md`。
  - 验收：L3/L4 任务 100% 含该段；人审 PRD 首屏可见竞品。
- **F2-3（P1）** 搜索词智能化：用 PRD 的 `productType`/关键词拼 GitHub query（如「autonomous coding agent spec-driven」），按语言/star 过滤。
- **F2-4（P1）** 竞品结果缓存：同 title 60 分钟内不重复发 GitHub 请求，落 `.aza/competitive-research.cache.json`；按复杂度分级（L1/L2 跳 live 搜索，用 curated 兜底）。
  - 验收：同一需求二次 review 不发网络请求；L1 任务 token 显著下降。
- **F2-5（P1）** stars 真实化：兜底 curated 池填真实 star 或标注「未联网」，避免误导。

### F3 多任务批量执行（P2）【Could】

> 目标：一次提交 N 个特性/PRD，并行交付。借鉴 ralphy `--parallel` + agency-orchestrator YAML 编排。

- **F3-1** 新增 `aza_loop action=batch`（或 `aza batch`）：接收 PRD 列表 / `.aza/batch.yaml`，每个单元独立 worktree + 独立 `.aza/` 状态，并行跑完整 8 工具链。
  - 验收：提交 4 个 PRD，4 个 worktree 并行；互不污染。
- **F3-2** 用 `YAMLOrchestrator`（L8，已实现）做 DAG/依赖 + `concurrency` 控制；共享竞品缓存与质量门阈值。
  - 验收：带依赖的批量任务按序/并行正确编排。
- **F3-3** 产物各自归档 `<project>/.aza/runs/<slug>/`，汇总报告回主会话。
  - 验收：批量结束产出 `batch-summary.md` 含每单元状态/产物链接。

### F4 上下文 / Token 优化（P1）【Should】

> 目标：更少 token、更少模型请求、更少上下文。

- **F4-1** review 载荷分级：L1 小任务跳过"多角色评审 + live 搜索 + 5 轮自优"，仅做最小生成。
  - 验收：L1 任务平均 token 降 ≥ 40%。
- **F4-2** 跨会话用 `ResumeGenerator` **摘要**而非全量回灌；参照 Trellis「仅成功时注入 / 按阶段抽取」。
- **F4-3** 语义记忆写入后置（`F0-5`）使跨会话可复用历史推理，减少重复上下文传输（借鉴 ruflo `ReasoningBank`）。
- **F4-4** 错误签名去重：circuit-breaker 折叠重复错误（借鉴 loop-engineering），减少无效重试与日志噪声。

### F5 一键构建与本地安装（P0 / P1）【Must + Should】

> 目标：开发完成后一键出包并本地安装，照顾非 Node 用户。

- **F5-1（P0）** `pnpm build:portable` 产出自包含包：`aza.exe`/`azaloop-mcp.exe` + `cli-bundle.js`/`mcp-bundle.js` + `install.ps1`/`install.sh` + `templates/` + `docs/`。
  - 验收：干净机（无 Node）双击 `install.ps1` 后 `aza --version` 可用。
- **F5-2（P1）** 可复现校验：打包产物字节级可复现 + 简单 checksum/signature（借鉴 spec-kit `bundle build`）。
- **F5-3（P1）** 安装后自检：install 脚本运行"续航就绪检查表（F1-4）"并报告结果。

### F6 防死循环 / 防中断保障（P0）【Must】

> 目标：不存在死循环、不存在循环中断——确定性格 + 可恢复 + 可观测。

- **F6-1** 三道硬闸兜底（绝不死循环）：`circuit-breaker` + `deadlock-detector` + `hard-stop`（max_iterations / strikes / security）。
  - 验收：构造"永远失败"的 task，循环在阈值内硬停并产出 `loop-abort-report.md`。
- **F6-2** 可验证完成信号（借鉴 OpenSpec `/goal`）：CompletionGate 用"可验证完成条件"而非固定迭代决定终止；若 `attestation` 未校验则 `canStop=false` 但硬停仍生效。
- **F6-3** 中断可观测：任何提前中断/升级都写 `STATE.yaml` 的 `last_event` 并通知（stdout + 可选 webhook），**绝不静默卡死**。
- **F6-4** 单测覆盖：circuit-breaker / deadlock / completion-gate / recursion-guard 各自有单元测试（复用 `tests/unit/completion-gate.test.ts` 等）。

---

## 6. 成功指标（Metrics）

### 北极星指标（North Star）
**跨会话全自动交付成功率** = （一次起启、无人工干预跑到 `aza_finish(ship)` 的会话数）/（总起启会话数）
- 基线：上线首周测量；**目标上线 30 天 ≥ 70%**

### 驱动指标（Drivers）
| 指标 | 定义 | 目标 |
|------|------|------|
| 跨客户端续跑成功率 | 断点后续跑至完成的比例 | ≥ 95% |
| PRD 竞品覆盖率 | `prd.md` 含竞品对比段比例 | ≥ 90%（L3/L4=100%） |
| 批量吞吐 | 单批并行单元数 / 相对串行加速比 | ≥ 4 并发 / ≥ 2× |
| 单 PRD 平均输入 token | review+loop 阶段 token | 降 ≥ 30% |
| GitHub 请求数/PRD | 竞品搜索 HTTP 请求 | 降 ≥ 60% |
| 死循环/静默中断发生率 | 需人工救场的循环中断 | ≤ 2% |

### 健康指标（Health）
| 指标 | 定义 | 警戒线 |
|------|------|------|
| 构建包本地安装成功率 | 干净机安装成功比例 | < 98% 告警 |
| 门禁误拦率 | 合法写被守卫阻断比例 | > 0 即查 |
| 语义记忆写入命中率 | 跨会话语义检索命中 | 持续上升 |
| 死代码回归 | 新增未接线的工具/模块 | 0 |

---

## 7. 竞品借鉴映射（摘要，详见 `analysis/competitor-analysis.md`）

| 竞品思路 | 映射到本 PRD |
|---------|-------------|
| loop-engineering circuit-breaker + 错误签名折叠 | F6-1 / F4-4 升级断路器 |
| OpenSpec `/goal` 可验证完成信号 | F6-2 与 CompletionGate 对齐 |
| ralphy 并行 worktree + `parallel_group` | F3 批量隔离范本 |
| agency-orchestrator YAML 编排 + 增量 `{{变量}}` 传参 | F3-2 编排范本 / F4 减上下文 |
| Trellis 按阶段上下文注入 / 仅成功时注入 | F4-2 上下文优化 |
| ruflo `ReasoningBank` 向量记忆 | F0-5 / F4-3 记忆复用 |
| spec-kit 字节级可复现 zip | F5-2 打包校验 |
| superpowers subagent 双轨审查 | 强化内循环 Maker/Checker（P2） |

---

## 8. 开放问题（Open Questions）

| # | 问题 | 负责方 | 阻断级 |
|---|------|-------|-------|
| Q1 | F3 批量执行是否进入本迭代，还是 v0.6？ | PM + Eng | 非阻断（建议 v0.6，本版仅留接口） |
| Q2 | 12 个 L0 Worker 是"按需 CLI"还是"接 verify 阶段"？ | Eng Lead | 阻断 F0-2 方案 |
| Q3 | 竞品搜索的 GitHub 速率限制（无 Token）下如何保质量？ | Eng | 非阻断（curated 兜底） |
| Q4 | 死锁阈值跨重启持久化是否引入新状态文件？ | Eng | 非阻断（写入 STATE.yaml） |
| Q5 | 非 Node 便携包是否要对 macOS/arm 出双架构？ | PM + Release | 非阻断（首版 Windows 优先） |

---

## 9. 排期建议（Phasing）

- **Phase 0（本迭代 P0，1–2 周）**：F0 孤儿清理 + F1 自动续航 + F2（P0 部分）+ F5（P0）+ F6。→ 达成"核心流程无错误 + 跨端续航 + 一键安装 + 不死循环"。
- **Phase 1（本迭代 P1，1 周）**：F2（P1 缓存/智能搜索）+ F4 上下文优化 + F5（P1 校验/自检）。
- **Phase 2（v0.6，下迭代）**：F3 多任务批量 + F0-2 Worker 契约落地 + superpowers 双轨审查强化。

> 依赖：F1/F6 依赖 `STATE.yaml` 结构稳定（F0-3）；F3 依赖 `YAMLOrchestrator` 现状可用；F5 依赖现有 `scripts/build-portable.ts`（已验证可用）。
