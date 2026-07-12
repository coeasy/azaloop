# Changelog

All notable changes to AzaLoop are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
