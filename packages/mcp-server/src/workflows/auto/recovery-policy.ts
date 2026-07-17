import type { ResumeData } from '@azaloop/core';
import type { TaskIdentity } from './task-identity';

const SUPPORTED_STAGES = new Set(['open', 'design', 'build', 'verify', 'archive']);

export type RecoveryDecision =
  | { kind: 'same_task'; state: ResumeData }
  | { kind: 'new_task'; reason: 'hash_mismatch' | 'terminal' | 'unsupported_state' }
  | { kind: 'fresh' };

export interface RecoveryPolicyOptions {
  terminalEvidence?: boolean;
}

export function decideRecovery(
  identity: TaskIdentity,
  state: ResumeData | null,
  options: RecoveryPolicyOptions = {},
): RecoveryDecision {
  if (!state) {
    return { kind: 'fresh' };
  }

  if (
    !state.task_id ||
    !state.user_input_hash ||
    !SUPPORTED_STAGES.has(state.current_stage)
  ) {
    return { kind: 'new_task', reason: 'unsupported_state' };
  }

  if (
    state.user_input_hash !== identity.fingerprint ||
    state.task_id !== identity.task_id
  ) {
    return { kind: 'new_task', reason: 'hash_mismatch' };
  }

  const progress = String(state.progress).trim();
  if (
    options.terminalEvidence === true ||
    (state.current_stage === 'archive' && (progress === '100%' || progress === '100'))
  ) {
    return { kind: 'new_task', reason: 'terminal' };
  }

  return { kind: 'same_task', state };
}
