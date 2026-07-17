import { createHash } from 'crypto';

export interface TaskIdentity {
  task_id: string;
  fingerprint: string;
}

export function createTaskIdentity(input: string, explicitTaskId?: string): TaskIdentity {
  const normalized = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('user_input is required');
  }

  const fingerprint = createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 32);

  return {
    task_id: explicitTaskId?.trim() || `aza-${fingerprint}`,
    fingerprint,
  };
}
