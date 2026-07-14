/**
 * recursion-guard.ts
 *
 * Trellis-style recursion guard. Detects and blocks nested invocations of
 * tools that can spawn sub-agents (aza_task_*, aza_quality_check) so that
 * the agent never re-dispatches itself. Implemented as a thin wrapper
 * around AsyncLocalStorage so it is safe under concurrent tool calls —
 * each concurrent call has its own context.
 *
 * Reference: https://github.com/mindfold-ai/Trellis (Recursion Guard pattern)
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Tool names whose nested invocations are forbidden. */
export const RECURSION_TOOLS: ReadonlySet<string> = new Set([
  'aza_task_implement',
  'aza_task_verify',
  'aza_task_design',
  'aza_quality_check',
  'aza_security_scan',
]);

/** Thrown when a forbidden tool is invoked while already on the call stack. */
export class RecursionGuardError extends Error {
  readonly tool: string;
  readonly depth: number;
  constructor(tool: string, depth: number) {
    super(
      `recursion-guard: tool "${tool}" is already on the call stack (depth=${depth}). ` +
      `Refusing to dispatch sub-agents from a sub-agent.`,
    );
    this.name = 'RecursionGuardError';
    this.tool = tool;
    this.depth = depth;
  }
  toJSON(): Record<string, unknown> {
    return { name: this.name, tool: this.tool, depth: this.depth, message: this.message };
  }
}

const storage = new AsyncLocalStorage<string[]>();

/**
 * Get the current call stack (read-only snapshot). Useful for diagnostics.
 */
export function getCurrentStack(): readonly string[] {
  return storage.getStore() ?? [];
}

/**
 * Run `fn` inside a recursion-guarded context. Pushes `toolName` onto the
 * per-call stack, executes `fn`, and pops the entry on completion.
 *
 * Throws `RecursionGuardError` if `toolName` already appears on the stack
 * AND belongs to `RECURSION_TOOLS`. Other tools are allowed to nest freely.
 */
export async function withRecursionGuard<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  const parent = storage.getStore() ?? [];
  const stack = [...parent, toolName];

  if (RECURSION_TOOLS.has(toolName)) {
    let depth = 0;
    for (const t of stack) if (t === toolName) depth++;
    if (depth > 1) {
      throw new RecursionGuardError(toolName, depth);
    }
  }

  return storage.run(stack, fn);
}

/**
 * Synchronous variant for code paths that cannot await (rare).
 */
export function withRecursionGuardSync<T>(toolName: string, fn: () => T): T {
  const parent = storage.getStore() ?? [];
  const stack = [...parent, toolName];

  if (RECURSION_TOOLS.has(toolName)) {
    let depth = 0;
    for (const t of stack) if (t === toolName) depth++;
    if (depth > 1) {
      throw new RecursionGuardError(toolName, depth);
    }
  }

  let result!: T;
  storage.run(stack, () => {
    result = fn();
  });
  return result;
}
