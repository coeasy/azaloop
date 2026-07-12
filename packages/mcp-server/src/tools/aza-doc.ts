import type { LoopResponse } from '@azaloop/shared';

const DOC_TYPES = ['prd', 'arch', 'db', 'api', 'test', 'deploy'] as const;

export async function handleDocGenerate(type: string, title: string, content: string): Promise<LoopResponse> {
  if (!DOC_TYPES.includes(type as any)) {
    return {
      success: false,
      data: null,
      error: `Unknown doc type: ${type}. Supported: ${DOC_TYPES.join(', ')}`,
      metadata: { iteration: 0, progress: '', stage: '' },
    };
  }
  return {
    success: true,
    data: { type, title, content, generated_at: new Date().toISOString() },
    next_action: { tool: 'aza_loop_next', action: 'done', reason: 'Documentation generated, project archived' },
    metadata: { iteration: 0, progress: '100%', stage: 'archive' },
  };
}
