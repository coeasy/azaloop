import type { NextAction } from '@azaloop/shared';
import type { MCPEventSimulator } from '../continuity/mcp-event-simulator';
import type { EventSimulationResult } from '../continuity/mcp-event-simulator';
import { isWriteAllowed, analyzeBlastRadius } from '../L7_loop/write-guards';
import { WRITE_TOOLS } from '../L7_loop/stage-tool-guard';
import { withRecursionGuard, RecursionGuardError } from '../L7_loop/recursion-guard';
import type { Stage } from '../L7_loop/state-machine';

/**
 * A tool executor is any async function that takes a record of arguments
 * and returns a result object.
 *
 * @typeParam T - The concrete result shape returned by the executor.
 */
export type ToolExecutor<T extends Record<string, unknown> = Record<string, unknown>> = (
  args: Record<string, unknown>,
) => Promise<T>;

/**
 * The result of a bridged tool call — the original tool result with
 * `next_action` appended so the LLM can auto-continue.
 *
 * @typeParam T - The original result shape.
 */
export type BridgedResult<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  next_action: NextAction;
};

/**
 * Error thrown when a write is blocked by the phase write-guard.
 * Carries the file path and current stage so callers can surface a
 * useful redirect to the agent.
 */
export class StageWriteGuardError extends Error {
  readonly filePath: string;
  readonly stage: Stage;
  constructor(filePath: string, stage: Stage) {
    super(`write-guard: file "${filePath}" is not allowed to be written in stage "${stage}"`);
    this.name = 'StageWriteGuardError';
    this.filePath = filePath;
    this.stage = stage;
  }
}

/**
 * Options for wiring the phase write-guard into MCPEventBridge.
 * If omitted, the bridge skips write-guard checks (backward-compatible).
 */
export interface MCPEventBridgeOptions {
  /**
   * Resolves the current pipeline stage. Called once per write-tool call.
   * If not provided, write-guard checks are skipped.
   */
  stageResolver?: () => Promise<Stage>;
  /** Workspace root for blast-radius analysis. Defaults to process.cwd(). */
  workspaceRoot?: string;
}

/**
 * MCPEventBridge — bridges MCP tool calls to the AzaLoop event bus.
 *
 * For clients that lack native Hook support (Windsurf, VS Code, Roo,
 * OpenCode, Comate, WorkBuddy …) this bridge wraps every MCP tool
 * executor with pre/post event simulation:
 *
 *   1. **pre-tool**  — `simulator.simulatePreTool()` (discipline check)
 *   2. **execute**  — call the original tool executor
 *   3. **post-tool** — `simulator.simulatePostTool()` (STATE + RESUME)
 *   4. **return**    — original result merged with `next_action`
 *
 * If the executor throws, an `on-error` event is emitted before
 * re-throwing so that downstream error handlers can react.
 */
export class MCPEventBridge {
  private simulator: MCPEventSimulator;
  private readonly options: MCPEventBridgeOptions;

  /**
   * @param simulator - The MCPEventSimulator that drives pre/post event logic.
   * @param options - Optional write-guard wiring (stageResolver + workspaceRoot).
   */
  constructor(simulator: MCPEventSimulator, options?: MCPEventBridgeOptions) {
    this.simulator = simulator;
    this.options = options ?? {};
  }

  /**
   * Wrap a tool executor with event simulation.
   *
   * Returns a new executor with the same argument signature whose
   * return type is `BridgedResult<T>` (original result + `next_action`).
   *
   * @example
   * ```ts
   * const wrapped = bridge.wrapTool('aza_prd_generate', prdExecutor);
   * const result = await wrapped({ requirements: '...' });
   * console.log(result.next_action); // { tool, action, reason }
   * ```
   *
   * @param toolName - Name of the MCP tool being wrapped.
   * @param executor - The original tool executor.
   * @returns A new executor that returns `BridgedResult<T>`.
   */
  wrapTool<T extends Record<string, unknown> = Record<string, unknown>>(
    toolName: string,
    executor: ToolExecutor<T>,
  ): ToolExecutor<BridgedResult<T>> {
    return async (args: Record<string, unknown>): Promise<BridgedResult<T>> => {
      return this.bridgeCall(toolName, args, executor);
    };
  }

  /**
   * Bridge a single tool call through the event simulation pipeline.
   *
   * Flow:
   *   1. `simulatePreTool`  — discipline check, emits `pre-tool` event.
   *   2. `executor(args)`    — actual tool execution.
   *   3. `simulatePostTool` — updates STATE, pre-writes RESUME, emits `post-tool`.
   *   4. Returns `{ ...result, next_action }`.
   *
   * If step 2 throws, `simulateOnError` is called to emit an `on-error`
   * event, then the original error is re-thrown.
   *
   * @param toolName - Name of the MCP tool.
   * @param args     - Arguments to pass to the tool.
   * @param executor - The original tool executor.
   * @returns The tool result with `next_action` appended.
   * @throws Rethrows any error from the executor (after emitting `on-error`).
   * @throws Error  when a hard-stop is active (from `simulatePreTool`).
   */
  async bridgeCall<T extends Record<string, unknown> = Record<string, unknown>>(
    toolName: string,
    args: Record<string, unknown>,
    executor: ToolExecutor<T>,
  ): Promise<BridgedResult<T>> {
    // 1. Pre-tool simulation (discipline check — may throw on hard stop).
    await this.simulator.simulatePreTool(toolName, args);

    // 1b. CP-new-2: Phase write-guard — for write tools, verify the target
    //     file is allowed in the current stage, and compute blast radius.
    let warnings: string[] | undefined;
    if (WRITE_TOOLS.has(toolName) && this.options.stageResolver) {
      const stage = await this.options.stageResolver();
      const filePath = (args.file_path as string) ||
        (args.project_root as string) ||
        (args.workspace_path as string) ||
        '';
      if (filePath) {
        if (!isWriteAllowed(filePath, stage)) {
          await this.simulator.simulateOnError(toolName, new StageWriteGuardError(filePath, stage));
          throw new StageWriteGuardError(filePath, stage);
        }
        // Blast-radius analysis (non-blocking — just adds warnings).
        try {
          const blast = await analyzeBlastRadius(filePath, this.options.workspaceRoot || process.cwd());
          if (blast.riskLevel === 'HIGH' || blast.riskLevel === 'CRITICAL') {
            warnings = warnings ?? [];
            warnings.push(`blast-radius ${blast.riskLevel}: ${blast.details}`);
            for (const rec of blast.recommendations) warnings.push(rec);
          }
        } catch {
          // blast-radius analysis is best-effort (file may not exist yet)
        }
      }
    }

    // 2. Execute the tool — wrap with Recursion Guard (T13 / Trellis pattern)
    //    so the same tool can't dispatch sub-agents from within itself.
    let result: T;
    try {
      result = await withRecursionGuard(toolName, () => executor(args));
    } catch (error) {
      // Emit on-error event before re-throwing.
      await this.simulator.simulateOnError(toolName, error);
      throw error;
    }

    // 3. Post-tool simulation (update STATE + pre-write RESUME).
    const simulation: EventSimulationResult = await this.simulator.simulatePostTool(
      toolName,
      result,
    );

    // 4. Return the tool result with next_action appended.
    //    If the tool already returned a next_action, keep it —
    //    the tool's next_action is more specific than the simulation's.
    const existingNextAction = (result as Record<string, unknown>).next_action as NextAction | undefined;
    return {
      ...result,
      ...(warnings ? { warnings } : {}),
      next_action: existingNextAction ?? simulation.nextAction,
    };
  }
}
