/**
 * R10 第11轮 (P4 状态查看) — aza status 一键全息。
 *
 * 借鉴 spec-kit「status / progress」+ 通用 ops command 模式：
 * 把 .aza/ 关键状态、capability 进度、trace matrix 覆盖率、HNSW 索引指标
 * 整合为一个命令，运维 / CI / 用户一眼看清当前项目状态。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCapabilityStats, listCapabilities } from '@azaloop/core';

export interface StatusReport {
  azaDir: string;
  files: {
    stateYaml: boolean;
    resumeMd: boolean;
    prdJson: boolean;
    prdDiff: boolean;
    traceMatrix: boolean;
    capabilities: boolean;
    qualityPassed: boolean;
    openspecChanges: number;
  };
  capability: ReturnType<typeof getCapabilityStats>;
  traceMatrix: {
    total: number;
    evidenceCoverage: number;
    shippedWithQuality: number;
    orphanCount: number;
  } | null;
  vectorStore: {
    size: number;
    insertCount: number;
    searchCount: number;
    avgHitRate: number;
    bruteForce: boolean;
  } | null;
  summary: {
    health: 'green' | 'yellow' | 'red';
    notes: string[];
  };
}

function safeReadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function gatherStatus(root: string = process.cwd()): StatusReport {
  const azaDir = path.join(root, '.aza');
  const files = {
    stateYaml: fs.existsSync(path.join(azaDir, 'STATE.yaml')),
    resumeMd: fs.existsSync(path.join(azaDir, 'RESUME.md')),
    prdJson: fs.existsSync(path.join(azaDir, 'prd.json')),
    prdDiff: fs.existsSync(path.join(azaDir, 'evidence', 'prd-diff.json')),
    traceMatrix: fs.existsSync(path.join(azaDir, 'evidence', 'trace-matrix.json')),
    capabilities: fs.existsSync(path.join(azaDir, 'evidence', 'capabilities.json')),
    qualityPassed: fs.existsSync(path.join(azaDir, 'quality-passed.marker')),
    openspecChanges: (() => {
      const changesDir = path.join(azaDir, 'openspec', 'changes');
      if (!fs.existsSync(changesDir)) return 0;
      try {
        return fs.readdirSync(changesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
      } catch { return 0; }
    })(),
  };
  const capability = getCapabilityStats();
  const tmRaw = safeReadJson<{ requirements: Array<{ id: string; status: string; evidence: unknown[] }> }>(path.join(azaDir, 'evidence', 'trace-matrix.json'));
  let traceMatrix: StatusReport['traceMatrix'] = null;
  if (tmRaw && Array.isArray(tmRaw.requirements)) {
    const total = tmRaw.requirements.length;
    const withEvidence = tmRaw.requirements.filter((r) => Array.isArray(r.evidence) && r.evidence.length > 0).length;
    const shippedWithQuality = tmRaw.requirements.filter((r) => r.status === 'shipped' && Array.isArray(r.evidence) && r.evidence.some((e) => (e as { kind?: string })?.kind === 'quality')).length;
    const orphanCount = total - withEvidence;
    traceMatrix = {
      total,
      evidenceCoverage: total > 0 ? withEvidence / total : 0,
      shippedWithQuality: total > 0 ? shippedWithQuality / total : 0,
      orphanCount,
    };
  }
  let vectorStore: StatusReport['vectorStore'] = null;
  const vsPath = path.join(azaDir, 'stores', 'vectors', 'index.json');
  if (fs.existsSync(vsPath)) {
    try {
      const vs = JSON.parse(fs.readFileSync(vsPath, 'utf8')) as { entries?: unknown[] };
      vectorStore = {
        size: Array.isArray(vs.entries) ? vs.entries.length : 0,
        insertCount: 0,
        searchCount: 0,
        avgHitRate: 0,
        bruteForce: false,
      };
    } catch { /* ignore */ }
  }

  // Health heuristics
  const notes: string[] = [];
  let health: 'green' | 'yellow' | 'red' = 'green';
  if (!files.stateYaml) { notes.push('STATE.yaml missing — run `aza init`'); health = 'red'; }
  if (files.stateYaml && !files.resumeMd) { notes.push('RESUME.md missing — loop not in resumeable state'); if (health === 'green') health = 'yellow'; }
  if (capability.certifiedE2eCoverage < 1.0) { notes.push(`certified e2e coverage ${(capability.certifiedE2eCoverage * 100).toFixed(0)}% < 100%`); if (health !== 'red') health = 'yellow'; }
  if (traceMatrix && traceMatrix.orphanCount > traceMatrix.total * 0.3) { notes.push(`trace orphan ratio > 30% (${traceMatrix.orphanCount}/${traceMatrix.total})`); if (health === 'green') health = 'yellow'; }
  if (notes.length === 0) notes.push('all systems nominal');

  return { azaDir, files, capability, traceMatrix, vectorStore, summary: { health, notes } };
}

function formatStatus(r: StatusReport): string {
  const lines: string[] = [];
  const f = r.files;
  lines.push(`# AzaLoop Status (${r.azaDir})`);
  lines.push('');
  const icon = r.summary.health === 'green' ? '🟢' : r.summary.health === 'yellow' ? '🟡' : '🔴';
  lines.push(`${icon} Health: ${r.summary.health.toUpperCase()}`);
  for (const n of r.summary.notes) lines.push(`  - ${n}`);
  lines.push('');
  lines.push(`## Files`);
  lines.push(`- STATE.yaml: ${f.stateYaml ? '✅' : '❌'}`);
  lines.push(`- RESUME.md: ${f.resumeMd ? '✅' : '❌'}`);
  lines.push(`- prd.json: ${f.prdJson ? '✅' : '❌'}`);
  lines.push(`- prd-diff: ${f.prdDiff ? '✅' : '❌'}`);
  lines.push(`- trace-matrix: ${f.traceMatrix ? '✅' : '❌'}`);
  lines.push(`- capabilities: ${f.capabilities ? '✅' : '❌'}`);
  lines.push(`- quality-passed: ${f.qualityPassed ? '✅' : '❌'}`);
  lines.push(`- openspec changes: ${f.openspecChanges}`);
  lines.push('');
  lines.push(`## Capability`);
  const c = r.capability;
  lines.push(`- total: ${c.total}`);
  lines.push(`- experimental: ${c.experimental}`);
  lines.push(`- verified: ${c.verified}`);
  lines.push(`- certified: ${c.certified}`);
  lines.push(`- verified evidence coverage: ${(c.verifiedEvidenceCoverage * 100).toFixed(0)}%`);
  lines.push(`- certified e2e coverage: ${(c.certifiedE2eCoverage * 100).toFixed(0)}%`);
  lines.push('');
  if (r.traceMatrix) {
    const t = r.traceMatrix;
    lines.push(`## Trace Matrix`);
    lines.push(`- total: ${t.total}`);
    lines.push(`- evidence coverage: ${(t.evidenceCoverage * 100).toFixed(0)}%`);
    lines.push(`- shipped+quality: ${(t.shippedWithQuality * 100).toFixed(0)}%`);
    lines.push(`- orphan count: ${t.orphanCount}`);
    lines.push('');
  }
  if (r.vectorStore) {
    const v = r.vectorStore;
    lines.push(`## Vector Store`);
    lines.push(`- size: ${v.size}`);
    lines.push(`- brute force: ${v.bruteForce ? 'yes' : 'no'}`);
    lines.push('');
  }
  lines.push(`## Capabilities (${listCapabilities().length})`);
  for (const c of listCapabilities()) {
    lines.push(`- ${c.maturity.padEnd(12)} ${c.name}`);
  }
  return lines.join('\n') + '\n';
}

export async function statusCommand(opts: { root?: string; json?: boolean; report?: boolean } = {}): Promise<number> {
  const root = opts.root ?? process.cwd();
  const r = gatherStatus(root);

  if (opts.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    process.stdout.write(formatStatus(r));
  }

  if (opts.report) {
    const outDir = path.join(r.azaDir, 'evidence');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify(r, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'status.md'), formatStatus(r), 'utf8');
  }

  return r.summary.health === 'red' ? 2 : r.summary.health === 'yellow' ? 1 : 0;
}
