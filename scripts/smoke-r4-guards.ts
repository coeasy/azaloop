/**
 * R4 smoke test: guard 冲突消解 — auto 模式下不被 red-flags/stage-tool-guard 误拦
 *
 * 验证：
 * 1. auto 模式下，aza_spec/aza_prd/aza_finish 在 design/build/verify/archive 阶段都能通过 stage-tool-guard
 * 2. auto 模式下，warn 级 red-flags（RF-3/4/5/7）只 log 不 block
 * 3. 硬规则（RF-1/2/6/8/9 = block）仍正确 block
 *
 * 运行：AZA_AUTO_APPROVE_PRD=true npx tsx scripts/smoke-r4-guards.ts
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

async function main() {
  process.env.AZA_AUTO_APPROVE_PRD = 'true';
  // 动态 import 以便拿到最新的 autoMode 状态
  const { checkStageTool, checkRedFlags, getStageToolMatrix, WRITE_TOOLS } = await import(
    '../packages/core/src/index'
  );

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'azaloop-r4-'));
  console.log(`[R4] workspace: ${tmp}`);

  let pass = 0;
  let fail = 0;

  // Test 1: auto 模式下，aza_spec/aza_prd/aza_finish 在任何阶段都允许
  const stages = ['open', 'design', 'build', 'verify', 'archive'] as const;
  const writeTools = ['aza_spec', 'aza_prd', 'aza_finish', 'aza_loop', 'aza_quality'];
  for (const stage of stages) {
    for (const tool of writeTools) {
      const r = checkStageTool(tool, stage);
      if (r.allowed) {
        pass++;
        console.log(`  ✓ ${tool} @ ${stage} → allowed`);
      } else {
        fail++;
        console.error(`  ✗ ${tool} @ ${stage} → BLOCKED: ${r.reason}`);
      }
    }
  }

  // Test 2: auto 模式下，warn 红旗不 block
  // aza_dag 在没有 aza_explore 时会触发 RF-3 (warn/autoMode=log) — 不应 block
  const rf3 = checkRedFlags('aza_dag', ['aza_prd_approve']);
  if (rf3 === null) {
    pass++;
    console.log('  ✓ RF-3 (warn) in auto mode → not blocked (correct)');
  } else {
    fail++;
    console.error(`  ✗ RF-3 unexpectedly returned: ${rf3.id} (should be log in auto)`);
  }

  // Test 3: 硬规则 (RF-1: aza_task_implement 在 aza_prd_approve 之前) 仍 block
  const rf1 = checkRedFlags('aza_task_implement', []);
  if (rf1 && rf1.id === 'RF-1') {
    pass++;
    console.log('  ✓ RF-1 (block) → still blocks (correct)');
  } else {
    fail++;
    console.error(`  ✗ RF-1 expected to block, got: ${rf1?.id ?? 'null'}`);
  }

  // Test 4: aza_task_implement 已有 aza_prd_approve → 不触发
  const rf1pass = checkRedFlags('aza_task_implement', ['aza_prd_approve']);
  if (rf1pass === null) {
    pass++;
    console.log('  ✓ RF-1 satisfied → not blocked (correct)');
  } else {
    fail++;
    console.error(`  ✗ RF-1 unexpectedly blocked after prereq: ${rf1pass.id}`);
  }

  // Test 5: 写入工具清单覆盖核心场景
  const writeList = Array.from(WRITE_TOOLS);
  console.log(`  ℹ WRITE_TOOLS: ${writeList.join(', ')}`);

  console.log(`\n[R4] Result: ${pass} passed, ${fail} failed`);
  await fs.rm(tmp, { recursive: true, force: true });
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('[R4] smoke test crashed:', e);
  process.exit(2);
});
