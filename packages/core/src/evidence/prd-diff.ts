/**
 * R10 第11轮 (P4 跨会话 PRD 增量) — PRD 增量 diff 复用。
 *
 * 借鉴 spec-kit「executable specification」+ planning-with-files「Stable Goals」+ comet「resume probe」：
 *
 * 痛点：每次会话都重新生成 PRD 浪费 token + 引入抖动。
 * 解法：保留上次 session 的 PRD，diff 出差异增量（goals/fr/AC 增删），
 *       作为 LLM 的「上次结论」喂回去，避免重复推理。
 *
 * 增量形式：
 *   - 保留：goal 仍存在（id-stable）
 *   - 新增：上次没有、本次新加
 *   - 删除：上次有、本次没了
 *   - 修改：title/description/priority 改变
 *
 * 落盘到 `.aza/evidence/prd-diff.json` + `.md` 供 CI/agent 消费。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PRD } from '@azaloop/shared';

export interface PrdDiffEntry {
  kind: 'kept' | 'added' | 'removed' | 'changed';
  id: string;
  field?: string;
  before?: string;
  after?: string;
}

export interface PrdDiff {
  schemaVersion: 1;
  generatedAt: string;
  basePrdId?: string;
  currentPrdId: string;
  summary: {
    goalsKept: number;
    goalsAdded: number;
    goalsRemoved: number;
    goalsChanged: number;
    frKept: number;
    frAdded: number;
    frRemoved: number;
    frChanged: number;
    acKept: number;
    acAdded: number;
    acRemoved: number;
    acChanged: number;
  };
  goals: PrdDiffEntry[];
  functionalRequirements: PrdDiffEntry[];
  acceptanceCriteria: PrdDiffEntry[];
}

function stableId(fr: { id: string } | undefined, fallbackIdx: number): string {
  return fr?.id ?? `anon-${fallbackIdx}`;
}

function diffStringArrays(
  prev: readonly string[] | undefined,
  curr: readonly string[] | undefined,
  idBase: string,
): { entries: PrdDiffEntry[]; kept: number; added: number; removed: number; changed: number } {
  const prevSet = new Set(prev ?? []);
  const currSet = new Set(curr ?? []);
  const entries: PrdDiffEntry[] = [];
  let kept = 0, added = 0, removed = 0, changed = 0;

  for (const x of prevSet) {
    if (currSet.has(x)) {
      entries.push({ kind: 'kept', id: `${idBase}::${x}` });
      kept++;
    } else {
      entries.push({ kind: 'removed', id: `${idBase}::${x}` });
      removed++;
    }
  }
  for (const x of currSet) {
    if (!prevSet.has(x)) {
      entries.push({ kind: 'added', id: `${idBase}::${x}` });
      added++;
    }
  }
  return { entries, kept, added, removed, changed };
}

function diffFr(prev: PRD['functional_requirements'] | undefined, curr: PRD['functional_requirements']): { entries: PrdDiffEntry[]; kept: number; added: number; removed: number; changed: number } {
  const prevMap = new Map<string, { description: string; priority: string }>();
  const currMap = new Map<string, { description: string; priority: string }>();
  (prev ?? []).forEach((fr, i) => prevMap.set(stableId(fr, i), { description: fr.description, priority: fr.priority ?? '' }));
  curr.forEach((fr, i) => currMap.set(stableId(fr, i), { description: fr.description, priority: fr.priority ?? '' }));

  const entries: PrdDiffEntry[] = [];
  let kept = 0, added = 0, removed = 0, changed = 0;
  for (const [id, before] of prevMap) {
    const after = currMap.get(id);
    if (!after) {
      entries.push({ kind: 'removed', id, before: before.description });
      removed++;
    } else if (after.description !== before.description || after.priority !== before.priority) {
      entries.push({ kind: 'changed', id, before: before.description, after: after.description, field: 'description/priority' });
      changed++;
    } else {
      entries.push({ kind: 'kept', id });
      kept++;
    }
  }
  for (const [id, after] of currMap) {
    if (!prevMap.has(id)) {
      entries.push({ kind: 'added', id, after: after.description });
      added++;
    }
  }
  return { entries, kept, added, removed, changed };
}

function diffAc(prev: PRD['acceptance_criteria'] | undefined, curr: PRD['acceptance_criteria']): { entries: PrdDiffEntry[]; kept: number; added: number; removed: number; changed: number } {
  const prevMap = new Map<string, string>();
  const currMap = new Map<string, string>();
  (prev ?? []).forEach((ac, i) => prevMap.set(stableId(ac, i), ac.description));
  curr.forEach((ac, i) => currMap.set(stableId(ac, i), ac.description));

  const entries: PrdDiffEntry[] = [];
  let kept = 0, added = 0, removed = 0, changed = 0;
  for (const [id, before] of prevMap) {
    const after = currMap.get(id);
    if (!after) { entries.push({ kind: 'removed', id, before }); removed++; }
    else if (after !== before) { entries.push({ kind: 'changed', id, before, after }); changed++; }
    else { entries.push({ kind: 'kept', id }); kept++; }
  }
  for (const [id, after] of currMap) {
    if (!prevMap.has(id)) { entries.push({ kind: 'added', id, after }); added++; }
  }
  return { entries, kept, added, removed, changed };
}

/**
 * 计算两次 PRD 之间的 diff。
 */
export function diffPrd(prev: PRD | null, curr: PRD): PrdDiff {
  const goals = diffStringArrays(prev?.goals, curr.goals, 'goal');
  const fr = diffFr(prev?.functional_requirements, curr.functional_requirements);
  const ac = diffAc(prev?.acceptance_criteria, curr.acceptance_criteria);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    basePrdId: prev?.id,
    currentPrdId: curr.id,
    summary: {
      goalsKept: goals.kept, goalsAdded: goals.added, goalsRemoved: goals.removed, goalsChanged: goals.changed,
      frKept: fr.kept, frAdded: fr.added, frRemoved: fr.removed, frChanged: fr.changed,
      acKept: ac.kept, acAdded: ac.added, acRemoved: ac.removed, acChanged: ac.changed,
    },
    goals: goals.entries,
    functionalRequirements: fr.entries,
    acceptanceCriteria: ac.entries,
  };
}

/**
 * 序列化为 LLM 友好的"上次结论"摘要，供后续 session 复用推理。
 */
export function diffToResumePrompt(diff: PrdDiff): string {
  const s = diff.summary;
  const lines: string[] = [];
  lines.push(`# 上次 PRD 结论摘要（diff vs current）`);
  lines.push('');
  lines.push(`## Goals: 保留 ${s.goalsKept} / 新增 ${s.goalsAdded} / 删除 ${s.goalsRemoved} / 修改 ${s.goalsChanged}`);
  lines.push(`## FR: 保留 ${s.frKept} / 新增 ${s.frAdded} / 删除 ${s.frRemoved} / 修改 ${s.frChanged}`);
  lines.push(`## AC: 保留 ${s.acKept} / 新增 ${s.acAdded} / 删除 ${s.acRemoved} / 修改 ${s.acChanged}`);
  lines.push('');

  const kept = diff.goals.filter((g) => g.kind === 'kept').map((g) => g.id.split('::')[1]);
  if (kept.length > 0) {
    lines.push('## 保留目标（不需重新论证）');
    for (const g of kept) lines.push(`- ${g}`);
    lines.push('');
  }
  const added = diff.goals.filter((g) => g.kind === 'added').map((g) => g.id.split('::')[1]);
  if (added.length > 0) {
    lines.push('## 新增目标（需重新论证）');
    for (const g of added) lines.push(`- ${g}`);
    lines.push('');
  }
  const removed = diff.goals.filter((g) => g.kind === 'removed').map((g) => g.id.split('::')[1]);
  if (removed.length > 0) {
    lines.push('## 删除目标（无需再答）');
    for (const g of removed) lines.push(`- ${g}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 从 .aza 读取上次 PRD。
 *
 * 优先级：prd.json (machine) > prd.md (legacy)。
 */
export function loadPreviousPrd(azaDir: string): PRD | null {
  const candidates = [
    path.join(azaDir, 'prd.json'),
    path.join(azaDir, 'prd.yaml'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const content = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(content) as PRD;
      if (parsed && parsed.id && Array.isArray(parsed.goals)) return parsed;
    } catch {
      /* skip corrupt */
    }
  }
  return null;
}

/**
 * 写 diff 到 .aza/evidence/prd-diff.json + prd-diff.md
 */
export function writePrdDiff(diff: PrdDiff, azaDir: string, resumePrompt?: string): { json: string; md: string } {
  const outDir = path.join(azaDir, 'evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'prd-diff.json');
  fs.writeFileSync(jsonPath, JSON.stringify(diff, null, 2), 'utf8');
  const md = [
    `# PRD 增量 Diff`,
    ``,
    `> 基线: ${diff.basePrdId ?? 'none'} | 当前: ${diff.currentPrdId} | 时间: ${diff.generatedAt}`,
    ``,
    `## Summary`,
    ``,
    `| 维度 | 保留 | 新增 | 删除 | 修改 |`,
    `|------|------|------|------|------|`,
    `| Goals | ${diff.summary.goalsKept} | ${diff.summary.goalsAdded} | ${diff.summary.goalsRemoved} | ${diff.summary.goalsChanged} |`,
    `| FR | ${diff.summary.frKept} | ${diff.summary.frAdded} | ${diff.summary.frRemoved} | ${diff.summary.frChanged} |`,
    `| AC | ${diff.summary.acKept} | ${diff.summary.acAdded} | ${diff.summary.acRemoved} | ${diff.summary.acChanged} |`,
    ``,
    resumePrompt ? `## Resume Prompt\n\n\`\`\`\n${resumePrompt}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');
  const mdPath = path.join(outDir, 'prd-diff.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  return { json: jsonPath, md: mdPath };
}
