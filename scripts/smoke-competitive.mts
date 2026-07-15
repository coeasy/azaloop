import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCompetitiveResearch,
  writePrdMarkdown,
  PRDGenerator,
} from '../packages/core/dist/index.js';

const azaDir = mkdtempSync(join(tmpdir(), 'aza-smoke-'));
const title = 'AI coding agent with PRD gate';
const description = 'Build an autonomous loop that writes PRDs, searches competitors, and ships.';

async function main() {
  // 1) L2 → live (or fallback). Must not throw, must return competitors.
  const r = await runCompetitiveResearch(azaDir, title, description, { complexity: 'L2' });
  if (!r.research || r.research.competitors.length === 0) {
    throw new Error('FAIL: runCompetitiveResearch returned no competitors');
  }
  console.log(`[L2] source=${r.research.source} count=${r.research.competitors.length} cached=${r.fromCache} mode=${r.mode}`);

  // 2) Second call must hit cache (no network).
  const r2 = await runCompetitiveResearch(azaDir, title, description, { complexity: 'L2' });
  if (!r2.fromCache) throw new Error('FAIL: second call did not use cache');
  console.log(`[cache] fromCache=${r2.fromCache}`);

  // 3) L1 → curated pool, offline, no network.
  const r3 = await runCompetitiveResearch(azaDir, title, description, { complexity: 'L1' });
  console.log(`[L1] source=${r3.research?.source} count=${r3.research?.competitors.length}`);

  // 4) Mode 'off' → skipped, null research.
  process.env.AZA_COMPETITOR_RESEARCH = 'off';
  const r4 = await runCompetitiveResearch(azaDir, title, description, { complexity: 'L2' });
  if (!r4.skipped || r4.research !== null) throw new Error('FAIL: mode=off should skip');
  console.log(`[off] skipped=${r4.skipped}`);
  delete process.env.AZA_COMPETITOR_RESEARCH;

  // 5) writePrdMarkdown must include a visible "## Competitive Research" section.
  const gen = new PRDGenerator();
  const prd = gen.generate({ title, description }, { enable_self_optimization: false });
  const out = writePrdMarkdown(azaDir, prd as any, r.research);
  const md = (await import('node:fs')).readFileSync(out, 'utf8');
  if (!/# ## Competitive Research/.test(md) && !/## Competitive Research/.test(md)) {
    throw new Error('FAIL: prd.md missing Competitive Research section');
  }
  console.log(`[prd.md] has Competitive Research section: ${/## Competitive Research/.test(md)}`);

  console.log('\nALL SMOKE CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
