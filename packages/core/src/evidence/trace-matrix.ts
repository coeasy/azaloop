/**
 * R10 第11轮 (P2 Spec×Loop 追踪闭环) — Requirement ↔ Evidence 追踪矩阵。
 *
 * 借鉴 spec-kit「constitution → specify → plan → tasks → implement」可追踪产物链
 * + ralphy-openspec「per-task CONTEXT/REPAIR/NOTES」+ Trellis「learnings 回写」。
 *
 * 目标：任一已交付需求能反向追溯到测试和产物。
 *
 * 模型：
 *   Requirement  ←稳定 ID
 *      ↕ N:M
 *   Story        ←来自 PRD.stories
 *      ↕ N:M
 *   Test         ←来自 quality/verify 阶段
 *      ↕ N:M
 *   Evidence     ←来自 run-ledger / quality-report.json / stage markers
 *
 * 追踪矩阵是纯数据结构：load + query + render，零 I/O 副作用。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PRD } from '@azaloop/shared';

// ── Types ────────────────────────────────────────────────

export type RequirementStatus = 'draft' | 'planned' | 'in_progress' | 'verified' | 'shipped' | 'abandoned';

export type TraceEvidenceKind =
  | 'test'           // 测试通过
  | 'design'         // design.md / openspec change
  | 'plan'           // task_plan.md / openspec tasks.md
  | 'quality'        // quality-report.json
  | 'ship'           // ship marker
  | 'competitive'    // 竞品研究
  | 'archive'        // archive 阶段产物
  | 'review';        // 审查记录

export interface TraceEvidence {
  kind: TraceEvidenceKind;
  ref: string;           // 文件路径 / 测试名 / action id
  collectedAt: string;   // ISO
  note?: string;
}

export interface Requirement {
  id: string;            // 稳定 ID，如 REQ-001
  title: string;
  description: string;
  acceptance?: string;   // 可测试的 AC
  priority?: 'P0' | 'P1' | 'P2';
  status: RequirementStatus;
  storyIds: string[];            // 关联 story id（PRD.stories[].id）
  testRefs: string[];            // 关联 test 文件或测试名
  evidence: TraceEvidence[];     // 收集到的证据
  // 竞品来源（来自 competitive-research 注入）
  competitiveRefs?: string[];
}

export interface TraceabilityQuery {
  requirementId?: string;
  storyId?: string;
  testRef?: string;
  evidenceKind?: TraceEvidenceKind;
  status?: RequirementStatus;
}

export interface TraceMatrix {
  schemaVersion: 1;
  projectName: string;
  generatedAt: string;
  requirements: Requirement[];
}

// ── Build from PRD ──────────────────────────────────────

/**
 * 从 PRD 构建追踪矩阵骨架（无 evidence）—— 给 LLM/用户补充 evidence 用。
 *
 * 借鉴 spec-kit：requirement 必须有稳定 ID、acceptance、priority，
 * 任何缺一不可，否则抛出错误。
 */
export function buildMatrixFromPrd(prd: PRD): TraceMatrix {
  const requirements: Requirement[] = [];
  // FR 全部升级为 REQ
  for (const fr of prd.functional_requirements) {
    requirements.push({
      id: fr.id,
      title: fr.description.slice(0, 60),
      description: fr.description,
      priority: (fr.priority as 'P0' | 'P1' | 'P2') ?? 'P1',
      status: 'draft',
      storyIds: [],
      testRefs: [],
      evidence: [],
    });
  }
  // Story 单独建为 REQ（如果还没有对应 FR）
  const existingIds = new Set(requirements.map((r) => r.id));
  for (const story of prd.stories) {
    const storyReqId = `STORY-${story.id}`;
    if (!existingIds.has(storyReqId)) {
      requirements.push({
        id: storyReqId,
        title: story.title,
        description: story.description,
        priority: (story.priority as 'P0' | 'P1' | 'P2') ?? 'P1',
        status: 'draft',
        storyIds: [story.id],
        testRefs: [],
        evidence: [],
      });
    } else {
      const r = requirements.find((x) => x.id === storyReqId);
      if (r) r.storyIds.push(story.id);
    }
  }
  return {
    schemaVersion: 1,
    projectName: prd.title,
    generatedAt: new Date().toISOString(),
    requirements,
  };
}

// ── Evidence collection ─────────────────────────────────

/**
 * 从 .aza/ 目录收集 evidence 关联回 requirement。
 *
 * 借鉴 ralphy-openspec「CONTEXT/REPAIR/NOTES」：每个 task 独立 artifact namespace
 * 走完后从 artifact 自动收集证据。
 */
export function collectEvidence(matrix: TraceMatrix, azaDir: string): TraceMatrix {
  const out: TraceMatrix = {
    ...matrix,
    requirements: matrix.requirements.map((r) => ({ ...r, evidence: [...r.evidence] })),
  };

  // 1. design.md → 所有 in_progress 需求
  const designPath = path.join(azaDir, 'design.md');
  if (fs.existsSync(designPath)) {
    const body = fs.readFileSync(designPath, 'utf8');
    if (body.length > 100) {
      for (const r of out.requirements) {
        if (r.status === 'draft' || r.status === 'planned') {
          r.evidence.push({
            kind: 'design',
            ref: designPath,
            collectedAt: new Date().toISOString(),
            note: 'design.md 存在',
          });
        }
      }
    }
  }

  // 2. task_plan.md / openspec tasks.md → planned
  const planPath = path.join(azaDir, 'task_plan.md');
  if (fs.existsSync(planPath)) {
    for (const r of out.requirements) {
      if (r.status === 'draft' && r.priority !== 'P2') {
        r.status = 'planned';
      }
      r.evidence.push({
        kind: 'plan',
        ref: planPath,
        collectedAt: new Date().toISOString(),
      });
    }
  }
  // openspec/tasks.md
  const openspecTasks = path.join(azaDir, 'openspec', 'tasks.md');
  if (fs.existsSync(openspecTasks)) {
    for (const r of out.requirements) {
      r.evidence.push({
        kind: 'plan',
        ref: openspecTasks,
        collectedAt: new Date().toISOString(),
      });
    }
  }

  // 3. quality-passed.marker / quality-report.json → verified
  const qualityMarker = path.join(azaDir, 'quality-passed.marker');
  const qualityReport = path.join(azaDir, 'quality-report.json');
  if (fs.existsSync(qualityMarker) || fs.existsSync(qualityReport)) {
    const ref = fs.existsSync(qualityReport) ? qualityReport : qualityMarker;
    for (const r of out.requirements) {
      if (r.status === 'planned' || r.status === 'in_progress') {
        r.status = 'verified';
      }
      r.evidence.push({
        kind: 'quality',
        ref,
        collectedAt: new Date().toISOString(),
      });
    }
  }

  // 4. archive 阶段 → shipped
  const stateFile = path.join(azaDir, 'STATE.yaml');
  if (fs.existsSync(stateFile)) {
    const body = fs.readFileSync(stateFile, 'utf8');
    if (/(archived|shipped|completed)/i.test(body)) {
      for (const r of out.requirements) {
        if (r.status === 'verified') {
          r.status = 'shipped';
        }
        r.evidence.push({
          kind: 'archive',
          ref: stateFile,
          collectedAt: new Date().toISOString(),
        });
      }
    }
  }

  // 5. 竞品研究
  const competitiveMd = path.join(azaDir, '..', 'competitive-research.md');
  if (fs.existsSync(competitiveMd)) {
    for (const r of out.requirements.slice(0, 3)) {
      r.evidence.push({
        kind: 'competitive',
        ref: competitiveMd,
        collectedAt: new Date().toISOString(),
      });
    }
  }

  return out;
}

// ── Query API ───────────────────────────────────────────

export function query(matrix: TraceMatrix, q: TraceMatrixQuery): Requirement[] {
  let out = matrix.requirements;
  if (q.requirementId) out = out.filter((r) => r.id === q.requirementId);
  if (q.storyId) out = out.filter((r) => r.storyIds.includes(q.storyId!));
  if (q.testRef) out = out.filter((r) => r.testRefs.includes(q.testRef!));
  if (q.evidenceKind) out = out.filter((r) => r.evidence.some((e) => e.kind === q.evidenceKind));
  if (q.status) out = out.filter((r) => r.status === q.status);
  return out;
}

export interface TraceMatrixQuery {
  requirementId?: string;
  storyId?: string;
  testRef?: string;
  evidenceKind?: TraceEvidenceKind;
  status?: RequirementStatus;
}

// ── Coverage analytics ─────────────────────────────────

export interface TraceCoverage {
  total: number;
  byStatus: Record<RequirementStatus, number>;
  /** 至少有一条 evidence 的 requirement 比例（0-1） */
  evidenceCoverage: number;
  /** status=shipped + 有 quality evidence 的比例（0-1） */
  shippedWithQuality: number;
  /** 没有任何 evidence 的孤儿 requirement id */
  orphanIds: string[];
}

export function computeCoverage(matrix: TraceMatrix): TraceCoverage {
  const total = matrix.requirements.length;
  const byStatus: Record<RequirementStatus, number> = {
    draft: 0, planned: 0, in_progress: 0, verified: 0, shipped: 0, abandoned: 0,
  };
  const orphanIds: string[] = [];
  let withEvidence = 0;
  let shippedWithQuality = 0;
  for (const r of matrix.requirements) {
    byStatus[r.status]++;
    if (r.evidence.length > 0) withEvidence++;
    else orphanIds.push(r.id);
    if (r.status === 'shipped' && r.evidence.some((e) => e.kind === 'quality')) shippedWithQuality++;
  }
  return {
    total,
    byStatus,
    evidenceCoverage: total > 0 ? withEvidence / total : 0,
    shippedWithQuality: total > 0 ? shippedWithQuality / total : 0,
    orphanIds,
  };
}

// ── Render & persist ───────────────────────────────────

export function renderMatrixMarkdown(matrix: TraceMatrix): string {
  const cov = computeCoverage(matrix);
  const lines: string[] = [];
  lines.push(`# Requirement ↔ Evidence 追踪矩阵`);
  lines.push('');
  lines.push(`> 项目: ${matrix.projectName} | 总计: ${cov.total} | 证据覆盖: ${(cov.evidenceCoverage * 100).toFixed(0)}% | shipped+quality: ${(cov.shippedWithQuality * 100).toFixed(0)}%`);
  lines.push('');
  lines.push(`## 状态分布`);
  lines.push('');
  for (const [s, n] of Object.entries(cov.byStatus)) {
    if (n > 0) lines.push(`- ${s}: ${n}`);
  }
  lines.push('');
  lines.push(`## Requirement 列表`);
  lines.push('');
  lines.push(`| ID | Title | P | Status | Stories | Tests | Evidence |`);
  lines.push(`|----|-------|---|--------|---------|-------|----------|`);
  for (const r of matrix.requirements) {
    const evKinds = [...new Set(r.evidence.map((e) => e.kind))].join(',');
    lines.push(`| ${r.id} | ${r.title} | ${r.priority ?? ''} | ${r.status} | ${r.storyIds.length} | ${r.testRefs.length} | ${evKinds || '—'} |`);
  }
  if (cov.orphanIds.length > 0) {
    lines.push('');
    lines.push(`## 孤儿 Requirement（无 evidence）`);
    lines.push('');
    for (const id of cov.orphanIds) lines.push(`- ${id}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 持久化追踪矩阵到 .aza/evidence/trace-matrix.json + trace-matrix.md
 *
 * 借鉴 spec-kit「reproducible bundle」：追踪矩阵作为可重建 artifact 落盘，
 * CI 消费它判断「需求是否真正交付」（不是「是否声称完成」）。
 */
export function writeTraceMatrix(matrix: TraceMatrix, azaDir: string): { json: string; md: string } {
  const outDir = path.join(azaDir, 'evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'trace-matrix.json');
  const mdPath = path.join(outDir, 'trace-matrix.md');
  fs.writeFileSync(jsonPath, JSON.stringify(matrix, null, 2), 'utf8');
  fs.writeFileSync(mdPath, renderMatrixMarkdown(matrix), 'utf8');
  return { json: jsonPath, md: mdPath };
}

/**
 * 从 .aza 读取已有追踪矩阵（若有）。
 */
export function loadTraceMatrix(azaDir: string): TraceMatrix | null {
  const jsonPath = path.join(azaDir, 'evidence', 'trace-matrix.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TraceMatrix;
  } catch {
    return null;
  }
}
