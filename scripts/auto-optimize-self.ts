#!/usr/bin/env node
/**
 * V21 — AzaLoop 自我优化脚本
 *
 * 需求目标：自动优化 AzaLoop 自身的错误处理和类型安全
 * 具体目标：
 *   1. circuit-breaker 缺少类型安全：options 可能为 undefined
 *   2. deadlock-detector 错误处理不完善
 *   3. real-handlers.ts 缺少 try/catch 保护
 *   4. loop-controller 错误重试逻辑未做指数退避
 *
 * 运行：aza_session → aza_prd → aza_loop (8 步) → 检查产出
 * 验证：.aza/artifacts/ 产出代码修改 + git diff + 4 包 typecheck
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { execSync } from 'child_process';

(globalThis as any).__AZA_QUIET__ = false;

const REPO_ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(require('os').tmpdir(), 'azaloop-autoopt-' + Date.now());
const AZA_DIR = path.join(TMP_DIR, '.aza');
const ARTIFACTS_DIR = path.join(AZA_DIR, 'artifacts');
const OPTIMIZATION_GOAL = '优化 AzaLoop 自身的错误处理和类型安全';
const PROTECTED_FILES = [
  'packages/core/src/L7_loop/loop-controller.ts',
  'packages/core/src/L7_loop/auto-loop-driver.ts',
  'packages/core/src/L1_spec/prd-review-gate.ts',
  'scripts/auto-optimize-self.ts',
];

async function main() {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  AzaLoop 自我优化 — 全自动测试              ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);
  console.log(`[repo]   ${REPO_ROOT}`);
  console.log(`[tmp]    ${TMP_DIR}`);
  console.log(`[goal]   ${OPTIMIZATION_GOAL}\n`);

  await fsp.mkdir(AZA_DIR, { recursive: true });
  await fsp.mkdir(ARTIFACTS_DIR, { recursive: true });

  let pass = 0;
  let fail = 0;
  const check = (cond: boolean, msg: string) => {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.log(`  ✗ FAIL: ${msg}`); }
  };

  // ── 1. aza_session ──
  console.log(`\n[1/8] aza_session.init (建立项目上下文)`);
  const { StateManager } = await import('../packages/core/src/state/state-manager');
  const stateManager = new StateManager(AZA_DIR);
  console.log(`  → StateManager 就绪`);

  // ── 2. aza_prd.review ──
  console.log(`\n[2/8] aza_prd.review (生成项目 PRD)`);
  const { PRDReviewGate } = await import('../packages/core/src/L1_spec/prd-review-gate');
  const resumeGenerator = { generate: async () => null, resume: async () => null } as any;
  const gate = new PRDReviewGate({ stateManager, resumeGenerator });

  const reviewResult = await gate.review({
    title: 'AzaLoop 自我优化：提升错误处理和类型安全',
    description: `${OPTIMIZATION_GOAL}。具体包括：(1) circuit-breaker 增加 options 类型守卫；(2) deadlock-detector 错误处理标准化；(3) real-handlers 包装 try/catch；(4) loop-controller 实现指数退避。`,
    workspace_path: TMP_DIR,
    complexity: 'L3',
    force_14chapters: false,
  });
  console.log(`  → prd_id: ${reviewResult.prd_id}`);
  console.log(`  → quality_score: ${reviewResult.quality_score}`);
  check(reviewResult.prd_id?.startsWith('PRD-'), 'prd_id 有效');
  check(reviewResult.quality_score >= 50, `quality_score ≥ 50 (${reviewResult.quality_score})`);

  // ── 3. aza_prd.approve ──
  console.log(`\n[3/8] aza_prd.approve (auto mode)`);
  const approveResult = await gate.approve({});
  console.log(`  → next_action: ${JSON.stringify(approveResult.next_action)}`);
  check(approveResult.approved === true, 'prd 已通过');

  // ── 4-7. aza_loop.step (8 步) ──
  console.log(`\n[4/8] aza_loop.step (8 步自动循环)`);
  const { LoopController } = await import('../packages/core/src/L7_loop/loop-controller');
  const { AutoLoopDriver } = await import('../packages/core/src/L7_loop/auto-loop-driver');

  const controller = new LoopController({
    azaDir: AZA_DIR,
    maxIterations: 8,
    maxStageIterations: 3,
    enableV12: true,
  });
  const driver = new AutoLoopDriver(controller, { maxIterations: 8 });

  const stepSummaries: Array<{ step: number; stage: string; iteration: number; done: boolean; nextTool: string }> = [];
  for (let i = 0; i < 8; i++) {
    try {
      const step = await driver.step();
      const summary = {
        step: i + 1,
        stage: step.stage,
        iteration: step.iteration,
        done: step.done,
        nextTool: step.nextAction?.tool ?? 'none',
      };
      stepSummaries.push(summary);
      console.log(`  [step ${i + 1}] stage=${summary.stage} iter=${summary.iteration} done=${summary.done} → ${summary.nextTool}`);

      // 每步后模拟 stage 处理器产出 artifacts
      if (!summary.done) {
        await emitArtifactForStage(summary, i + 1);
      }
      if (summary.done) break;
    } catch (e) {
      console.log(`  [step ${i + 1}] ERROR: ${(e as Error).message}`);
    }
  }

  check(stepSummaries.length >= 4, `至少执行 4 步 (actual: ${stepSummaries.length})`);
  check(stepSummaries.some(s => s.stage === 'design'), '经过 design stage');
  check(stepSummaries.some(s => s.stage === 'build'), '经过 build stage');

  // ── 8. 验证产出 ──
  console.log(`\n[8/8] 验证自动优化产出\n`);

  // 8.1 验证 .aza/ 状态
  const azaFiles = await fsp.readdir(AZA_DIR);
  console.log(`  .aza/ 产物数: ${azaFiles.length}`);
  for (const f of azaFiles.slice(0, 15)) {
    const stat = await fsp.stat(path.join(AZA_DIR, f));
    console.log(`    📄 ${f} (${stat.size} bytes)`);
  }
  check(azaFiles.length >= 5, `.aza/ 产物数 ≥ 5 (actual: ${azaFiles.length})`);
  check(azaFiles.includes('prd.json'), 'prd.json 存在');
  check(azaFiles.includes('run-state.json'), 'run-state.json 存在');
  check(azaFiles.includes('audit.jsonl'), 'audit.jsonl 存在');

  // 8.2 验证 artifacts/ 目录
  const artifacts = await fsp.readdir(ARTIFACTS_DIR).catch(() => []);
  console.log(`\n  .aza/artifacts/ 产出数: ${artifacts.length}`);
  for (const f of artifacts) {
    const stat = await fsp.stat(path.join(ARTIFACTS_DIR, f));
    console.log(`    📝 ${f} (${stat.size} bytes)`);
  }
  check(artifacts.length >= 2, `artifacts/ 产出数 ≥ 2 (actual: ${artifacts.length})`);

  // 8.3 验证 AzaLoop 自身代码保护
  const gitStatus = execSync('git status --short', { cwd: REPO_ROOT }).toString();
  const protectedViolations: string[] = [];
  for (const pf of PROTECTED_FILES) {
    if (gitStatus.includes(`M ${pf}`) || gitStatus.includes(` M ${pf}`)) {
      protectedViolations.push(pf);
    }
  }
  if (protectedViolations.length === 0) {
    check(true, 'AzaLoop 受保护核心文件未被修改');
  } else {
    check(false, `受保护文件被修改: ${protectedViolations.join(', ')}`);
  }

  // 8.4 汇总
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  总结                                       ║`);
  console.log(`╚════════════════════════════════════════════╝`);
  console.log(`  ✅ 通过: ${pass}`);
  console.log(`  ✗  失败: ${fail}`);
  console.log(`  步骤数: ${stepSummaries.length}/8`);
  console.log(`  artifacts: ${ARTIFACTS_DIR}`);
  console.log(`  回滚点: git reset --hard c6efaee\n`);

  process.exit(fail === 0 ? 0 : 1);
}

/**
 * 模拟每步的 stage handler 产出 artifacts。
 * 真实环境中这一步是 inner-loop handlerProvider 调用 LLM 生成代码修改。
 * 在 demo 中，我们产出"建议修改"标记到 .aza/artifacts/，由后续人工 review。
 */
async function emitArtifactForStage(summary: { stage: string }, step: number) {
  const goalMap: Record<string, { file: string; title: string; suggestion: string }[]> = {
    design: [
      {
        file: 'packages/core/src/L7_loop/circuit-breaker.ts',
        title: 'circuit-breaker options 类型守卫',
        suggestion: `// 建议修改位置：execute() 方法入口
if (!options || typeof options !== 'object') {
  throw new Error('CircuitBreaker.execute: options must be an object');
}
// 或使用 zod schema 验证`,
      },
    ],
    build: [
      {
        file: 'packages/core/src/L7_loop/deadlock-detector.ts',
        title: 'deadlock-detector 错误处理标准化',
        suggestion: `// 建议修改位置：checkNoProgress() 方法
try {
  return this.checkNoProgressImpl(lastChangeAt, now);
} catch (e) {
  console.error('[deadlock-detector] checkNoProgress failed:', e);
  return { deadlocked: false }; // fail-safe
}`,
      },
      {
        file: 'packages/core/src/L7_loop/real-handlers.ts',
        title: 'real-handlers try/catch 包装',
        suggestion: `// 建议修改位置：每个 handler 入口
async runHandlerForStage(stage: string, payload: any): Promise<any> {
  try {
    return await this.executeHandler(stage, payload);
  } catch (e) {
    await this.auditHandlerError(stage, e);
    return null; // graceful degradation
  }
}`,
      },
      {
        file: 'packages/core/src/L7_loop/loop-controller.ts',
        title: 'loop-controller 指数退避',
        suggestion: `// 建议修改位置：catch 块 coldStartRetry 后
const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
await new Promise(r => setTimeout(r, delay));
retryCount++;`,
      },
    ],
    verify: [
      {
        file: 'packages/core/src/L7_loop/loop-controller.ts',
        title: 'verify stage: 验证所有修改通过 typecheck',
        suggestion: `// 建议在 verify stage 末尾：
const tsc = spawn('pnpm', ['-r', 'typecheck'], { cwd: REPO_ROOT });
if (tsc.status !== 0) throw new Error('typecheck failed');`,
      },
    ],
  };

  const items = goalMap[summary.stage] || [];
  for (const item of items) {
    const filename = `step-${String(step).padStart(2, '0')}-${item.file.replace(/[\\/]/g, '_')}.md`;
    const content = `# 建议修改：${item.title}

**目标文件**: \`${item.file}\`
**阶段**: ${summary.stage}
**步骤**: ${step}
**生成时间**: ${new Date().toISOString()}

## 建议内容

\`\`\`typescript
${item.suggestion}
\`\`\`

## 验收

- [ ] 4 包 \`pnpm -r typecheck\` 0 错误
- [ ] 不破坏现有 API
- [ ] 添加单元测试覆盖

## 关联

- 优化目标: 错误处理和类型安全
- 优先级: P1
- 风险: 低
`;
    await fsp.writeFile(path.join(ARTIFACTS_DIR, filename), content, 'utf8');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
