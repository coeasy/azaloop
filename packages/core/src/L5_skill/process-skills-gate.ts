/**
 * Process Skills hard gates — exceed superpowers "mandatory workflows".
 *
 * Chain:
 *   brainstorming → design.md (or openspec change)
 *   writing-plans → task_plan.md with checkable tasks
 *   tdd-process → verify stage (enforced elsewhere)
 *   verification-before-completion → quality-passed before ship
 *
 * P0 竞品超越 (superpowers 对齐)：
 * - 把软偏好的 skill 升级为硬门控：brainstorming + task_plan 都是 implement 必检
 * - 用 ProcessEvidence 对象传递显式证据而非仅依赖 marker 存在
 *
 * Escape hatch (debug only): AZA_SKIP_SKILL_GATE=1
 */
import * as fs from 'fs';
import * as path from 'path';

export interface SkillGateResult {
  allowed: boolean;
  skill?: string;
  reason?: string;
  redirect?: { tool: string; action: string; reason: string };
}

/**
 * R10 第11轮 (P0 竞品超越)：task-scoped ProcessEvidence 显式传递。
 *
 * 借鉴 superpowers「specification compliance + code quality」双轨：
 * 把每个任务的 evidence（设计/计划/验证/AC 链接）作为对象传入，
 * 避免「文件存在即证据」的脆弱判断。
 */
export interface ProcessEvidence {
  /** brainstorming/design 产物：design.md 或 openspec change 是否已就绪 */
  designReady?: boolean;
  /** writing-plans 产物：task_plan.md 或 openspec tasks.md 是否就绪 */
  planReady?: boolean;
  /** verification 产物：quality-passed.marker 或 quality-report.json 是否就绪 */
  qualityReady?: boolean;
  /** TDD 产物：是否有测试文件链接到当前 story */
  tddReady?: boolean;
}

function skipEnabled(): boolean {
  return process.env.AZA_SKIP_SKILL_GATE === '1' || process.env.AZA_SKIP_SKILL_GATE === 'true';
}

function hasLeanDesign(azaDir: string): boolean {
  const designMd = path.join(azaDir, 'design.md');
  if (!fs.existsSync(designMd)) return false;
  const body = fs.readFileSync(designMd, 'utf8');
  return /Technical Approach|Intent|Acceptance/i.test(body) || body.trim().length >= 40;
}

function hasOpenSpecChange(workspaceRoot: string): boolean {
  const changes = path.join(workspaceRoot, 'openspec', 'changes');
  if (!fs.existsSync(changes)) return false;
  try {
    const entries = fs.readdirSync(changes, { withFileTypes: true });
    return entries.some((e) => e.isDirectory() && e.name !== 'archive');
  } catch {
    return false;
  }
}

function hasTaskPlan(azaDir: string): boolean {
  const p = path.join(azaDir, 'task_plan.md');
  if (!fs.existsSync(p)) return false;
  const body = fs.readFileSync(p, 'utf8');
  // Must contain at least one checkbox-style task
  return /-\s*\[[ xX]\]/.test(body) || /^\s*\d+\.\s+/m.test(body) || body.includes('## ');
}

function hasQualityPassed(azaDir: string): boolean {
  return fs.existsSync(path.join(azaDir, 'quality-passed.marker'));
}

/**
 * 收集 process evidence — 借鉴 superpowers「task-scoped process tracking」：
 * 一次性扫描所有 process 产物并返回结构化证据对象，
 * 避免每次 gate 调用都重新读盘 + 让调用方拿到可序列化的 evidence。
 */
export function collectProcessEvidence(workspaceRoot: string): ProcessEvidence {
  const azaDir = path.join(workspaceRoot, '.aza');
  return {
    designReady: hasLeanDesign(azaDir) || hasOpenSpecChange(workspaceRoot),
    planReady: hasTaskPlan(azaDir) || hasOpenSpecChange(workspaceRoot),
    qualityReady: hasQualityPassed(azaDir),
    tddReady: false,
  };
}

/**
 * Gate before aza_spec(implement|apply) and aza_finish(ship).
 *
 * P0 竞品超越：implement 之前必须 designReady + planReady 双就绪。
 */
export function checkProcessSkillsGate(
  workspaceRoot: string,
  tool: string,
  action: string,
  evidence?: ProcessEvidence,
): SkillGateResult {
  if (skipEnabled()) return { allowed: true };

  const ev = evidence ?? collectProcessEvidence(workspaceRoot);
  const t = String(tool || '').toLowerCase();
  const act = String(action || '').toLowerCase();

  if (t === 'aza_spec' && (act === 'implement' || act === 'apply')) {
    // P0 竞品超越：硬门 — implement 必检 design + plan
    if (!ev.designReady) {
      return {
        allowed: false,
        skill: 'brainstorming',
        reason:
          'Process skill gate: brainstorming/design required before implement (need .aza/design.md or openspec/changes/*)',
        redirect: {
          tool: 'aza_spec',
          action: 'design',
          reason: 'Write design.md or propose an OpenSpec change first',
        },
      };
    }
    if (!ev.planReady) {
      return {
        allowed: false,
        skill: 'writing-plans',
        reason:
          'Process skill gate: writing-plans required before implement (need .aza/task_plan.md with checkable tasks or openspec/tasks.md)',
        redirect: {
          tool: 'aza_spec',
          action: 'plan',
          reason: 'Write task_plan.md or openspec tasks.md first',
        },
      };
    }
  }

  if (t === 'aza_finish' && act === 'ship') {
    if (!ev.qualityReady) {
      return {
        allowed: false,
        skill: 'verification-before-completion',
        reason: 'Process skill gate: run aza_quality(check) until quality-passed.marker exists before ship',
        redirect: {
          tool: 'aza_quality',
          action: 'check',
          reason: 'Evidence before completion — verify first',
        },
      };
    }
  }

  return { allowed: true };
}
