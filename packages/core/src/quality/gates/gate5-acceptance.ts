import type { GateResult } from '../pipeline';
import type { AcceptanceCriteria } from '@azaloop/shared';

export async function acceptanceGate(criteria: AcceptanceCriteria[]): Promise<GateResult> {
  const start = Date.now();
  const issues: string[] = [];

  const untestable = criteria.filter(c => !c.testable);
  if (untestable.length > 0) {
    issues.push(`${untestable.length} acceptance criteria are not testable`);
  }

  const notPassed = criteria.filter(c => c.status !== 'passed');
  if (notPassed.length > 0) {
    issues.push(`${notPassed.length}/${criteria.length} criteria not yet passed`);
  }

  const untestableIds = untestable.map(c => c.id);
  const notPassedIds = notPassed.map(c => c.id);

  if (untestableIds.length > 0) {
    issues.push(`Untestable: ${untestableIds.join(', ')}`);
  }
  if (notPassedIds.length > 0) {
    issues.push(`Not passed: ${notPassedIds.join(', ')}`);
  }

  return {
    gate: 'Gate 5: Acceptance Criteria Verification',
    passed: issues.length === 0,
    issues,
    duration_ms: Date.now() - start,
  };
}
