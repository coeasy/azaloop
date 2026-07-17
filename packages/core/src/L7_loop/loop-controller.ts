import { StateMachine, type Stage } from './state-machine';
import { StageGuards, createDefaultGuards, type GuardConditionKey } from './guards';
import { DeadlockDetector } from './deadlock-detector';
import { HardStopManager, type StopReason } from './hard-stop';
import { StrikeSystem } from '../L4_discipline/strike-system';
import type { RootCauseCategory } from '../L4_discipline/strike-system';
import { DlpChainDetector } from '../L4_discipline/dlp-chain-detector';
import { diffPrd, diffContract, hasMaterialChange } from './content-diff';
import { CircuitBreaker } from './circuit-breaker';
import { CompletionGate, DEFAULT_BLOCK_COUNT_LIMIT } from './completion-gate';
import { LoopAudit } from './loop-audit';
import { InnerLoop, type InnerStageResult, type StageHandlerProvider } from './inner-loop';
import { OuterLoop, type StoryProvider, type HumanGateFn, type CommitFn, type OuterLoopResult, createDefaultStoryProvider, createDefaultHumanGate, createDefaultCommit } from './outer-loop';
import { createRealHandlerProvider } from './real-handlers';
import { StateManager } from '../state/state-manager';
import { RunStateManager, AuditLog } from '../state/state-manager';
// R10 第2轮 (D1)：导入 RunLedger 以便 DLP 链式检测读取最近条目
import { RunLedger } from '../state/run-ledger';
import { ContextOrchestrator, type ContextEntryBundle } from '../L2_memory/context-orchestrator';
import type { ContextEntry } from '../L2_memory/context-orchestrator';
// R10 第3轮 (D3)：导入 FilePersistor 以接入主循环 checkpoint 落盘
import { FilePersistor } from '../L2_memory/file-persistor';
import { InjectionEngine } from '../L9_knowledge/injection-engine';
import { ConfigLoader } from '../config/config-loader';
import { DecisionPointRegistry, contentHash, type DecisionPointRecord, type DPStatus } from './decision-points';
import { ResumeGenerator } from '../continuity/resume-generator';
import { AZALOOP_ENGINE_VERSION } from '../continuity/resume-generator';
import { ProgressLedger2D } from './progress-ledger';
import * as fs from 'fs';
import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { AzaloopConfig } from '@azaloop/shared';
import type { PRD } from '@azaloop/shared';
import * as path from 'path';
import { TokenBudget, type BudgetAction } from './token-budget';
// R12 P6 Plus (P2 退出标准): 主编排 + 阶段执行 拆分为独立子模块
import { NextOrchestrator } from './runtime/next-orchestrator';
import { PhaseHandler } from './runtime/phase-handler';
// R12 P6 Plus2 (P2 退出标准): 状态同步 + 审计评估 + OuterLoop + V11 拆分为独立子模块
import { StateSync } from './runtime/state-sync';
import { AuditEvaluator } from './runtime/audit-evaluator';
import { OuterLoopRunner } from './runtime/outer-loop-runner';
import { NextV11 } from './runtime/next-v11';
// R12 P6 Plus3 (P2 退出标准): 生命周期 + 响应构造 拆分为独立子模块
import { LifecycleHandler } from './runtime/lifecycle-handler';
import { ResponseBuilder } from './runtime/response-builder';
// R12 P6 Plus4 (P2 退出标准): 纯函数路由 + 可观察外观 + hook 管理 + 回调桥接 拆分为独立子模块
import { resolveRoute } from './runtime/route-resolver';
import { ObservableFacade } from './runtime/observable-facade';
import { HookManager } from './runtime/hook-manager';
import { CallbackBridge } from './runtime/callback-bridge';
// R12 P6 Plus5 (P2 退出标准强化): V12 子系统初始化拆分为独立工厂
import { SubsystemInitializer } from './runtime/subsystem-initializer';
// R12 P6 Plus6 (P2 退出标准强化): 11 个 submodule 依赖注入装配拆分为工厂
import { SubmoduleWiring } from './runtime/submodule-wiring';

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
  /** V20 Task 4: Token budget hard cap (per-task & per-session limits) */
  tokenBudget?: TokenBudget;
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

  /**
   * R10 第2轮 (D1)：RunLedger 句柄，供 DLP 链式检测读取最近条目。
   * 与 resumeGen 共享同一份 run-ledger.jsonl；首次使用前需 load()。
   */
  private runLedger: RunLedger | null = null;

  /**
   * R10 第3轮 (D3)：统一文件落盘器，主循环每轮 checkpoint 持久化所有关键产物。
   * 确保主循环 next() 不再遗漏 prd.md/contract.md/loop.md 的落盘。
   */
  private filePersistor: FilePersistor | null = null;

  /** V12: Handler provider for maker/checker/optimizer */
  private handlerProvider: StageHandlerProvider;

  /** V12: Block count for CompletionGate (no longer hardcoded) */
  blockCount: number = 0;
  /** V12: Stop hook active state (no longer hardcoded) */
  stopHookActive: boolean = false;
  /** V12: Ledger progress tracking (no longer hardcoded) */
  ledgerHasProgress: boolean = false;
  /** R12 P6 Plus4: Context bundle (from options) — used by callback bridge for handler provider */
  readonly contextBundle: ContextEntryBundle | null;
  /** R12 P6 Plus4: Knowledge entries (from options) — used by callback bridge for handler provider */
  readonly knowledgeEntries: string[];

  /** OuterLoop controller for Story-level scheduling */
  private outerLoop: OuterLoop | null = null;

  /** Context orchestrator — per-stage JSONL injection + Summarize→Prune→Inject */
  private contextOrchestrator: ContextOrchestrator | null = null;
  /** Injection engine — stage-specific knowledge injection */
  private injectionEngine: InjectionEngine;
  /** V20 Task 4: Token budget hard cap (per-task & per-session limits) */
  private tokenBudget: TokenBudget;
  /** Resume generator for run-ledger access */
  private resumeGen: ResumeGenerator | null = null;
  /** Cache for checker results within a single next() cycle */
  private checkerCache: Map<string, { result: any; timestamp: number }> = new Map();
  /** Decision Point registry for DP-0 to DP-7 protocol (auditable stage handoffs) */
  readonly dpRegistry: DecisionPointRegistry;
  /** CP1 drift detection: content hashes of PRD/contract from last sync (spec-superflow pattern) */
  private lastHashes: { prd?: string; contract?: string } = {};
  /** Set when content drift is detected (PRD/contract changed without going through aza_prd_modify) */
  private driftDetected: boolean = false;
  /** V20 Task 11: DLP 链式检测器 */
  private dlpDetector: DlpChainDetector | null = null;
  /** V20 Task 12: 缓存上次 PRD 内容（用于内容差异分析） */
  private lastPrd: PRD | null = null;
  /** V20 Task 12: 缓存上次 contract 内容（用于内容差异分析） */
  private lastContract: string = '';
  /** 二维进度账本（stage × iteration），用于崩溃恢复和无进展检测 */
  private ledger2d: ProgressLedger2D = new ProgressLedger2D();

  /** R12 P6 Plus: 主编排器（next() 拆分目标） */
  private orchestrator: NextOrchestrator | null = null;
  /** R12 P6 Plus: 阶段执行器（nextV12 拆分目标） */
  private phaseHandler: PhaseHandler | null = null;
  /** R12 P6 Plus2: 状态同步器（syncStateFromFile/ToFile/buildLoopMarkdown 拆分目标） */
  private stateSync: StateSync | null = null;
  /** R12 P6 Plus2: 审计评估器（audit() 拆分目标） */
  private auditEvaluator: AuditEvaluator | null = null;
  /** R12 P6 Plus2: OuterLoop 运行器（runOuterLoop/advanceBoard/buildResponse 拆分目标） */
  private outerLoopRunner: OuterLoopRunner | null = null;
  /** R12 P6 Plus2: V11 兼容路径（nextV11 拆分目标） */
  private nextV11Runner: NextV11 | null = null;
  /** R12 P6 Plus3: 生命周期处理器 */
  private lifecycleHandler: LifecycleHandler | null = null;
  /** R12 P6 Plus3: 响应构建器 */
  private responseBuilder: ResponseBuilder | null = null;
  /** R12 P6 Plus4: 纯函数路由（无需实例，引用 resolveRoute 函数即可） */
  /** R12 P6 Plus4: 可观察外观（worker scheduler 桥接） */
  private observableFacade: ObservableFacade | null = null;
  /** R12 P6 Plus4: hook 管理（block count / stop hook / ledger progress） */
  private hookManager: HookManager | null = null;
  /** R12 P6 Plus4: 回调桥接（OuterLoop callbacks + handler provider 构造） */
  private callbackBridge: CallbackBridge | null = null;

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
        loop: {
          max_iterations: 50,
          max_stage_iterations: 20,
          outer_enabled: true,
          full_auto: false,
          deadlock_threshold: 3,
          hard_stop_on_security: true,
        },
        autonomy: { level: 'L2', auto_approve_prd: false },
        memory: { enabled: true, episodic_max: 100, compression_threshold: 50 },
        quality: { gates: { lint: true, test: true, regression: true, security: true, acceptance: true } },
        rules: [],
        boundaries: { never_touch: [] },
        mcp_servers: [],
      };
    }
    this.config = effectiveConfig;

    this.options = options;
    this.contextBundle = options.contextBundle ?? null;
    this.knowledgeEntries = options.knowledgeEntries ?? [];
    // R10: maxStageIterations 配置化（9.8.4-2）。优先级：
    // 显式 options.maxStageIterations > AZA_MAX_STAGE_ITERATIONS 环境变量 > azaloop.yaml loop.max_stage_iterations > 默认 20
    const envMaxStage = Number(process.env.AZA_MAX_STAGE_ITERATIONS);
    const resolvedMaxStageIterations =
      options.maxStageIterations ??
      (Number.isFinite(envMaxStage) && envMaxStage > 0
        ? envMaxStage
        : effectiveConfig.loop.max_stage_iterations) ??
      20;
    this.configLoopOptions = {
      maxIterations: options.maxIterations ?? effectiveConfig.loop.max_iterations,
      maxStageIterations: resolvedMaxStageIterations,
      maxStrikes: options.maxStrikes ?? 3,
      deadlockThreshold: options.deadlockThreshold ?? effectiveConfig.loop.deadlock_threshold,
      hardStopOnSecurity: options.hardStopOnSecurity ?? effectiveConfig.loop.hard_stop_on_security,
      enableV12: options.enableV12 ?? true,
      azaDir: options.azaDir ?? '',
      enableOuterLoop: options.enableOuterLoop ?? false,
    };
    // R12 P6 Plus5: 委托 SubsystemInitializer 执行 V12 子系统初始化
    // 7 个核心子系统 + DP registry + inner loop + handler provider
    // + 持久化（stateManager/runStateManager/auditLog/tokenBudget）
    // + 注入（contextOrchestrator/injectionEngine/resumeGen/runLedger/filePersistor/dlpDetector）
    // + OuterLoop + crash recovery
    const initializer = new SubsystemInitializer({
      config: this.configLoopOptions,
      tokenBudget: options.tokenBudget,
      checkerCache: this.checkerCache,
      contextBundle: this.contextBundle,
      knowledgeEntries: this.knowledgeEntries,
      conditions: this.conditions,
      stageIterations: this.stageIterations,
      ledger2d: this.ledger2d,
      setBlockCount: (n) => { this.blockCount = n; },
      setLedgerHasProgress: (v) => { this.ledgerHasProgress = v; },
      setStopHookActive: (v) => { this.stopHookActive = v; },
    });
    const core = initializer.initCore();
    this.stateMachine = core.stateMachine;
    this.guards = core.guards;
    this.deadlockDetector = core.deadlockDetector;
    this.hardStop = core.hardStop;
    this.strikeSystem = core.strikeSystem;
    this.circuitBreaker = core.circuitBreaker;
    this.completionGate = core.completionGate;
    this.auditor = core.auditor;
    const v12 = initializer.initV12(core);
    this.dpRegistry = v12.dpRegistry;
    this.innerLoop = v12.innerLoop;
    this.handlerProvider = v12.handlerProvider;
    const persistence = initializer.initPersistence();
    this.stateManager = persistence.stateManager;
    this.runStateManager = persistence.runStateManager;
    this.auditLog = persistence.auditLog;
    this.tokenBudget = persistence.tokenBudget;
    const injection = initializer.initInjection(this.auditLog);
    this.contextOrchestrator = injection.contextOrchestrator;
    this.injectionEngine = injection.injectionEngine;
    this.resumeGen = injection.resumeGen;
    this.runLedger = injection.runLedger;
    this.filePersistor = injection.filePersistor;
    this.dlpDetector = injection.dlpDetector;
    this.outerLoop = initializer.initOuterLoop(this.innerLoop);
    initializer.recoverLedger();

    // R12 P6 Plus6: 委托 SubmoduleWiring 执行 11 个 submodule 依赖注入装配
    // 两阶段装配：wireLeaves() → 9 个 leaf submodules；wireHubs() → 2 个 hub submodules
    const wiring = new SubmoduleWiring({
      // ── Subsystems ──
      stateMachine: this.stateMachine,
      guards: this.guards,
      deadlockDetector: this.deadlockDetector,
      hardStop: this.hardStop,
      strikeSystem: this.strikeSystem,
      circuitBreaker: this.circuitBreaker,
      completionGate: this.completionGate,
      auditor: this.auditor,
      innerLoop: this.innerLoop,
      dpRegistry: this.dpRegistry,
      handlerProvider: this.handlerProvider,
      dlpDetector: this.dlpDetector,
      runLedger: this.runLedger,
      resumeGen: this.resumeGen,
      contextOrchestrator: this.contextOrchestrator,
      injectionEngine: this.injectionEngine,
      auditLog: this.auditLog,
      stateManager: this.stateManager,
      runStateManager: this.runStateManager,
      tokenBudget: this.tokenBudget,
      filePersistor: this.filePersistor,
      outerLoop: this.outerLoop,
      ledger2d: this.ledger2d,
      // ── Configuration ──
      config: this.config,
      configLoopOptions: this.configLoopOptions,
      projectRoot: this.options.projectRoot,
      contextBundle: this.contextBundle,
      knowledgeEntries: this.knowledgeEntries,
      // ── State ──
      blockCount: this.blockCount,
      stopHookActive: this.stopHookActive,
      ledgerHasProgress: this.ledgerHasProgress,
      driftDetected: this.driftDetected,
      conditions: this.conditions,
      stageIterations: this.stageIterations,
      checkerCache: this.checkerCache,
      lastHashes: this.lastHashes,
      lastPrd: this.lastPrd,
      lastContract: this.lastContract,
      // ── Setters ──
      setBlockCount: (n) => { this.blockCount = n; },
      setLedgerHasProgress: (v) => { this.ledgerHasProgress = v; },
      setStopHookActive: (v) => { this.stopHookActive = v; },
      setLastHashes: (h) => { this.lastHashes = h; },
      setLastPrd: (p) => { this.lastPrd = p; },
      setLastContract: (c) => { this.lastContract = c; },
      setDriftDetected: (v) => { this.driftDetected = v; },
      setHandlerProvider: (p) => this.setHandlerProvider(p),
      // ── Controller method bridges ──
      syncStateFromFile: () => this.syncStateFromFile(),
      syncStateToFile: () => this.syncStateToFile(),
      notifyStageAdvance: (s) => this.notifyStageAdvance(s),
      notifyStrike: (r) => this.notifyStrike(r),
      notifyCompletion: () => this.notifyCompletion(),
      markLedgerProgress: () => this.markLedgerProgress(),
      buildResponse: (stage, action, hard, level, awaiting) =>
        this.buildResponse(stage, action, hard, level, awaiting),
      getStageEntryAction: (s) => this.getStageEntryAction(s),
      dispatchV12: (cs) => this.dispatchV12(cs),
      dispatchV11: (cs) => this.dispatchV11(cs),
    });
    const leaves = wiring.wireLeaves();
    this.responseBuilder = leaves.responseBuilder;
    this.lifecycleHandler = leaves.lifecycleHandler;
    this.nextV11Runner = leaves.nextV11Runner;
    this.outerLoopRunner = leaves.outerLoopRunner;
    this.auditEvaluator = leaves.auditEvaluator;
    this.stateSync = leaves.stateSync;
    this.observableFacade = leaves.observableFacade;
    this.hookManager = leaves.hookManager;
    this.callbackBridge = leaves.callbackBridge;
    const hubs = wiring.wireHubs({
      outerLoopRunner: () => this.outerLoopRunner,
    });
    this.orchestrator = hubs.orchestrator;
    this.phaseHandler = hubs.phaseHandler;
  }

  // ── V12: Handler provider injection ──

  setHandlerProvider(provider: StageHandlerProvider): void {
    this.handlerProvider = provider;
    // Keep the inner loop in lock-step with the controller's handler
    // provider so the 5-phase handlers always use the same real handlers.
    this.innerLoop?.setHandlerProvider(provider);
  }

  // ── C13: OuterLoop callbacks ──

  /**
   * 设置 OuterLoop 回调。
   * R12 P6 Plus4: 委托到 runtime/callback-bridge.ts。
   * OuterLoop 需要 StoryProvider/HumanGate/Commit 等外部回调。
   * 如果不设置，将使用默认实现从 STATE.yaml 读取 Story 并自动批准。
   */
  setOuterLoopCallbacks(callbacks: {
    storyProvider: StoryProvider;
    humanGate: HumanGateFn;
    commit: CommitFn;
  }): void {
    this.callbackBridge?.setOuterLoopCallbacks(callbacks);
  }

  // ── v13: WorkerScheduler wiring (P1.1) ──

  /**
   * R12 P6 Plus4: thin shell — 委托到 runtime/observable-facade.ts。
   * Worker scheduler (ruflo 12 workers + 270s heartbeat) that should
   * receive `emitStageAdvance` / `emitStrike` / `emitCompletion` events
   * from this loop controller. Set once at engine construction.
   *
   * The scheduler is optional — when null, the loop runs without the
   * background observation layer (used by tests and CLI single-shot
   * commands that don't need the overhead of 12 timers).
   */
  setWorkerScheduler(scheduler: import('../L0_platform/workers').WorkerScheduler | null): void {
    this.observableFacade?.setScheduler(scheduler);
  }

  /**
   * v13 — P1.1: thin shell — 业务实现全部在 runtime/observable-facade.ts。
   * Called by `syncStateFromFile` whenever the loaded stage differs
   * from the last observed stage. Safe to call when no scheduler is
   * wired (no-op). Schedulers without `on-stage-advance` workers simply
   * log the event without running anything.
   */
  private notifyStageAdvance(newStage: Stage): void {
    if (!this.observableFacade) return;
    this.observableFacade.notifyStageAdvance(newStage);
  }

  /**
   * v13 — P1.1: thin shell — 业务实现全部在 runtime/observable-facade.ts。
   * Called from the strike system fan-out. `deepdive` is the canonical
   * `on-strike` worker and will produce a root-cause report.
   */
  notifyStrike(reason: string): void {
    if (!this.observableFacade) return;
    this.observableFacade.notifyStrike(reason);
  }

  /**
   * v13 — P1.1: thin shell — 业务实现全部在 runtime/observable-facade.ts。
   * `document` / `audit` / `benchmark` are the canonical `on-completion`
   * workers and will produce final summary reports.
   */
  notifyCompletion(): void {
    if (!this.observableFacade) return;
    this.observableFacade.notifyCompletion();
  }

  // ── V12: Block count & stop hook tracking (no longer hardcoded) ──

  incrementBlockCount(): void {
    this.hookManager?.incrementBlockCount();
  }

  resetBlockCount(): void {
    this.hookManager?.resetBlockCount();
  }

  setStopHook(active: boolean): void {
    this.hookManager?.setStopHook(active);
  }

  markLedgerProgress(): void {
    this.hookManager?.markLedgerProgress();
  }

  // ── V12: State synchronization (StateMachine ↔ StateManager) ──

  /** R12 P6 Plus2: thin shell → runtime/state-sync.ts */
  async syncStateFromFile(): Promise<void> {
    return this.stateSync!.syncFromFile();
  }

  /** R12 P6 Plus2: thin shell → runtime/state-sync.ts */
  async syncStateToFile(): Promise<void> {
    return this.stateSync!.syncToFile();
  }

  /** R12 P6 Plus2: thin shell → runtime/state-sync.ts */
  private buildLoopMarkdown(
    memState: ReturnType<StateMachine['getState']>,
    currentState: ReturnType<StateManager['getState']>,
  ): string {
    return this.stateSync!.buildLoopMarkdown(memState, currentState);
  }

  // ── V11 compatibility: condition-based guards ──

  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  setCondition(key: GuardConditionKey, passed: boolean): void {
    this.lifecycleHandler?.setCondition(key, passed);
  }
  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  getCondition(key: GuardConditionKey): boolean {
    return this.lifecycleHandler?.getCondition(key) ?? false;
  }
  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  resetConditions(): void {
    this.lifecycleHandler?.resetConditions();
  }

  // ── Main entry: next() with V12 three-level routing ──

  /** R12 P6 Plus: thin shell → runtime/next-orchestrator.ts */
  async next(currentStage?: string): Promise<LoopResponse<{ stage: string; progress: string; next_action: NextAction; awaitingAction?: NextAction }>> {
    return this.orchestrator!.run(currentStage);
  }

  /** R12 P6 Plus: thin shell → runtime/phase-handler.ts */
  private async dispatchV12(currentStage?: string): Promise<LoopResponse<{ stage: string; progress: string; next_action: NextAction; awaitingAction?: NextAction }>> {
    return this.phaseHandler!.run(currentStage);
  }

  /** R12 P6 Plus2: thin shell → runtime/next-v11.ts */
  private dispatchV11(currentStage?: string): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    return this.nextV11Runner!.run(currentStage) as LoopResponse<{ stage: string; progress: string; next_action: NextAction }>;
  }

  /** R12 P6 Plus2: thin shell → runtime/outer-loop-runner.ts */
  private async advanceOuterBoardIfNeeded(
    result: LoopResponse<{ stage: string; progress: string; next_action: NextAction; awaitingAction?: NextAction }>,
  ): Promise<void> {
    return this.outerLoopRunner!.advanceBoardIfNeeded(result);
  }

  /** R12 P6 Plus2: thin shell → runtime/outer-loop-runner.ts */
  private async runOuterLoop(): Promise<OuterLoopResult> {
    return this.outerLoopRunner!.run();
  }

  /** R12 P6 Plus2: thin shell → runtime/outer-loop-runner.ts */
  private buildOuterLoopResponse(outerResult: OuterLoopResult): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    return this.outerLoopRunner!.buildResponse(outerResult);
  }

  /** R12 P6 Plus2: thin shell → runtime/next-v11.ts */
  private nextV11(currentStage?: string): LoopResponse<{ stage: string; progress: string; next_action: NextAction }> {
    return this.nextV11Runner!.run(currentStage) as LoopResponse<{ stage: string; progress: string; next_action: NextAction }>;
  }

  // ── Shared methods ──

  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  recordAction(tool: string, action: string): void {
    this.lifecycleHandler?.recordAction(tool, action);
  }
  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  completeStage(stage: string): { success: boolean; error?: string } {
    return this.lifecycleHandler?.completeStage(stage) ?? { success: false, error: 'LifecycleHandler not initialized' };
  }
  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  forceAdvance(stage: string): string | null {
    return this.lifecycleHandler?.forceAdvance(stage) ?? null;
  }
  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  reset(): void {
    this.lifecycleHandler?.reset();
  }
  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  stop(reason: StopReason, detail: string): void {
    this.lifecycleHandler?.stop(reason, detail);
  }
  /** R12 P6 Plus3: thin shell → runtime/lifecycle-handler.ts */
  getStageIterations(stage: string): number {
    return this.lifecycleHandler?.getStageIterations(stage) ?? 0;
  }

  // ── V12: Audit integration ──

  /** R12 P6 Plus2: thin shell → runtime/audit-evaluator.ts */
  async audit() {
    return this.auditEvaluator!.run();
  }

  // ── Private helpers ──

  /** R12 P6 Plus3: thin shell → runtime/response-builder.ts */
  private buildResponse(
    stage: string,
    nextAction: NextAction,
    isHardStop = false,
    loopLevel: 'outer' | 'inner' | 'phase' = 'phase',
    awaitingAction?: NextAction,
  ): LoopResponse<{ stage: string; progress: string; next_action: NextAction; awaitingAction?: NextAction }> {
    return this.responseBuilder!.build(stage, nextAction, isHardStop, loopLevel, awaitingAction);
  }

  /** R12 P6 Plus3: thin shell → runtime/response-builder.ts */
  private getStageEntryAction(stage: string): NextAction {
    return this.responseBuilder?.getStageEntryAction(stage) ?? { tool: 'aza_loop', action: 'full', reason: `Continue in ${stage} stage` };
  }
}
