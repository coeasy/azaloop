import type { Stage } from './state-machine';
import {
  evaluateStageGate,
  type PhaseGateInput,
  type PhaseGateEvaluation,
} from './phase-gates';

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  blocking_issues: string[];
  refine_action?: string;
  refine_tool?: string;
}

export interface GuardCheck {
  name: string;
  check: () => GuardResult;
}

export class StageGuards {
  private guards: Map<Stage, GuardCheck[]> = new Map();

  register(stage: Stage, guard: GuardCheck): void {
    const existing = this.guards.get(stage) || [];
    existing.push(guard);
    this.guards.set(stage, existing);
  }

  checkStage(stage: Stage): GuardResult {
    const stageGuards = this.guards.get(stage);
    if (!stageGuards || stageGuards.length === 0) {
      return { allowed: true, blocking_issues: [] };
    }

    const allIssues: string[] = [];
    let refineAction = 'refine';
    let refineTool = 'aza_task_implement';

    for (const guard of stageGuards) {
      const result = guard.check();
      if (!result.allowed) {
        allIssues.push(...result.blocking_issues);
        if (result.refine_action) refineAction = result.refine_action;
        if (result.refine_tool) refineTool = result.refine_tool;
      }
    }

    return {
      allowed: allIssues.length === 0,
      reason: allIssues.length > 0
        ? `Blocked by ${allIssues.length} issue(s): ${allIssues.slice(0, 3).join('; ')}`
        : undefined,
      blocking_issues: allIssues,
      refine_action: refineAction,
      refine_tool: refineTool,
    };
  }

  clear(): void {
    this.guards.clear();
  }

  /**
   * Check a stage using the V12 structured PhaseGate system.
   *
   * This bridges the V11 boolean-guard system with the V12 quality-metric
   * gate system, allowing LoopController.nextV12() to use structured
   * quality gates instead of simple boolean conditions.
   */
  checkStageWithPhaseGate(stage: Stage, input: PhaseGateInput): GuardResult {
    const evaluation = evaluateStageGate(stage, input);
    const blockingIssues = evaluation.results
      .filter(r => !r.result.passed)
      .map(r => r.result.detail);

    return {
      allowed: evaluation.passed,
      reason: evaluation.blocking_reason,
      blocking_issues: blockingIssues,
      refine_action: this.inferRefineAction(stage),
      refine_tool: this.inferRefineTool(stage),
    };
  }

  private inferRefineAction(stage: Stage): string {
    const map: Record<Stage, string> = {
      open: 'generate',
      design: 'design',
      build: 'implement',
      verify: 'check',
      archive: 'generate',
    };
    return map[stage] || 'refine';
  }

  private inferRefineTool(stage: Stage): string {
    const map: Record<Stage, string> = {
      open: 'aza_prd_generate',
      design: 'aza_task_design',
      build: 'aza_task_implement',
      verify: 'aza_quality_check',
      archive: 'aza_doc_generate',
    };
    return map[stage] || 'aza_loop_next';
  }
}

/**
 * Create a StageGuards instance backed by V12 PhaseGates.
 *
 * The returned guards use `evaluateStageGate()` for each stage,
 * replacing the V11 boolean-condition approach.
 */
export function createPhaseGateAdapter(
  getPhaseInput: (stage: Stage) => PhaseGateInput,
): StageGuards {
  const guards = new StageGuards();

  const stages: Stage[] = ['open', 'design', 'build', 'verify', 'archive'];
  for (const stage of stages) {
    guards.register(stage, {
      name: `Phase gate adapter for ${stage}`,
      check: () => {
        const input = getPhaseInput(stage);
        const evaluation = evaluateStageGate(stage, input);
        const blockingIssues = evaluation.results
          .filter(r => !r.result.passed)
          .map(r => r.result.detail);
        return {
          allowed: evaluation.passed,
          blocking_issues: blockingIssues,
          reason: evaluation.blocking_reason,
        };
      },
    });
  }

  return guards;
}

export type GuardConditionKey =
  | 'prd_valid'
  | 'stories_designed'
  | 'build_tested'
  | 'quality_passed'
  | 'archive_ready';

export function createDefaultGuards(
  getCondition: (key: GuardConditionKey) => boolean
): StageGuards {
  const guards = new StageGuards();

  guards.register('open', {
    name: 'PRD quality gate — PRD must be generated and validated (score ≥ 80%)',
    check: () => {
      const passed = getCondition('prd_valid');
      return {
        allowed: passed,
        blocking_issues: passed ? [] : ['PRD not yet validated or quality score < 80%'],
        refine_action: 'refine',
        refine_tool: 'aza_prd_generate',
      };
    },
  });

  guards.register('design', {
    name: 'Story design gate — all stories must be designed with acceptance criteria',
    check: () => {
      const passed = getCondition('stories_designed');
      return {
        allowed: passed,
        blocking_issues: passed ? [] : ['Stories not fully designed'],
        refine_action: 'design',
        refine_tool: 'aza_task_design',
      };
    },
  });

  guards.register('build', {
    name: 'Build gate — all implementations must have passing tests',
    check: () => {
      const passed = getCondition('build_tested');
      return {
        allowed: passed,
        blocking_issues: passed ? [] : ['Implementation incomplete or tests failing'],
        refine_action: 'implement',
        refine_tool: 'aza_task_implement',
      };
    },
  });

  guards.register('verify', {
    name: 'Verification gate — all 5 quality gates must pass',
    check: () => {
      const passed = getCondition('quality_passed');
      return {
        allowed: passed,
        blocking_issues: passed ? [] : ['Quality gates not all passing'],
        refine_action: 'check',
        refine_tool: 'aza_quality_check',
      };
    },
  });

  guards.register('archive', {
    name: 'Archive gate — documentation and release must be ready',
    check: () => {
      const passed = getCondition('archive_ready');
      return {
        allowed: passed,
        blocking_issues: passed ? [] : ['Archive prerequisites not met'],
        refine_action: 'generate',
        refine_tool: 'aza_doc_generate',
      };
    },
  });

  return guards;
}
