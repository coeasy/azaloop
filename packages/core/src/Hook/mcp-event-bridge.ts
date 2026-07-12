import type { NextAction } from '@azaloop/shared';
import type { MCPEventSimulator } from '../continuity/mcp-event-simulator';
import type { EventSimulationResult } from '../continuity/mcp-event-simulator';

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

  /**
   * @param simulator - The MCPEventSimulator that drives pre/post event logic.
   */
  constructor(simulator: MCPEventSimulator) {
    this.simulator = simulator;
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

    // 2. Execute the tool.
    let result: T;
    try {
      result = await executor(args);
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
      next_action: existingNextAction ?? simulation.nextAction,
    };
  }
}
