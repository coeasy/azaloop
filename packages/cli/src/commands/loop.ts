import { LoopController, ConfigLoader, PRDReviewGate, StateManager, ResumeGenerator } from '@azaloop/core';
import * as path from 'path';
import * as readline from 'readline';

export interface LoopOptions {
  stage?: string;
  dir?: string;
  /** Max iterations before forcing stop (safety cap). Default: 50. */
  maxIterations?: number;
  /** Dry-run mode: print next_action without driving the loop. Default: false. */
  dryRun?: boolean;
  /** Task title — fed to the PRD review gate when next_action.tool === 'aza_prd_review'. */
  task?: string;
  /** Task description — fed to the PRD review gate. */
  description?: string;
  /** PRD gate timeout in ms. Default: 60_000. */
  prdTimeoutMs?: number;
}

/**
 * V12.2 auto-loop CLI driver.
 *
 * Repeatedly calls `LoopController.next()` and follows the `next_action` chain
 * until the loop reaches `done` / `stop` / `escalate` or hits the iteration cap.
 * This is the fallback auto-loop driver for CLI-only clients (aider, hermes)
 * and a debugging tool for MCP clients.
 *
 * Flow:
 *   1. Initialize LoopController with V12 three-level loop enabled.
 *   2. Call `next(stage)` → read `next_action`.
 *   3. If next_action.tool === 'aza_prd_review' → run PRD gate (60s timeout).
 *   4. If action is `done`/`stop`/`escalate` → break.
 *   5. Record the action (for deadlock detection) and loop.
 *
 * Safety: capped by `maxIterations` + CircuitBreaker + HardStop inside the controller.
 */
export async function loopCommand(options: LoopOptions): Promise<void> {
  const azaDir = options.dir || path.join(process.cwd(), '.aza');
  const maxIter = options.maxIterations ?? 50;
  const prdTimeoutMs = options.prdTimeoutMs ?? 60_000;
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

  let stage = options.stage as any;
  let iter = 0;

  console.log(`[aza loop] Starting auto-loop (max ${maxIter} iterations, azaDir=${azaDir})`);

  for (;;) {
    if (iter >= maxIter) {
      console.error(`[aza loop] Reached max iterations (${maxIter}). Stopping.`);
      break;
    }

    const result = await lc.next(stage);
    iter++;
    const action = result.data?.next_action;
    const resultStage = result.data?.stage;

    // Print the step result for the operator/agent to observe.
    console.log(`\n[aza loop] iter=${iter} stage=${resultStage} action=${action?.action} tool=${action?.tool}`);
    console.log(`  reason: ${action?.reason ?? '(none)'}`);
    console.log(`  progress: ${result.data?.progress}`);
    if (result.error) {
      console.log(`  error: ${result.error}`);
    }

    // Terminal actions — stop the loop.
    if (!action) {
      console.log('[aza loop] No next_action returned. Stopping.');
      break;
    }
    if (action.action === 'done') {
      console.log('[aza loop] ✅ Done.');
      break;
    }
    if (action.action === 'stop') {
      console.log(`[aza loop] ⏹ Stopped: ${action.reason}`);
      break;
    }
    if (action.action === 'escalate') {
      console.error(`[aza loop] ⚠ Escalate: ${action.reason}`);
      break;
    }

    // PRD review gate (T12): when the controller hands us aza_prd_review,
    // generate the PRD summary, show it, wait 60s for confirmation, and
    // continue. In --dry-run mode we skip the prompt and auto-approve.
    if (action.tool === 'aza_prd_review') {
      const gateResult = await runPrdGate(azaDir, options, prdTimeoutMs);
      if (gateResult === 'cancel') {
        console.log('[aza loop] ⏹ PRD review cancelled by user.');
        break;
      }
      // Either approved or auto-approved: loop continues.
      continue;
    }

    if (options.dryRun) {
      console.log(`[aza loop] (dry-run) Would call ${action.tool} next.`);
      break;
    }

    // Record the action for deadlock detection.
    lc.recordAction(action.tool, action.action);

    // Advance: use the stage returned by the controller.
    stage = resultStage;
  }

  console.log(`\n[aza loop] Completed after ${iter} iteration(s).`);
}

/**
 * Result of a PRD gate interaction.
 * - 'continue' → user approved (or auto-approved on timeout) → loop continues
 * - 'cancel'   → user cancelled → caller should stop the loop
 */
type PrdGateResult = 'continue' | 'cancel';

/**
 * Run the PRD review gate from the CLI:
 *  1. Show the PRD summary.
 *  2. Wait for the user to type "开始执行" / "取消" / modify feedback, or hit the 60s timeout.
 *  3. Translate that into approve / modify / cancel / autoApproveOnTimeout.
 *
 * In --dry-run mode or when stdin is not a TTY (e.g. CI), we auto-approve
 * after a single "press enter" prompt, falling back to the timeout default.
 */
async function runPrdGate(
  azaDir: string,
  options: LoopOptions,
  timeoutMs: number,
): Promise<PrdGateResult> {
  const stateManager = new StateManager(azaDir);
  await stateManager.load();
  const resumeGenerator = new ResumeGenerator(azaDir);
  const gate = new PRDReviewGate({
    stateManager,
    resumeGenerator,
    timeoutMs,
  });

  const review = await gate.review({
    title: options.task || 'AzaLoop Task',
    description: options.description || '',
  });

  console.log('\n' + review.summary);
  console.log('\n' + review.instruction);

  // Dry-run: skip interaction, auto-approve.
  if (options.dryRun || !process.stdin.isTTY) {
    console.log('\n[aza loop] (dry-run / non-TTY) auto-approving PRD.');
    const approval = await gate.autoApproveOnTimeout();
    console.log(`[aza loop] ${approval.message}`);
    return 'continue';
  }

  const input = await readUserInputWithTimeout(timeoutMs);
  let approval;
  if (input === null) {
    console.log('\n[aza loop] ⏳ Timeout — auto-approving PRD.');
    approval = await gate.autoApproveOnTimeout();
  } else if (input.includes('取消') || input.toLowerCase() === 'cancel') {
    const cancelled = await gate.cancel();
    console.log(`[aza loop] ${cancelled.next_action.reason ?? 'cancelled'}`);
    return 'cancel';
  } else if (input.includes('开始执行') || input.trim() === '') {
    approval = await gate.approve();
  } else {
    console.log('[aza loop] Treating input as modification feedback...');
    const next = await gate.modify(input);
    console.log('\n' + next.summary);
    // Re-prompt once with the refined PRD; if no input, auto-approve the refined one.
    const second = await readUserInputWithTimeout(timeoutMs);
    if (second === null) {
      approval = await gate.autoApproveOnTimeout();
    } else if (second.includes('取消')) {
      await gate.cancel();
      return 'cancel';
    } else {
      approval = await gate.approve();
    }
  }
  console.log(`[aza loop] ${approval.message}`);
  return 'continue';
}

/**
 * Prompt the user with readline; resolve with the trimmed input, or null
 * if the readline is closed by the timeout.
 */
function readUserInputWithTimeout(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const timer = setTimeout(() => {
      rl.close();
    }, timeoutMs);
    rl.question('\n> ', (answer) => {
      clearTimeout(timer);
      rl.close();
      resolve(answer.trim());
    });
    rl.on('close', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}
