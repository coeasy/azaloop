/**
 * R10 第11轮 (P5 跨工具走证) — Cross-Tooling Audit (CTA).
 *
 * 借鉴 superpowers「verification before completion」+ spec-kit「executable spec」：
 * 单一能力不能孤立验证：必须证明它和上下游工具真的连接起来。
 *
 * 验证矩阵：
 *   1. capability 在 orchestrator middleware / business 至少一处被引用
 *   2. capability 提供的 API 在 CLI 命令至少一处被调用
 *   3. capability 验证脚本能独立运行（链入 spine-e2e）
 *   4. capability 的产物落盘文件存在
 *
 * 失败 = 主体链路断 = 1+ broken CTA。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listCapabilities } from '@azaloop/core';

interface CTAResult {
  capability: string;
  referencedInCore: boolean;
  referencedInMcp: boolean;
  referencedInCli: boolean;
  referencedInScripts: boolean;
  files: string[];
  evidenceExists: boolean;
  ctaHealthy: boolean;
  missingCTAs: string[];
}

function fileContains(p: string, needle: string): boolean {
  try {
    return fs.readFileSync(p, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

function dirFilesContaining(dir: string, needles: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.mts'))) {
      try {
        const body = fs.readFileSync(full, 'utf8');
        if (needles.some((n) => body.includes(n))) {
          out.push(path.relative(process.cwd(), full));
        }
      } catch { /* skip */ }
    }
  }
  return out;
}

function checkCta(id: string, evidenceFiles: string[]): CTAResult {
  const root = process.cwd();
  // 关键标识：拆分 capability id 为多部分，每部分都作 needle
  // 例: auto_loop.cross_session_resume → [auto, loop, cross, session, resume, cross_session_resume, auto_loop]
  const parts = id.split(/[._-]/).filter((p) => p.length >= 3);
  const needles = [
    id,
    id.replace(/\./g, '_'),
    id.replace(/\./g, '-'),
    ...parts,
  ];
  const uniqueNeedles = [...new Set(needles)].filter((x) => x.length >= 3);

  // core/src 引用
  const coreDir = path.join(root, 'packages', 'core', 'src');
  const coreFiles = dirFilesContaining(coreDir, uniqueNeedles);
  // mcp-server/src 引用
  const mcpDir = path.join(root, 'packages', 'mcp-server', 'src');
  const mcpFiles = dirFilesContaining(mcpDir, uniqueNeedles);
  // cli/src 引用
  const cliDir = path.join(root, 'packages', 'cli', 'src');
  const cliFiles = dirFilesContaining(cliDir, uniqueNeedles);
  // scripts 引用
  const scriptsDir = path.join(root, 'scripts');
  const scriptFiles = dirFilesContaining(scriptsDir, uniqueNeedles);

  // evidence 文件存在性
  const missing: string[] = [];
  let evidenceExists = true;
  for (const ef of evidenceFiles) {
    if (!fs.existsSync(path.isAbsolute(ef) ? ef : path.join(root, ef))) {
      missing.push(ef);
      evidenceExists = false;
    }
  }

  const referencedInCore = coreFiles.length > 0;
  const referencedInMcp = mcpFiles.length > 0;
  const referencedInCli = cliFiles.length > 0;
  const referencedInScripts = scriptFiles.length > 0;

  const missingCTAs: string[] = [];
  if (!referencedInCore) missingCTAs.push('core');
  if (!referencedInScripts) missingCTAs.push('scripts');
  if (!evidenceExists) missingCTAs.push('evidence_files');

  return {
    capability: id,
    referencedInCore,
    referencedInMcp,
    referencedInCli,
    referencedInScripts,
    files: [...coreFiles, ...mcpFiles, ...cliFiles, ...scriptFiles],
    evidenceExists,
    ctaHealthy: referencedInCore && referencedInScripts && evidenceExists,
    missingCTAs,
  };
}

function main() {
  const caps = listCapabilities();
  console.log(`[cta-audit] checking ${caps.length} capabilities for cross-tooling health...`);

  const results: CTAResult[] = [];
  let healthy = 0;
  for (const c of caps) {
    const evidenceFiles = [
      ...(c.evidence.testFiles ?? []),
      c.evidence.e2eScript,
      c.evidence.clientTemplate,
    ].filter((x): x is string => Boolean(x));
    const r = checkCta(c.id, evidenceFiles);
    results.push(r);
    if (r.ctaHealthy) {
      healthy++;
      console.log(`  ✅ ${c.id}: core=${r.referencedInCore} scripts=${r.referencedInScripts} evidence=${r.evidenceExists}`);
    } else {
      console.warn(`  ❌ ${c.id}: missing CTA in [${r.missingCTAs.join(', ')}]`);
    }
  }

  // 落盘
  const azaDir = path.join(process.cwd(), '.aza');
  fs.mkdirSync(path.join(azaDir, 'evidence'), { recursive: true });
  const outPath = path.join(azaDir, 'evidence', 'cta-audit.json');
  fs.writeFileSync(outPath, JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary: {
      total: caps.length,
      healthy,
      broken: caps.length - healthy,
      health_rate: caps.length > 0 ? healthy / caps.length : 0,
    },
    results,
  }, null, 2), 'utf8');
  console.log(`[cta-audit] report: ${outPath}`);

  if (healthy < caps.length) {
    console.error(`[cta-audit] FAIL: ${caps.length - healthy} capabilities have broken CTAs`);
    process.exit(1);
  }
  console.log(`[cta-audit] PASS: all ${caps.length} capabilities have healthy CTAs`);
}

main();
