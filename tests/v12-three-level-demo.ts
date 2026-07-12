/**
 * V12 Three-Level Loop Demo
 *
 * Verifies the unified architecture:
 *   LoopController (V12) → StateMachine + CircuitBreaker + CompletionGate + LoopAudit
 *
 * Run: npx tsx tests/v12-three-level-demo.ts
 */
import { LoopController, CircuitBreaker, CompletionGate, LoopAudit, StateMachine } from '@azaloop/core';

function log(msg: string): void { console.log(`  ${msg}`); }

const CONDITIONS: Record<string, string> = {
  open: 'prd_valid',
  design: 'stories_designed',
  build: 'build_tested',
  verify: 'quality_passed',
  archive: 'archive_ready',
};

async function main() {
  console.log('');
  console.log('═'.repeat(62));
  console.log('  V12 Three-Level Loop — Unified Architecture Demo');
  console.log('═'.repeat(62));
  console.log('');

  // ── 1. Verify all V12 modules compose correctly ──
  console.log('┌─ Module Composition Check');
  const lc = new LoopController({ maxIterations: 30, maxStageIterations: 5, enableV12: true });
  log(`StateMachine:        ${lc.stateMachine.constructor.name}`);
  log(`CircuitBreaker:      ${lc.circuitBreaker.constructor.name}`);
  log(`CompletionGate:      ${lc.completionGate.constructor.name}`);
  log(`LoopAudit:           ${lc.auditor.constructor.name}`);
  log(`InnerLoop:           ${lc.innerLoop.constructor.name}`);
  log(`StageGuards:         ${lc.guards.constructor.name}`);
  log(`DeadlockDetector:    ${lc.deadlockDetector.constructor.name}`);
  log(`HardStopManager:     ${lc.hardStop.constructor.name}`);
  log(`StrikeSystem:        ${lc.strikeSystem.constructor.name}`);
  console.log(`└${'─'.repeat(54)}`);
  console.log('');

  // ── 2. Verify StateMachine V12 state ──
  console.log('┌─ StateMachine V12 State');
  const sm = lc.stateMachine;
  log(`Current stage:       ${sm.getCurrentStage()}`);
  log(`Phase loop state:    iter=${sm.getPhaseLoopState().iteration}, max=${sm.getPhaseLoopState().max_iterations}`);
  log(`Inner loop state:    story=${sm.getInnerLoopState().current_story || 'none'}, attempts=${sm.getInnerLoopState().story_attempts}`);
  log(`Outer loop state:    cadence=${sm.getOuterLoopState().cadence}`);
  log(`Attestation:         verified=${sm.getAttestation().verified}`);
  console.log(`└${'─'.repeat(54)}`);
  console.log('');

  // ── 3. Verify serialization ──
  console.log('┌─ Serialization');
  const json = sm.serialize();
  const restored = StateMachine.deserialize(json);
  log(`Serialized:          ${json.length} bytes`);
  log(`Deserialized stage:  ${restored.getCurrentStage()}`);
  log(`Deserialized phase:  iter=${restored.getPhaseLoopState().iteration}`);
  log(`Round-trip OK:       ${restored.getCurrentStage() === sm.getCurrentStage()}`);
  console.log(`└${'─'.repeat(54)}`);
  console.log('');

  // ── 4. Run three-level loop through all stages ──
  console.log('┌─ Three-Level Loop Execution');
  const stages = ['open', 'design', 'build', 'verify', 'archive'];

  for (const stage of stages) {
    console.log(`│`);
    console.log(`│  ── ${stage.toUpperCase()} STAGE ──`);
    let attempts = 0;
    let prevStage = sm.getCurrentStage();

    while (attempts < 8) {
      attempts++;
      const result = lc.next();
      const currentStage = sm.getCurrentStage();

      if (!result.success) {
        log(`  [${attempts}] HARD STOP: ${result.error}`);
        break;
      }

      const { tool, action, reason } = result.next_action!;
      log(`  [${attempts}] next() → ${tool}:${action}`);
      log(`       reason: ${reason}`);
      log(`       loop_level: ${result.metadata?.loop_level}, phase_iter: ${result.metadata?.phase_iteration}`);

      if (action === 'done') {
        log(`  🏁 All stages complete!`);
        break;
      }

      lc.recordAction(tool, action);

      if (currentStage !== prevStage) {
        log(`  ✓ Stage "${stage}" gate passed → advanced to "${currentStage}"`);
        log(`    (took ${attempts} iteration(s))`);
        break;
      }

      // Still in same stage → set condition
      const condition = CONDITIONS[stage];
      if (condition) {
        lc.setCondition(condition as any, true);
        log(`  → Setting "${condition}" = true`);
      }

      if (attempts >= 8) {
        log(`  ✗ Safety limit reached`);
        break;
      }
    }
  }
  console.log(`│`);
  console.log(`└${'─'.repeat(54)}`);
  console.log('');

  // ── 5. Circuit Breaker Status ──
  console.log('┌─ Circuit Breaker');
  const phaseMetrics = lc.circuitBreaker.getMetrics('phase');
  const innerMetrics = lc.circuitBreaker.getMetrics('inner');
  const outerMetrics = lc.circuitBreaker.getMetrics('outer');
  log(`Phase:   iterations=${phaseMetrics.iterations}, tokens=${phaseMetrics.tokensSpent}`);
  log(`Inner:   iterations=${innerMetrics.iterations}, tokens=${innerMetrics.tokensSpent}`);
  log(`Outer:   iterations=${outerMetrics.iterations}, tokens=${outerMetrics.tokensSpent}`);
  const tripped = lc.circuitBreaker.checkAll();
  log(`Tripped: ${tripped?.tripped ?? false}`);
  console.log(`└${'─'.repeat(54)}`);
  console.log('');

  // ── 6. Completion Gate ──
  console.log('┌─ Completion Gate');
  const state = sm.getState();
  const hasInProgress = Object.values(state.stages).some(s => s.status === 'in_progress');
  const gateResult = lc.completionGate.evaluate({
    gated_mode_enabled: true,
    has_in_progress_stage: hasInProgress,
    all_stages_completed: Object.values(state.stages).every(s => s.status === 'completed'),
    stop_hook_active: false,
    block_count: 0,
    block_count_limit: 5,
    ledger_has_progress: state.iteration > 0,
    attestation_verified: state.attestation?.verified ?? false,
  });
  log(`canStop: ${gateResult.canStop}`);
  if (gateResult.blockedReason) {
    log(`blocked: ${gateResult.blockedReason}`);
  }
  gateResult.conditions.forEach(c => {
    log(`  C${c.index} ${c.id}: ${c.satisfied ? '✓' : '✗'} ${c.detail}`);
  });
  console.log(`└${'─'.repeat(54)}`);
  console.log('');

  // ── 7. Loop Audit ──
  console.log('┌─ Loop Audit');
  const auditResult = await lc.audit();
  log(`Score:   ${auditResult.score}/100 (${auditResult.level})`);
  log(`Signals: ${auditResult.signals.filter(s => s.passed).length}/${auditResult.signals.length} passed`);
  if (auditResult.recommendations.length > 0) {
    log(`Recommendations:`);
    auditResult.recommendations.slice(0, 3).forEach(r => log(`  - ${r}`));
  }
  console.log(`└${'─'.repeat(54)}`);
  console.log('');

  // ── 8. Final State ──
  console.log('═'.repeat(62));
  const finalState = sm.getState();
  console.log('  Final State:');
  console.log(`    Stage:     ${finalState.current_stage}`);
  console.log(`    Iteration: ${finalState.iteration}`);
  console.log(`    Progress:  ${finalState.progress}`);
  console.log(`    Phase:     iter=${finalState.loops.phase.iteration}`);
  const allDone = stages.every(s => finalState.stages[s]?.status === 'completed');
  console.log(`    All 5 stages completed: ${allDone ? '✓ YES' : '✗ NO'}`);
  console.log('');
}

main().catch(console.error);
