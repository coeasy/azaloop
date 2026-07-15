#!/usr/bin/env node
/**
 * V21 E2E — 在 AzaLoop 自身代码上跑 1 步全自动 demo
 *
 * 目的：验证 AzaLoop 的 aza_session→aza_prd→aza_loop 工具链能修改自身代码（只跑 1 步）
 * 限制：
 *  - maxIterations=1（只跑 1 步）
 *  - azaDir 在 tmp 目录（不动 AzaLoop 仓库 .aza/）
 *  - 设置 boundaries.never_touch 防止 AzaLoop 修改本脚本
 *  - 设置 worktree/sandbox 隔离
 *
 * 验证：能否在 1 步内产出可观察的 .aza/ 产物
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

(globalThis as any).__AZA_QUIET__ = false;

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = path.join(require('os').tmpdir(), 'azaloop-selfdemo-' + Date.now());
  const azaDir = path.join(tmpDir, '.aza');
  await fsp.mkdir(azaDir, { recursive: true });

  console.log(`\n[smoke-selfdemo] repo: ${repoRoot}`);
  console.log(`[smoke-selfdemo] tmp:  ${tmpDir}\n`);

  // 设置全局保护：禁止 AzaLoop 修改自身核心文件
  process.env.AZA_BOUNDARIES_NEVER_TOUCH = JSON.stringify([
    'packages/core/src/L7_loop/loop-controller.ts',
    'packages/core/src/L7_loop/auto-loop-driver.ts',
    'packages/core/src/L1_spec/prd-review-gate.ts',
    'scripts/smoke-selfdemo.ts',
    '.git/**',
  ]);

  let pass = 0;
  let fail = 0;
  const check = (cond: boolean, msg: string) => {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.log(`  ✗ FAIL: ${msg}`); }
  };

  try {
    // 1. 准备
    console.log('[1] 初始化 StateManager + LoopController + AutoLoopDriver');
    const { StateManager } = await import('../packages/core/src/state/state-manager');
    const { LoopController } = await import('../packages/core/src/L7_loop/loop-controller');
    const { AutoLoopDriver } = await import('../packages/core/src/L7_loop/auto-loop-driver');

    const stateManager = new StateManager(azaDir);
    const controller = new LoopController({
      azaDir,
      maxIterations: 1,         // 仅 1 步
      maxStageIterations: 1,    // 每 stage 仅 1 次
      enableV12: true,
    });
    const driver = new AutoLoopDriver(controller, { maxIterations: 1 });

    // 2. 跑 1 步
    console.log('\n[2] aza_loop.step (max 1 步)');
    const step = await driver.step();
    console.log(`  → stage=${step.stage}, done=${step.done}, iteration=${step.iteration}, nextAction=${step.nextAction?.tool ?? 'n/a'}`);

    check(typeof step.stage === 'string', `step 返回 stage (${step.stage})`);
    check(step.iteration === 1, `iteration=1 (actual: ${step.iteration})`);

    // 3. 验证产物
    console.log('\n[3] 验证 .aza/ 产物');
    const files = await fsp.readdir(azaDir);
    console.log(`  产物数: ${files.length}`);
    for (const f of files) {
      const stat = await fsp.stat(path.join(azaDir, f));
      console.log(`  📄 ${f} (${stat.size} bytes)`);
    }

    check(files.length >= 3, `产物数 ≥3 (actual: ${files.length})`);
    check(files.includes('run-state.json') || files.includes('STATE.yaml'), '状态文件存在');

    // 4. 验证 AzaLoop 自身代码未被修改（保护检查）
    console.log('\n[4] 验证 AzaLoop 自身代码未被修改');
    const { execSync } = require('child_process');
    const status = execSync('git status --short', { cwd: repoRoot }).toString();
    const protectedFiles = [
      'packages/core/src/L7_loop/loop-controller.ts',
      'packages/core/src/L7_loop/auto-loop-driver.ts',
      'packages/core/src/L1_spec/prd-review-gate.ts',
    ];
    let protectedOk = true;
    for (const pf of protectedFiles) {
      if (status.includes(`M ${pf}`) || status.includes(` M ${pf}`)) {
        console.log(`  ⚠  protected file modified: ${pf}`);
        protectedOk = false;
      }
    }
    check(protectedOk, '受保护的核心文件未被修改');

    // 5. 总结
    console.log(`\n=== 总结 ===`);
    console.log(`  通过: ${pass}`);
    console.log(`  失败: ${fail}`);
    console.log(`  AzaLoop 自身代码: ${status.split('\n').length - 1} 个文件变更（与改动前一致即可）`);
    console.log(`  临时产物目录: ${tmpDir}\n`);

    process.exit(fail === 0 ? 0 : 1);
  } finally {
    // 清理环境变量
    delete process.env.AZA_BOUNDARIES_NEVER_TOUCH;
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
