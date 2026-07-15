import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * V20 Task 3: Persistent state for the CLI daemon.
 *
 * Written to `.aza/daemon-state.json` every tick so the daemon
 * survives crashes. On restart, if `lastTickAt` is older than
 * 5 minutes, the daemon increments `crashRecoveryCount` and
 * resumes from the last known state.
 */
export interface DaemonState {
  startedAt: string;
  lastTickAt: string;
  iteration: number;
  currentStage: string;
  awaitingAction: { tool: string; action: string } | null;
  cronSchedule: string | null;
  maxDurationMs: number;
  tokenUsage: { total: number; perTask: number };
  stopped: boolean;
  crashRecoveryCount: number;
}

export async function loadDaemonState(filePath: string): Promise<DaemonState | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const state = JSON.parse(raw) as DaemonState;
    // Crash detection: if lastTickAt is older than 5 minutes, mark as crashed
    const lastTick = new Date(state.lastTickAt).getTime();
    const fiveMin = 5 * 60 * 1000;
    if (Date.now() - lastTick > fiveMin && !state.stopped) {
      state.crashRecoveryCount = (state.crashRecoveryCount || 0) + 1;
    }
    return state;
  } catch {
    return null;
  }
}

export async function saveDaemonState(filePath: string, state: DaemonState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

export function createInitialDaemonState(maxDurationMs: number, cronSchedule: string | null): DaemonState {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    lastTickAt: now,
    iteration: 0,
    currentStage: 'open',
    awaitingAction: null,
    cronSchedule,
    maxDurationMs,
    tokenUsage: { total: 0, perTask: 0 },
    stopped: false,
    crashRecoveryCount: 0,
  };
}
