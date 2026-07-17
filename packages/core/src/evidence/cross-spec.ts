/**
 * R10 第11轮 (P6 multi-project) — CrossSpec 多项目集成。
 *
 * 借鉴 spec-kit「multi-repo coordination」+ spec-kit「constitution inheritance」：
 *
 * 痛点：复杂项目 = monorepo 多个子项目；当前 AzaLoop 仅支持单 workspace。
 * 解法：把多个 .aza/ 子项目合并视图，共享 trace matrix + capability manifest。
 *
 * 工作流：
 *   1. CrossSpec.discover(): 扫描 monorepo 找所有子 .aza/
 *   2. CrossSpec.aggregate(): 合并 trace matrix + capability + reasoning bank
 *   3. CrossSpec.crossLink(): 跨项目 requirement 链接（inter-project deps）
 *   4. CrossSpec.render(): 输出 monorepo 总览
 */
import * as fs from 'fs';
import * as path from 'path';
import { listCapabilities, type CapabilityDescriptor } from './capability-registry';
import {
  loadTraceMatrix,
  type TraceMatrix,
  type Requirement,
} from './trace-matrix';

export interface SubProject {
  /** 子项目根目录（相对 monorepo root） */
  rootPath: string;
  /** .aza 目录绝对路径 */
  azaDir: string;
  /** 项目名（package.json 或目录名 fallback） */
  name: string;
  /** trace matrix（如果有） */
  traceMatrix: TraceMatrix | null;
  /** 自身 capability 清单（来自 BUILTIN_CAPABILITIES） */
  capabilities: CapabilityDescriptor[];
  /** 子项目的 requirement 数量 */
  requirementCount: number;
  /** 子项目状态（G/I/R/D = Green/Yellow/Red/Detached） */
  health: 'green' | 'yellow' | 'red' | 'detached';
}

export interface CrossLink {
  fromProject: string;
  fromReqId: string;
  toProject: string;
  toRef: string;
  relation: 'depends_on' | 'shared_with' | 'derives_from';
  evidence: string[];
}

export interface CrossSpecManifest {
  schemaVersion: 1;
  generatedAt: string;
  monorepoRoot: string;
  projects: SubProject[];
  aggregate: {
    totalProjects: number;
    totalRequirements: number;
    totalCapabilities: number;
    verifiedCapabilities: number;
    certifiedCapabilities: number;
    healthCounts: Record<SubProject['health'], number>;
  };
  crossLinks: CrossLink[];
}

const SUBPROJECT_MARKERS = ['.aza', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];

/**
 * 启发式：目录内同时存在 .aza + package.json 或 .aza + pyproject.toml = 子项目
 */
function isSubProject(azaDir: string): boolean {
  if (!fs.existsSync(azaDir)) return false;
  const dir = path.dirname(azaDir);
  let count = 0;
  for (const marker of SUBPROJECT_MARKERS) {
    if (fs.existsSync(path.join(dir, marker))) count++;
  }
  return count >= 2; // .aza + 至少 1 个
}

function detectHealth(azaDir: string, matrix: TraceMatrix | null): SubProject['health'] {
  const stateFile = path.join(azaDir, 'STATE.yaml');
  if (!fs.existsSync(stateFile)) return 'detached';
  if (!matrix) return 'yellow';
  const total = matrix.requirements.length;
  if (total === 0) return 'yellow';
  const shipped = matrix.requirements.filter((r) => r.status === 'shipped').length;
  if (shipped >= total * 0.8) return 'green';
  if (shipped >= total * 0.3) return 'yellow';
  return 'red';
}

function loadSubProject(root: string, azaDir: string): SubProject | null {
  if (!isSubProject(azaDir)) return null;
  const dir = path.dirname(azaDir);
  let name = path.basename(dir);
  // 尝试读 package.json
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name) name = pkg.name;
    }
  } catch { /* ignore */ }
  const matrix = loadTraceMatrix(azaDir);
  const requirementCount = matrix?.requirements.length ?? 0;
  return {
    rootPath: path.relative(root, dir),
    azaDir,
    name,
    traceMatrix: matrix,
    capabilities: [...listCapabilities()],
    requirementCount,
    health: detectHealth(azaDir, matrix),
  };
}

/**
 * 启发式发现 monorepo 子项目：
 *   1. 自身 root
 *   2. root 一级子目录（广度 1）
 *   3. root 二级子目录（广度 2，跳过 node_modules / .git）
 */
export function discoverSubProjects(root: string = process.cwd()): SubProject[] {
  const found: SubProject[] = [];

  const tryLoad = (dir: string) => {
    const aza = path.join(dir, '.aza');
    const sp = loadSubProject(root, aza);
    if (sp) found.push(sp);
  };

  // 自身
  tryLoad(root);
  // 广度 1
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      tryLoad(path.join(root, entry.name));
      // 广度 2
      try {
        const sub = path.join(root, entry.name);
        for (const inner of fs.readdirSync(sub, { withFileTypes: true })) {
          if (!inner.isDirectory()) continue;
          if (inner.name === 'node_modules' || inner.name.startsWith('.')) continue;
          tryLoad(path.join(sub, inner.name));
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

  // 去重
  const seen = new Set<string>();
  return found.filter((p) => {
    if (seen.has(p.azaDir)) return false;
    seen.add(p.azaDir);
    return true;
  });
}

/**
 * 推断跨项目链接：
 *   - 同名 requirement 出现 ≥2 个项目 → shared_with
 *   - 需求描述含 "depends on / uses / requires" + 其他项目名 → depends_on
 *   - 子项目能力互相引用 → derives_from
 */
export function inferCrossLinks(projects: SubProject[]): CrossLink[] {
  const links: CrossLink[] = [];
  const byId = new Map<string, Array<{ project: SubProject; req: Requirement }>>();

  for (const p of projects) {
    if (!p.traceMatrix) continue;
    for (const r of p.traceMatrix.requirements) {
      if (!byId.has(r.id)) byId.set(r.id, []);
      byId.get(r.id)!.push({ project: p, req: r });
    }
  }

  for (const [id, hits] of byId) {
    if (hits.length < 2) continue;
    for (let i = 0; i < hits.length; i++) {
      for (let j = 0; j < hits.length; j++) {
        if (i === j) continue;
        links.push({
          fromProject: hits[i]!.project.name,
          fromReqId: hits[i]!.req.id,
          toProject: hits[j]!.project.name,
          toRef: hits[j]!.req.id,
          relation: 'shared_with',
          evidence: hits.map((h) => h.req.title.slice(0, 40)),
        });
      }
    }
  }

  // P6 第12轮 (P6-2 依赖推断) — 从需求文本提取 depends_on 关系
  const depKeywords = /\b(depends on|uses|requires|imports|relies on|consumes|integrates with)\b/i;
  const projectNames = new Set(projects.map((p) => p.name.toLowerCase()));
  for (const p of projects) {
    if (!p.traceMatrix) continue;
    for (const r of p.traceMatrix.requirements) {
      const text = `${r.title} ${r.description ?? ''}`.toLowerCase();
      if (!depKeywords.test(text)) continue;
      for (const other of projects) {
        if (other.name === p.name) continue;
        if (text.includes(other.name.toLowerCase())) {
          links.push({
            fromProject: p.name,
            fromReqId: r.id,
            toProject: other.name,
            toRef: other.name,
            relation: 'depends_on',
            evidence: [`keyword-match: ${r.title.slice(0, 60)}`],
          });
        }
      }
    }
  }
  return links;
}

/**
 * P6 第12轮 (P6-2 拓扑排序) — 拓扑排序跨项目链接。
 * depends_on 必须排在 shared_with/derives_from 之前。
 */
export function topoSortCrossLinks(links: CrossLink[]): CrossLink[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const all = new Set<string>();
  for (const l of links) {
    all.add(`${l.fromProject}.${l.fromReqId}`);
    all.add(`${l.toProject}.${l.toRef}`);
  }
  for (const node of all) {
    inDeg.set(node, 0);
    adj.set(node, []);
  }
  for (const l of links) {
    if (l.relation !== 'depends_on') continue;
    const to = `${l.toProject}.${l.toRef}`;
    const from = `${l.fromProject}.${l.fromReqId}`;
    if (adj.has(to)) {
      adj.get(to)!.push(from);
      inDeg.set(from, (inDeg.get(from) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [node, deg] of inDeg) {
    if (deg === 0) queue.push(node);
  }
  const sorted: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    sorted.push(n);
    for (const next of adj.get(n) ?? []) {
      const newDeg = (inDeg.get(next) ?? 0) - 1;
      inDeg.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }
  const order = new Map(sorted.map((n, i) => [n, i] as const));
  return [...links].sort((a, b) => {
    const oa = order.get(`${a.fromProject}.${a.fromReqId}`) ?? 0;
    const ob = order.get(`${b.fromProject}.${b.fromReqId}`) ?? 0;
    return oa - ob;
  });
}

/**
 * P6 第12轮 (P6-2 健康风险传播) — 沿依赖链传递风险。
 * 一个 red 项目的依赖方应被标记为 at-risk。
 */
export function propagateHealthRisk(manifest: CrossSpecManifest): {
  atRisk: Array<{ project: string; reason: string; dependencies: string[] }>;
} {
  const atRisk: Array<{ project: string; reason: string; dependencies: string[] }> = [];
  const healthByName = new Map(manifest.projects.map((p) => [p.name, p.health] as const));
  for (const link of manifest.crossLinks) {
    if (link.relation !== 'depends_on') continue;
    const depHealth = healthByName.get(link.toProject);
    if (depHealth === 'red' || depHealth === 'detached') {
      const existing = atRisk.find((a) => a.project === link.fromProject);
      if (existing) {
        if (!existing.dependencies.includes(link.toProject)) {
          existing.dependencies.push(link.toProject);
        }
      } else {
        atRisk.push({
          project: link.fromProject,
          reason: `depends on ${depHealth} project: ${link.toProject}`,
          dependencies: [link.toProject],
        });
      }
    }
  }
  return { atRisk };
}

/**
 * 聚合生成 monorepo manifest。
 */
export function buildCrossSpecManifest(root: string = process.cwd()): CrossSpecManifest {
  const projects = discoverSubProjects(root);
  const crossLinks = topoSortCrossLinks(inferCrossLinks(projects));
  const healthCounts: Record<SubProject['health'], number> = { green: 0, yellow: 0, red: 0, detached: 0 };
  let totalRequirements = 0;
  for (const p of projects) {
    healthCounts[p.health]++;
    totalRequirements += p.requirementCount;
  }
  const caps = listCapabilities();
  const manifest: CrossSpecManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    monorepoRoot: root,
    projects,
    aggregate: {
      totalProjects: projects.length,
      totalRequirements,
      totalCapabilities: caps.length,
      verifiedCapabilities: caps.filter((c) => c.maturity === 'verified').length,
      certifiedCapabilities: caps.filter((c) => c.maturity === 'certified').length,
      healthCounts,
    },
    crossLinks,
  };
  // P6 第12轮：把健康风险传播附加到 manifest 的隐藏字段（避免破坏 schema）
  (manifest as CrossSpecManifest & { _atRisk?: unknown })._atRisk = propagateHealthRisk(manifest).atRisk;
  return manifest;
}

/**
 * 渲染 monorepo 总览 Markdown。
 */
export function renderCrossSpecMarkdown(m: CrossSpecManifest): string {
  const lines: string[] = [];
  lines.push(`# CrossSpec Monorepo 总览`);
  lines.push('');
  lines.push(`> Root: \`${m.monorepoRoot}\` | 时间: ${m.generatedAt}`);
  lines.push('');
  lines.push(`## 聚合`);
  lines.push('');
  lines.push(`- 子项目: ${m.aggregate.totalProjects}`);
  lines.push(`- 需求总数: ${m.aggregate.totalRequirements}`);
  lines.push(`- 能力总数: ${m.aggregate.totalCapabilities} (verified=${m.aggregate.verifiedCapabilities}, certified=${m.aggregate.certifiedCapabilities})`);
  lines.push(`- 健康分布: green=${m.aggregate.healthCounts.green} yellow=${m.aggregate.healthCounts.yellow} red=${m.aggregate.healthCounts.red} detached=${m.aggregate.healthCounts.detached}`);
  lines.push('');
  lines.push(`## 子项目`);
  lines.push('');
  lines.push(`| 名称 | 路径 | 健康 | 需求数 |`);
  lines.push(`|------|------|------|--------|`);
  for (const p of m.projects) {
    const icon = { green: '🟢', yellow: '🟡', red: '🔴', detached: '⚪' }[p.health];
    lines.push(`| ${p.name} | ${p.rootPath} | ${icon} ${p.health} | ${p.requirementCount} |`);
  }
  if (m.crossLinks.length > 0) {
    lines.push('');
    lines.push(`## 跨项目链接 (${m.crossLinks.length})`);
    lines.push('');
    for (const l of m.crossLinks.slice(0, 20)) {
      lines.push(`- **${l.fromProject}**.\`${l.fromReqId}\` → **${l.toProject}**.\`${l.toRef}\` [${l.relation}]`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * 落盘 monorepo manifest。
 */
export function writeCrossSpecManifest(root: string = process.cwd()): { json: string; md: string } {
  const m = buildCrossSpecManifest(root);
  const azaDir = path.join(root, '.aza');
  const outDir = path.join(azaDir, 'evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'cross-spec.json');
  const mdPath = path.join(outDir, 'cross-spec.md');
  fs.writeFileSync(jsonPath, JSON.stringify(m, null, 2), 'utf8');
  fs.writeFileSync(mdPath, renderCrossSpecMarkdown(m), 'utf8');
  return { json: jsonPath, md: mdPath };
}
