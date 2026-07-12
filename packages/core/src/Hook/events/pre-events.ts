/**
 * Pre-event handlers — executed before tool/commit/phase operations.
 * Consolidated from: pre-tool.ts, pre-commit.ts, pre-phase.ts
 */
import type { EventHandler } from '../event-bus';
import { StrikeSystem } from '../../L4_discipline/strike-system';
import { scanSecrets } from '../../L6_security/scanners/secret';
import { scanSQLInjection } from '../../L6_security/scanners/sql-injection';
import { scanXSS } from '../../L6_security/scanners/xss';
import { StageGuards } from '../../L7_loop/guards';

// ── pre-tool ──
export function createPreToolHandler(strikeSystem?: StrikeSystem): EventHandler {
  return async (payload) => {
    const toolName = payload.data?.tool as string;

    if (strikeSystem?.isHardStop()) {
      console.error(`[Hook:pre-tool] Hard stop active — blocking tool call: ${toolName}`);
      throw new Error(`Hard stop: cannot execute tool '${toolName}'`);
    }

    console.warn(`[Hook:pre-tool] Executing: ${toolName}`);
  };
}

// ── pre-commit ──
export function createPreCommitHandler(): EventHandler {
  return async (payload) => {
    const files = (payload.data?.files as string[]) || [];

    for (const file of files) {
      const content = payload.data?.content as string || '';
      const secrets = scanSecrets(content, file);
      if (secrets.length > 0) {
        console.error(`[Hook:pre-commit] SECURITY BLOCKER: Secrets found in ${file}`);
        throw new Error(`Pre-commit hook blocked: secrets detected in ${file}`);
      }
    }

    console.warn(`[Hook:pre-commit] Security scan passed for ${files.length} files`);
  };
}

// ── pre-phase ──
export function createPrePhaseHandler(guards?: StageGuards): EventHandler {
  return async (payload) => {
    const phase = payload.data?.phase as string;

    if (guards) {
      const result = guards.checkStage(phase as any);
      if (!result.allowed) {
        console.error(`[Hook:pre-phase] Guard check failed for phase '${phase}': ${result.reason}`);
        throw new Error(`Phase guard blocked: ${result.reason}`);
      }
    }

    console.warn(`[Hook:pre-phase] Entering phase: ${phase}`);
  };
}
