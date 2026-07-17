/**
 * R12 P6 Plus5 (P2 退出标准强化) — Subsystem Initializer 拆分
 *
 * 借鉴 gstack「bootstrap module」+ ralphy「subsystem factory」：
 *
 * 痛点：loop-controller.ts 构造函数 ~285 行，包含：
 *   - 7 个核心子系统（stateMachine/guards/deadlock/hardStop/strike/circuitBreaker/completionGate/auditor）
 *   - 6 个 V12 子系统（innerLoop/handlerProvider/stateManager/runStateManager/auditLog/tokenBudget）
 *   - 7 个持久化子系统（contextOrchestrator/injectionEngine/resumeGen/runLedger/filePersistor/dlpDetector/outerLoop）
 *   - 1 个 crash recovery（ledger2d.deserialize）
 *   全部塞在单方法里，构造逻辑与控制流混杂。
 *
 * 解法：抽出 SubsystemInitializer 工具类，把所有 V12 子系统初始化逻辑
 *       （包括 best-effort async load、error handling）封装到独立方法。
 *       Controller 构造函数只负责编排（5 行 init 调用）+ 子模块装配。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 *       返回的对象保存所有初始化后的子系统引用，由 controller 持有。
 */

import { StateMachine } from '../state-machine';
import { StageGuards, createDefaultGuards, type GuardConditionKey } from '../guards';
import { DeadlockDetector } from '../deadlock-detector';
import { HardStopManager } from '../hard-stop';
import { StrikeSystem } from '../../L4_discipline/strike-system';
import { CircuitBreaker } from '../circuit-breaker';
import { CompletionGate } from '../completion-gate';
import { LoopAudit } from '../loop-audit';
import { InnerLoop, type StageHandlerProvider } from '../inner-loop';
import { OuterLoop } from '../outer-loop';
import { createRealHandlerProvider } from '../real-handlers';
import { StateManager, RunStateManager, AuditLog } from '../../state/state-manager';
import { RunLedger } from '../../state/run-ledger';
import { ContextOrchestrator, type ContextEntryBundle } from '../../L2_memory/context-orchestrator';
import { FilePersistor } from '../../L2_memory/file-persistor';
import { InjectionEngine } from '../../L9_knowledge/injection-engine';
import { ResumeGenerator } from '../../continuity/resume-generator';
import { DlpChainDetector } from '../../L4_discipline/dlp-chain-detector';
import { DecisionPointRegistry } from '../decision-points';
import { TokenBudget } from '../token-budget';
import { ProgressLedger2D } from '../progress-ledger';
import * as fs from 'fs';
import * as path from 'path';

// ── Subsystem Initializer 依赖（从 LoopController 注入）──

export interface SubsystemInitializerDeps {
  /** Resolved config (from options or projectRoot) */
  config: {
    maxIterations: number;
    maxStageIterations: number;
    maxStrikes: number;
    deadlockThreshold: number;
    enableV12: boolean;
    azaDir: string;
    enableOuterLoop: boolean;
  };
  /** User-supplied token budget (may be undefined → create default) */
  tokenBudget: TokenBudget | undefined;
  /** Pre-allocated checker cache (shared with handler provider) */
  checkerCache: Map<string, { result: any; timestamp: number }>;
  /** Optional context bundle for handler provider */
  contextBundle: ContextEntryBundle | null;
  /** Optional knowledge entries for handler provider */
  knowledgeEntries: string[];
  /** Pre-allocated conditions map (for V11 guards) */
  conditions: Map<GuardConditionKey, boolean>;
  /** Pre-allocated stage iterations map (for V11 guards) */
  stageIterations: Map<string, number>;
  /** Pre-allocated 2D progress ledger (for crash recovery) */
  ledger2d: ProgressLedger2D;
  /** Fallback to set block count (controller private) */
  setBlockCount: (n: number) => void;
  /** Fallback to set ledgerHasProgress (controller private) */
  setLedgerHasProgress: (v: boolean) => void;
  /** Fallback to set stopHookActive (controller private) */
  setStopHookActive: (v: boolean) => void;
}

/**
 * 子系统初始化器：负责 V12 + V11 + 持久化子系统的初始化。
 *
 * 主要能力：
 *   1. 核心子系统：stateMachine/guards/deadlock/hardStop/strike/circuitBreaker/completionGate/auditor
 *   2. V12 子系统：innerLoop/handlerProvider/stateManager/runStateManager/auditLog/tokenBudget
 *   3. 持久化子系统：contextOrchestrator/injectionEngine/resumeGen/runLedger/filePersistor/dlpDetector
 *   4. OuterLoop 实例（按需）
 *   5. Crash recovery：从 ledger.json 恢复 2D progress ledger
 */
export class SubsystemInitializer {
  constructor(private readonly deps: SubsystemInitializerDeps) {}

  /**
   * 初始化所有核心子系统（不依赖 azaDir 的部分）。
   * 包括：stateMachine, guards, deadlockDetector, hardStop, strikeSystem,
   *       circuitBreaker, completionGate, auditor
   */
  initCore(): {
    stateMachine: StateMachine;
    guards: StageGuards;
    deadlockDetector: DeadlockDetector;
    hardStop: HardStopManager;
    strikeSystem: StrikeSystem;
    circuitBreaker: CircuitBreaker;
    completionGate: CompletionGate;
    auditor: LoopAudit;
  } {
    const { config } = this.deps;
    const stateMachine = new StateMachine();
    const guards = createDefaultGuards((key) => this.deps.conditions.get(key) === true);
    const deadlockDetector = new DeadlockDetector(config.deadlockThreshold);
    const hardStop = new HardStopManager();
    const strikeSystem = new StrikeSystem(config.maxStrikes);
    const circuitBreaker = new CircuitBreaker({
      maxIterations: config.maxIterations,
      stagnationThreshold: 3,
      noProgressThreshold: 5,
    });
    const completionGate = new CompletionGate();
    const auditor = new LoopAudit();
    return {
      stateMachine,
      guards,
      deadlockDetector,
      hardStop,
      strikeSystem,
      circuitBreaker,
      completionGate,
      auditor,
    };
  }

  /**
   * 初始化 DP Registry + InnerLoop + Handler Provider。
   * 注意：依赖 initCore() 的结果（stateMachine, circuitBreaker）。
   */
  initV12(core: ReturnType<SubsystemInitializer['initCore']>): {
    dpRegistry: DecisionPointRegistry;
    innerLoop: InnerLoop;
    handlerProvider: StageHandlerProvider;
  } {
    const { config } = this.deps;
    const auditLogPath = config.azaDir
      ? path.join(config.azaDir, 'audit.jsonl')
      : undefined;
    const dpRegistry = new DecisionPointRegistry(auditLogPath);
    // Load existing DP history from audit log for session recovery
    if (auditLogPath) {
      dpRegistry.loadFromAudit(auditLogPath).catch(() => {
        // best-effort: missing audit log is non-fatal
      });
    }
    const innerLoop = new InnerLoop(core.circuitBreaker, {
      maxPhaseIterations: config.maxStageIterations,
      dpRegistry,
    }, core.stateMachine);

    // V12: Initialize REAL handler provider (gates on actual PRD checks,
    // type-check, test runs, secret scanning and artifact existence —
    // never hardcoded/simulated metrics). The project source lives in the
    // parent of `.aza`, so derive workDir from azaDir.
    const workDir = config.azaDir ? path.dirname(config.azaDir) : undefined;
    const handlerProvider = createRealHandlerProvider({
      workDir,
      azaDir: config.azaDir || undefined,
      checkerCache: this.deps.checkerCache,
    });
    // Share the freshly-initialized real handler provider with the
    // inner loop so the 5 phase handlers can dispatch through it.
    innerLoop.setHandlerProvider(handlerProvider);

    return { dpRegistry, innerLoop, handlerProvider };
  }

  /**
   * 初始化 V12 持久化子系统（StateManager / RunStateManager / AuditLog / TokenBudget）。
   * 仅在 azaDir 存在时初始化持久化层。
   */
  initPersistence(): {
    stateManager: StateManager | null;
    runStateManager: RunStateManager | null;
    auditLog: AuditLog | null;
    tokenBudget: TokenBudget;
  } {
    const { config } = this.deps;
    const tokenBudget = this.deps.tokenBudget ?? new TokenBudget('L2');
    let stateManager: StateManager | null = null;
    let runStateManager: RunStateManager | null = null;
    let auditLog: AuditLog | null = null;
    if (config.azaDir) {
      stateManager = new StateManager(config.azaDir);
      // Initialize RunStateManager for machine-owned state (comet pattern)
      const projectRoot = config.azaDir
        ? path.dirname(config.azaDir)
        : process.cwd();
      runStateManager = new RunStateManager(config.azaDir, projectRoot);
      runStateManager.load().catch(() => {
        // best-effort: missing run-state is non-fatal
      });
      // Initialize AuditLog for append-only state transitions (comet pattern)
      auditLog = new AuditLog(config.azaDir);
    }
    return { stateManager, runStateManager, auditLog, tokenBudget };
  }

  /**
   * 初始化 V12 注入 + 持久化子系统（ContextOrchestrator / InjectionEngine /
   * ResumeGenerator / RunLedger / FilePersistor / DlpChainDetector）。
   * 仅在 azaDir 存在时初始化。
   */
  initInjection(auditLog: AuditLog | null): {
    contextOrchestrator: ContextOrchestrator | null;
    injectionEngine: InjectionEngine;
    resumeGen: ResumeGenerator | null;
    runLedger: RunLedger | null;
    filePersistor: FilePersistor | null;
    dlpDetector: DlpChainDetector | null;
  } {
    const { config } = this.deps;
    let contextOrchestrator: ContextOrchestrator | null = null;
    let resumeGen: ResumeGenerator | null = null;
    let runLedger: RunLedger | null = null;
    let filePersistor: FilePersistor | null = null;
    let dlpDetector: DlpChainDetector | null = null;
    // V12: Initialize ContextOrchestrator for per-stage JSONL context injection
    if (config.azaDir) {
      contextOrchestrator = new ContextOrchestrator(config.azaDir, this.deps.tokenBudget!);
    }
    // V12: Initialize InjectionEngine for stage-specific knowledge
    const injectionEngine = new InjectionEngine();
    // Initialize ResumeGenerator for run-ledger access
    if (config.azaDir) {
      resumeGen = new ResumeGenerator(config.azaDir);
      // R10 第2轮 (D1)：初始化 RunLedger 并异步加载历史条目，
      // 供 DLP 链式检测、上下文恢复等场景使用。load() 失败非致命。
      runLedger = new RunLedger(config.azaDir);
      runLedger.load().catch(() => {
        // best-effort: missing run-ledger.jsonl is non-fatal
      });
      // R10 第3轮 (D3)：初始化 FilePersistor，主循环每轮 checkpoint
      // 通过 persistCheckpoint() 持久化 loop.md 并验证所有产物。
      filePersistor = new FilePersistor(config.azaDir);
    }
    // V20 Task 11: Initialize DLP chain detector
    if (config.azaDir) {
      dlpDetector = new DlpChainDetector();
    }
    // suppress unused-var warning for auditLog (kept for future hook integration)
    void auditLog;
    return { contextOrchestrator, injectionEngine, resumeGen, runLedger, filePersistor, dlpDetector };
  }

  /**
   * 初始化 OuterLoop（按 enableOuterLoop 配置）。
   */
  initOuterLoop(innerLoop: InnerLoop): OuterLoop | null {
    const { config } = this.deps;
    if (!config.enableOuterLoop) return null;
    // Initialize OuterLoop if enabled — pass shared InnerLoop so
    // both loops observe the same StateMachine instance.
    return new OuterLoop(undefined as any, {
      maxCycles: config.maxIterations,
      requireHumanGate: true,
      enableCircuitBreaker: true,
    }, innerLoop);
  }

  /**
   * Crash recovery: restore the 2D progress ledger from
   * `<azaDir>/ledger.json` if a previous session persisted one.
   */
  recoverLedger(): void {
    const { config, ledger2d } = this.deps;
    if (!config.azaDir) return;
    try {
      const ledgerPath = path.join(config.azaDir, 'ledger.json');
      if (fs.existsSync(ledgerPath)) {
        const raw = fs.readFileSync(ledgerPath, 'utf8');
        ledger2d.deserialize(raw);
      }
    } catch {
      // best-effort: a missing or corrupt ledger is non-fatal
    }
  }
}
