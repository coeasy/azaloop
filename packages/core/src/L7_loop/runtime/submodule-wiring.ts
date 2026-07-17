/**
 * R12 P6 Plus6 (P2 退出标准强化) — Submodule Wiring 拆分
 *
 * 借鉴 spec-kit「composition root」+ ralphy「dependency graph」+ agency-orchestrator「DI container」：
 *
 * 痛点：loop-controller.ts 构造函数 ~170 行（lines 294-466）的 submodule 依赖注入装配：
 *   - ResponseBuilder (1 dep)
 *   - LifecycleHandler (16 deps)
 *   - NextV11 (10 deps)
 *   - OuterLoopRunner (7 deps)
 *   - AuditEvaluator (9 deps)
 *   - StateSync (14 deps)
 *   - NextOrchestrator (18 deps, 含 4 个对其他子模块的 late-binding)
 *   - PhaseHandler (22 deps)
 *   - ObservableFacade (1 dep)
 *   - HookManager (6 deps)
 *   - CallbackBridge (7 deps)
 *   全部在 controller 构造函数里手工 new + 注入。
 *
 * 解法：抽出 SubmoduleWiring 工厂类，提供两阶段装配：
 *       - wireLeaves()：9 个 leaf submodule（不依赖其他 submodule）
 *       - wireHubs()：2 个 hub submodule（orchestrator + phaseHandler，使用 late-binding）
 *       Controller 构造函数只需要 2 行装配调用。
 *
 * 边界：所有依赖通过 WiringContext 注入，wiring 自身不持有任何状态。
 *       Late-binding 通过 ref provider 解决（hub 创建时引用还未就位，调用时才解析）。
 */

import { createRealHandlerProvider } from '../real-handlers';
import * as path from 'path';
import type { LoopResponse, NextAction } from '@azaloop/shared';
import type { AuditLog } from '../../state/state-manager';
import type { OuterLoop, OuterLoopResult, StoryProvider, HumanGateFn, CommitFn } from '../outer-loop';
import type { StateMachine } from '../state-machine';
import type { InnerLoop, StageHandlerProvider } from '../inner-loop';
import type { HardStopManager } from '../hard-stop';
import type { CircuitBreaker } from '../circuit-breaker';
import type { StrikeSystem } from '../../L4_discipline/strike-system';
import type { TokenBudget } from '../token-budget';
import type { CompletionGate } from '../completion-gate';
import type { DecisionPointRegistry } from '../decision-points';
import type { DlpChainDetector } from '../../L4_discipline/dlp-chain-detector';
import type { RunLedger } from '../../state/run-ledger';
import type { ResumeGenerator } from '../../continuity/resume-generator';
import type { ContextOrchestrator, ContextEntryBundle } from '../../L2_memory/context-orchestrator';
import type { InjectionEngine } from '../../L9_knowledge/injection-engine';
import type { StageGuards, GuardConditionKey } from '../guards';
import type { DeadlockDetector } from '../deadlock-detector';
import type { LoopAudit } from '../loop-audit';
import type { StateManager, RunStateManager } from '../../state/state-manager';
import type { FilePersistor } from '../../L2_memory/file-persistor';
import type { AzaloopConfig } from '@azaloop/shared';
import type { ProgressLedger2D } from '../progress-ledger';
import type { Stage } from '../state-machine';

import { ResponseBuilder } from './response-builder';
import { LifecycleHandler } from './lifecycle-handler';
import { NextV11 } from './next-v11';
import { OuterLoopRunner } from './outer-loop-runner';
import { AuditEvaluator } from './audit-evaluator';
import { StateSync } from './state-sync';
import { NextOrchestrator } from './next-orchestrator';
import { PhaseHandler } from './phase-handler';
import { ObservableFacade } from './observable-facade';
import { HookManager } from './hook-manager';
import { CallbackBridge } from './callback-bridge';

// ── Late-binding ref provider ──
// 用于打破循环依赖：hub submodule 创建时引用 leaf submodule，调用时才解析。
export type RefProvider<T> = () => T | null;

// ── Submodule Wiring 依赖（从 LoopController 注入）──

export interface WiringContext {
  // ── Subsystems ──
  stateMachine: StateMachine;
  guards: StageGuards;
  deadlockDetector: DeadlockDetector;
  hardStop: HardStopManager;
  strikeSystem: StrikeSystem;
  circuitBreaker: CircuitBreaker;
  completionGate: CompletionGate;
  auditor: LoopAudit;
  innerLoop: InnerLoop;
  dpRegistry: DecisionPointRegistry;
  handlerProvider: StageHandlerProvider;
  dlpDetector: DlpChainDetector | null;
  runLedger: RunLedger | null;
  resumeGen: ResumeGenerator | null;
  contextOrchestrator: ContextOrchestrator | null;
  injectionEngine: InjectionEngine;
  auditLog: AuditLog | null;
  stateManager: StateManager | null;
  runStateManager: RunStateManager | null;
  tokenBudget: TokenBudget;
  filePersistor: FilePersistor | null;
  outerLoop: OuterLoop | null;
  ledger2d: ProgressLedger2D;

  // ── Configuration ──
  config: AzaloopConfig;
  configLoopOptions: {
    maxIterations: number;
    maxStageIterations: number;
    maxStrikes: number;
    azaDir: string;
    enableOuterLoop: boolean;
    enableV12: boolean;
  };
  projectRoot: string | undefined;
  contextBundle: ContextEntryBundle | null;
  knowledgeEntries: string[];

  // ── State (controller private fields) ──
  blockCount: number;
  stopHookActive: boolean;
  ledgerHasProgress: boolean;
  driftDetected: boolean;
  conditions: Map<GuardConditionKey, boolean>;
  stageIterations: Map<string, number>;
  checkerCache: Map<string, { result: any; timestamp: number }>;
  lastHashes: { prd?: string; contract?: string };
  lastPrd: any;
  lastContract: string;

  // ── Setters (controller private state mutations) ──
  setBlockCount: (n: number) => void;
  setLedgerHasProgress: (v: boolean) => void;
  setStopHookActive: (v: boolean) => void;
  setLastHashes: (h: { prd?: string; contract?: string }) => void;
  setLastPrd: (p: any) => void;
  setLastContract: (c: string) => void;
  setDriftDetected: (v: boolean) => void;
  setHandlerProvider: (p: StageHandlerProvider) => void;

  // ── Controller method bridges (for cross-submodule callbacks) ──
  syncStateFromFile: () => Promise<void>;
  syncStateToFile: () => Promise<void>;
  notifyStageAdvance: (s: Stage) => void;
  notifyStrike: (r: string) => void;
  notifyCompletion: () => void;
  markLedgerProgress: () => void;
  buildResponse: (stage: string, action: NextAction, hard?: boolean, level?: 'outer' | 'inner' | 'phase', awaiting?: NextAction) => LoopResponse<any>;
  getStageEntryAction: (s: string) => NextAction;
  dispatchV12: (s?: string) => Promise<LoopResponse<any>>;
  dispatchV11: (s?: string) => LoopResponse<any>;
}

/**
 * Leaf 装配产物：9 个不依赖其他 submodule 的实例
 */
export interface WiredLeaves {
  responseBuilder: ResponseBuilder;
  lifecycleHandler: LifecycleHandler;
  nextV11Runner: NextV11;
  outerLoopRunner: OuterLoopRunner;
  auditEvaluator: AuditEvaluator;
  stateSync: StateSync;
  observableFacade: ObservableFacade;
  hookManager: HookManager;
  callbackBridge: CallbackBridge;
}

/**
 * Hub 装配产物：2 个依赖其他 submodule 的实例
 */
export interface WiredHubs {
  orchestrator: NextOrchestrator;
  phaseHandler: PhaseHandler;
}

/**
 * Submodule Wiring 工厂：负责把 controller 字段装配成 11 个 submodule 实例。
 *
 * 两阶段装配：
 *   - wireLeaves() → 9 个 leaf submodules（同步，无循环依赖）
 *   - wireHubs(refs) → 2 个 hub submodules（异步，依赖 leaf submodules）
 */
export class SubmoduleWiring {
  constructor(private readonly ctx: WiringContext) {}

  /**
   * 装配 9 个 leaf submodules（不依赖其他 submodule）。
   * 顺序：callbackBridge 先创建（其它 leaf 依赖其 outerLoopCallbacks）。
   */
  wireLeaves(): WiredLeaves {
    // 1. callbackBridge 必须最先创建（outerLoopRunner 依赖其 outerLoopCallbacks）
    const callbackBridge = this.wireCallbackBridge();
    // 2. outerLoopRunner 单独装配（注入 callbackBridge）
    const outerLoopRunner = this.wireOuterLoopRunner(callbackBridge);
    return {
      responseBuilder: this.wireResponseBuilder(),
      lifecycleHandler: this.wireLifecycleHandler(),
      nextV11Runner: this.wireNextV11(),
      outerLoopRunner,
      auditEvaluator: this.wireAuditEvaluator(),
      stateSync: this.wireStateSync(),
      observableFacade: this.wireObservableFacade(),
      hookManager: this.wireHookManager(),
      callbackBridge,
    };
  }

  /**
   * 装配 2 个 hub submodules（orchestrator + phaseHandler），使用 late-binding refs。
   * 必须在 wireLeaves() 之后调用，refs 指向已装配的 leaf submodules。
   */
  wireHubs(refs: {
    outerLoopRunner: RefProvider<OuterLoopRunner>;
  }): WiredHubs {
    return {
      orchestrator: this.wireOrchestrator(refs.outerLoopRunner),
      phaseHandler: this.wirePhaseHandler(),
    };
  }

  // ── Leaf wirings ──

  private wireResponseBuilder(): ResponseBuilder {
    return new ResponseBuilder({
      stateMachine: this.ctx.stateMachine,
    });
  }

  private wireLifecycleHandler(): LifecycleHandler {
    const c = this.ctx;
    return new LifecycleHandler({
      stateMachine: c.stateMachine,
      deadlockDetector: c.deadlockDetector,
      strikeSystem: c.strikeSystem,
      hardStop: c.hardStop,
      circuitBreaker: c.circuitBreaker,
      tokenBudget: c.tokenBudget,
      guards: c.guards,
      dpRegistry: c.dpRegistry,
      getConditions: () => c.conditions,
      getStageIterations: () => c.stageIterations,
      getBlockCount: () => c.blockCount,
      setBlockCount: c.setBlockCount,
      getLedgerHasProgress: () => c.ledgerHasProgress,
      setLedgerHasProgress: c.setLedgerHasProgress,
      getStopHookActive: () => c.stopHookActive,
      setStopHookActive: c.setStopHookActive,
      getHandlerProvider: () => c.handlerProvider,
      setHandlerProvider: c.setHandlerProvider,
      syncStateToFile: () => c.syncStateToFile(),
      notifyStrike: c.notifyStrike,
    });
  }

  private wireNextV11(): NextV11 {
    const c = this.ctx;
    return new NextV11({
      stateMachine: c.stateMachine,
      guards: c.guards,
      hardStop: c.hardStop,
      strikeSystem: c.strikeSystem,
      getStageIteration: (s) => c.stageIterations.get(s) ?? 0,
      setStageIteration: (s, n) => c.stageIterations.set(s, n),
      maxIterations: c.configLoopOptions.maxIterations,
      maxStageIterations: c.configLoopOptions.maxStageIterations,
      maxStrikes: c.configLoopOptions.maxStrikes,
      buildResponse: (stage, action, hard, level) =>
        c.buildResponse(stage, action, hard, level) as LoopResponse<any>,
      getStageEntryAction: c.getStageEntryAction,
      notifyCompletion: c.notifyCompletion,
    });
  }

  private wireOuterLoopRunner(callbackBridge: CallbackBridge): OuterLoopRunner {
    const c = this.ctx;
    return new OuterLoopRunner({
      stateMachine: c.stateMachine,
      stateManager: c.stateManager,
      outerLoop: c.outerLoop,
      handlerProvider: c.handlerProvider,
      tokenBudget: c.tokenBudget,
      outerLoopCallbacks: callbackBridge.getOuterLoopCallbacks() ?? null,
      buildResponse: (stage, action, hard, level) =>
        c.buildResponse(stage, action, hard, level) as LoopResponse<any>,
      syncStateToFile: () => c.syncStateToFile(),
    });
  }

  private wireAuditEvaluator(): AuditEvaluator {
    const c = this.ctx;
    return new AuditEvaluator({
      stateMachine: c.stateMachine,
      stateManager: c.stateManager,
      tokenBudget: c.tokenBudget,
      auditor: c.auditor,
      azaDir: c.configLoopOptions.azaDir,
      config: c.config,
      stopHookActive: c.stopHookActive,
      ledgerHasProgress: c.ledgerHasProgress,
      enableV12: c.configLoopOptions.enableV12,
    });
  }

  private wireStateSync(): StateSync {
    const c = this.ctx;
    return new StateSync({
      stateMachine: c.stateMachine,
      stateManager: c.stateManager!,
      resumeGen: c.resumeGen,
      filePersistor: c.filePersistor,
      auditLog: c.auditLog,
      azaDir: c.configLoopOptions.azaDir,
      notifyStageAdvance: c.notifyStageAdvance,
      getStageEntryAction: c.getStageEntryAction,
      getLastHashes: () => c.lastHashes,
      setLastHashes: c.setLastHashes,
      getLastPrd: () => c.lastPrd,
      setLastPrd: c.setLastPrd,
      getLastContract: () => c.lastContract,
      setLastContract: c.setLastContract,
      setDriftDetected: c.setDriftDetected,
    });
  }

  private wireObservableFacade(): ObservableFacade {
    return new ObservableFacade({
      workerScheduler: null,
    });
  }

  private wireHookManager(): HookManager {
    const c = this.ctx;
    return new HookManager({
      getBlockCount: () => c.blockCount,
      setBlockCount: c.setBlockCount,
      getStopHookActive: () => c.stopHookActive,
      setStopHookActive: c.setStopHookActive,
      getLedgerHasProgress: () => c.ledgerHasProgress,
      setLedgerHasProgress: c.setLedgerHasProgress,
    });
  }

  private wireCallbackBridge(): CallbackBridge {
    const c = this.ctx;
    return new CallbackBridge({
      getAzaDir: () => c.configLoopOptions.azaDir,
      getHandlerProvider: () => c.handlerProvider,
      setHandlerProvider: c.setHandlerProvider,
      getCheckerCache: () => c.checkerCache,
      getContextBundle: () => c.contextBundle,
      getKnowledgeEntries: () => c.knowledgeEntries,
      getConfig: () => c.config,
    });
  }

  // ── Hub wirings (with late-binding) ──

  private wireOrchestrator(outerLoopRunnerRef: RefProvider<OuterLoopRunner>): NextOrchestrator {
    const c = this.ctx;
    return new NextOrchestrator({
      stateMachine: c.stateMachine,
      ledger2d: c.ledger2d,
      deadlockDetector: c.deadlockDetector,
      hardStop: c.hardStop,
      circuitBreaker: c.circuitBreaker,
      strikeSystem: c.strikeSystem,
      tokenBudget: c.tokenBudget,
      config: {
        maxIterations: c.configLoopOptions.maxIterations,
        enableOuterLoop: c.configLoopOptions.enableOuterLoop,
        enableV12: c.configLoopOptions.enableV12,
        azaDir: c.configLoopOptions.azaDir,
      },
      options: { projectRoot: c.projectRoot },
      azaDir: c.configLoopOptions.azaDir || undefined,
      getStageIteration: (s) => c.stageIterations.get(s) ?? 0,
      setStageIteration: (s, n) => c.stageIterations.set(s, n),
      getLastHashes: () => c.lastHashes,
      setLastHashes: c.setLastHashes,
      auditAppend: (e) => c.auditLog?.append(e as any),
      dispatchV12: c.dispatchV12,
      dispatchV11: c.dispatchV11,
      dispatchOuterLoop: () => outerLoopRunnerRef()?.run() as unknown as Promise<LoopResponse<any>> ?? Promise.resolve({} as LoopResponse<any>),
      buildOuterLoopResponse: (or: OuterLoopResult) => outerLoopRunnerRef()?.buildResponse(or) ?? ({} as LoopResponse<any>),
      syncStateFromFile: () => c.syncStateFromFile(),
      syncStateToFile: () => c.syncStateToFile(),
      buildResponse: (stage, action, hard, level) =>
        c.buildResponse(stage, action, hard, level) as LoopResponse<any>,
      advanceOuterBoardIfNeeded: (r) => outerLoopRunnerRef()?.advanceBoardIfNeeded(r) ?? Promise.resolve(),
    });
  }

  private wirePhaseHandler(): PhaseHandler {
    const c = this.ctx;
    return new PhaseHandler({
      stateMachine: c.stateMachine,
      innerLoop: c.innerLoop,
      hardStop: c.hardStop,
      circuitBreaker: c.circuitBreaker,
      strikeSystem: c.strikeSystem,
      tokenBudget: c.tokenBudget,
      completionGate: c.completionGate,
      dpRegistry: c.dpRegistry,
      dlpDetector: c.dlpDetector,
      runLedger: c.runLedger,
      resumeGen: c.resumeGen,
      contextOrchestrator: c.contextOrchestrator,
      injectionEngine: c.injectionEngine,
      handlerProvider: c.handlerProvider,
      auditLog: c.auditLog ? { append: (e) => c.auditLog!.append(e as any) } : null,
      config: {
        maxIterations: c.configLoopOptions.maxIterations,
        azaDir: c.configLoopOptions.azaDir,
      },
      blockCount: c.blockCount,
      stopHookActive: c.stopHookActive,
      ledgerHasProgress: c.ledgerHasProgress,
      driftDetected: c.driftDetected,
      checkerCache: c.checkerCache,
      setHandlerProvider: c.setHandlerProvider,
      setDriftDetected: c.setDriftDetected,
      markLedgerProgress: c.markLedgerProgress,
      getWorkDir: () => c.configLoopOptions.azaDir ? path.dirname(c.configLoopOptions.azaDir) : undefined,
      buildResponse: (stage, action, hard, level, awaiting) =>
        c.buildResponse(stage, action, hard, level, awaiting),
      getStageEntryAction: c.getStageEntryAction,
      createRealHandlerProvider: (args) => createRealHandlerProvider(args as any),
    });
  }
}
