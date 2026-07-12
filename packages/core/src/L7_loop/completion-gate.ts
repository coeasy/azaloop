/**
 * Input for the completion gate evaluation.
 *
 * All six conditions must be satisfied for the loop to be allowed to stop.
 */
export interface CompletionGateInput {
  /** 1. Whether gated mode is enabled (required to allow stop). */
  gated_mode_enabled: boolean;
  /** 2. Whether there is at least one stage in "in_progress" status. */
  has_in_progress_stage: boolean;
  /** 2b. Whether all stages are completed (alternative to in_progress). */
  all_stages_completed: boolean;
  /** 3. Whether a stop hook is currently active (must be false to stop). */
  stop_hook_active: boolean;
  /** 4. Current block count. */
  block_count: number;
  /** 4b. Maximum allowed block count. */
  block_count_limit: number;
  /** 5. Whether the ledger has recorded progress since the last block. */
  ledger_has_progress: boolean;
  /** 6. Whether SHA-256 attestation has been verified (PRD/plan integrity). */
  attestation_verified: boolean;
}

/**
 * A single condition check result.
 */
export interface ConditionResult {
  /** The condition number (1–5). */
  index: number;
  /** Short identifier for the condition. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Whether the condition is satisfied. */
  satisfied: boolean;
  /** Detail explaining why the condition passed or failed. */
  detail: string;
}

/**
 * Result of the completion gate evaluation.
 */
export interface CompletionGateResult {
  /** Whether the loop is allowed to stop (all conditions satisfied). */
  canStop: boolean;
  /** The reason stopping is blocked, if applicable. */
  blockedReason?: string;
  /** Individual condition results. */
  conditions: ConditionResult[];
}

/**
 * The completion gate ensures that the loop only stops when all five
 * safety conditions are satisfied.
 *
 * This prevents premature termination in scenarios such as:
 * - Non-gated (autonomous) mode where a stop would be unsafe
 * - No active work in progress (nothing to stop)
 * - A stop hook is actively blocking
 * - Too many blocks have accumulated (indicating a stuck loop)
 * - No progress has been made since the last block
 */
export class CompletionGate {
  /**
   * Evaluate whether the loop is allowed to stop.
   *
   * All five conditions must be satisfied:
   *
   * 1. gated mode enabled
   * 2. has in_progress stage
   * 3. stop_hook_active is false
   * 4. block count under limit
   * 5. ledger has progress since last block
   */
  evaluate(input: CompletionGateInput): CompletionGateResult {
    const conditions: ConditionResult[] = [
      {
        index: 1,
        id: 'gated_mode_enabled',
        label: 'Gated mode is enabled',
        satisfied: input.gated_mode_enabled,
        detail: input.gated_mode_enabled
          ? 'Gated mode is enabled — stop is permitted'
          : 'Gated mode is disabled — stop is not permitted in non-gated mode',
      },
      {
        index: 2,
        id: 'has_in_progress_or_completed',
        label: 'Has an in-progress stage or all completed',
        satisfied: input.has_in_progress_stage || input.all_stages_completed,
        detail: input.has_in_progress_stage
          ? 'At least one stage is in_progress'
          : input.all_stages_completed
            ? 'All stages completed — stop is permitted'
            : 'No stage is in_progress and not all completed — nothing to stop',
      },
      {
        index: 3,
        id: 'stop_hook_inactive',
        label: 'Stop hook is inactive',
        satisfied: !input.stop_hook_active,
        detail: input.stop_hook_active
          ? 'A stop hook is active — stop is blocked'
          : 'No stop hook is active',
      },
      {
        index: 4,
        id: 'block_count_under_limit',
        label: `Block count (${input.block_count}) under limit (${input.block_count_limit})`,
        satisfied: input.block_count < input.block_count_limit,
        detail: input.block_count < input.block_count_limit
          ? `Block count ${input.block_count} is within limit ${input.block_count_limit}`
          : `Block count ${input.block_count} has reached or exceeded limit ${input.block_count_limit}`,
      },
      {
        index: 5,
        id: 'ledger_has_progress',
        label: 'Ledger has progress since last block',
        satisfied: input.ledger_has_progress,
        detail: input.ledger_has_progress
          ? 'Ledger shows progress since the last block'
          : 'Ledger shows no progress since the last block',
      },
      {
        index: 6,
        id: 'attestation_verified',
        label: 'SHA-256 attestation verified',
        satisfied: input.attestation_verified,
        detail: input.attestation_verified
          ? 'Attestation hashes verified — integrity confirmed'
          : 'Attestation not verified — PRD/plan integrity unchecked',
      },
    ];

    const failures = conditions.filter(c => !c.satisfied);

    if (failures.length === 0) {
      return { canStop: true, conditions };
    }

    const blockedReason = failures
      .map(f => `Condition ${f.index} (${f.id}): ${f.detail}`)
      .join('; ');

    return {
      canStop: false,
      blockedReason: `Cannot stop — ${failures.length} condition(s) unsatisfied: ${blockedReason}`,
      conditions,
    };
  }

  /**
   * Static convenience method — evaluates without instantiating.
   */
  static check(input: CompletionGateInput): CompletionGateResult {
    return new CompletionGate().evaluate(input);
  }
}

/**
 * Default block count limit.
 */
export const DEFAULT_BLOCK_COUNT_LIMIT = 5;
