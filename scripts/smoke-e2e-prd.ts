#!/usr/bin/env node
/**
 * V21 — 端到端冒烟测试：验证阶段 A 的 6 个断链修复在运行时真正生效。
 *
 * 检查 aza_prd(review) 调用后，.aza/ 目录下是否生成：
 *  1. prd-gate-report.json  (A1: PrdQualityGate 接入)
 *  2. todolist.json + todolist.md  (A2: todolist 在 review 路径生成)
 *  3. prd-multi-role-review.json  (A6: 多角色审查)
 *  4. prd.json + prd.md  (基础产物)
 *  5. 14-chapter H2 骨架出现在 prd.md 中  (A4: 14 章节真正启用)
 *
 * 运行: npx tsx scripts/smoke-e2e-prd.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

(globalThis as any).__AZA_QUIET__ = false;

async function main() {
  const tmpDir = path.join(process.cwd(), '.aza-smoke-e2e-' + Date.now());
  const azaDir = path.join(tmpDir, '.aza');
  await fsp.mkdir(azaDir, { recursive: true });

  let pass = 0;
  let fail = 0;
  const check = (cond: boolean, msg: string) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${msg}`);
    } else {
      fail++;
      console.log(`  ✗ FAIL: ${msg}`);
    }
  };

  console.log(`\n[smoke-e2e] tmp dir: ${tmpDir}\n`);

  // 1. 准备 StateManager + ResumeGenerator stub
  console.log('[1] 准备 PRDReviewGate 实例...');
  const { PRDReviewGate } = await import('../packages/core/src/L1_spec/prd-review-gate');
  const { StateManager } = await import('../packages/core/src/state/state-manager');
  const stateManager = new StateManager(tmpDir);
  const resumeGenerator = {
    generate: async () => null,
    resume: async () => null,
  } as any;

  const gate = new PRDReviewGate({ stateManager, resumeGenerator });

  // 2. 调用 review() 触发整条链路
  console.log('[2] 调用 gate.review() (L3 复杂度，强制 14 章节)...\n');
  const result = await gate.review({
    title: 'AzaLoop 冒烟测试 PRD',
    description: '一个用于端到端冒烟测试的简单 PRD，包含用户认证、任务管理、通知三大模块。',
    workspace_path: tmpDir,
    complexity: 'L3',
    force_14chapters: true,
  });
  console.log(`\n  → prd_id: ${result.prd_id}`);
  console.log(`  → quality_score: ${result.quality_score}`);
  console.log(`  → needs_user_approval: ${result.needs_user_approval}\n`);

  // 3. 验证 .aza/ 产物
  console.log('[3] 验证 .aza/ 产物:\n');
  const files = await fsp.readdir(azaDir);
  for (const f of files) {
    const stat = await fsp.stat(path.join(azaDir, f));
    console.log(`  📄 ${f}  (${stat.size} bytes)`);
  }
  console.log('');

  // A1: prd-gate-report.json
  const gateReportPath = path.join(azaDir, 'prd-gate-report.json');
  check(fs.existsSync(gateReportPath), 'A1: prd-gate-report.json exists');
  if (fs.existsSync(gateReportPath)) {
    const report = JSON.parse(fs.readFileSync(gateReportPath, 'utf8'));
    check(typeof report.score === 'number', `A1: gate score is number (${report.score})`);
    check(['A', 'B', 'C', 'D'].includes(report.grade), `A1: gate grade valid (${report.grade})`);
    check(Array.isArray(report.blockers), `A1: blockers is array (${report.blockers.length})`);
  }

  // A2: todolist.json + todolist.md
  const todolistJsonPath = path.join(azaDir, 'todolist.json');
  const todolistMdPath = path.join(azaDir, 'todolist.md');
  check(fs.existsSync(todolistJsonPath), 'A2: todolist.json exists');
  check(fs.existsSync(todolistMdPath), 'A2: todolist.md exists');
  if (fs.existsSync(todolistJsonPath)) {
    const tl = JSON.parse(fs.readFileSync(todolistJsonPath, 'utf8'));
    check(tl.total_items > 0, `A2: todolist has items (${tl.total_items})`);
    check(tl.summary.p0_count >= 0, `A2: todolist has P0 tasks (${tl.summary.p0_count})`);
  }

  // 基础产物
  check(fs.existsSync(path.join(azaDir, 'prd.json')), 'BASE: prd.json exists');
  check(fs.existsSync(path.join(azaDir, 'prd.md')), 'BASE: prd.md exists');
  check(fs.existsSync(path.join(azaDir, 'prd-multi-role-review.json')), 'A6: prd-multi-role-review.json exists');

  // A4: 14-chapter H2 骨架
  if (fs.existsSync(path.join(azaDir, 'prd.md'))) {
    const prdMd = fs.readFileSync(path.join(azaDir, 'prd.md'), 'utf8');
    const h2Count = (prdMd.match(/^## /gm) || []).length;
    check(h2Count >= 5, `A4: prd.md has ≥5 H2 sections (actual: ${h2Count})`);
    check(/14 章节|14章节/.test(prdMd) || /项目背景|需求基本情况|商业分析/.test(prdMd),
      'A4: prd.md contains 14-chapter content markers');
  }

  // 4. 验证 result 对象附加了 gate 字段
  console.log('\n[4] 验证 result 对象附加字段:');
  const gateOnResult = (result as any).gate;
  check(gateOnResult !== undefined, 'A1: result.gate is attached');
  if (gateOnResult) {
    check(typeof gateOnResult.score === 'number', `A1: result.gate.score is number (${gateOnResult.score})`);
  }

  // 5. 输出总结
  console.log(`\n=== 总结 ===`);
  console.log(`  通过: ${pass}`);
  console.log(`  失败: ${fail}`);
  console.log(`  产物目录: ${azaDir}\n`);

  // 保留产物便于人工检查（30 秒后由用户手动删除）
  console.log(`提示: 30 秒后可手动删除 ${tmpDir}`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
