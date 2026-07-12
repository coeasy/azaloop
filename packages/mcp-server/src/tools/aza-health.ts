import type { LoopResponse } from '@azaloop/shared';

const startTime = Date.now();

export async function handleHealthCheck(): Promise<LoopResponse> {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  return {
    success: true,
    data: {
      status: 'healthy',
      version: '0.1.0',
      uptime_seconds: uptime,
      memory_usage: process.memoryUsage().heapUsed,
    },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}
