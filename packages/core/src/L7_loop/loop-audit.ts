/**
 * The audit level assigned to a project based on its signal scores.
 *
 * - **L0 Draft** — Minimal automation; loop is in draft/manual mode.
 * - **L1 Report-only** — Loop runs but only reports; no autonomous actions.
 * - **L2 Assisted** — Loop can take actions with human assistance/approval.
 * - **L3 Unattended** — Loop can run fully autonomously without human oversight.
 */
export type AuditLevel = 'L0' | 'L1' | 'L2' | 'L3';

/**
 * The category a signal belongs to.
 */
export type SignalCategory =
  | 'state'
  | 'skill'
  | 'safety'
  | 'automation'
  | 'isolation'
  | 'cost'
  | 'permission'
  | 'anti-stall'
  | 'activity';

/**
 * A single audit signal definition.
 */
export interface SignalDefinition {
  /** Unique identifier (e.g. `state_file_exists`). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** The category this signal belongs to. */
  category: SignalCategory;
  /** Weight in the overall score (0–1 range; all weights sum to 1.0). */
  weight: number;
  /** Human-readable description of what this signal checks. */
  description: string;
}

/**
 * Result of evaluating a single signal.
 */
export interface SignalResult {
  /** The signal definition that was evaluated. */
  id: string;
  label: string;
  category: SignalCategory;
  /** Whether the signal passed (is present/satisfied). */
  passed: boolean;
  /** Weight of this signal. */
  weight: number;
  /** Points contributed to the total score (weight * 100 if passed, 0 otherwise). */
  points: number;
  /** Detail about the evaluation. */
  detail: string;
}

/**
 * Overall audit result.
 */
export interface LoopAuditResult {
  /** Total score (0–100). */
  score: number;
  /** The assigned audit level based on score thresholds. */
  level: AuditLevel;
  /** Individual signal results. */
  signals: SignalResult[];
  /** Recommendations for improving the score. */
  recommendations: string[];
}

/**
 * Input for the audit — a map of signal IDs to their pass/fail status.
 */
export type SignalInput = Record<string, boolean>;

/**
 * The 18 audit signals across 9 categories.
 *
 * | #  | Category    | Signal ID                  | Description |
 * |----|-------------|----------------------------|-------------|
 * | 1  | State       | state_file_exists          | State file is present and valid |
 * | 2  | State       | loop_md_exists             | LOOP.md exists and is up-to-date |
 * | 3  | State       | run_log_exists             | run-log file exists with entries |
 * | 4  | Skill       | triage_skill_registered     | Triage skill is registered |
 * | 5  | Skill       | verifier_skill_registered  | Verifier skill is registered |
 * | 6  | Safety      | safety_docs_present        | Safety documentation is present |
 * | 7  | Safety      | agents_md_present          | AGENTS.md file exists |
 * | 8  | Safety      | human_escalation_configured | Human escalation path is configured |
 * | 9  | Automation  | workflows_configured       | CI/CD workflows are configured |
 * | 10 | Automation  | patterns_documented        | Automation patterns are documented |
 * | 11 | Isolation   | worktree_isolated          | Git worktree isolation is enabled |
 * | 12 | Isolation   | mcp_isolated               | MCP servers are isolated |
 * | 13 | Cost        | budget_configured          | Token budget is configured |
 * | 14 | Cost        | run_log_cost_tracked       | Run-log tracks token cost |
 * | 15 | Permission  | least_privilege_enforced   | Least-privilege permissions are enforced |
 * | 16 | Anti-stall  | circuit_breaker_active     | Circuit breaker is active |
 * | 17 | Activity    | last_run_recent             | Last run was within acceptable time window |
 * | 18 | Activity    | git_commits_present        | Git commits exist from the loop |
 */
export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  // State (3 signals)
  {
    id: 'state_file_exists',
    label: 'State file exists',
    category: 'state',
    weight: 1 / 18,
    description: 'A valid STATE file is present and can be read by the loop',
  },
  {
    id: 'loop_md_exists',
    label: 'LOOP.md exists',
    category: 'state',
    weight: 1 / 18,
    description: 'LOOP.md file exists and is up-to-date with current loop status',
  },
  {
    id: 'run_log_exists',
    label: 'Run-log exists',
    category: 'state',
    weight: 1 / 18,
    description: 'A run-log file exists with recorded entries',
  },

  // Skill (2 signals)
  {
    id: 'triage_skill_registered',
    label: 'Triage skill registered',
    category: 'skill',
    weight: 1 / 18,
    description: 'The triage skill is registered and available for the outer loop',
  },
  {
    id: 'verifier_skill_registered',
    label: 'Verifier skill registered',
    category: 'skill',
    weight: 1 / 18,
    description: 'The verifier skill is registered for quality gate validation',
  },

  // Safety (3 signals)
  {
    id: 'safety_docs_present',
    label: 'Safety docs present',
    category: 'safety',
    weight: 1 / 18,
    description: 'Safety documentation is present in the project',
  },
  {
    id: 'agents_md_present',
    label: 'AGENTS.md present',
    category: 'safety',
    weight: 1 / 18,
    description: 'AGENTS.md file exists with agent rules and constraints',
  },
  {
    id: 'human_escalation_configured',
    label: 'Human escalation configured',
    category: 'safety',
    weight: 1 / 18,
    description: 'A human escalation path is configured for critical failures',
  },

  // Automation (2 signals)
  {
    id: 'workflows_configured',
    label: 'Workflows configured',
    category: 'automation',
    weight: 1 / 18,
    description: 'CI/CD workflows are configured for the project',
  },
  {
    id: 'patterns_documented',
    label: 'Patterns documented',
    category: 'automation',
    weight: 1 / 18,
    description: 'Automation patterns are documented and reusable',
  },

  // Isolation (2 signals)
  {
    id: 'worktree_isolated',
    label: 'Worktree isolated',
    category: 'isolation',
    weight: 1 / 18,
    description: 'Git worktree isolation is enabled for parallel work',
  },
  {
    id: 'mcp_isolated',
    label: 'MCP isolated',
    category: 'isolation',
    weight: 1 / 18,
    description: 'MCP servers are isolated from the main environment',
  },

  // Cost (2 signals)
  {
    id: 'budget_configured',
    label: 'Budget configured',
    category: 'cost',
    weight: 1 / 18,
    description: 'A token budget is configured and enforced',
  },
  {
    id: 'run_log_cost_tracked',
    label: 'Run-log cost tracked',
    category: 'cost',
    weight: 1 / 18,
    description: 'The run-log tracks token cost per iteration',
  },

  // Permission (1 signal)
  {
    id: 'least_privilege_enforced',
    label: 'Least-privilege enforced',
    category: 'permission',
    weight: 1 / 18,
    description: 'Least-privilege permissions are enforced for all tools and agents',
  },

  // Anti-stall (1 signal)
  {
    id: 'circuit_breaker_active',
    label: 'Circuit breaker active',
    category: 'anti-stall',
    weight: 1 / 18,
    description: 'The circuit breaker is active and monitoring all loop levels',
  },

  // Activity proof (2 signals)
  {
    id: 'last_run_recent',
    label: 'Last run recent',
    category: 'activity',
    weight: 1 / 18,
    description: 'The last loop run was within an acceptable time window',
  },
  {
    id: 'git_commits_present',
    label: 'Git commits present',
    category: 'activity',
    weight: 1 / 18,
    description: 'Git commits from the loop are present in the repository',
  },
];

/**
 * Score thresholds for each audit level.
 *
 * - L0 Draft:       0 – 39
 * - L1 Report-only:  40 – 59
 * - L2 Assisted:     60 – 79
 * - L3 Unattended:    80 – 100
 */
export const LEVEL_THRESHOLDS: ReadonlyArray<{ level: AuditLevel; min: number; max: number }> = [
  { level: 'L0', min: 0, max: 39 },
  { level: 'L1', min: 40, max: 59 },
  { level: 'L2', min: 60, max: 79 },
  { level: 'L3', min: 80, max: 100 },
];

/**
 * Map from level to its human-readable description.
 */
export const LEVEL_DESCRIPTIONS: Record<AuditLevel, string> = {
  L0: 'Draft — minimal automation; loop is in manual/draft mode',
  L1: 'Report-only — loop runs but only reports; no autonomous actions',
  L2: 'Assisted — loop can take actions with human assistance/approval',
  L3: 'Unattended — loop can run fully autonomously without human oversight',
};

/**
 * The loop audit engine.
 *
 * Evaluates 18 signals across 9 categories and produces a score (0–100)
 * and an assigned level (L0–L3). Each signal contributes equally (1/18
 * of the total score, rounded to whole points).
 */
export class LoopAudit {
  private signals: SignalDefinition[];

  constructor(signals: SignalDefinition[] = SIGNAL_DEFINITIONS) {
    this.signals = signals;
  }

  /**
   * Evaluate the audit given a map of signal pass/fail results.
   *
   * Signals not present in the input are treated as `false` (failed).
   */
  evaluate(input: SignalInput): LoopAuditResult {
    const results: SignalResult[] = this.signals.map((def) => {
      const passed = input[def.id] === true;
      const points = passed ? Math.round(def.weight * 100) : 0;
      return {
        id: def.id,
        label: def.label,
        category: def.category,
        passed,
        weight: def.weight,
        points,
        detail: passed
          ? `${def.label} — satisfied`
          : `${def.label} — not satisfied: ${def.description}`,
      };
    });

    // Calculate total score — sum of all signal points, normalized to 0–100
    const rawScore = results.reduce((sum, r) => sum + r.weight * 100, 0);
    const earnedScore = results.reduce((sum, r) => sum + (r.passed ? r.weight * 100 : 0), 0);
    const score = Math.round((earnedScore / rawScore) * 100);

    const level = this.scoreToLevel(score);

    const recommendations = this.generateRecommendations(results);

    return {
      score,
      level,
      signals: results,
      recommendations,
    };
  }

  /**
   * Convert a numeric score to an audit level.
   */
  scoreToLevel(score: number): AuditLevel {
    for (const threshold of LEVEL_THRESHOLDS) {
      if (score >= threshold.min && score <= threshold.max) {
        return threshold.level;
      }
    }
    return 'L0';
  }

  /**
   * Get the human-readable description for a level.
   */
  getLevelDescription(level: AuditLevel): string {
    return LEVEL_DESCRIPTIONS[level];
  }

  /**
   * Get all signal definitions.
   */
  getSignals(): SignalDefinition[] {
    return [...this.signals];
  }

  /**
   * Get signals filtered by category.
   */
  getSignalsByCategory(category: SignalCategory): SignalDefinition[] {
    return this.signals.filter(s => s.category === category);
  }

  // ── private helpers ──

  private generateRecommendations(results: SignalResult[]): string[] {
    const failed = results.filter(r => !r.passed);
    if (failed.length === 0) {
      return ['All 18 signals satisfied — project is at L3 (Unattended) level.'];
    }

    const recommendations: string[] = [];

    // Group failures by category
    const byCategory = new Map<SignalCategory, SignalResult[]>();
    for (const f of failed) {
      const existing = byCategory.get(f.category) || [];
      existing.push(f);
      byCategory.set(f.category, existing);
    }

    // Generate category-level recommendations
    const categoryLabels: Record<SignalCategory, string> = {
      state: 'State Management',
      skill: 'Skill Registry',
      safety: 'Safety & Guardrails',
      automation: 'Automation',
      isolation: 'Isolation',
      cost: 'Cost Control',
      permission: 'Permission Model',
      'anti-stall': 'Anti-Stall Mechanisms',
      activity: 'Activity Proof',
    };

    for (const [category, failures] of byCategory) {
      const label = categoryLabels[category];
      const signalList = failures.map(f => f.label).join(', ');
      recommendations.push(
        `[${label}] Missing: ${signalList} — see signal descriptions for requirements.`,
      );
    }

    // Add level-specific recommendation
    const passedCount = results.length - failed.length;
    if (passedCount < 7) {
      recommendations.push(
        `Currently at L0 (Draft). Address ${failed.length} missing signal(s) to reach L1 (Report-only, needs 40+).`,
      );
    } else if (passedCount < 11) {
      recommendations.push(
        `Currently at L1 (Report-only). Address ${failed.length} missing signal(s) to reach L2 (Assisted, needs 60+).`,
      );
    } else if (passedCount < 15) {
      recommendations.push(
        `Currently at L2 (Assisted). Address ${failed.length} missing signal(s) to reach L3 (Unattended, needs 80+).`,
      );
    } else {
      recommendations.push(
        `Nearly complete — ${failed.length} signal(s) remaining to reach L3 (Unattended).`,
      );
    }

    return recommendations;
  }
}
