/**
 * R12 P6 Plus2 (P2 退出标准) — State Sync 拆分
 *
 * 借鉴 spec-kit「state snapshot」+ comet「pure resume probe」：
 *
 * 痛点：loop-controller.ts syncStateFromFile (125 行) + syncStateToFile (50 行)
 *       + buildLoopMarkdown (40 行) = ~215 行，状态同步逻辑密集且与其他职责混在一起。
 *
 * 解法：抽出 StateSync 工具类，封装 file ↔ memory 双向同步 + 内容 diff 检测 + loop.md 摘要生成。
 *
 * 边界：所有依赖通过接口注入，不直接访问 controller 私有字段。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Stage } from '../state-machine';
import type { StateMachine } from '../state-machine';
import type { StateManager } from '../../state/state-manager';
import type { FilePersistor } from '../../L2_memory/file-persistor';
import type { ResumeGenerator } from '../../continuity/resume-generator';
import type { AuditLog } from '../../state/state-manager';
import type { PRD } from '@azaloop/shared';
import type { NextAction } from '@azaloop/shared';
import { AZALOOP_ENGINE_VERSION } from '../../continuity/resume-generator';
import { contentHash } from '../decision-points';
import { diffPrd, diffContract, hasMaterialChange } from '../content-diff';

// ── StateSync 依赖（从 LoopController 注入）──

export interface StateSyncDeps {
  stateMachine: StateMachine;
  stateManager: StateManager;
  resumeGen: ResumeGenerator | null;
  filePersistor: FilePersistor | null;
  auditLog: AuditLog | null;
  azaDir: string;
  /**
   * 状态变更通知回调（用于 v13 worker scheduler stage advance）。
   * 签名：notifyStageAdvance(stage: Stage): void
   */
  notifyStageAdvance: (stage: Stage) => void;
  /**
   * 获取 stage 入口 action。
   * 签名：getStageEntryAction(stage: string): NextAction
   */
  getStageEntryAction: (stage: string) => NextAction;
  /**
   * 读取上次缓存的内容哈希（用于 drift 检测）。
   */
  getLastHashes: () => { prd?: string; contract?: string };
  /**
   * 写回内容哈希缓存。
   */
  setLastHashes: (h: { prd?: string; contract?: string }) => void;
  /**
   * 读取上次缓存的 PRD 对象。
   */
  getLastPrd: () => PRD | null;
  setLastPrd: (p: PRD | null) => void;
  /**
   * 读取上次缓存的 contract 内容。
   */
  getLastContract: () => string;
  setLastContract: (c: string) => void;
  /**
   * 标记 drift 检测到。
   */
  setDriftDetected: (v: boolean) => void;
}

/**
 * 状态同步器：负责 file ↔ memory 双向同步 + 内容 diff 检测 + loop.md 摘要生成。
 */
export class StateSync {
  constructor(private readonly deps: StateSyncDeps) {}

  /**
   * 从 STATE.yaml 同步到内存 StateMachine。
   * V20 Task 12: 检测 PRD/contract 内容 diff，标记 drift。
   */
  async syncFromFile(): Promise<void> {
    const { stateManager, stateMachine, azaDir } = this.deps;
    if (!stateManager) return;

    try {
      const fileState = await stateManager.load();
      let stage = fileState.pipeline.current_stage as Stage;
      // Heal drift: blocked/in_progress stage wins over stale pipeline.current_stage
      const stages = fileState.pipeline.stages as Record<Stage, any>;
      const order: Stage[] = ['open', 'design', 'build', 'verify', 'archive'];
      for (const s of order) {
        if (stages[s]?.status === 'blocked') { stage = s; break; }
      }
      if (stage === fileState.pipeline.current_stage) {
        for (const s of order) {
          if (stages[s]?.status === 'in_progress') { stage = s; break; }
        }
      }
      const phaseCurrent = (fileState.loops as any)?.phase?.current as Stage | undefined;
      if (stage === fileState.pipeline.current_stage && phaseCurrent && stages[phaseCurrent]?.status !== 'completed') {
        stage = phaseCurrent;
      }
      // Mutate in place — do NOT reassign — so InnerLoop/OuterLoop keep
      // observing the same shared StateMachine instance.
      stateMachine.loadState({
        current_stage: stage,
        stages: fileState.pipeline.stages as Record<Stage, any>,
        iteration: fileState.loop.iteration,
        progress: fileState.loop.progress,
        loops: fileState.loops as any,
        attestation: fileState.attestation || { verified: true },
      });
      // v13 — P1.1: notify the worker scheduler of a stage transition.
      this.deps.notifyStageAdvance(stage);
    } catch {
      // File doesn't exist yet — use default state
    }

    // ── CP1 drift detection (V20 Task 12: content-level diff) ──
    if (azaDir) {
      await this.detectDrift(azaDir);
    }
  }

  /**
   * 检测 PRD/contract 内容 diff，标记 drift。
   * R10 第2轮 (D2): 差异小但确实变了，写入 audit.jsonl 作为 minor_drift。
   */
  private async detectDrift(azaDir: string): Promise<void> {
    const { auditLog } = this.deps;
    const newHashes: { prd?: string; contract?: string } = {};
    let currentPrd: PRD | null = null;
    let currentContract: string = '';

    try {
      const prdPath = path.join(azaDir, 'prd.json');
      if (fs.existsSync(prdPath)) {
        const prdContent = fs.readFileSync(prdPath, 'utf8');
        newHashes.prd = contentHash(prdContent);
        try {
          currentPrd = JSON.parse(prdContent);
        } catch { /* parse error */ }
      }
    } catch { /* best-effort */ }

    try {
      const contractPath = path.join(azaDir, 'contract.md');
      if (fs.existsSync(contractPath)) {
        const contractContent = fs.readFileSync(contractPath, 'utf8');
        newHashes.contract = contentHash(contractContent);
        currentContract = contractContent;
      }
    } catch { /* best-effort */ }

    // V20 Task 12: 内容差异分析（非哈希）
    const lastHashes = this.deps.getLastHashes();
    if (lastHashes.prd && newHashes.prd && lastHashes.prd !== newHashes.prd) {
      const lastPrd = this.deps.getLastPrd();
      if (lastPrd && currentPrd) {
        const diff = diffPrd(lastPrd, currentPrd);
        if (hasMaterialChange(diff)) {
          this.deps.setDriftDetected(true);
        } else {
          // R10 第2轮 (D2): 差异小但确实变了，写入 audit.jsonl 作为 minor_drift
          auditLog?.append({
            type: 'minor_drift',
            source: 'prd_content_diff',
            before: { sha: lastHashes.prd },
            after: { sha: newHashes.prd },
            details: {
              target: 'prd',
              fieldCount: diff.fields.length,
              overallChangeRatio: diff.overallChangeRatio,
              fields: diff.fields.map(f => ({ field: f.field, changeRatio: f.changeRatio })),
              material: false,
            },
          }).catch(() => { /* best-effort: audit log failure is non-fatal */ });
        }
      } else {
        // 无法解析 PRD，回退到哈希比对
        this.deps.setDriftDetected(true);
      }
    }

    if (lastHashes.contract && newHashes.contract && lastHashes.contract !== newHashes.contract) {
      const lastContract = this.deps.getLastContract();
      if (lastContract && currentContract) {
        const diff = diffContract(lastContract, currentContract);
        if (hasMaterialChange(diff)) {
          this.deps.setDriftDetected(true);
        } else {
          // R10 第2轮 (D2): contract 微调也写入 audit.jsonl
          auditLog?.append({
            type: 'minor_drift',
            source: 'contract_content_diff',
            before: { sha: lastHashes.contract },
            after: { sha: newHashes.contract },
            details: {
              target: 'contract',
              lineChanges: diff.lineChanges,
              changeRatio: diff.changeRatio,
              material: false,
            },
          }).catch(() => { /* best-effort */ });
        }
      } else {
        this.deps.setDriftDetected(true);
      }
    }

    // 更新缓存
    this.deps.setLastHashes(newHashes);
    this.deps.setLastPrd(currentPrd);
    this.deps.setLastContract(currentContract);
  }

  /**
   * 从内存 StateMachine 同步到 STATE.yaml + RESUME.md + loop.md。
   * V17: auto-generate RESUME.md after state sync.
   * R10 第3轮 (D3): persist loop.md via FilePersistor.
   */
  async syncToFile(): Promise<void> {
    const { stateManager, stateMachine, resumeGen, filePersistor } = this.deps;
    if (!stateManager) return;

    const memState = stateMachine.getState();
    const currentState = stateManager.getState();
    const progress = stateMachine.getProgress();
    await stateManager.update({
      pipeline: {
        current_stage: memState.current_stage,
        stages: memState.stages as any,
      },
      loops: memState.loops as any,
      loop: {
        iteration: memState.iteration,
        progress,
        current_story: memState.loops.inner.current_story || currentState.loop.current_story,
        client: currentState.loop.client,
        model: currentState.loop.model,
        max_iterations: currentState.loop.max_iterations,
      },
      attestation: memState.attestation,
      strikes: currentState.strikes,
    });

    // V17: Auto-generate RESUME.md after state sync
    if (resumeGen && stateManager) {
      const entry = this.deps.getStageEntryAction(memState.current_stage);
      await resumeGen.generate(stateManager, {
        next_tool: entry.tool,
        next_action: entry.action,
        last_milestone: new Date().toISOString(),
        // R10: 每次落盘都刷新引擎代际
        engine_version: AZALOOP_ENGINE_VERSION,
      }).catch(() => {
        // best-effort: RESUME.md generation failure is non-fatal
      });
    }

    // R10 第3轮 (D3): persist loop.md and verify all artifacts
    if (filePersistor) {
      const loopMd = this.buildLoopMarkdown(memState, currentState);
      await filePersistor.persistCheckpoint({ loopMd }).catch(() => {
        // best-effort: checkpoint failure is non-fatal
      });
    }
  }

  /**
   * R10 第3轮 (D3): 从当前 state 生成 loop.md 摘要。
   * loop.md 是人类可读的循环进度快照。
   */
  buildLoopMarkdown(
    memState: ReturnType<StateMachine['getState']>,
    currentState: ReturnType<StateManager['getState']>,
  ): string {
    const { stateMachine } = this.deps;
    const now = new Date().toISOString();
    const entry = this.deps.getStageEntryAction(memState.current_stage);
    const stageStatuses = Object.entries(memState.stages)
      .map(([s, info]: [string, any]) => `- **${s}**: ${info?.status ?? 'unknown'}`)
      .join('\n');
    const strikes = currentState.strikes ?? 0;
    return [
      '# AzaLoop Progress',
      '',
      `> Auto-generated checkpoint at ${now}`,
      '',
      '| Field | Value |',
      '|-------|-------|',
      `| Stage | ${memState.current_stage} |`,
      `| Iteration | ${memState.iteration} |`,
      `| Progress | ${stateMachine.getProgress()} |`,
      `| Client | ${currentState.loop.client || '(unknown)'} |`,
      `| Model | ${currentState.loop.model || '(unknown)'} |`,
      `| Strikes | ${strikes} |`,
      `| Engine Version | ${AZALOOP_ENGINE_VERSION} |`,
      '',
      '## Stage Status',
      '',
      stageStatuses || '(no stages)',
      '',
      '## Next Action',
      '',
      `Run \`${entry.tool}\` with action \`${entry.action}\` to continue the loop.`,
      '',
      '## Recovery',
      '',
      'To resume this loop in any client, run: `aza continue`',
      '',
    ].join('\n');
  }
}
