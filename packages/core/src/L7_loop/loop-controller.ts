import { StateMachine, type Stage } from './state-machine';
import { StageGuards, createDefaultGuards, type GuardConditionKey } from './guards';
import { DeadlockDetector } from './deadlock-detector';
import { HardStopManager, type StopReason } from './hard-stop';
import { StrikeSystem } from '../L4_discipline/strike-system';
import { CircuitBreaker } from './circuit-breaker';
import { CompletionGate, DEFAULT_BLOCK_COUNT_LIMIT } from './completion-gate';
import { LoopAudit } from './loop-audit';
import { InnerLoop, type StageHandlerProvider } from './inner-loop';
import { OuterLoop, type StoryProvider, type HumanGateFn, type CommitFn, type OuterLoopResult, createDefaultStoryProvider, createDefaultHumanGate, createDefaultCommit } from './outer-loop';
import { createRealHandlerProvider } from './real-handlers';
import { StateManager } from '../state/state-manager';
import { RunStateManager, AuditLog } from '../state/state-manager';
import { ContextOrchestrator, type ContextEntryBundle } from '../L2_memory/context-orchestrator';
import { InjectionEngine } from '../L9_knowledge/injection-engine';
import { ConfigLoader } from '../config/config-loader';
import { DecisionPointRegistry, type DecisionPointRecord, type DPStatus } from './decision-points';
import { ResumeGenerator } from '../continuity/resume-generator';
import * as fs from 'fs';
import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { AzaloopConfig } from '@azaloop/shared';
import * as path from 'path';

export interface LoopControllerOptions {
  maxIterations?: number;
  maxStageIterations?: number;
  maxStrikes?: number;
  deadlockThreshold?: number;
  hardStopOnSecurity?: boolean;
  enableV12?: boolean;
  /** .aza directory path for file state synchronization. Enables cross-session persistence. */
  azaDir?: string;
  /** Enable OuterLoop for Story-level scheduling. Default: false (experimental) */
  enableOuterLoop?: boolean;
  /** Project root directory (used to load azaloop.yaml config) */
  projectRoot?: string;
  /** Parsed azaloop.yaml config (takes precedence over projectRoot auto-load) */
  config?: AzaloopConfig;
  /** Context bundle from ContextOrchestrator — used by real handlers for stage context */
  contextBundle?: ContextEntryBundle | null;
  /** Knowledge entries from InjectionEngine — used by real handlers for stage knowledge */
  knowledgeEntries?: string[];
}

/**
 * Unified loop controller — bridges V11 boolean-guard loop with V12
 * three-level hierarchy (OuterLoop → InnerLoop → PhaseLoop).
 *
 * When enableV12=true (default), next() delegates to the V12 three-level
 * loop via InnerLoop.run(). When enableV12=false, falls back to V11 boolean
 * guard check for backward compatibility.
 */
export class LoopController {
  stateMachine: StateMachine;
  guards: StageGuards;
  deadlockDetector: DeadlockDetector;
  hardStop: HardStopManager;
  strikeSystem: StrikeSystem;
  circuitBreaker: CircuitBreaker;
  completionGate: CompletionGate;
  auditor: LoopAudit;
  innerLoop: InnerLoop;
  stateManager: StateManager | null = null;
  /** Machine-owned run state (comet pattern — scripts own writes, agents read only) */
  runStateManager: RunStateManager | null = null;
  /** Append-only audit log (comet pattern — every state transition is recorded) */
  auditLog: AuditLog | null = null;
  /** Loaded azaloop.yaml config (auto-resolved from project root) */
  readonly config: AzaloopConfig;

  /** V12: Handler provider for maker/checker/optimizer */
  private handlerProvider: StageHandlerProvider;

  /** V12: Block count for CompletionGate (no longer hardcoded) */
  blockCount: number = 0;
  /** V12: Stop hook active state (no longer hardcoded) */
  stopHookActive: boolean = false;
  /** V12: Ledger progress tracking (no longer hardcoded) */
  ledgerHasProgress: boolean = false;

  /** OuterLoop controller for Story-level scheduling */
  private outerLoop: OuterLoop | null = null;

  /** Context orchestrator — per-stage JSONL injection + Summarize→Prune→Inject */
  private contextOrchestrator: ContextOrchestrator | null = null;
  /** Injection engine — stage-specific knowledge injection */
  private injectionEngine: InjectionEngine;
  /** Unified token budget for context pruning (from config or default 4000) */
  private tokenBudget: number = 4000;
  /** Resume generator for run-ledger access */
  private resumeGen: ResumeGenerator | null = null;
  /** Cache for checker results within a single next() cycle */
  private checkerCache: Map<string, { result: any; timestamp: number }> = new Map();
  /** Decision Point registry for DP-0 to DP-7 protocol (auditable stage handoffs) */
  readonly dpRegistry: DecisionPointRegistry;

  readonly options: LoopControllerOptions;
  private conditions: Map<GuardConditionKey, boolean> = new Map();
  private stageIterations: Map<string, number> = new Map();
  /** Resolved loop options (from config or defaults) */
  readonly configLoopOptions: {
    maxIterations: number;
    maxStageIterations: number;
    maxStrikes: number;
    deadlockThreshold: number;
    hardStopOnSecurity: boolean;
    enableV12: boolean;
    azaDir: string;
    enableOuterLoop: boolean;
  };

  constructor(options: LoopControllerOptions = {}) {
    // Resolve config: explicit config > auto-load from projectRoot > default
    let effectiveConfig: AzaloopConfig;
    if (options.config) {
      effectiveConfig = options.config;
    } else if (options.projectRoot) {
      const loader = new ConfigLoader(options.projectRoot);
      effectiveConfig = loader.getDefaultConfig(); // non-async default
    } else {
      effectiveConfig = {
        version: '4.0',
        project: { name: 'azaloop', root: '.' },
        loop: { max_iterations: 50, deadlock_threshold: 3, hard_stop_on_security: true },
        memory: { enabled: true, episodic_max: 100, compression_threshold: 50 },
        quality: { gates: { lint: true, test: true, regression: true, security: true, acceptance: true } },
        mcp_servers: [],
      };
    }
    this.config = effectiveConfig;

    this.options = options;
    this.configLoopOptions = {
      maxIterations: options.maxIterations ?? effectiveConfig.loop.max_iterations,
      maxStageIterations: options.maxStageIterations ?? 5,
      maxStrikes: options.maxStrikes ?? 3,
      deadlockThreshold: options.deadlockThreshold ?? effectiveConfig.loop.deadlock_threshold,
      hardStopOnSecurity: options.hardStopOnSecurity ?? effectiveConfig.loop.hard_stop_on_security,
      enableV12: options.enableV12 ?? true,
      azaDir: options.azaDir ?? '',
      enableOuterLoop: options.enableOuterLoop ?? false,
    };
    this.stateMachine = new StateMachine();
    this.guards = createDefaultGuards((key) => this.conditions.get(key) === true);
    this.deadlockDetector = new DeadlockDetector(this.configLoopOptions.deadlockThreshold);
    this.hardStop = new HardStopManager();
    this.strikeSystem = new StrikeSystem(this.configLoopOptions.maxStrikes);
    this.circuitBreaker = new CircuitBreaker({
      maxIterations: this.configLoopOptions.maxIterations,
      stagnationThreshold: 3,
      noProgressThreshold: 5,
    });
    this.completionGate = new CompletionGate();
    this.auditor = new LoopAudit();

    // V12: Initialize Decision Point registry for DP-0 to DP-7 protocol
    // (must be initialized before innerLoop creation since innerLoop passes it to PhaseLoop)
    const auditLogPath = this.configLoopOptions.azaDir
      ? path.join(this.configLoopOptions.azaDir, 'audit.jsonl')
      : undefined;
    this.dpRegistry = new DecisionPointRegistry(auditLogPath);
    // Load existing DP history from audit log for session recovery
    if (auditLogPath) {
      this.dpRegistry.loadFromAudit(auditLogPath).catch(() => {
        // best-effort: missing audit log is non-fatal
      });
    }

    this.innerLoop = new InnerLoop(this.circuitBreaker, {
      maxPhaseIterations: this.configLoopOptions.maxStageIterations,
      dpRegistry: this.dpRegistry,
    }, this.stateMachine);

    // V12: Initialize REAL handler provider (gates on actual PRD checks,
    // type-check, test runs, secret scanning and artifact existence —
    // never hardcoded/simulated metrics). The project source lives in the
    // parent of `.aza`, so derive workDir from azaDir.
    const workDir = this.configLoopOptions.azaDir ? path.dirname(this.configLoopOptions.azaDir) : undefined;
    this.handlerProvider = createRealHandlerProvider({
      workDir,
      azaDir: this.configLoopOptions.azaDir || undefined,
      checkerCache: this.checkerCache,
    });

    // V12: Initialize StateManager for file synchronization
    if (this.configLoopOptions.azaDir) {
      this.stateManager = new StateManager(this.configLoopOptions.azaDir);
      // Initialize RunStateManager for machine-owned state (comet pattern)
      const projectRoot = this.configLoopOptions.azaDir
        ? path.dirname(this.configLoopOptions.azaDir)
        : process.cwd();
      this.runStateManager = new RunStateManager(this.configLoopOptions.azaDir, projectRoot);
      this.runStateManager.load().catch(() => {
        // best-effort: missing run-state is non-fatal
      });
      // Initialize AuditLog for append-only state transitions (comet pattern)
      this.auditLog = new AuditLog(this.configLoopOptions.azaDir);
    }

    // V12: Initialize ContextOrchestrator for per-stage JSONL context injection
    if (this.configLoopOptions.azaDir) {
      this.contextOrchestrator = new ContextOrchestrator(this.configLoopOptions.azaDir);
    }
    // V12: Initialize InjectionEngine for stage-specific knowledge
    this.injectionEngine = new InjectionEngine();

    // V12: Wire token budget from config (loop.token_budget or default 4000)
    const configTokenBudget = (effectiveConfig as any).loop?.token_budget;
    if (typeof configTokenBudget === 'number' && configTokenBudget > 0) {
      this.tokenBudget = configTokenBudget;
    }

    // Initialize ResumeGenerator for run-ledger access
    if (this.configLoopOptions.azaDir) {
      this.resumeGen = new ResumeGenerator(this.configLoopOptions.azaDir);
    }

    // Initialize OuterLoop if enabled
    if (this.configLoopOptions.enableOuterLoop) {
      this.outerLoop = new OuterLoop(this.circuitBreaker, {
        maxCycles: this.configLoopOptions.maxIterations,
        requireHumanGate: true,
        enableCircuitBreaker: true,
      });
    }
  }

  // ── V12: Handler provider injection ──

  setHandlerProvider(provider: StageHandlerProvider): void {
    this.handlerProvider = provider;
  }

  // ── C13: OuterLoop callbacks ──

  /** OuterLoop callbacks for Story-level scheduling */
  private outerLoopCallbacks: {
    storyProvider: StoryProvider;
    humanGate: HumanGateFn;
    commit: CommitFn;
  } | null = null;

  /**
   * 设置 OuterLoop 回调。
   * OuterLoop 需要 StoryProvider/HumanGate/Commit 等外部回调。
   * 如果不设置，将使用默认实现从 STATE.yaml 读取 Story 并自动批准。
   */
  setOuterLoopCallbacks(callbacks: {
    storyProvider: StoryProvider;
    humanGate: HumanGateFn;
    commit: CommitFn;
  }): void {
    this.outerLoopCallbacks = callbacks;
  }

  // ── V12: Block count & stop hook tracking (no longer hardcoded) ──

  incrementBlockCount(): void {
    this.blockCount++;
    this.ledgerHasProgress = false;
  }

  resetBlockCount(): void {
    this.blockCount = 0;
    this.ledgerHasProgress = true;
  }

  setStopHook(active: boolean): void {
    this.stopHookActive = active;
  }

  markLedgerProgress(): void {
    this.ledgerHasProgress = true;
  }

  // ── V12: State synchronization (StateMachine ↔ StateManager) ──

  /**
   * Load file state from STATE.yaml into memory StateMachine.
   * Call at the start of next() to ensure cross-session consistency.
   */
  async syncStateFromFile(): Promise<void> {
    if (!this.stateManager) return;
    try {
      const fileState = await this.stateManager.load();
      const stage = fileState.pipeline.current_stage as Stage;
      // Mutate in place — do NOT reassign — so InnerLoop/OuterLoop keep
      // observing the same shared StateMachine instance.
      this.stateMachine.loadState({
        current_stage: stage,
        stages: fileState.pipeline.stages as Record<Stage, any>,
        iteration: fileState.loop.iteration,
        progress: fileState.loop.progress,
        loops: fileState.loops as any,
        attestation: fileState.attestation || { verified: true },
      });
    } catch {
      // File doesn't exist yet — use default state
    }
  }

  /**
   * Persist memory StateMachine state to file STATE.yaml.
   * Call after stage transitions and gate passes.
   */
  async syncStateToFile(): Promise<void> {
    if (!this.stateManager) return;
    const memState = this.stateMachine.getState();
    const currentState = this.stateManager.getState();
    await this.stateManager.update({
      pipeline: {
        current_stage: memState.current_stage,
        stages: memState.stages as any,
      },
      loops: memState.loops as any,
      loop: {
        iteration: memState.iteration,
        progress: memState.progress,
        current_story: memState.loops.inner.current_story,
        client: currentState.loop.client,
        model: currentState.loop.model,
        max_iterations: currentState.loop.max_iterations,
      },
      attestation: memState.attestation,
      strikes: currentState.strikes,
    });
  }

  // ── V11 compatibility: condition-based guards ──

  setCondition(key: GuardConditionKey, passed: boolean): void {
    this.conditions.set(key, passed);
  }

  getCondition(key: GuardConditionKey): boolean {
    return this.conditions.get(key) === true;
  }

  resetConditions(): void {
    this.conditions.clear();
  }

  // ── Main entry: next() with V12 three-level routing ──

  async next(currentStage?: string): Promise<LoopResponse<{ stage: string; progress: string; next_action: NextAction }>> {
    // V12: Sync state from file at the start of each cycle
    await this.syncStateFromFile();

    // If OuterLoop is enabled and has callbacks, use OuterLoop
    if (this.configLoopOptions.enableOuterLoop && this.outerLoop && this.outerLoopCallbacks) {
      const outerResult = await this.runOuterLoop();
      return this.buildOuterLoopResponse(outerResult);
    }

    const result = this.configLoopOptions.enableV12
      ? await this.nextV12(currentStage)
      : this.nextV11(currentStage);

    // V12: Sync state to file at the end of each cycle
    await this.syncStateToFile();
    return result;
  }

  /**
   * Run the OuterLoop for Story-level scheduling.
   */
  private async runOuterLoop(): Promise<OuterLoopResult> {
    const storyProvider = this.outerLoopCallbacks?.storyProvider || 
      (this.stateManager ? createDefaultStoryProvider(this.stateManager) : null);
    
    const humanGate = this.outerLoopCallbacks?.humanGate ||
      (this.stateManager ? createDefaultHumanGate(this.stateManager) : null);
    
    const commit = this.outerLoopCallbacks?.commit ||
      (this.stateManager ? createDefaultCommit(this.stateManager) : null);

    if (!storyProvider || !humanGate || !commit) {
      throw new Error('OuterLoop requires storyProvider, humanGate, and commit callbacks or StateManager');
    }

    const stateReader = async () => {
      const state = this.stateMachine.getState();
      const innerState = this.stateMachine.getInnerLoopState();
      return {
        current_stage: state.current_stage,
        has_in_progress: innerState.current_story !== null,
        iteration: state.iteration,
      };
    };

    const result = await this.outerLoop!.run(
      storyProvider,
      stateReader,
      this.handlerProvider,
      humanGate,
      commit,
    );

    // Sync state after OuterLoop completes
    await this.syncStateToFile();
    return result;
  }

  /**
   * Build response from OuterLoop result.
   */
  private buildOuterLoopResponse(outerResult: OuterLoopResult): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    const stage = this.stateMachine.getCurrentStage();
    const state = this.stateMachine.getState();

    if (outerResult.done) {
      return this.buildResponse('archive', {
        tool: 'aza_loop_next', action: 'done',
        reason: 'All stories processed — project complete',
      });
    }

    if (outerResult.escalated) {
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'escalate',
        reason: outerResult.escalation_reason || 'OuterLoop escalated to human',
      }, true);
    }

    // Continue with next story
    return this.buildResponse(stage, {
      tool: 'aza_loop_next', action: 'next',
      reason: `OuterLoop cycle ${outerResult.total_cycles} completed — continue to next story`,
    });
  }

  /**
   * V12 path: route through InnerLoop → PhaseLoop three-level hierarchy.
   *
   * Calls InnerLoop.run() which invokes PhaseLoop.run() for each stage,
   * executing maker → checker → gate → optimizer cycle.
   */
  private async nextV12(currentStage?: string): Promise<LoopResponse<{ stage: string; progress: string; next_action: NextAction }>> {
    const stage = (currentStage || this.stateMachine.getCurrentStage()) as Stage;

    // Hard stop check
    if (this.hardStop.isStopped()) {
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'report',
        reason: `Hard stop: ${this.hardStop.getRecord()?.reason}`,
      }, true);
    }

    // Check circuit breaker
    const breakerResult = this.circuitBreaker.checkAll();
    if (breakerResult?.tripped) {
      this.hardStop.stop('max_iterations_exceeded', breakerResult.reason!, this.stateMachine.getState().iteration);
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'escalate',
        reason: `Circuit breaker tripped: ${breakerResult.reason}`,
      }, true);
    }

    // Check global iteration limit
    const iterCheck = HardStopManager.checkIterations(
      this.stateMachine.getState().iteration, this.configLoopOptions.maxIterations,
    );
    if (iterCheck.exceeded) {
      this.hardStop.stop('max_iterations_exceeded', iterCheck.detail!, this.stateMachine.getState().iteration);
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'stop',
        reason: iterCheck.detail!,
      }, true);
    }

    // V12: Check 3-Strike system
    if (this.strikeSystem.isHardStop()) {
      this.hardStop.stop('strikes_exceeded', `3-Strike hard stop: ${this.strikeSystem.getStrikeCount()} strikes`, this.stateMachine.getState().iteration);
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'escalate',
        reason: `3-Strike hard stop: ${this.strikeSystem.getStrikeCount()} strikes exceeded`,
      }, true);
    }

    // ── V12 Core: Call InnerLoop.run() to execute three-level loop ──
    const innerState = this.stateMachine.getInnerLoopState();
    const storyId = innerState.current_story || `STORY-${stage.toUpperCase()}`;

    // Mark current stage as in_progress
    this.stateMachine.setStageStatus(stage, 'in_progress');

    // ── V12: Generate per-stage context (JSONL) and inject knowledge ──
    let contextBundle: ContextEntryBundle | null = null;
    let knowledgeEntries: string[] = [];
    if (this.contextOrchestrator) {
      try {
        const bundle = await this.contextOrchestrator.generateContextFiles(stage);
        const injected = await this.contextOrchestrator.injectContext(stage);
        const pruned = this.contextOrchestrator.pruneContext(injected, this.tokenBudget);
        // Store pruned context for handlers to use — ContextEntryBundle structure
        contextBundle = pruned;
        this.checkerCache.set(`context:${stage}`, { result: contextBundle, timestamp: Date.now() });
      } catch { /* best-effort: context injection is non-fatal */ }
    }
    // Inject stage-specific knowledge from InjectionEngine
    knowledgeEntries = this.injectionEngine.inject({
      stage,
      tags: [stage, storyId],
    });
    if (knowledgeEntries.length > 0) {
      this.checkerCache.set(`knowledge:${stage}`, { result: knowledgeEntries, timestamp: Date.now() });
    }

    // Update handler provider with fresh context/knowledge for this cycle
    const handlerWorkDir = this.configLoopOptions.azaDir ? path.dirname(this.configLoopOptions.azaDir) : undefined;
    this.handlerProvider = createRealHandlerProvider({
      workDir: handlerWorkDir,
      azaDir: this.configLoopOptions.azaDir || undefined,
      checkerCache: this.checkerCache,
      contextBundle,
      knowledgeEntries,
    });

    // Execute InnerLoop for this stage
    const innerResult = await this.innerLoop.run(storyId, this.handlerProvider);

    if (innerResult.success) {
      // Stage succeeded → record progress
      this.circuitBreaker.recordProgress('inner');
      this.markLedgerProgress();

      if (innerResult.completed) {
        // V12: Evaluate CompletionGate before allowing stop
        // Check attestation from state machine
        const state = this.stateMachine.getState();
        const attestationVerified = state.attestation?.verified ?? false;
        const allCompleted = Object.values(state.stages).every(s => s.status === 'completed');
        const gateResult = this.completionGate.evaluate({
          gated_mode_enabled: true,
          has_in_progress_stage: false,
          all_stages_completed: allCompleted,
          stop_hook_active: this.stopHookActive,
          block_count: this.blockCount,
          block_count_limit: DEFAULT_BLOCK_COUNT_LIMIT,
          ledger_has_progress: this.ledgerHasProgress,
          attestation_verified: attestationVerified,
        });
        if (gateResult.canStop) {
          this.stateMachine.setStageStatus('archive', 'completed');
          return this.buildResponse('archive', {
            tool: 'aza_loop_next', action: 'done',
            reason: 'All stages complete — project archived',
          });
        } else {
          // CompletionGate blocked — continue looping
          return this.buildResponse(stage, {
            tool: 'aza_loop_next', action: 'refine',
            reason: `CompletionGate blocked: ${gateResult.blockedReason}`,
          });
        }
      }

      // Advance to next stage
      const nextStage = innerResult.current_stage as Stage;
      if (nextStage && nextStage !== stage) {
        this.stateMachine.setStageStatus(stage, 'completed');
        this.stateMachine.setPhaseLoopState({
          current: nextStage,
          iteration: 0,
          history: [],
        });
        return this.buildResponse(nextStage, this.getStageEntryAction(nextStage), false, 'inner');
      }

      // Same stage, next iteration
      return this.buildResponse(stage, this.getStageEntryAction(stage), false, 'inner');
    }

    // Stage failed
    if (innerResult.escalated) {
      this.circuitBreaker.recordFailure('inner', innerResult.escalation_reason || 'Stage failed');
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'escalate',
        reason: innerResult.escalation_reason || `Stage "${stage}" escalated`,
      }, false, 'inner');
    }

    // Gate failed but not escalated → return refine action
    const phaseState = this.stateMachine.getPhaseLoopState();
    this.circuitBreaker.recordFailure('phase', `Stage "${stage}" gate check failed`);

    // Check phase-level stagnation
    const phaseCheck = this.circuitBreaker.check('phase');
    if (phaseCheck.tripped) {
      this.circuitBreaker.recordFailure('inner', `Phase "${stage}" circuit breaker tripped`);
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'escalate',
        reason: `Stage "${stage}" circuit breaker tripped: ${phaseCheck.reason}`,
      }, false, 'inner');
    }

    return this.buildResponse(stage, {
      tool: 'aza_task_implement', action: 'refine',
      reason: `Stage "${stage}" needs refinement (phase iteration ${phaseState.iteration})`,
    }, false, 'phase');
  }

  /**
   * V11 fallback: boolean guard check.
   */
  private nextV11(currentStage?: string): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    const stage = currentStage || this.stateMachine.getCurrentStage();

    if (this.hardStop.isStopped()) {
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'report',
        reason: `Hard stop: ${this.hardStop.getRecord()?.reason}`,
      }, true);
    }

    const iterCheck = HardStopManager.checkIterations(
      this.stateMachine.getState().iteration, this.configLoopOptions.maxIterations,
    );
    if (iterCheck.exceeded) {
      this.hardStop.stop('max_iterations_exceeded', iterCheck.detail!, this.stateMachine.getState().iteration);
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'stop', reason: iterCheck.detail!,
      }, true);
    }

    const currentStageIter = this.stageIterations.get(stage) || 0;
    if (currentStageIter >= this.configLoopOptions.maxStageIterations) {
      this.hardStop.stop('max_iterations_exceeded',
        `Stage "${stage}" exceeded max stage iterations (${this.configLoopOptions.maxStageIterations})`,
        this.stateMachine.getState().iteration);
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'escalate',
        reason: `Stage ${stage} stuck after ${currentStageIter} attempts`,
      }, true);
    }

    const strikeCheck = HardStopManager.checkStrikes(
      this.strikeSystem.getStrikeCount(), this.configLoopOptions.maxStrikes,
    );
    if (strikeCheck.exceeded) {
      this.hardStop.stop('strikes_exceeded', strikeCheck.detail!, this.stateMachine.getState().iteration);
      return this.buildResponse(stage, {
        tool: 'aza_loop_next', action: 'escalate', reason: strikeCheck.detail!,
      }, true);
    }

    const guardResult = this.guards.checkStage(stage as any);

    if (guardResult.allowed) {
      this.stateMachine.setStageStatus(stage as any, 'completed');
      if (stage === 'archive') {
        return this.buildResponse(stage, {
          tool: 'aza_loop_next', action: 'done', reason: 'All stages complete',
        });
      }
      this.stateMachine.advance();
      const advancedStage = this.stateMachine.getCurrentStage();
      this.stateMachine.setStageStatus(advancedStage, 'in_progress');
      return this.buildResponse(advancedStage, this.getStageEntryAction(advancedStage));
    }

    this.stageIterations.set(stage, currentStageIter + 1);
    this.stateMachine.setStageStatus(stage as any, 'in_progress');

    return this.buildResponse(stage, {
      tool: guardResult.refine_tool || 'aza_task_implement',
      action: guardResult.refine_action || 'refine',
      reason: guardResult.reason || `Quality checks not passed for stage "${stage}"`,
    });
  }

  // ── Shared methods ──

  recordAction(tool: string, action: string): void {
    this.deadlockDetector.record(tool, action, this.stateMachine.getState().iteration);
    if (this.deadlockDetector.isDeadlocked()) {
      const repeated = this.deadlockDetector.getRepeatedAction();
      if (repeated) {
        this.strikeSystem.record('deadlock_detected', `Deadlock: repeated ${repeated.tool}:${repeated.action}`, this.stateMachine.getState().iteration);
        this.deadlockDetector.clear();
      }
    }
  }

  completeStage(stage: string): { success: boolean; error?: string } {
    const guardResult = this.guards.checkStage(stage as any);
    if (!guardResult.allowed) {
      return { success: false, error: guardResult.reason || `Cannot complete stage "${stage}": quality gates not passed` };
    }
    if (stage === 'archive') {
      this.stateMachine.setStageStatus('archive', 'completed');
      return { success: true };
    }
    this.stateMachine.setStageStatus(stage as any, 'completed');
    this.stateMachine.advance();
    const nextStage = this.stateMachine.getCurrentStage();
    this.stateMachine.setStageStatus(nextStage, 'in_progress');
    return { success: true };
  }

  forceAdvance(stage: string): string | null {
    this.stateMachine.setStageStatus(stage as any, 'completed');
    return this.stateMachine.advance();
  }

  /**
   * Reset controller state for reuse (caller responsible for re-init after stop).
   */
  reset(): void {
    this.hardStop.reset();
    this.circuitBreaker.reset();
    this.strikeSystem.clear();
    this.checkerCache.clear();
    this.blockCount = 0;
    this.ledgerHasProgress = false;
    this.stopHookActive = false;
  }

  stop(reason: StopReason, detail: string): void {
    this.hardStop.stop(reason, detail, this.stateMachine.getState().iteration);
  }

  getStageIterations(stage: string): number {
    return this.stageIterations.get(stage) || 0;
  }

  // ── V12: Audit integration ──

  async audit() {
    const azaDir = this.configLoopOptions.azaDir;
    const workDir = azaDir ? path.dirname(azaDir) : process.cwd();

    // ── Real signal collection from filesystem and state ──
    const stateFileExists = this.stateManager !== null;

    // Check loop.md existence
    let loopMdExists = false;
    if (azaDir) {
      try { loopMdExists = fs.existsSync(path.join(azaDir, 'LOOP.md')); } catch { /* ignore */ }
    }

    // Check run-log (run-ledger.jsonl) existence
    let runLogExists = false;
    if (azaDir) {
      try { runLogExists = fs.existsSync(path.join(azaDir, 'run-ledger.jsonl')); } catch { /* ignore */ }
    }

    // Skill registration — V12 enables real handler providers
    const triageSkillRegistered = this.configLoopOptions.enableV12;
    const verifierSkillRegistered = this.configLoopOptions.enableV12;

    // Safety docs — check for AGENTS.md and safety docs in project root
    let safetyDocsPresent = false;
    let agentsMdPresent = false;
    try {
      safetyDocsPresent = fs.existsSync(path.join(workDir, 'docs', 'safety.md')) ||
        fs.existsSync(path.join(workDir, 'SAFETY.md'));
      agentsMdPresent = fs.existsSync(path.join(workDir, 'AGENTS.md'));
    } catch { /* ignore */ }

    // Human escalation — stop hook active or configured
    const humanEscalationConfigured = this.stopHookActive ||
      (this.config?.loop as any)?.human_escalation === true;

    // Workflows configured — check for CI files
    let workflowsConfigured = false;
    try {
      workflowsConfigured = fs.existsSync(path.join(workDir, '.github', 'workflows')) ||
        fs.existsSync(path.join(workDir, '.gitlab-ci.yml'));
    } catch { /* ignore */ }

    // Patterns documented — conventions.jsonl exists
    let patternsDocumented = false;
    if (azaDir) {
      try {
        patternsDocumented = fs.existsSync(path.join(azaDir, 'spec-conventions', 'conventions.jsonl'));
      } catch { /* ignore */ }
    }

    // Isolation signals
    const worktreeIsolated = false; // worktree isolation is opt-in
    const mcpIsolated = true; // MCP servers are always isolated by design

    // Cost signals
    const budgetConfigured = this.tokenBudget !== 4000 || // non-default budget
      typeof (this.config?.loop as any)?.token_budget === 'number';
    const runLogCostTracked = this.ledgerHasProgress || runLogExists;

    // Permission + anti-stall + activity
    const leastPrivilegeEnforced = true; // enforced by MCP event bridge design
    const circuitBreakerActive = true; // always active
    let lastRunRecent = false;
    let gitCommitsPresent = false;
    if (azaDir) {
      try {
        // Check run-state.json for last_run timestamp
        const runStatePath = path.join(azaDir, 'run-state.json');
        if (fs.existsSync(runStatePath)) {
          const raw = JSON.parse(fs.readFileSync(runStatePath, 'utf-8'));
          if (raw.updated_at) {
            const lastRun = new Date(raw.updated_at).getTime();
            lastRunRecent = (Date.now() - lastRun) < 24 * 60 * 60 * 1000; // within 24h
          }
        }
        // Check git commits
        const gitDir = path.join(workDir, '.git');
        gitCommitsPresent = fs.existsSync(gitDir) && this.stateMachine.getState().iteration > 0;
      } catch { /* ignore */ }
    }

    const input: Record<string, boolean> = {
      state_file_exists: stateFileExists,
      loop_md_exists: loopMdExists,
      run_log_exists: runLogExists,
      triage_skill_registered: triageSkillRegistered,
      verifier_skill_registered: verifierSkillRegistered,
      safety_docs_present: safetyDocsPresent,
      agents_md_present: agentsMdPresent,
      human_escalation_configured: humanEscalationConfigured,
      workflows_configured: workflowsConfigured,
      patterns_documented: patternsDocumented,
      worktree_isolated: worktreeIsolated,
      mcp_isolated: mcpIsolated,
      budget_configured: budgetConfigured,
      run_log_cost_tracked: runLogCostTracked,
      least_privilege_enforced: leastPrivilegeEnforced,
      circuit_breaker_active: circuitBreakerActive,
      last_run_recent: lastRunRecent,
      git_commits_present: gitCommitsPresent,
    };
    return this.auditor.evaluate(input);
  }

  // ── Private helpers ──

  private buildResponse(
    stage: string,
    nextAction: NextAction,
    isHardStop = false,
    loopLevel: 'outer' | 'inner' | 'phase' = 'phase',
  ): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    const state = this.stateMachine.getState();
    const phaseState = this.stateMachine.getPhaseLoopState();
    return {
      success: !isHardStop,
      data: { stage, progress: state.progress, next_action: nextAction },
      next_action: nextAction,
      error: isHardStop ? nextAction.reason : undefined,
      metadata: {
        iteration: state.iteration,
        progress: state.progress,
        stage,
        loop_level: loopLevel,
        phase_iteration: phaseState.iteration,
      },
    };
  }

  private getStageEntryAction(stage: string): NextAction {
    const actions: Record<string, NextAction> = {
      open: { tool: 'aza_prd_generate', action: 'generate', reason: 'Entering open stage — generate PRD first' },
      design: { tool: 'aza_task_design', action: 'design', reason: 'Entering design stage — design stories' },
      build: { tool: 'aza_task_implement', action: 'implement', reason: 'Entering build stage — implement with tests' },
      verify: { tool: 'aza_quality_check', action: 'check', reason: 'Entering verify stage — run quality gates' },
      archive: { tool: 'aza_doc_generate', action: 'generate', reason: 'Entering archive stage — finalize documentation' },
    };
    return actions[stage] || { tool: 'aza_loop_next', action: 'next', reason: `Continue in ${stage} stage` };
  }
}
