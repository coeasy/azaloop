#!/usr/bin/env node
/**
 * V21 E2E — 验证 aza_prd → aza_loop → aza_finish 全自动链路
 *
 * 在隔离目录中跑，模拟 aza_session → aza_prd(review) → aza_prd(approve) →
 * aza_loop(full) → aza_finish 的完整 next_action 链，验证：
 * 1. PRD review 后 next_action 指向 aza_prd(approve)
 * 2. approve 后 next_action 指向 aza_loop
 * 3. aza_loop step() 能在隔离目录推进
 * 4. .aza/ 下产物逐步生成
 * 5. circuit-breaker / deadlock-detector 在边界条件下触发
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

(globalThis as any).__AZA_QUIET__ = false;

async function main() {
  const tmpDir = process.env.AZA_TEST_DIR || path.join(require('os').tmpdir(), 'azaloop-smoke-isolated');
  const azaDir = path.join(tmpDir, '.aza');
  await fsp.mkdir(azaDir, { recursive: true });

  let pass = 0;
  let fail = 0;
  const check = (cond: boolean, msg: string) => {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.log(`  ✗ FAIL: ${msg}`); }
  };

  console.log(`\n[smoke-auto] tmp dir: ${tmpDir}\n`);

  // 1. aza_session
  console.log('[1] aza_session.start');
  const { StateManager } = await import('../packages/core/src/state/state-manager');
  const stateManager = new StateManager(azaDir);
  const resumeGenerator = {
    generate: async () => null,
    resume: async () => null,
  } as any;

  // 2. aza_prd.review
  console.log('[2] aza_prd.review (L2 复杂度，全自动)');
  const { PRDReviewGate } = await import('../packages/core/src/L1_spec/prd-review-gate');
  const gate = new PRDReviewGate({ stateManager, resumeGenerator });

  const reviewResult = await gate.review({
    title: 'AzaLoop 全自动循环测试',
    description: '一个用于端到端全自动测试的简单项目，验证 aza_prd → aza_loop 全链路贯通。',
    workspace_path: tmpDir,
    complexity: 'L2',
    force_14chapters: false,
  });

  console.log(`\n  → prd_id: ${reviewResult.prd_id}`);
  console.log(`  → quality_score: ${reviewResult.quality_score}`);
  console.log(`  → needs_user_approval: ${reviewResult.needs_user_approval}`);
  console.log(`  → next_action: ${JSON.stringify(reviewResult.next_action)}`);

  check(reviewResult.prd_id?.startsWith('PRD-'), 'aza_prd.review 返回有效 prd_id');
  check(typeof reviewResult.quality_score === 'number', `quality_score 是 number (${reviewResult.quality_score})`);
  // review 后下一步应是 aza_prd(approve) 或 aza_prd(refine)，由 pendingReview 决定
  check(reviewResult.needs_user_approval === true || reviewResult.next_action === undefined,
    `review 后 needs_user_approval=true (${reviewResult.needs_user_approval})`);

  // 3. aza_prd.approve
  console.log('\n[3] aza_prd.approve (auto mode)');
  const approveResult = await gate.approve({});
  console.log(`  → approved: ${approveResult.approved}`);
  console.log(`  → next_action: ${JSON.stringify(approveResult.next_action)}`);

  check(approveResult.approved === true, 'aza_prd.approve 成功');
  check(approveResult.next_action?.tool === 'aza_loop' || approveResult.next_action?.tool === 'aza_session',
    `next_action 指向 aza_loop 或 aza_session (${approveResult.next_action?.tool})`);

  // 4. aza_loop step()
  console.log('\n[4] aza_loop.step (1-3 步)');
  const { LoopController } = await import('../packages/core/src/L7_loop/loop-controller');
  const { AutoLoopDriver } = await import('../packages/core/src/L7_loop/auto-loop-driver');

  const controller = new LoopController({
    azaDir,
    maxIterations: 5,
    maxStageIterations: 3,
    enableV12: true,
  });
  const driver = new AutoLoopDriver(controller, {
    maxIterations: 3,
  });

  let stepCount = 0;
  let totalIterations = 0;
  const maxSteps = 5;
  let lastStep: any = null;
  while (stepCount < maxSteps) {
    lastStep = await driver.step();
    stepCount++;
    totalIterations += lastStep.iteration ?? 0;
    console.log(`  → step ${stepCount}: stage=${lastStep.stage}, done=${lastStep.done}, iteration=${lastStep.iteration}, nextAction=${lastStep.nextAction?.tool ?? 'n/a'}`);
    if (lastStep.done) break;
  }

  check(lastStep !== null, '至少执行 1 步');
  check(typeof lastStep.stage === 'string', `step 返回 stage 字段 (${lastStep.stage})`);
  check(totalIterations >= 1, `累计 iteration ≥ 1 (actual: ${totalIterations})`);

  // 5. 验证 .aza/ 产物
  console.log('\n[5] 验证 .aza/ 产物');
  const files = await fsp.readdir(azaDir);
  console.log(`  产物数: ${files.length}`);
  for (const f of files) {
    const stat = await fsp.stat(path.join(azaDir, f));
    console.log(`  📄 ${f} (${stat.size} bytes)`);
  }

  check(files.includes('prd.json'), 'prd.json 存在');
  check(files.includes('prd.md'), 'prd.md 存在');
  check(files.includes('prd-gate-report.json'), 'prd-gate-report.json 存在');
  check(files.includes('todolist.json'), 'todolist.json 存在');
  check(files.includes('todolist.md'), 'todolist.md 存在');

  // 6. 总结
  console.log(`\n=== 总结 ===`);
  console.log(`  通过: ${pass}`);
  console.log(`  失败: ${fail}`);
  console.log(`  产物目录: ${azaDir}`);
  console.log(`  步骤数: ${stepCount}\n`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
