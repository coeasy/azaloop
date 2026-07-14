/**
 * v14 — P8.5: aza_cost — token cost tracking tool.
 *
 * Exposes the `CostTracker` as an MCP tool so clients (Trae, Cursor,
 * OpenCode, Claude Code) can monitor token consumption against the
 * configured budget.
 *
 * Two actions:
 *   - `status`  — return the current budget usage.
 *   - `consume` — record a token consumption and return the result.
 *
 * State is persisted in `.aza/cost-tracker.json` so the tracker
 * survives across MCP calls within the same workspace.
 *
 * Reference:
 *   • ruvnet/ruflo v3.10.33 — token-budget gate (80% warn, 100% reject).
 */

import { CostTracker } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as fs from 'fs';
import * as path from 'path';

export interface CostInput {
  /** Action: 'status' or 'consume'. */
  action: 'status' | 'consume';
  /** Tokens to record (only used for action='consume'). */
  tokens?: number;
  /** Source identifier (e.g. 'prd-review', 'task-implement'). */
  source?: string;
  /** Optional explicit budget (only used for first init). */
  budget?: number;
  /** Working directory (defaults to process.cwd()). */
  workspace_path?: string;
}

export interface CostResult {
  action: 'status' | 'consume';
  consumed: number;
  budget: number;
  remaining: number;
  pct: number;
  warning: boolean;
  rejected: boolean;
  perSource: Record<string, number>;
  consume?: {
    allowed: boolean;
    warning: boolean;
    reason?: string;
  };
  message: string;
}

const STATE_FILE = 'cost-tracker.json';

interface PersistedState {
  budget: number;
  consumed: number;
  sources: Record<string, number>;
}

function loadState(azaDir: string): PersistedState | null {
  const fp = path.join(azaDir, STATE_FILE);
  try {
    const content = fs.readFileSync(fp, 'utf8');
    return JSON.parse(content) as PersistedState;
  } catch {
    return null;
  }
}

function saveState(azaDir: string, state: PersistedState): void {
  const fp = path.join(azaDir, STATE_FILE);
  try {
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

/**
 * Handle the `aza_cost` MCP tool call.
 */
export async function handleCost(input: CostInput): Promise<LoopResponse> {
  const workspace = input.workspace_path ?? process.cwd();
  const azaDir = path.join(workspace, '.aza');
  const action = input.action ?? 'status';

  if (action === 'consume' && (input.tokens === undefined || input.tokens < 0)) {
    return {
      success: false,
      data: null,
      next_action: {
        tool: 'aza_cost',
        action: 'retry',
        reason: 'consume requires a non-negative `tokens` value',
      },
      metadata: { iteration: 0, progress: '0%', stage: 'build' },
    };
  }

  // Hydrate tracker from persisted state.
  const persisted = loadState(azaDir);
  const budget = input.budget ?? persisted?.budget ?? 50_000;
  const tracker = new CostTracker({ budget });
  if (persisted) {
    for (const [source, tokens] of Object.entries(persisted.sources)) {
      tracker.consume(tokens, source);
    }
  }

  let result: CostResult;
  if (action === 'status') {
    const usage = tracker.getBudgetUsage();
    result = {
      action: 'status',
      consumed: usage.consumed,
      budget: usage.budget,
      remaining: usage.remaining,
      pct: usage.pct,
      warning: usage.warning,
      rejected: usage.rejected,
      perSource: usage.perSource,
      message: usage.rejected
        ? '⛔ Budget rejected — strikes have been triggered.'
        : usage.warning
          ? `⚠ Budget warning — consumed ${(usage.pct * 100).toFixed(1)}% of budget.`
          : `✓ Budget OK — consumed ${(usage.pct * 100).toFixed(1)}% of budget.`,
    };
  } else {
    // consume
    const r = tracker.consume(input.tokens ?? 0, input.source ?? 'default');
    const usage = tracker.getBudgetUsage();
    // Persist
    saveState(azaDir, {
      budget: usage.budget,
      consumed: usage.consumed,
      sources: usage.perSource,
    });
    result = {
      action: 'consume',
      consumed: usage.consumed,
      budget: usage.budget,
      remaining: usage.remaining,
      pct: usage.pct,
      warning: r.warning,
      rejected: !r.allowed,
      perSource: usage.perSource,
      consume: { allowed: r.allowed, warning: r.warning, reason: r.reason },
      message: !r.allowed
        ? `⛔ Rejected: ${r.reason}`
        : r.warning
          ? `⚠ Warning: budget at ${(usage.pct * 100).toFixed(1)}% after consuming ${input.tokens} tokens from '${input.source ?? 'default'}'.`
          : `✓ Consumed ${input.tokens} tokens from '${input.source ?? 'default'}' (now at ${(usage.pct * 100).toFixed(1)}%).`,
    };
  }

  return {
    success: true,
    data: result,
    next_action: result.rejected
      ? { tool: 'aza_finish_work', action: 'stop', reason: 'Budget exhausted' }
      : { tool: 'aza_cost', action: 'continue', reason: result.message },
    metadata: {
      iteration: 0,
      progress: `${(result.pct * 100).toFixed(0)}%`,
      stage: 'build',
    },
  };
}
