import type { HookEvent } from '../Hook/event-bus';
import { EventBus } from '../Hook/event-bus';
import { StateManager } from '../state/state-manager';
import { StrikeSystem } from '../L4_discipline/strike-system';
import { ResumeGenerator } from './resume-generator';
import { RunLedger } from '../state/run-ledger';
import { WorkspaceJournal } from '../L2_memory/workspace-journal';
import { scanSecrets } from '../L6_security/scanners/secret';
import { evaluate, loadPolicyFromFile, type SecurityPolicy } from '../L6_security/policy-as-code';
import { runShellwardGuard } from '../L6_security/shellward-guard';
import * as path from 'path';
import type { NextAction } from '@azaloop/shared';

/**
 * A single error tracked by the in-memory ErrorTracker.
 * Useful for debugging silent failures (O-10).
 */
export interface TrackedError {
  category: string;
  message: string;
  stack?: string;
  timestamp: string;
}

/**
 * Lightweight in-memory ring buffer of recent errors. Replaces the silent
 * `try { ... } catch { /* best-effort *\/ }` pattern so debuggers can see
 * what failed and why. Capped at 50 entries to bound memory.
 *
 * Reference: O-10 in the azaloop-pipeline-unification plan.
 */
export class ErrorTracker {
  private maxSize: number;
  private errors: TrackedError[] = [];

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  track(category: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const entry: TrackedError = {
      category,
      message,
      stack,
      timestamp: new Date().toISOString(),
    };
    this.errors.push(entry);
    if (this.errors.length > this.maxSize) {
      this.errors.splice(0, this.errors.length - this.maxSize);
    }
  }

  getRecent(): TrackedError[] {
    return [...this.errors];
  }

  getByCategory(category: string): TrackedError[] {
    return this.errors.filter(e => e.category === category);
  }

  clear(): void {
    this.errors = [];
  }

  get size(): number {
    return this.errors.length;
  }
}

/**
 * Result of a single event simulation step.
 */
export interface EventSimulationResult {
  /** Hook events that were emitted during this simulation step. */
  events: HookEvent[];
  /** Whether the STATE file was updated during this step. */
  stateUpdated: boolean;
  /** Whether the RESUME file was (pre-)written during this step. */
  resumeWritten: boolean;
  /** The next action the LLM should take, derived from current STATE. */
  nextAction: NextAction;
}

/**
 * Maps each pipeline stage to the unified 8-tool next step (0.2.x).
 */
const STAGE_NEXT_MAP: Record<string, { tool: string; action: string }> = {
  open: { tool: 'aza_prd', action: 'review' },
  design: { tool: 'aza_spec', action: 'design' },
  build: { tool: 'aza_spec', action: 'implement' },
  verify: { tool: 'aza_quality', action: 'check' },
  archive: { tool: 'aza_finish', action: 'ship' },
};

/**
 * MCPEventSimulator — simulates native Hook events for clients that lack
 * Hook support (e.g. Windsurf, VS Code, Roo, OpenCode, Comate, WorkBuddy).
 *
 * On every MCP tool call the simulator performs four logical steps:
 *   1. **pre-tool** simulation — discipline check (hard-stop guard)
 *   2. **tool execution** — handled by the caller (MCPEventBridge)
 *   3. **post-tool** simulation — update STATE + pre-write RESUME
 *   4. **return** next_action so the LLM can auto-continue
 *
 * Pre-writing RESUME on every tool call guarantees that even if the
 * session is killed mid-flight, the last known state is persisted.
 */
export class MCPEventSimulator {
  private eventBus: EventBus;
  private stateManager: StateManager;
  private resumeGenerator: ResumeGenerator;
  private strikeSystem: StrikeSystem;
  private runLedger: RunLedger;
  private workspaceJournal: WorkspaceJournal;
  /** Loaded security policy (from policy.yaml or default) */
  private policy: SecurityPolicy;
  /** O-10: in-memory ring buffer of swallowed best-effort errors. */
  private errorTracker: ErrorTracker = new ErrorTracker(50);

  /**
   * @param eventBus       - EventBus used to emit simulated Hook events.
   * @param stateManager   - StateManager used to read / update STATE.
   * @param resumeGenerator - ResumeGenerator used to pre-write RESUME.md.
   * @param strikeSystem   - Optional StrikeSystem for discipline checks.
   *                         Falls back to StateManager.isHardStop() when omitted.
   */
  constructor(
    eventBus: EventBus,
    stateManager: StateManager,
    resumeGenerator: ResumeGenerator,
    strikeSystem?: StrikeSystem,
    azaDir?: string,
  ) {
    this.eventBus = eventBus;
    this.stateManager = stateManager;
    this.resumeGenerator = resumeGenerator;
    this.strikeSystem = strikeSystem ?? new StrikeSystem();
    const dir = azaDir ?? resumeGenerator.getPath().replace(/[/\\]RESUME\.md$/, '');
    this.runLedger = new RunLedger(dir);
    this.workspaceJournal = new WorkspaceJournal(dir);
    // Load policy from policy.yaml if it exists alongside the package
    const policyPath = path.join(dir, '..', 'packages', 'core', 'src', 'L6_security', 'policy.yaml');
    this.policy = loadPolicyFromFile(policyPath);
  }

  // ── Session lifecycle ──────────────────────────────────────────────

  /**
   * Simulate a `session-start` Hook event.
   *
   * Emits the event on the EventBus so that any registered handlers
   * (e.g. context injection logging) can react.
   *
   * @returns Simulation result (no STATE or RESUME changes).
   */
  async simulateSessionStart(): Promise<EventSimulationResult> {
    const events: HookEvent[] = ['session-start'];
    const state = this.stateManager.getState();

    await this.eventBus.emit('session-start', {
      client: state.loop.client,
      model: state.loop.model,
      stage: state.pipeline.current_stage,
      iteration: state.loop.iteration,
    });

    return this.buildResult(events, false, false);
  }

  // ── Per-tool simulation ────────────────────────────────────────────

  /**
   * Simulate a `pre-tool` Hook event and perform a discipline check.
   *
   * If a hard-stop is active (3+ strikes), this method **throws** to
   * block the subsequent tool execution — mirroring the behaviour of
   * the native pre-tool Hook handler.
   *
   * @param toolName - Name of the MCP tool about to be called.
   * @param args     - Arguments passed to the tool.
   * @returns Simulation result (no STATE or RESUME changes yet).
   * @throws Error when a hard-stop is active.
   */
  async simulatePreTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<EventSimulationResult> {
    const events: HookEvent[] = ['pre-tool'];

    // ── shellward 8-layer DLP on tool args ──
    const argsStr = JSON.stringify(args);
    const dlp = runShellwardGuard(argsStr, `tool-args:${toolName}`, { blockOnFail: true });
    if (dlp.blocked) {
      console.error(
        `[MCPEventSimulator:pre-tool] shellward DLP blocked: ${dlp.reason}`,
      );
      await this.eventBus.emit('on-error', {
        tool: toolName,
        error: `shellward DLP blocked: ${dlp.reason}`,
      });
      throw new Error(`Security policy blocked tool '${toolName}': ${dlp.reason}`);
    }

    // Legacy secret-only pass kept for policy-file nuance (warn-only if already covered)
    const secretFindings = scanSecrets(argsStr, `tool-args:${toolName}`);
    if (secretFindings.length > 0) {
      const policyResult = evaluate(secretFindings, this.policy);
      if (!policyResult.passed) {
        console.error(
          `[MCPEventSimulator:pre-tool] Security policy blocked: ${policyResult.reason}`,
        );
        await this.eventBus.emit('on-error', {
          tool: toolName,
          error: `Security policy blocked: ${policyResult.reason}`,
        });
        throw new Error(`Security policy blocked tool '${toolName}': ${policyResult.reason}`);
      }
    }

    // Discipline check — hard stop blocks tool execution.
    if (this.isHardStop()) {
      console.error(
        `[MCPEventSimulator:pre-tool] Hard stop active — blocking tool call: ${toolName}`,
      );
      throw new Error(`Hard stop: cannot execute tool '${toolName}'`);
    }

    await this.eventBus.emit('pre-tool', {
      tool: toolName,
      args,
    });

    return this.buildResult(events, false, false);
  }

  /**
   * Simulate a `post-tool` Hook event, update STATE, and pre-write RESUME.
   *
   * This is the core of the "pre-write on every tool call" strategy:
   * after each successful tool execution the STATE file is incremented
   * and a fresh RESUME.md is written so that a session kill never loses
   * more than the currently in-flight tool call.
   *
   * @param toolName - Name of the MCP tool that was called.
   * @param result   - The result returned by the tool executor.
   * @returns Simulation result with `stateUpdated` and `resumeWritten` set to `true`.
   */
  async simulatePostTool(
    toolName: string,
    result: unknown,
  ): Promise<EventSimulationResult> {
    const events: HookEvent[] = ['post-tool'];
    let stateUpdated = false;
    let resumeWritten = false;

    // ── L4-L7 Security defense: output scanning ──
    // Scan tool output for secrets/data exfiltration
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const outputFindings = scanSecrets(resultStr, `tool-output:${toolName}`);
    if (outputFindings.length > 0) {
      const policyResult = evaluate(outputFindings, this.policy);
      if (!policyResult.passed) {
        console.warn(
          `[MCPEventSimulator:post-tool] Security warning in output: ${policyResult.reason}`,
        );
      }
    }

    // Emit post-tool event so registered handlers can react.
    await this.eventBus.emit('post-tool', {
      tool: toolName,
      result,
    });

    // ── RunLedger: record tool call in append-only JSONL ──
    const state = this.stateManager.getState();
    try {
      await this.runLedger.append({
        tool: toolName,
        action: `post-tool`,
        stage: state.pipeline.current_stage,
        iteration: state.loop.iteration,
        tokens: 100, // estimated per-call
        summary: `Tool ${toolName} executed successfully`,
        success: true,
      });
    } catch (err) {
      // best-effort: ledger write is non-fatal, but track it (O-10).
      this.errorTracker.track('run_ledger_write', err);
    }

    // Update STATE — increment iteration counter.
    await this.stateManager.incrementIteration();
    stateUpdated = true;

    // Pre-write RESUME so the session is always recoverable.
    await this.resumeGenerator.generate(this.stateManager, {
      last_milestone: new Date().toISOString(),
    });
    resumeWritten = true;

    return this.buildResult(events, stateUpdated, resumeWritten);
  }

  /**
   * Simulate an `on-error` Hook event when a tool execution fails.
   *
   * Does not update STATE or RESUME — the caller (bridge) re-throws
   * the original error after this method returns.
   *
   * @param toolName - Name of the MCP tool that threw.
   * @param error    - The error object or value.
   * @returns Simulation result (no STATE or RESUME changes).
   */
  async simulateOnError(
    toolName: string,
    error: unknown,
  ): Promise<EventSimulationResult> {
    const events: HookEvent[] = ['on-error'];

    await this.eventBus.emit('on-error', {
      tool: toolName,
      error: error instanceof Error ? error.message : String(error),
    });

    return this.buildResult(events, false, false);
  }

  // ── Session stop ───────────────────────────────────────────────────

  /**
   * Simulate an `on-stop` Hook event and write a final RESUME.
   *
   * Writes a complete RESUME.md containing the full pipeline / loop state
   * so the next session can pick up exactly where this one left off.
   *
   * @returns Simulation result with `resumeWritten` set to `true`.
   */
  async simulateOnStop(): Promise<EventSimulationResult> {
    const events: HookEvent[] = ['on-stop'];
    const state = this.stateManager.getState();

    await this.eventBus.emit('on-stop', {
      stage: state.pipeline.current_stage,
      iteration: state.loop.iteration,
      progress: state.loop.progress,
    });

    // ── WorkspaceJournal: auto-archive session on stop ──
    try {
      await this.workspaceJournal.archive({
        stage: state.pipeline.current_stage,
        work_summary: `Session ended at stage ${state.pipeline.current_stage}, iteration ${state.loop.iteration}, progress ${state.loop.progress}`,
        iteration: state.loop.iteration,
      });
    } catch (err) {
      // best-effort: journal archive is non-fatal, but track it (O-10).
      this.errorTracker.track('workspace_journal_archive', err);
    }

    // Write a full RESUME with all current state fields.
    await this.resumeGenerator.generate(this.stateManager, {
      current_stage: state.pipeline.current_stage,
      current_story: state.loop.current_story,
      iteration: state.loop.iteration,
      progress: state.loop.progress,
      client: state.loop.client,
      model: state.loop.model,
      last_milestone: new Date().toISOString(),
    });

    console.warn(
      `[MCPEventSimulator:on-stop] Resume written for stage: ${state.pipeline.current_stage}`,
    );

    return this.buildResult(events, false, true);
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Check whether a hard-stop is active.
   *
   * Uses the StrikeSystem when available, otherwise falls back to
   * StateManager.isHardStop() which reads the persisted strike count.
   */
  private isHardStop(): boolean {
    return this.strikeSystem.isHardStop() || this.stateManager.isHardStop();
  }

  /**
   * Derive the next action from the current STATE.
   *
   * The `tool` is determined by the current pipeline stage; the `action`
   * follows the `continue_<stage>` convention used throughout AzaLoop.
   */
  private getNextAction(): NextAction {
    const state = this.stateManager.getState();
    const stage = state.pipeline.current_stage;
    const progress = String(state.loop.progress || '');
    const stageStatus = (state.pipeline.stages as any)?.[stage]?.status;
    const done =
      progress === '100%' ||
      progress === '100' ||
      stageStatus === 'completed';

    // Idle after successful archive — do not keep pushing ship
    if (stage === 'archive' && done) {
      return {
        tool: 'aza_auto',
        action: 'run',
        reason: '上一轮已交付（archive@100%）。新需求请直接 aza_auto(user_input=...) — 短句如「全自动优化改进项目」也是有效需求。',
      };
    }

    // Once a story is active, always drive full-auto rather than re-open PRD generate
    if (state.loop.current_story && (stage === 'open' || stage === 'design' || stage === 'build')) {
      return {
        tool: 'aza_loop',
        action: 'full',
        reason: `Story ${state.loop.current_story} active at "${stage}" — continue full loop`,
      };
    }
    const mapped = STAGE_NEXT_MAP[stage] ?? { tool: 'aza_loop', action: 'full' };
    return {
      tool: mapped.tool,
      action: mapped.action,
      reason: `Stage "${stage}" in progress, iteration ${state.loop.iteration}, progress ${state.loop.progress}`,
    };
  }

  /**
   * O-10: public accessor for the in-memory error tracker. Exposed so
   * `aza_audit` and other diagnostic tools can surface silent failures.
   */
  getRecentErrors(): TrackedError[] {
    return this.errorTracker.getRecent();
  }

  getErrorsByCategory(category: string): TrackedError[] {
    return this.errorTracker.getByCategory(category);
  }

  /**
   * Assemble a simulation result object.
   */
  private buildResult(
    events: HookEvent[],
    stateUpdated: boolean,
    resumeWritten: boolean,
  ): EventSimulationResult {
    return {
      events,
      stateUpdated,
      resumeWritten,
      nextAction: this.getNextAction(),
    };
  }
}
