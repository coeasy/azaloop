import { LoopAudit } from '@azaloop/core';
import type { SignalInput } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as fs from 'fs';
import * as path from 'path';

const audit = new LoopAudit();

/**
 * Probe the workspace for the 18 audit signals and return a SignalInput map.
 *
 * Each signal is evaluated by checking for the presence of the corresponding
 * file/directory or capability marker in the workspace.
 */
function collectSignals(workspacePath: string): SignalInput {
  const root = workspacePath || '.';
  const azaDir = path.join(root, '.aza');
  const gitDir = path.join(root, '.git');
  const githubDir = path.join(root, '.github');

  const exists = (p: string): boolean => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };

  const hasContent = (p: string): boolean => {
    try {
      return exists(p) && fs.statSync(p).size > 0;
    } catch {
      return false;
    }
  };

  // Read .aza/STATE.yaml to detect loop markers.
  const statePath = path.join(azaDir, 'STATE.yaml');
  let stateContent = '';
  if (exists(statePath)) {
    try {
      stateContent = fs.readFileSync(statePath, 'utf-8');
    } catch {
      stateContent = '';
    }
  }

  return {
    // State signals
    state_file_exists: exists(statePath) && hasContent(statePath),
    loop_md_exists: exists(path.join(root, 'LOOP.md')),
    run_log_exists: hasContent(path.join(azaDir, 'run-log.jsonl')) || hasContent(path.join(azaDir, 'run-log.json')),

    // Skill signals
    triage_skill_registered: /triage/i.test(stateContent) || exists(path.join(azaDir, 'skills', 'triage.json')),
    verifier_skill_registered: /verif/i.test(stateContent) || exists(path.join(azaDir, 'skills', 'verifier.json')),

    // Safety signals
    safety_docs_present: exists(path.join(azaDir, 'SAFETY.md')) || exists(path.join(root, 'SAFETY.md')),
    agents_md_present: exists(path.join(root, 'AGENTS.md')),
    human_escalation_configured: /escalat|human|manual/i.test(stateContent),

    // Automation signals
    workflows_configured: exists(path.join(githubDir, 'workflows')),
    patterns_documented: exists(path.join(root, 'CONVENTIONS.md')) || exists(path.join(azaDir, 'PATTERNS.md')),

    // Isolation signals
    worktree_isolated: exists(gitDir) && /worktree/i.test(stateContent),
    mcp_isolated: exists(path.join(azaDir, 'mcp.json')) || exists(path.join(root, 'mcp.json')),

    // Cost signals
    budget_configured: /budget|token.*limit|cost.*limit/i.test(stateContent),
    run_log_cost_tracked: /token.*cost|cost.*track/i.test(stateContent),

    // Permission signal
    least_privilege_enforced: /least.?privilege|permission/i.test(stateContent) || exists(path.join(azaDir, 'permissions.json')),

    // Anti-stall signal
    circuit_breaker_active: /circuit.?breaker|breaker.*active/i.test(stateContent),

    // Activity signals
    last_run_recent: (() => {
      try {
        const stat = fs.statSync(statePath);
        const ageMs = Date.now() - stat.mtimeMs;
        // Considered recent if modified within the last 7 days.
        return ageMs < 7 * 24 * 60 * 60 * 1000;
      } catch {
        return false;
      }
    })(),
    git_commits_present: exists(gitDir),
  };
}

/**
 * `aza_audit` — run a loop-audit against the workspace and return the
 * resulting score (0–100), audit level (L0–L3), per-signal breakdown, and
 * recommendations.
 */
export async function handleAudit(workspacePath?: string): Promise<LoopResponse> {
  try {
    const signals = collectSignals(workspacePath ?? '.');
    const result = audit.evaluate(signals);

    return {
      success: true,
      data: {
        score: result.score,
        level: result.level,
        level_description: audit.getLevelDescription(result.level),
        signals: result.signals,
        recommendations: result.recommendations,
      },
      next_action:
        result.score >= 80
          ? { tool: 'aza_loop_next', action: 'next', reason: `Audit level ${result.level} — autonomous loop ready` }
          : { tool: 'aza_audit', action: 'fix', reason: `Audit level ${result.level} (score ${result.score}) — address recommendations before autonomous run` },
      metadata: { iteration: 0, progress: `${result.score}%`, stage: 'audit' },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: '0%', stage: 'audit' },
    };
  }
}
