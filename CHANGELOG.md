# Changelog

All notable changes to AzaLoop are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-07-15

### Fixed (portable 一键构建安装包 — 此前完全无法启动)
- **SEA 可执行文件启动崩溃**：`scripts/build-portable.ts` 的 `bundleWithEsbuild` 给 CJS bundle 加了 `#!/usr/bin/env node` banner，而 Node SEA 内嵌 CJS 加载器（`embedderRunCjs`）不剥离 shebang，导致 `aza.exe`/`azaloop-mcp.exe` 启动即 `SyntaxError`。已移除 banner，改为在 SEA 回退副本上单独加 shebang。
- **`js-yaml` 运行时无法解析**：原 `external: ['js-yaml']` 使 SEA 运行时报 `ERR_UNKNOWN_BUILTIN_MODULE: js-yaml`；`upgrade.ts` 直接 `require('js-yaml')` 且 cli 包未声明该依赖。已将 `js-yaml` 加入 `packages/cli/package.json` 依赖并由 esbuild 打包进 SEA。
- **`client-rules-generator` 顶层 `program.parse(process.argv)` 误路由**：该模块在被 `index.ts` import 时即解析 argv，SEA 单模块下 `require.main === module` 恒真，导致 `aza init`/`aza budget` 等被误判为未知 client。已加入口判定（仅当本文件为真实入口时才 parse）。
- **CLI `--root`/`--dir` 在 Windows 上写错位置**：原生 Windows `aza.exe` 来自 Git-Bash 的 `/c/...`、`/p/...` POSIX 盘符前缀会被当成「相对当前盘根」→ 静默写到 `P:\c\...` 等错误路径。新增 `normalizeCliPath()`（`packages/cli/src/util/path.ts`），将 `/x/...` 归一化为 `X:\...`，并接入 `init/setup/loop/continue/status/budget/audit/upgrade/pack` 全部命令。
- **`aza_loop(orch_run)` 的 `requiredEvidence.map is not a function` 崩溃**：轻量 YAML 解析器把数组解析成字符串，已加数组守卫。
- **MCP 表面全连通校验**：逐 handler 核对，28 个 tool 模块中 25 个本就接入 8-tool 主线，剩余 3 个（`aza-cost`/`aza-plugin`/`aza-test-loop`）已接入 `aza_meta`；`client-rules-generator.ts` 亦非孤儿。导出 handler 与 dispatch 完全对齐，无孤儿逻辑。
- **`aza init` 写入的 `STATE.yaml` 触发 `StateManager.load()` 校验失败**：原来手工拼 YAML 模板把 `updated_at` 写成未加引号的 ISO 时间戳，js-yaml `load()` 会把它解析成 `Date` 对象，导致 `aza status`/`aza continue` 首次运行报「Not initialized」或抛 `ZodError`。改为用 schema 感知的 `StateManager.update()` 生成 `STATE.yaml`，时间戳自动加引号、字段始终满足 `StateSchema`。

### Added
- `scripts/smoke-competitive.mts` — 竞品搜索冒烟（L2 实时/回退、L1 curated、缓存命中、`mode=off` 跳过、`prd.md` 含 `## Competitive Research` 章节）。
- `scripts/smoke-prd-gate.mts` — 校验生成 PRD 能通过严格 14 维闸门（`p0=0 && p1=0`）。
- `scripts/e2e-real-loop.ts` 改用真实生成 PRD，验证 `open` 阶段可正确推进。

## [0.2.1] - 2026-07-14

### Changed
- **GitHub 竞品搜索升级为「默认 + 可见 + 不可绕过」**：新增 `runCompetitiveResearch()` 单一入口（`github-competitive-research.ts`），被 `aza_prd` 的 `review` 与 `generate` 两条路径共用，杜绝走 `generate` 绕过实时搜索。`AZA_COMPETITOR_RESEARCH`(默认 `auto`)：L1 走 curated 离线池、L2–L4 走实时 GitHub；24h 磁盘缓存按 query 归一化，降低 token/请求。
- **PRD 增加独立 `## Competitive Research` 章节**：`writePrdMarkdown` 现在固化渲染竞品链接/★stars/差异化，`prd.md` 与 `competitive-research.md` 双写；`PRDReviewGate.review()` 通过 `competitive` 字段把 source/count/top/cached 暴露给宿主。
- **GitHub 搜索词智能化**：`buildSearchKeywords()` 从 PRD 标题/描述抽取领域关键词，替换原来的固定关键词袋。
- **3 个有价值模块接入主线**（此前仅被编译进 `dist/`）：`aza_meta(cost*)` → `handleCost`（CostTracker 令牌成本）、`aza_meta(plugin*)` → `handlePlugin`（PluginLoader，替换原 stub）、`aza_meta(test_loop|selftest|doctor)` → `handleTestLoop`（AutoLoopEngine 自测）。

### Removed
- `PRDGenerator.generateAsync()`：无调用方的孤儿方法，其职责已由 `runCompetitiveResearch` 统一承担。

### Fixed
- `aza_prd(generate)` 此前跳过实时竞品搜索的旁路问题。
- 更正上一轮「30+ 孤儿 tools/*.ts 应删除」的误判（实际仅 3 个且均已接入主线）。

## [0.2.0] - 2026-07-14

### Changed
- **MCP converged to 8 tools**: `aza_session` / `aza_prd` / `aza_loop` / `aza_spec` / `aza_quality` / `aza_finish` / `aza_memory` / `aza_meta` (legacy names still routed via alias).
- **MCP remapping**: `remapNext` / `remapAutoLoop` share `LEGACY_TOOL_MAP` so host tools (`aza_task_design` → `aza_spec/design`) are no longer collapsed to `aza_loop/next`.
- **PRD approve unlocks design**: `markPrdApproved` sets `prd_valid`, records DP-0/DP-1, writes `aza_prd_approve` audit marker (T18).
- **completeStage** records Decision Points and syncs STATE to disk.
- **Gate 1**: prefers `pnpm typecheck`; skips ESLint when no config is present.
- **Gate 2**: honors `AZA_QUALITY_TEST_CMD`; prefers package `test` script.
- **docs/PRD.md** + OpenSpec `azaloop-0-2-x` + CLI seed rules updated to the 8-tool surface.
- **Primary spine fully wired for Cursor full-auto**: approve defaults to OpenSpec scaffold → `aza_loop(full)` cooperative awaitingAction → quality Gate1–7 → `aza_finish(ship)`.
- Stage-tool guard rewritten for the 8-tool surface; `OuterLoop` enabled by default on MCP LoopController.
### Cursor full-auto protocol
- Force `next_action` / `report_tool`; slash commands under `templates/clients/cursor/commands/`
- Roles: `/aza-ceo` `/aza-plan` `/aza-design` `/aza-review` `/aza-qa` `/aza-cso` `/aza-ship`
- Process skills: brainstorming, tdd-process, verification-before-completion
- `aza_loop(orch_run)` loads `.aza/orchestrator.yaml` (seeds from template) and writes `.aza/orch-output/`
- Local verify: `npx tsx scripts/verify-spine.ts`


### Added
- `scripts/check-mcp-drift.ts` — CI guard for registry≡handlers (exactly 8).
- Task board files under `.aza/`: `task_plan.md` / `findings.md` / `progress.md`.
- `aza_finish(ship)` quality-then-finish delivery action; `AZA_AUTO_APPROVE_PRD` / `auto_approve` for unattended Cursor runs.
- Gate 7 (ADR compliance) registered in quality pipeline.
- **WorktreeManager** — real `git worktree add/remove/list/prune` via `aza_meta(worktree*)`.
- **SwarmCoordinator** — depends_on + max_parallel queue with host instructions; `aza_meta(swarm*)`.
- **shellward 8-layer DLP** wired into MCP pre-tool (`runShellwardGuard`); `aza_meta(dlp_scan)`.
- **`.aza/stores/{specs,changes,vectors}`** + NSW vector index (`createNSWIndex`) replacing brute-force-only HNSW placeholder.
- **Cursor third-party setup**: `scripts/setup-cursor.mjs`, `docs/CURSOR-THIRD-PARTY.md`, smoke tests `scripts/smoke-cursor-mcp.ts`.

### Fixed
- `aza_finish_work` was listed but not callable — now via `aza_finish`.
- `full` mode no longer spins maxIterations while waiting for host LLM tools.
- DAG build result persisted to `.aza/dag.json`.

## [0.1.0] - 2025-07-12

### Added
- **Three-level loop engine**: OuterLoop (story scheduling + DAG parallel dispatch) → InnerLoop (5 stages: open→design→build→verify→archive) → PhaseLoop (maker→checker→gate→optimizer)
- **Circuit Breaker**: 4 dimensions (iteration/token/stagnation/no-progress) × 3 levels (phase/inner/outer)
- **Completion Gate**: 6 conditions including SHA-256 attestation verification
- **Quality Pipeline**: 6 gates (lint, test, regression, security, acceptance, loop-audit) with parallel batch execution
- **MCP Event Simulator**: Pre-tool/post-tool security scanning (L1-L7 defense layers) with policy.yaml integration
- **MCP Event Bridge**: All 48 MCP tools wrapped with automatic event simulation
- **Run Ledger**: Append-only JSONL recording every tool invocation (borrowed from planning-with-files)
- **Loop Cost**: Token budget estimator with per-stage breakdown (borrowed from loop-engineering)
- **Workspace Journal**: Automatic session archiving with next-session summary injection (borrowed from Trellis)
- **Explore Mode**: Think-before-commit analysis tool (borrowed from OpenSpec)
- **Skill Eval Platform**: Rubric scoring + Pass@k metrics (borrowed from Comet)
- **Context Orchestrator**: Per-stage JSONL context injection with Summarize→Prune→Inject pipeline
- **Injection Engine**: Stage-specific knowledge injection into inner-loop design phase
- **Dynamic Binder**: PhaseLoop role prompt injection (maker/checker per stage)
- **Loop Audit**: 18 real signals collected from filesystem and state (L0-L3 scoring)
- **Real Handlers**: Async tsc/vitest/secret-scan with checker result caching
- **Policy-as-Code**: Declarative security policy via policy.yaml with lightweight YAML parser
- **China Compliance Checker**: 网络安全法 / PIPL / 等保 2.0 / 数据出境 / AI 标识 scoring
- **24+ Client Support**: Auto-detection + degradation strategies (T1 full / T2 bridged / T3 manual)
- **CLI Commands**: `aza init`, `aza loop`, `aza status`, `aza budget`, `aza audit`, `aza continue`, `aza health`, `aza upgrade`
- **CI/CD**: GitHub Actions workflow with typecheck + test + e2e-real-loop + npm publish + portable SEA builds
- **DAG Builder**: Unified task-based (L7) + artifact-based (L8 merged) dependency graph with parallel-ready detection
- **SDD Dual Review**: Implementer + reviewer verdict pattern for stage advancement

### Architecture
- 10-layer design (L0 Platform → L9 Knowledge) with three-level loop
- PRD-driven pipeline: `aza_prd generate` → `aza_loop next` → `aza_task verify` → `aza_quality check` → `aza_ship`
- Hook/event lifecycle: pre-events → post-events → lifecycle-events (3 consolidated files)
- MCP server with 48 handler = 48 schema (zero drift)
