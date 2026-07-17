/**
 * aza_quality — quality pipeline handlers (check / ui_qa).
 *
 * R12 P6 Plus9 (P1 主链路拆分第9轮) — 把 7 个 pipeline.register 调用 +
 * 3 个 helper (loadAcceptanceCriteria / loadRegressionBaseline / collectWorkspaceSignals)
 * 抽到 quality-pipeline-builder.ts。主文件只保留 2 个 handler。
 */
import { runUiQa } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as fs from 'fs';
import * as path from 'path';
import { buildPipeline } from './quality-pipeline-builder';

/**
 * aza_quality(check) — 跑全部 7 个 quality gate。
 */
export async function handleQualityCheck(projectRoot: string): Promise<LoopResponse> {
  const root = projectRoot || process.cwd();
  const pipeline = await buildPipeline(root);
  // Optional UI QA when AZA_UI_QA=true (does not fail gate when skipped)
  let uiQa: Awaited<ReturnType<typeof runUiQa>> | null = null;
  try {
    if (process.env.AZA_UI_QA === 'true') {
      uiQa = await runUiQa({ projectRoot: root });
    }
  } catch {
    /* best-effort */
  }
  const result = await pipeline.runAll();
  if (result.passed && uiQa && !uiQa.skipped && !uiQa.passed) {
    return {
      success: false,
      data: { ...result, ui_qa: uiQa },
      next_action: {
        tool: 'aza_quality',
        action: 'ui_qa',
        reason: `UI QA failed: ${uiQa.reason}`,
      },
      metadata: { iteration: 0, progress: '55%', stage: 'verify' },
    };
  }
  if (result.passed) {
    try {
      const azaDir = path.join(root, '.aza');
      fs.mkdirSync(azaDir, { recursive: true });
      fs.writeFileSync(
        path.join(azaDir, 'quality-passed.marker'),
        JSON.stringify({ at: new Date().toISOString(), summary: result.summary }, null, 2),
        'utf8',
      );
    } catch {
      /* best-effort */
    }
    try {
      const { handleLoopSetCondition } = await import('./aza-loop');
      await handleLoopSetCondition('quality_passed', true, root);
      await handleLoopSetCondition('build_tested', true, root);
      await handleLoopSetCondition('archive_ready', true, root);
    } catch {
      /* best-effort */
    }
  }
  return {
    success: result.passed,
    data: uiQa ? { ...result, ui_qa: uiQa } : result,
    next_action: result.passed
      ? { tool: 'aza_finish', action: 'ship', reason: 'All quality gates passed — ready to ship' }
      : { tool: 'aza_quality', action: 'check', reason: `Quality gate failed: ${result.summary}` },
    metadata: { iteration: 0, progress: result.passed ? '85%' : '50%', stage: 'verify' },
  };
}

/**
 * aza_quality(ui_qa) — 单独跑 UI QA gate（playwright + axe-core）。
 */
export async function handleUiQa(
  projectRoot: string,
  url?: string,
): Promise<LoopResponse> {
  const root = projectRoot || process.cwd();
  const result = await runUiQa({ projectRoot: root, url });
  return {
    success: result.passed,
    data: result,
    next_action: result.skipped
      ? { tool: 'aza_quality', action: 'check', reason: result.reason }
      : result.passed
        ? { tool: 'aza_finish', action: 'ship', reason: 'UI QA passed — ready to ship' }
        : { tool: 'aza_quality', action: 'ui_qa', reason: `UI QA failed: ${result.reason}` },
    metadata: { iteration: 0, progress: result.passed ? '80%' : '55%', stage: 'verify' },
  };
}
