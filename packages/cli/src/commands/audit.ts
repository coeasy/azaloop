import { LoopController, ConfigLoader } from '@azaloop/core';
import * as path from 'path';

export async function auditCommand(dir?: string): Promise<void> {
  const azaDir = dir || path.join(process.cwd(), '.aza');
  const projectRoot = path.dirname(azaDir);

  const loader = new ConfigLoader(projectRoot);
  const config = loader.loadSync();

  const lc = new LoopController({
    maxIterations: config.loop.max_iterations,
    maxStageIterations: config.loop.max_stage_iterations,
    enableV12: true,
    azaDir,
    projectRoot,
    config,
  });

  const result = await lc.audit();

  console.log('');
  console.log('  🔍 AzaLoop Audit Report (18 signals)');
  console.log('  ─────────────────────────────────────');
  console.log(`  Overall Score: ${result.score}/100`);
  console.log(`  Level:         ${result.level}`);
  console.log('');

  console.log('  Signal Results:');
  console.log('  ─────────────────────────────────────');
  for (const signal of result.signals) {
    const icon = signal.passed ? '✅' : '❌';
    console.log(`  ${icon} ${signal.id.padEnd(30)} [${signal.category}] ${signal.detail}`);
  }
  console.log('');

  if (result.recommendations.length > 0) {
    console.log('  Recommendations:');
    for (const rec of result.recommendations) {
      console.log(`  • ${rec}`);
    }
    console.log('');
  }

  // Level description
  const levelDesc: Record<string, string> = {
    L0: 'Bare minimum — critical infrastructure missing',
    L1: 'Basic — core loop operational',
    L2: 'Advanced — security + memory active',
    L3: 'Production-ready — all systems operational',
  };
  console.log(`  Level: ${result.level} — ${levelDesc[result.level] || 'Unknown'}`);
  console.log('');
}
