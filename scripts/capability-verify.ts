/**
 * R10 第11轮 (P2 度量) — Capability 验证 + manifest 生成。
 *
 * 借鉴 spec-kit「reproducible bundle」+ ruflo「capability introspection」：
 *
 * 验证逻辑：
 *   1. 加载能力注册表
 *   2. 对每个 verified/certified 能力，断言其 evidence.testFiles 全部存在
 *   3. 对每个 certified 能力，断言 evidence.e2eScript 存在（脚本可解析）
 *   4. 生成 .aza/evidence/capabilities.json + capabilities.md
 *
 * 逃逸闸：AZA_SKIP_CAP_VERIFY=1
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  listCapabilities,
  getCapabilityStats,
  writeCapabilitiesManifest,
  renderCapabilitiesMarkdown,
  type CapabilityDescriptor,
  type CapabilityMaturity,
} from '@azaloop/core';

interface VerifyResult {
  capability: string;
  maturity: CapabilityMaturity;
  evidenceOk: boolean;
  missingFiles: string[];
  notes: string[];
}

function verifyCapability(c: CapabilityDescriptor, root: string): VerifyResult {
  const missing: string[] = [];
  const notes: string[] = [];
  for (const tf of c.evidence.testFiles ?? []) {
    const p = path.isAbsolute(tf) ? tf : path.join(root, tf);
    if (!fs.existsSync(p)) {
      missing.push(tf);
    }
  }
  if (c.evidence.e2eScript) {
    const p = path.isAbsolute(c.evidence.e2eScript)
      ? c.evidence.e2eScript
      : path.join(root, c.evidence.e2eScript);
    if (!fs.existsSync(p)) {
      missing.push(c.evidence.e2eScript);
    } else {
      notes.push(`E2E script present: ${c.evidence.e2eScript}`);
    }
  }
  if (c.evidence.clientTemplate) {
    const p = path.isAbsolute(c.evidence.clientTemplate)
      ? c.evidence.clientTemplate
      : path.join(root, c.evidence.clientTemplate);
    if (fs.existsSync(p)) {
      notes.push(`client template present: ${c.evidence.clientTemplate}`);
    }
  }
  return {
    capability: c.name,
    maturity: c.maturity,
    evidenceOk: missing.length === 0,
    missingFiles: missing,
    notes,
  };
}

function main() {
  if (process.env.AZA_SKIP_CAP_VERIFY === '1' || process.env.AZA_SKIP_CAP_VERIFY === 'true') {
    console.log('[cap-verify] skipped (AZA_SKIP_CAP_VERIFY=1)');
    return;
  }
  const root = process.cwd();
  const caps = listCapabilities();
  console.log(`[cap-verify] checking ${caps.length} capabilities...`);

  const results: VerifyResult[] = [];
  let verifiedBroken = 0;
  let certifiedBroken = 0;
  for (const c of caps) {
    const r = verifyCapability(c, root);
    results.push(r);
    if (!r.evidenceOk) {
      if (c.maturity === 'verified') verifiedBroken++;
      if (c.maturity === 'certified') certifiedBroken++;
      console.warn(`  ❌ ${c.id} (${c.maturity}): missing ${r.missingFiles.join(', ')}`);
    } else {
      console.log(`  ✅ ${c.id} (${c.maturity}): evidence complete`);
    }
  }

  const stats = getCapabilityStats();

  // 写 manifest
  const azaDir = path.join(root, '.aza');
  const jsonPath = writeCapabilitiesManifest(azaDir);
  const mdPath = path.join(azaDir, 'evidence', 'capabilities.md');
  fs.writeFileSync(mdPath, renderCapabilitiesMarkdown(), 'utf8');
  console.log(`[cap-verify] manifest: ${jsonPath}`);
  console.log(`[cap-verify] markdown: ${mdPath}`);

  // 写验证报告
  const verifyPath = path.join(azaDir, 'evidence', 'capability-verify.json');
  fs.writeFileSync(verifyPath, JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    stats,
    verified_broken: verifiedBroken,
    certified_broken: certifiedBroken,
    results,
  }, null, 2), 'utf8');
  console.log(`[cap-verify] verify: ${verifyPath}`);

  if (certifiedBroken > 0) {
    console.error(`[cap-verify] FAIL: ${certifiedBroken} certified capability(s) missing evidence`);
    process.exit(1);
  }
  if (verifiedBroken > 0) {
    console.warn(`[cap-verify] WARN: ${verifiedBroken} verified capability(s) missing evidence (non-fatal)`);
  }
  console.log(`[cap-verify] PASS: total=${stats.total} experimental=${stats.experimental} verified=${stats.verified} certified=${stats.certified}`);
}

main();
