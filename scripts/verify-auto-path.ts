#!/usr/bin/env node
/**
 * V20 Task 7: Verify auto-mode path isn't blocked by guards.
 *
 * Sets AZA_AUTO_APPROVE_PRD=true and walks through:
 * 1. Red-flags: warn-severity (autoMode: 'log') rules don't block in auto mode;
 *    block-severity (autoMode: 'block') rules still block.
 * 2. Stage-tool-guard: core auto tools allowed in any stage (auto mode).
 * 3. Tool registry has aza_auto registered.
 * 4. PRDReviewGate exposes draft/multiReview/refine multi-step methods.
 * 5. handleAzaAuto is exported from unified-handlers.
 * 6. TokenBudget thresholds fire at 70% (summarize) and 80% (compress).
 *
 * Run with: npx tsx scripts/verify-auto-path.ts
 */

import * as path from 'path';
import * as fs from 'fs/promises';

async function main() {
  // Force auto mode for all guard checks below.
  process.env.AZA_AUTO_APPROVE_PRD = 'true';

  const tmpDir = path.join(process.cwd(), '.aza-verify-auto');
  await fs.mkdir(path.join(tmpDir, '.aza'), { recursive: true });

  let pass = 0;
  let fail = 0;
  const assert = (cond: boolean, msg: string) => {
    if (cond) {
      pass++;
      console.log(`  \u2713 ${msg}`);
    } else {
      fail++;
      console.error(`  \u2717 ${msg}`);
    }
  };

  // ── Test 1: red-flags auto-mode ──
  console.log('\n[Test 1] red-flags auto-mode:');
  const { checkRedFlags } = await import('../packages/core/src/L7_loop/red-flags');
  // aza_prd has no red-flag rules → null in any mode.
  const prdFlags = checkRedFlags('aza_prd', []);
  assert(prdFlags === null, 'checkRedFlags returns null for aza_prd (no rules)');
  // aza_dag triggers RF-3 (warn → autoMode: 'log'); in auto mode it should log + not block.
  const dagFlags = checkRedFlags('aza_dag', []);
  assert(dagFlags === null, 'aza_dag RF-3 (warn) logged, not blocked in auto mode');
  // aza_task_implement triggers RF-1 (block → autoMode: 'block'); still blocks in auto mode.
  const implFlags = checkRedFlags('aza_task_implement', []);
  assert(implFlags !== null, 'aza_task_implement RF-1 (block) still blocks in auto mode');
  assert(implFlags?.id === 'RF-1', 'blocked flag is RF-1');

  // Sanity: outside auto mode, aza_dag should block (returns RF-3).
  const prevAuto = process.env.AZA_AUTO_APPROVE_PRD;
  process.env.AZA_AUTO_APPROVE_PRD = 'false';
  const dagFlagsManual = checkRedFlags('aza_dag', []);
  assert(dagFlagsManual !== null, 'aza_dag RF-3 blocks when auto mode is off');
  assert(dagFlagsManual?.id === 'RF-3', 'manual-mode blocked flag is RF-3');
  process.env.AZA_AUTO_APPROVE_PRD = prevAuto;

  // ── Test 2: stage-tool-guard auto-mode ──
  console.log('\n[Test 2] stage-tool-guard auto-mode:');
  const { checkStageTool } = await import('../packages/core/src/L7_loop/stage-tool-guard');
  // Core auto tools allowed regardless of stage in auto mode.
  const prdCheck = checkStageTool('aza_prd', 'open' as any);
  assert(prdCheck.allowed === true, 'aza_prd allowed in open stage (auto mode)');
  const loopCheck = checkStageTool('aza_loop', 'open' as any);
  assert(loopCheck.allowed === true, 'aza_loop allowed in open stage (auto mode)');
  const autoCheck = checkStageTool('aza_auto', 'open' as any);
  assert(autoCheck.allowed === true, 'aza_auto allowed in open stage (auto mode)');
  // aza_spec normally restricted to design/build/verify/archive; auto mode should allow it in open.
  const specCheck = checkStageTool('aza_spec', 'open' as any);
  assert(specCheck.allowed === true, 'aza_spec allowed in open stage (auto mode)');
  // aza_finish normally restricted to open/verify/archive; auto mode should allow it in build.
  const finishCheck = checkStageTool('aza_finish', 'build' as any);
  assert(finishCheck.allowed === true, 'aza_finish allowed in build stage (auto mode)');
  // aza_quality allowed in any stage via auto bypass.
  const qualityCheck = checkStageTool('aza_quality', 'open' as any);
  assert(qualityCheck.allowed === true, 'aza_quality allowed in open stage (auto mode)');

  // ── Test 3: tool registry has aza_auto ──
  console.log('\n[Test 3] tool registry:');
  const { TOOL_REGISTRY } = await import('../packages/mcp-server/src/tool-registry');
  const hasAzaAuto = TOOL_REGISTRY.some((t: { name: string }) => t.name === 'aza_auto');
  assert(hasAzaAuto, 'aza_auto registered in TOOL_REGISTRY');
  const hasAzaPrd = TOOL_REGISTRY.some((t: { name: string }) => t.name === 'aza_prd');
  assert(hasAzaPrd, 'aza_prd registered in TOOL_REGISTRY');

  // ── Test 4: PRDReviewGate multi-step methods ──
  console.log('\n[Test 4] PRDReviewGate multi-step methods:');
  const { PRDReviewGate } = await import('../packages/core/src/L1_spec/prd-review-gate');
  const proto = PRDReviewGate.prototype;
  assert(typeof proto.draft === 'function', 'PRDReviewGate.draft() exists');
  assert(typeof proto.multiReview === 'function', 'PRDReviewGate.multiReview() exists');
  assert(typeof proto.refine === 'function', 'PRDReviewGate.refine() exists');
  assert(typeof proto.review === 'function', 'PRDReviewGate.review() exists');
  assert(typeof proto.approve === 'function', 'PRDReviewGate.approve() exists');

  // ── Test 5: handleAzaAuto exists ──
  console.log('\n[Test 5] handleAzaAuto:');
  const handlers = await import('../packages/mcp-server/src/unified-handlers');
  assert(typeof handlers.handleAzaAuto === 'function', 'handleAzaAuto exported');

  // ── Test 6: TokenBudget thresholds ──
  console.log('\n[Test 6] TokenBudget:');
  const { TokenBudget } = await import('../packages/core/src/L7_loop/token-budget');
  const tb = new TokenBudget('L2');
  assert(typeof tb.checkBudget === 'function', 'TokenBudget.checkBudget() exists');
  assert(tb.checkBudget() === 'continue', 'Fresh budget returns continue');
  tb.recordUsage(85_000); // 85K / 120K = 70.8% → summarize
  assert(tb.checkBudget() === 'summarize', '70% triggers summarize');
  tb.recordUsage(15_000); // 100K / 120K = 83.3% → compress
  assert(tb.checkBudget() === 'compress', '80% triggers compress');

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
