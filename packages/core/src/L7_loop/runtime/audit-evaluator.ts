/**
 * R12 P6 Plus2 (P2 退出标准) — Audit Evaluator 拆分
 *
 * 借鉴 gstack「production-readiness review」+ spec-kit「audit report」：
 *
 * 痛点：loop-controller.ts audit() ~100 行；信号收集 + 评估逻辑混在一起，
 *       难以独立测试和扩展。
 *
 * 解法：抽出 AuditEvaluator 工具类，封装 18 个 readiness 信号的收集与评估。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LoopAudit, SignalInput } from '../loop-audit';
import type { AzaloopConfig } from '@azaloop/shared';
import type { StateMachine } from '../state-machine';
import type { StateManager } from '../../state/state-manager';
import type { TokenBudget } from '../token-budget';

// ── AuditEvaluator 依赖（从 LoopController 注入）──

export interface AuditEvaluatorDeps {
  /** 状态机（用于读取 iteration） */
  stateMachine: StateMachine;
  /** 状态管理器 */
  stateManager: StateManager | null;
  /** Token 预算（用于 budgetConfigured 信号） */
  tokenBudget: TokenBudget;
  /** 审计器（最终评估） */
  auditor: LoopAudit;
  /** .aza 目录 */
  azaDir: string;
  /** 已加载的 azaloop.yaml 配置 */
  config: AzaloopConfig;
  /** Stop hook 激活状态 */
  stopHookActive: boolean;
  /** 账本是否有进展 */
  ledgerHasProgress: boolean;
  /** V12 启用状态（用于 triage_skill_registered 等信号） */
  enableV12: boolean;
}

/**
 * 审计评估器：负责生产就绪度信号的收集与评估。
 */
export class AuditEvaluator {
  constructor(private readonly deps: AuditEvaluatorDeps) {}

  /**
   * 收集所有信号并评估生产就绪度。
   * 行为等价于原 LoopController.audit() 方法。
   */
  async run(): Promise<ReturnType<LoopAudit['evaluate']>> {
    const signals = this.collectSignals();
    return this.deps.auditor.evaluate(signals);
  }

  /**
   * 收集 18 个生产就绪度信号。
   * 全部为 best-effort — 单个信号收集失败不影响整体评估。
   */
  private collectSignals(): SignalInput {
    const { azaDir, stateManager, stateMachine, tokenBudget, config, stopHookActive, enableV12 } = this.deps;
    const workDir = azaDir ? path.dirname(azaDir) : process.cwd();

    // ── State + log files ──
    const stateFileExists = stateManager !== null;
    const loopMdExists = azaDir ? safeExists(path.join(azaDir, 'LOOP.md')) : false;
    const runLogExists = azaDir ? safeExists(path.join(azaDir, 'run-ledger.jsonl')) : false;

    // ── Skill registration (V12 enables real handler providers) ──
    const triageSkillRegistered = enableV12;
    const verifierSkillRegistered = enableV12;

    // ── Safety docs ──
    const safetyDocsPresent = safeExists(path.join(workDir, 'docs', 'safety.md')) ||
      safeExists(path.join(workDir, 'SAFETY.md'));
    const agentsMdPresent = safeExists(path.join(workDir, 'AGENTS.md'));

    // ── Human escalation ──
    const humanEscalationConfigured = stopHookActive ||
      (config.loop as any)?.human_escalation === true;

    // ── Workflows configured (CI files) ──
    const workflowsConfigured = safeExists(path.join(workDir, '.github', 'workflows')) ||
      safeExists(path.join(workDir, '.gitlab-ci.yml'));

    // ── Patterns documented (conventions.jsonl) ──
    const patternsDocumented = azaDir
      ? safeExists(path.join(azaDir, 'spec-conventions', 'conventions.jsonl'))
      : false;

    // ── Isolation ──
    const worktreeIsolated = false; // opt-in
    const mcpIsolated = true;       // MCP servers always isolated by design

    // ── Cost ──
    const budgetConfigured = tokenBudget.perSessionLimit !== 120_000 ||
      typeof (config.loop as any)?.token_budget === 'number';
    const runLogCostTracked = this.deps.ledgerHasProgress || runLogExists;

    // ── Permission + anti-stall + activity ──
    const leastPrivilegeEnforced = true; // enforced by MCP event bridge design
    const circuitBreakerActive = true;   // always active
    const lastRunRecent = this.checkLastRunRecent(azaDir);
    const gitCommitsPresent = azaDir
      ? safeExists(path.join(path.dirname(azaDir), '.git')) && stateMachine.getState().iteration > 0
      : false;

    return {
      state_file_exists: stateFileExists,
      loop_md_exists: loopMdExists,
      run_log_exists: runLogExists,
      triage_skill_registered: triageSkillRegistered,
      verifier_skill_registered: verifierSkillRegistered,
      safety_docs_present: safetyDocsPresent,
      agents_md_present: agentsMdPresent,
      human_escalation_configured: humanEscalationConfigured,
      workflows_configured: workflowsConfigured,
      patterns_documented: patternsDocumented,
      worktree_isolated: worktreeIsolated,
      mcp_isolated: mcpIsolated,
      budget_configured: budgetConfigured,
      run_log_cost_tracked: runLogCostTracked,
      least_privilege_enforced: leastPrivilegeEnforced,
      circuit_breaker_active: circuitBreakerActive,
      last_run_recent: lastRunRecent,
      git_commits_present: gitCommitsPresent,
    };
  }

  /**
   * 检查最近运行时间（24h 内）。
   */
  private checkLastRunRecent(azaDir: string | undefined): boolean {
    if (!azaDir) return false;
    try {
      const runStatePath = path.join(azaDir, 'run-state.json');
      if (!fs.existsSync(runStatePath)) return false;
      const raw = JSON.parse(fs.readFileSync(runStatePath, 'utf-8'));
      if (!raw.updated_at) return false;
      const lastRun = new Date(raw.updated_at).getTime();
      return (Date.now() - lastRun) < 24 * 60 * 60 * 1000; // within 24h
    } catch {
      return false;
    }
  }
}

/**
 * 安全检查文件是否存在（吞掉所有异常）。
 */
function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
