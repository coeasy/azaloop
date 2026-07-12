/**
 * Quality-Gated Loop Demo
 *
 * Each stage loops internally until its quality gate passes,
 * then the loop automatically advances to the next stage.
 *
 * Run: npx tsx tests/quality-gated-loop-demo.ts
 */
import { LoopController } from '@azaloop/core';

function simulateLlmRefineAttempt(stage: string): string {
  const conditions: Record<string, string> = {
    open: 'prd_valid',
    design: 'stories_designed',
    build: 'build_tested',
    verify: 'quality_passed',
    archive: 'archive_ready',
  };
  return conditions[stage] || '';
}

async function main() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  Quality-Gated Loop — Per-Stage Inner Refinement Demo');
  console.log('═'.repeat(60));
  console.log('');
  console.log('  Workflow:');
  console.log('    next() → guard check → fail → refine (stay in stage)');
  console.log('    setCondition(key, true) → next() → pass → advance');
  console.log('');

  const lc = new LoopController({
    maxIterations: 30,
    maxStageIterations: 5,
    maxStrikes: 3,
  });

  const stageNames = ['open', 'design', 'build', 'verify', 'archive'];
  let completed = 0;

  for (const stage of stageNames) {
    const pad = stage.toUpperCase().padEnd(7);
    console.log(`┌─ ${stage.toUpperCase()} STAGE ${'─'.repeat(45 - stage.length)}`);
    console.log(`│  Stage: ${lc.stateMachine.getCurrentStage()}  |  Progress: ${lc.stateMachine.getProgress()}`);

    let attempts = 0;
    let prevStage = lc.stateMachine.getCurrentStage();

    // === Inner refinement loop: stay in stage until quality gate passes ===
    while (true) {
      attempts++;
      const result = lc.next();
      const currentStage = lc.stateMachine.getCurrentStage();

      if (!result.success) {
        console.log(`│  [${attempts}] ✗ Hard stop: ${result.error}`);
        break;
      }

      const { tool, action, reason } = result.next_action!;
      console.log(`│  [${attempts}] next() → ${tool}:${action}`);
      console.log(`│       reason: ${reason}`);

      if (action === 'done') {
        console.log(`│  🏁 All stages complete!`);
        completed++;
        break;
      }

      lc.recordAction(tool, action);

      if (currentStage !== prevStage) {
        // Stage advanced! Quality gate passed.
        completed++;
        console.log(`│  ✓ Stage "${stage}" gate passed → advanced to "${currentStage}"`);
        console.log(`│    (took ${attempts} iteration(s), ${lc.getStageIterations(stage)} refine attempt(s))`);
        break;
      }

      // Still in same stage → quality gate needs refinement
      const condition = simulateLlmRefineAttempt(stage);
      if (condition) {
        lc.setCondition(condition as any, true);
        console.log(`│  → Setting "${condition}" = true, re-checking guard...`);
      }

      if (attempts >= 10) {
        console.log(`│  ✗ Safety limit (10 attempts) reached`);
        break;
      }
    }

    console.log(`└${'─'.repeat(52)}`);
    console.log('');
  }

  // === Summary ===
  const state = lc.stateMachine.getState();
  console.log('═'.repeat(60));
  console.log('  Final State:');
  console.log(`    Current stage: ${state.current_stage}`);
  console.log(`    Progress:      ${state.progress}`);
  console.log(`    Iteration:     ${state.iteration}`);
  console.log(`    Stages:`);
  for (const [name, info] of Object.entries(state.stages)) {
    const s = info as any;
    console.log(`      ${name.padEnd(8)} ${s.status}`);
  }

  const allDone = stageNames.every(s => state.stages[s]?.status === 'completed');
  console.log('');
  console.log(`  All 5 stages quality-gated and completed: ${allDone ? '✓ YES' : '✗ NO'}`);
  console.log('');
}

main().catch(console.error);
