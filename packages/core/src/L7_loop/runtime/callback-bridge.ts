/**
 * R12 P6 Plus4 (P2 退出标准) — Callback Bridge 拆分
 *
 * 借鉴 comet「callback bridge」+ agency-orchestrator「human gate」：
 *
 * 痛点：loop-controller.ts 中：
 *   - outerLoopCallbacks 字段
 *   - setOuterLoopCallbacks setter
 *   - createRealHandlerProvider 通过 closure 调用
 *   - RealHandlerProvider init code (workDir derivation)
 *   共 ~30 行 散在主类。
 *
 * 解法：抽出 CallbackBridge 工具类，封装 OuterLoop 回调管理 + handler provider 构造。
 *       主类只持有 CallbackBridge + 1 个 thin shell setter。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import * as path from 'path';
import { createRealHandlerProvider } from '../real-handlers';
import type { StoryProvider, HumanGateFn, CommitFn } from '../outer-loop';
import type { StageHandlerProvider } from '../inner-loop';
import type { ContextEntryBundle } from '../../L2_memory/context-orchestrator';
import type { AzaloopConfig } from '@azaloop/shared';

// ── CallbackBridge 依赖（从 LoopController 注入）──

export interface CallbackBridgeDeps {
  /** aza directory for resolving workDir */
  getAzaDir: () => string;
  /** Currently active handler provider (mutable) */
  getHandlerProvider: () => StageHandlerProvider;
  setHandlerProvider: (p: StageHandlerProvider) => void;
  /** Shared checker cache (passed to real handler provider) */
  getCheckerCache: () => Map<string, { result: any; timestamp: number }>;
  /** Context bundle from ContextOrchestrator — used by real handlers for stage context */
  getContextBundle: () => ContextEntryBundle | null | undefined;
  /** Knowledge entries from InjectionEngine — used by real handlers for stage knowledge */
  getKnowledgeEntries: () => string[] | undefined;
  /** Loaded azaloop.yaml config */
  getConfig: () => AzaloopConfig;
}

/**
 * 回调桥接：管理 OuterLoop 回调 + 真实 handler provider 构造。
 */
export class CallbackBridge {
  private outerLoopCallbacks: {
    storyProvider: StoryProvider;
    humanGate: HumanGateFn;
    commit: CommitFn;
  } | null = null;

  constructor(private readonly deps: CallbackBridgeDeps) {}

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

  /**
   * 获取当前 OuterLoop 回调（可能为 null）。
   */
  getOuterLoopCallbacks(): {
    storyProvider: StoryProvider;
    humanGate: HumanGateFn;
    commit: CommitFn;
  } | null {
    return this.outerLoopCallbacks;
  }

  /**
   * V12: Initialize REAL handler provider (gates on actual PRD checks,
   * type-check, test runs, secret scanning and artifact existence —
   * never hardcoded/simulated metrics). The project source lives in the
   * parent of `.aza`, so derive workDir from azaDir.
   */
  createHandlerProvider(): StageHandlerProvider {
    const azaDir = this.deps.getAzaDir();
    const workDir = azaDir ? path.dirname(azaDir) : undefined;
    const provider = createRealHandlerProvider({
      workDir,
      azaDir: azaDir || undefined,
      checkerCache: this.deps.getCheckerCache(),
    });
    this.deps.setHandlerProvider(provider);
    return provider;
  }
}
