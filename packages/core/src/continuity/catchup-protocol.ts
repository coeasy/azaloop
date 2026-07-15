import { StateManager } from '../state/state-manager';
import { ResumeGenerator } from './resume-generator';
import { ProjectMemory } from '../L2_memory/project-memory';
import { LongTermMemory } from '../L2_memory/long-term-memory';
import { SessionCatchup } from '../L2_memory/session-catchup';
import { RunLedger } from '../state/run-ledger';

export interface CatchupResult {
  state_restored: boolean;
  resume_found: boolean;
  memories_loaded: boolean;
  catchup_summary: string;
  errors_to_avoid: string[];
}

/**
 * CatchupProtocol — 会话接续协议
 *
 * 在每次会话开始时执行，恢复之前的状态和记忆，确保跨会话连续性。
 * 用于：
 * 1. 恢复 STATE.yaml 状态
 * 2. 加载 RESUME.md 恢复上下文
 * 3. 加载项目记忆和长期记忆
 * 4. 生成接续摘要供 LLM 参考
 */
export class CatchupProtocol {
  private stateManager: StateManager;
  private resumeGenerator: ResumeGenerator;
  private projectMemory: ProjectMemory;
  private longTermMemory: LongTermMemory;
  private sessionCatchup: SessionCatchup;
  private runLedger: RunLedger;

  constructor(
    stateManager: StateManager,
    resumeGenerator: ResumeGenerator,
    projectMemory: ProjectMemory,
    longTermMemory: LongTermMemory,
  ) {
    this.stateManager = stateManager;
    this.resumeGenerator = resumeGenerator;
    this.projectMemory = projectMemory;
    this.longTermMemory = longTermMemory;
    this.sessionCatchup = new SessionCatchup(stateManager, projectMemory, longTermMemory);
    const azaDir = (stateManager as any).azaDir || '.aza';
    this.runLedger = new RunLedger(azaDir);
  }

  async run(): Promise<CatchupResult> {
    // 优先读 run-ledger 的 getRecoveryPoint()
    await this.runLedger.load();
    const recoveryPoint = this.runLedger.getRecoveryPoint();

    const resume = await this.resumeGenerator.read();
    const state = this.stateManager.getState();
    const catchupSummary = await this.sessionCatchup.catchup();

    // 若有恢复点，用 summarizeSince() 重建上下文摘要
    let ledgerSummary = '';
    if (recoveryPoint && recoveryPoint.iteration) {
      ledgerSummary = this.runLedger.summarizeSince(recoveryPoint.iteration);
    }

    return {
      state_restored: state.pipeline.current_stage !== 'open' || state.loop.iteration > 0,
      resume_found: resume !== null,
      memories_loaded: catchupSummary.recent_memories > 0,
      catchup_summary: this.generateSummary(catchupSummary, resume, ledgerSummary, recoveryPoint),
      errors_to_avoid: catchupSummary.errors_to_avoid,
    };
  }

  private generateSummary(catchup: any, resume: any, ledgerSummary: string, recoveryPoint: any): string {
    const lines = [
      '# Session Catch-up Protocol',
      '',
      `State restored: ${catchup.session_restored}`,
      `Resume found: ${resume !== null}`,
      `Current stage: ${catchup.current_stage}`,
      `Iteration: ${catchup.iteration}`,
      `Progress: ${catchup.progress}`,
      '',
    ];

    // 追加 run-ledger 恢复信息
    if (recoveryPoint) {
      lines.push(
        '## Run Ledger Recovery',
        '',
        `Recovery point: iteration ${recoveryPoint.iteration ?? 'unknown'}, tool ${recoveryPoint.tool}`,
        ledgerSummary,
        '',
      );
    }

    return lines.join('\n');
  }
}
