import { securityGate } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';

export async function handleSecurityScan(projectRoot: string): Promise<LoopResponse> {
  const result = await securityGate(projectRoot);
  return {
    success: result.passed,
    data: result,
    next_action: result.passed
      ? { tool: 'aza_loop', action: 'next', reason: 'Security scan passed' }
      : { tool: 'aza_security', action: 'fix', reason: `Security issues found: ${result.issues.length}` },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}
