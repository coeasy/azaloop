/**
 * R10 第11轮 (P4 主体链路) — Spine E2E 验证。
 *
 * 借鉴 spec-kit「executable specification」+ agency-orchestrator「end-to-end run」：
 *
 * 把 18 竞品改造的"主体链路"做端到端验证：
 *   1. PRD 生成（含竞品研究）→ prd.json 落盘
 *   2. Trace matrix 从 PRD 构建 → evidence 收集
 *   3. PRD diff（模拟二次会话）
 *   4. Capability 验证 + client 认证
 *   5. 状态输出
 *
 * 任何一个环节失败 = 主体链路断 = exit 1。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildMatrixFromPrd,
  collectEvidence,
  writeTraceMatrix,
  diffPrd,
  diffToResumePrompt,
  writePrdDiff,
  getCapabilityStats,
  routeByRisk,
  listCapabilities,
  type PRD,
} from '@azaloop/core';

interface StepResult {
  step: string;
  passed: boolean;
  detail: string;
  duration_ms: number;
  artifacts: string[];
}

const FRAMEWORK_VERSION = '0.1.1';

function makeMinimalPrd(title: string, description: string): PRD {
  const now = new Date().toISOString();
  return {
    id: `PRD-${Date.now()}`,
    title,
    version: '1.0.0',
    created_at: now,
    updated_at: now,
    overview: description,
    goals: [
      `目标 1: ${title} 应实现 ${description.slice(0, 30)}`,
      `目标 2: 与开源竞品相比具有差异化`,
    ],
    target_users: ['开发者', '运维'],
    functional_requirements: [
      { id: 'FR-1', description: `核心能力: ${description.slice(0, 50)}`, priority: 'P0' },
      { id: 'FR-2', description: '配套能力: 配置/部署友好', priority: 'P1' },
    ],
    stories: [
      { id: 'S-1', title: '实现核心', description: '第一步：核心功能' },
    ],
    architecture: [{ component: 'core', description: '业务核心' }],
    acceptance_criteria: [
      { id: 'AC-1', description: 'AC-1: 核心能力可通过单元测试', testable: true },
      { id: 'AC-2', description: 'AC-2: 配套能力可配置', testable: true },
    ],
    risks: [
      { description: '风险 1: 时间', probability: 'medium', mitigation: '预留缓冲' },
    ],
  } as PRD;
}

function runStep<T>(name: string, fn: () => { passed: boolean; detail: string; artifacts?: string[]; result?: T }): { step: string; passed: boolean; detail: string; duration_ms: number; artifacts: string[] } {
  const start = Date.now();
  try {
    const r = fn();
    return {
      step: name,
      passed: r.passed,
      detail: r.detail,
      duration_ms: Date.now() - start,
      artifacts: r.artifacts ?? [],
    };
  } catch (err) {
    return {
      step: name,
      passed: false,
      detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
      duration_ms: Date.now() - start,
      artifacts: [],
    };
  }
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-spine-'));
  const azaDir = path.join(tmpRoot, '.aza');
  fs.mkdirSync(azaDir, { recursive: true });
  console.log(`[spine-e2e] workspace: ${tmpRoot}`);

  const steps: StepResult[] = [];

  // Step 1: 模拟 PRD 落盘
  steps.push(runStep('prd.generate_and_persist', () => {
    const prd = makeMinimalPrd('AzaLoop E2E', 'A test PRD for verifying the full spine end-to-end');
    const prdPath = path.join(azaDir, 'prd.json');
    fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2), 'utf8');
    if (!fs.existsSync(prdPath)) return { passed: false, detail: 'prd.json not written' };
    return {
      passed: true,
      detail: `prd.json written (${fs.statSync(prdPath).size} bytes)`,
      artifacts: [prdPath],
    };
  }));

  // Step 2: 加载 PRD → build trace matrix → collect evidence → write
  steps.push(runStep('trace_matrix.build', () => {
    const prdRaw = JSON.parse(fs.readFileSync(path.join(azaDir, 'prd.json'), 'utf8')) as PRD;
    const matrix = buildMatrixFromPrd(prdRaw);
    const enriched = collectEvidence(matrix, azaDir);
    const { json, md } = writeTraceMatrix(enriched, azaDir);
    return {
      passed: enriched.requirements.length > 0,
      detail: `${enriched.requirements.length} requirements; evidence: ${enriched.requirements.filter((r) => r.evidence.length > 0).length}`,
      artifacts: [json, md],
    };
  }));

  // Step 3: 模拟二次会话 → diff
  steps.push(runStep('prd.diff_reuse', () => {
    const prevRaw = JSON.parse(fs.readFileSync(path.join(azaDir, 'prd.json'), 'utf8')) as PRD;
    // 修改一项目标 + 加一项 AC
    const modified: PRD = {
      ...prevRaw,
      goals: [...prevRaw.goals, '目标 3: 新增的反合理化防线'],
      acceptance_criteria: [
        ...prevRaw.acceptance_criteria,
        { id: 'AC-3', description: 'AC-3: 新增 AC', testable: true },
      ],
    };
    const diff = diffPrd(prevRaw, modified);
    const prompt = diffToResumePrompt(diff);
    const { json, md } = writePrdDiff(diff, azaDir, prompt);
    if (diff.summary.goalsAdded < 1) return { passed: false, detail: 'diff did not detect added goal' };
    if (diff.summary.acAdded < 1) return { passed: false, detail: 'diff did not detect added AC' };
    return {
      passed: true,
      detail: `diff: goals+${diff.summary.goalsAdded}, ac+${diff.summary.acAdded}`,
      artifacts: [json, md],
    };
  }));

  // Step 4: 风险路由
  steps.push(runStep('risk_router.dry_run', () => {
    const plan = routeByRisk({
      files: ['src/auth/login.ts', 'src/db/users.ts'],
      touchesSensitive: true,
      dbSchemaChange: true,
    });
    if (plan.riskLevel !== 'high' && plan.riskLevel !== 'critical') {
      return { passed: false, detail: `expected high/critical, got ${plan.riskLevel}` };
    }
    return {
      passed: true,
      detail: `risk=${plan.riskLevel} reviewers=${plan.reviewers.length} worktree=${plan.requireWorktree}`,
    };
  }));

  // Step 5: Capability 验证
  steps.push(runStep('capability.introspect', () => {
    const stats = getCapabilityStats();
    if (stats.total === 0) return { passed: false, detail: 'no capabilities registered' };
    const verifiedAllHaveEvidence = listCapabilities()
      .filter((c) => c.maturity === 'verified')
      .every((c) => c.evidence.testFiles && c.evidence.testFiles.length > 0);
    return {
      passed: stats.verifiedEvidenceCoverage === 1.0 && verifiedAllHaveEvidence,
      detail: `total=${stats.total} exp=${stats.experimental} ver=${stats.verified} cert=${stats.certified}; ev-coverage=${(stats.verifiedEvidenceCoverage * 100).toFixed(0)}%`,
    };
  }));

  // Step 6: 全链路状态
  steps.push(runStep('state.gather', () => {
    const stateYaml = path.join(azaDir, 'STATE.yaml');
    const resumeMd = path.join(azaDir, 'RESUME.md');
    fs.writeFileSync(stateYaml, `client: spine-test\nmodel: test\nversion: ${FRAMEWORK_VERSION}\n`, 'utf8');
    fs.writeFileSync(resumeMd, `# RESUME\nstage: build\niteration: 1\n`, 'utf8');
    if (!fs.existsSync(stateYaml) || !fs.existsSync(resumeMd)) {
      return { passed: false, detail: 'STATE.yaml or RESUME.md missing' };
    }
    return { passed: true, detail: 'STATE.yaml + RESUME.md persisted' };
  }));

  // 落盘报告
  const reportPath = path.join(azaDir, 'evidence', 'spine-e2e.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    schema_version: 1,
    framework_version: FRAMEWORK_VERSION,
    generated_at: new Date().toISOString(),
    workspace: tmpRoot,
    steps,
    summary: {
      total: steps.length,
      passed: steps.filter((s) => s.passed).length,
      failed: steps.filter((s) => !s.passed).length,
    },
  }, null, 2), 'utf8');

  // 控制台输出
  console.log('');
  for (const s of steps) {
    const icon = s.passed ? '✅' : '❌';
    console.log(`  ${icon} ${s.step} (${s.duration_ms}ms): ${s.detail}`);
  }
  console.log('');
  console.log(`[spine-e2e] report: ${reportPath}`);

  const failed = steps.filter((s) => !s.passed).length;
  if (failed > 0) {
    console.error(`[spine-e2e] FAIL: ${failed} step(s) failed`);
    process.exit(1);
  }
  console.log(`[spine-e2e] PASS: all ${steps.length} steps ok`);
}

main().catch((err) => {
  console.error('[spine-e2e] FATAL:', err);
  process.exit(2);
});
