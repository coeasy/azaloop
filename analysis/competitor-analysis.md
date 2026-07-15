# AzaLoop 竞品分析报告（18 个项目 + AzaLoop 自身）

> 分析时间：2026-07-14
> 目的：借鉴 18 个开源 AI-Agent / 规范驱动开发项目的细节，明确 AzaLoop 的差异化定位、已具备能力与空白点。
> 数据源：各仓库 GitHub README / 源码（通过子代理并行抓取）。

---

## 1. 一句话结论

- **AzaLoop 的主流程已经贯通**，且**「PRD 生成时从 GitHub 搜索竞品并自补充」这一你最看重的能力，在代码里已经实现并接线**（位于 `packages/core/src/L1_spec/prd-review-gate.ts`）。
- 18 个竞品里**没有任何一个内置 GitHub 相似仓库/竞品自动搜索** —— 这是整个赛道的空白，AzaLoop 已经占住这个位置。
- AzaLoop 当前最大的问题不是「流程不通」，而是**孤儿代码与子系统未被主线驱动**（见 `flow-review-and-optimization.md`）。

---

## 2. 竞品逐项目速览（18 个）

| # | 仓库 | 一句话定位 | 是否 Spec 先行 | 自主循环 | 防死循环 | 跨会话续跑 | 多任务并行 | 一键构建分发 | GitHub 竞品搜索 |
|---|------|-----------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 1 | OthmanAdi/planning-with-files | 磁盘文件持久化规划技能 | ❌ | ✅ `--autonomous` | ✅ gated Stop 门 | ✅ Session Recovery | ⚠️ slug 隔离 | npx/Cursor 插件 | ❌ |
| 2 | github/spec-kit | GitHub 官方 SDD 工具包 | ✅ | ❌（无循环引擎） | ⚠️ tasks.md 持久 | ⚠️ 增量追加 | ✅ bundle 批量 | zip + Python CLI | ❌ |
| 3 | garrytan/gstack | 23 角色工程团队技能 | ✅ `/autoplan` | ⚠️ PTY smoke 重试 | ✅ 3 次重发上限 | ✅ memory-ingest | ✅ Review Army | npm + 插件 | ❌ |
| 4 | Fission-AI/OpenSpec | Spec-Driven 框架（store 核心） | ✅ | ✅ `/goal` 条件循环 | ✅ 完成信号 | ✅ status block | ✅ 多 store/多仓 | CLI + devcontainer | ❌ |
| 5 | cobusgreyling/loop-engineering | 「循环工程」模式库+CLI | ❌ | ✅ L1→L3 分级 | ✅ **circuit breaker** | ✅ STATE.md | ✅ 7 生产模式 | 7 个 npx 包 | ❌ |
| 6 | twj515895394/andrej-karpathy-skills-12 | Karpathy 12 条铁律契约 | ❌ | ❌ | ⚠️ checkpoint 规则 | ❌ | ❌ | 插件/curl | ❌ |
| 7 | obra/superpowers | 完整软件开发方法论技能集 | ✅ brainstorming→plan | ✅ 子代理驱动 | ✅ 固化计划+TDD | ✅ worktree+session-start 钩子 | ✅ 并发派发 | 多 harness 插件 | ❌ |
| 8 | wenqingyu/ralphy-openspec | OpenSpec + Ralph Loop | ✅ | ✅ Ralph 循环 | ✅ budget/迭代上限 | ✅ state.db/STATUS.md | ✅ worktree | npx ralphy-spec | ❌ |
| 9 | michaelshimeles/ralphy | PRD 循环工具（多代理） | ❌（消费 PRD） | ✅ 循环至 PRD 完成 | ✅ max-iter/retries | ✅ checkbox/YAML/Issue | ✅ `--parallel` | npm -g / git | ❌（深度集成 GitHub Issues） |
| 10 | ruvnet/ruflo | 智能体元 harness（100+ agent） | ✅ goals/sparc/adr | ✅ autopilot/loop-workers | ✅ A* 自适应重规划 | ✅ AgentDB/HNSW | ✅ Swarm+共识 | npm + Docker + 插件 | ❌（仅文档对比友商） |
| 11 | mindfold-ai/Trellis | 跨平台 agent 编排框架 | ✅ prd.md+七段式 spec | ✅ channel + timeout | ✅ recursion guard | ✅ `trellis mem` | ✅ channel spawn | pnpm + 各平台钩子 | ❌ |
| 12 | rpamis/comet | 可恢复长时任务 Skill 平台 | ✅ OpenSpec+Superpowers | ✅ 状态机+阶段守卫 | ✅ comet-guard | ✅ `.comet.yaml`+resume-probe | ⚠️ 单 change 单元 | npm + 33 平台 | ❌ |
| 13 | Fokkyp/claude-skills | PM 向 PRD 生成 + 竞品分析技能 | ✅ prd-generator | ❌ | ❌ | ❌ | ❌ | git clone | ❌（仅友链） |
| 14 | addyosmani/agent-skills | 24 个生产级工程技能 | ✅ `/spec`→`/build auto` | ✅ 一次批准逐任务 | ✅ 审查循环上限 | ✅ atomic commits | ✅ plan 拆分 | npx skills + 70+ 代理 | ❌ |
| 15 | jnMetaCode/superpowers-zh | superpowers 中文汉化+6 原创 | ✅ | ✅ 审查上限 3 次 | ✅ 同源机制 | ✅ 多客户端 JSON 注入 | ✅ workflow-runner | npx + 桌面 | ❌ |
| 16 | jnMetaCode/agency-orchestrator | 216+ 中文角色 YAML 编排 | ✅ product-review | ✅ loop 块+max_iter | ✅ 闸门+`--resume` | ✅ AO_HOME 全局 | ✅ concurrency | npm -g + Electron | ❌ |
| 17 | jnMetaCode/ai-coding-guide | 10 款 AI 编程工具最佳实践文档 | ❌（纯文档） | ❌ | ❌ | ❌ | ❌ | git clone | ❌ |
| 18 | jnMetaCode/shellward | AI 应用合规网关（零依赖） | ❌ | ❌ | ❌ | ⚠️ 审计日志轮转 | ✅ 批量扫描 | npm + Docker | ❌ |

---

## 3. 跨仓库共性模式（值得借鉴）

1. **规范先行（Spec-before-code）是主流共识**：superpowers、OpenSpec、ralphy、Trellis、comet、ruflo、agent-skills 全部把「先写结构化规格/PRD/验收标准」作为强制或推荐前置，以收敛需求、减少后续澄清 token。
2. **循环 = 重复同 prompt + 预算/迭代上限防死循环**：ralphy 的 `--max-iterations`、loop-engineering 的 **circuit breaker**、OpenSpec 的 `/goal` 完成信号、comet 的阶段守卫 —— 一致用**确定性条件**替代主观判断。
3. **文件即记忆实现跨会话恢复**：几乎所有项目都把进度/状态写磁盘文件（STATE.md、state.db、`.comet.yaml`、`openspec/`、`tasks/<id>/`）以对抗上下文腐烂，而非依赖对话记忆。
4. **上下文压缩收敛于三招**：(a) 摘要/剪枝（diff `--stat`、prune stack）；(b) 大小预算（spec-kit scrub、OpenSpec 50KB 预算）；(c) KV-cache 友好（稳定时间戳）。
5. **多任务 = worktree 隔离 + 并行子代理 + 批次编排**：ralphy `--parallel`、Trellis `channel spawn`、superpowers 并发派发、ruflo Swarm。
6. **分发两极**：要么 `npx/git clone` 零安装，要么 `npm -g` CLI + 桌面端；纯 Markdown 技能（SKILL.md）成为跨客户端（Claude/Cursor/Gemini/Codex）事实标准。
7. **普遍缺失 GitHub 竞品/相似仓库搜索**：18 个仓库**无一**内置「搜索 GitHub 同类项目/发现竞品」功能。这是整条赛道的空白。

---

## 4. AzaLoop 相对竞品的差异化（已具备）

| 能力 | AzaLoop 现状 | 对比竞品 |
|------|------------|---------|
| **PRD 生成时 GitHub 竞品搜索并自补充** | ✅ `prd-review-gate.ts` 调 `researchCompetitors`（GitHub API + 兜底 curated），写 `.aza/competitive-research.md`，合并进 PRD overview/goals，再写 `prd.md`/`prd.json`/OpenSpec change | 18 个竞品**全部缺失** |
| **收敛为 8 个统一 MCP 工具**（而非 30+） | ✅ `tool-registry.ts` 仅暴露 8 个；`legacy-router.ts` 兼容旧名 | 多数项目工具/技能数量膨胀（agent-skills 24、ruflo 100+、agency 216+） |
| **10 层架构 + 多级循环 + 完备护栏** | ✅ L0–L9；外/内/阶段循环；circuit-breaker / deadlock-detector / hard-stop / completion-gate / recursion-guard / red-flags | loop-engineering 仅有 circuit breaker；comet 仅有阶段守卫 |
| **跨客户端/跨模型/跨会话全自动续航** | ✅ 零 LLM 配置（用宿主模型）；`STATE.yaml`+`ResumeGenerator`+`CompletionGate`+`aza_session(continue)`；`next_action` 链驱动 | 多数依赖特定 harness（Cursor/Claude），跨客户端需各自适配 |
| **文件落到项目目录而非 HOME** | ✅ `resolveWorkspaceRoot` + 每次注入 `workspace_path`，确保 `.aza/`、`openspec/` 落在项目根 | planning-with-files 早期版本曾把文件写到 `~` |
| **一键便携构建安装包** | ✅ `build:portable` → `dist/portable/`（含 `aza.exe`/`azaloop-mcp.exe`/`install.ps1|sh`） | 多数仅 npm/git，无便携 exe |

---

## 5. AzaLoop 相对竞品可借鉴的点（补短板）

| 借鉴来源 | 可借鉴做法 | 对 AzaLoop 的价值 |
|---------|-----------|------------------|
| loop-engineering `circuit breaker` | 每轮**摘要已尝试 / 折叠重复错误 / 最近窗口** + 停滞同错 N 次/超预算/迭代上限升级 | 让 AzaLoop 的断路器不仅看「次数」，也看「错误签名去重」，减少无效重试 |
| OpenSpec `/goal` 可验证完成条件 | 用**可验证完成信号**（而非固定迭代）决定循环终止 | 与 AzaLoop 的 CompletionGate 对齐，避免「跑满 max_iterations 才停」 |
| superpowers `subagent-driven-development` | 每任务一 agent + 两轮审查，固化计划防偏离 | 强化 AzaLoop 内循环的「执行-审查」双轨 |
| ruflo `AgentDB/HNSW + ReasoningBank` | 向量记忆复用历史推理轨迹，减重复上下文传输 | 强化 AzaLoop L2 记忆层，降低跨会话 token |
| Trellis `inject-subagent-context` + `mem extract --phase` | 仅成功时注入、按阶段抽取讨论段 | 直接优化 AzaLoop 的上下文注入，减少 token |
| agency-orchestrator `loop.max_iterations` + `{{变量}}` 仅传增量 | YAML 编排 + 增量传参 | 为 AzaLoop「多任务一批执行」提供编排范本 |
| ralphy `--parallel` + `parallel_group` | 单 PRD 文件聚合多任务、按批次并行 worktree | AzaLoop 缺「批量多 PRD/多特性并行」的范本来源 |
| spec-kit `bundle build` 字节级可复现 zip | 可复现分发产物 | 强化 AzaLoop 便携包的校验/签名 |

---

## 6. 赛道空白（AzaLoop 的机会）

1. **GitHub 竞品/相似仓库自动搜索 + 自补充 PRD** —— AzaLoop **已经做**，且 18 个竞品全缺。应作为头号卖点放大。
2. **「收敛工具面」+「跨客户端统一」+「竞品感知」三者合一** —— 目前无第二家同时做到。
3. **中文场景深度**（superpowers-zh、agency-orchestrator 是中文生态，但不做竞品搜索；AzaLoop 可吃下中文 + 竞品感知 + 跨客户端）。

---

## 7. 风险与建议优先级

- **P0（立即）**：清理孤儿代码（见 flow-review 文档），否则构建膨胀、维护混乱。
- **P1（本迭代）**：把「GitHub 竞品搜索」从「已接线但可被绕过」升级为「默认且可见」，并在 PRD 文档里显式列出竞品对比段。
- **P2（下迭代）**：补齐「多任务一批执行」（借鉴 ralphy/agency 的并行 worktree + YAML 编排）。
- **P3（探索）**：引入 circuit breaker 的「错误签名去重」与向量记忆，进一步降 token。

> 完整流程贯通性审查与孤儿逻辑清单见同目录 `flow-review-and-optimization.md`。
