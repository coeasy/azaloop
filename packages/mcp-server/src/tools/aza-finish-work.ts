/**
 * v14 — P8.3: aza_finish_work — unified finish-work flow.
 *
 * Trellis-inspired slash command: archives the current task, writes a
 * 3-piece task-artifact set, updates STATUS.md, appends a workspace-journal
 * entry, and signals the loop to stop. Triggered by `/aza:finish-work` in
 * Trae / Cursor / Claude Code / OpenCode.
 *
 * Flow:
 *  1. Read current state from STATE.yaml (current_stage + active_story).
 *  2. Ensure 3-piece task artifacts under `<azaDir>/tasks/<taskId>/`.
 *  3. Append a workspace journal entry (Trellis pattern).
 *  4. Update STATUS.md snapshot.
 *  5. Optionally signal stop (best-effort).
 *  6. Return a FinishWorkResult with all artifacts written.
 *
 * Reference: mindfold-ai/Trellis v0.6.0 — `/trellis:finish-work`.
 */

import { StateManager } from '@azaloop/core';
import { ResumeGenerator } from '@azaloop/core';
import { ensureTaskArtifacts, appendNote } from '@azaloop/core';
import { WorkspaceJournal } from '@azaloop/core';
import { writeStatusSnapshot } from '@azaloop/core';
import * as path from 'path';
import type { LoopResponse } from '@azaloop/shared';

// ── Types ────────────────────────────────────────────────────

export interface FinishWorkInput {
  /** Optional explicit task ID; defaults to active_story from STATE. */
  taskId?: string;
  /** Optional human-readable work summary. */
  work_summary?: string;
  /** Key decisions made this iteration. */
  decisions?: string[];
  /** Open issues / questions for the next session. */
  open_questions?: string[];
  /** Optional next steps. */
  next_steps?: string[];
  /** Iteration count for journal entry. */
  iteration?: number;
  /** When true, also signal a stop event. Default: true. */
  stop_loop?: boolean;
  /** Working directory (defaults to process.cwd()). */
  workspace_path?: string;
}

export interface FinishWorkResult {
  success: boolean;
  task_id: string;
  artifacts_written: string[];
  journal_appended: boolean;
  status_updated: boolean;
  loop_stopped: boolean;
  next_action: {
    tool: 'aza_init' | 'aza_session_start' | 'aza_loop_next';
    action: 'restart' | 'continue' | 'stop';
    reason: string;
  };
  message: string;
  duration_ms: number;
  errors: string[];
}

// ── Implementation ───────────────────────────────────────────

/**
 * Handle the `aza_finish_work` MCP tool call.
 *
 * Side effects (all best-effort; failure of any single step is recorded
 * in `errors` but does not abort the overall flow):
 *  1. Write task artifacts (CONTEXT/REPAIR/NOTES).
 *  2. Append workspace journal entry.
 *  3. Write STATUS.md.
 *  4. Optionally signal stop.
 */
export async function handleFinishWork(
  input: FinishWorkInput,
  stateManager?: StateManager,
  resumeGenerator?: ResumeGenerator,
): Promise<LoopResponse> {
  const start = Date.now();
  const azaDir = path.join(input.workspace_path ?? process.cwd(), '.aza');
  const errors: string[] = [];
  const artifactsWritten: string[] = [];

  // 1) Resolve the task id (explicit > loops.inner.current_story > 'unknown').
  let taskId = input.taskId;
  if (!taskId && stateManager) {
    try {
      const state = await stateManager.load();
      taskId = state.loops.inner.current_story || 'unknown';
    } catch {
      taskId = 'unknown';
    }
  }
  taskId = taskId ?? 'unknown';

  // 2) Resolve stage for journal.
  let stage = 'open';
  if (stateManager) {
    try {
      const state = await stateManager.load();
      stage = state.pipeline.current_stage || 'open';
    } catch {
      // best-effort
    }
  }

  // 3) Write 3-piece task artifacts.
  try {
    ensureTaskArtifacts(azaDir, {
      taskId,
      title: input.work_summary ?? `Task ${taskId}`,
      description: input.work_summary,
    });
    artifactsWritten.push('CONTEXT.md', 'REPAIR.md', 'NOTES.md');
  } catch (err) {
    errors.push(`Failed to write task artifacts: ${(err as Error).message}`);
  }

  // 4) Append a NOTES.md line.
  const noteParts: string[] = [];
  if (input.work_summary) noteParts.push(`Summary: ${input.work_summary}`);
  if (input.decisions && input.decisions.length > 0) {
    noteParts.push(`Decisions:\n${input.decisions.map((d) => `- ${d}`).join('\n')}`);
  }
  if (input.open_questions && input.open_questions.length > 0) {
    noteParts.push(`Open questions:\n${input.open_questions.map((q) => `- ${q}`).join('\n')}`);
  }
  if (input.next_steps && input.next_steps.length > 0) {
    noteParts.push(`Next steps:\n${input.next_steps.map((s) => `- ${s}`).join('\n')}`);
  }
  try {
    appendNote(azaDir, taskId, noteParts.join('\n\n'));
  } catch (err) {
    errors.push(`Failed to append note: ${(err as Error).message}`);
  }

  // 5) Append workspace journal entry.
  let journalAppended = false;
  try {
    const journal = new WorkspaceJournal(azaDir);
    await journal.archive({
      stage,
      work_summary: input.work_summary ?? `Task ${taskId} finished`,
      decisions: input.decisions,
      issues: input.open_questions,
      next_steps: input.next_steps,
      iteration: input.iteration,
    });
    journalAppended = true;
  } catch (err) {
    errors.push(`Failed to append workspace journal: ${(err as Error).message}`);
  }

  // 6) Update STATUS.md.
  let statusUpdated = false;
  try {
    writeStatusSnapshot(azaDir, {
      currentStage: stage,
      iteration: input.iteration ?? 0,
      progress: '100',
      lastMilestone: input.work_summary ?? `Task ${taskId} finished`,
      nextAction: 'idle (awaiting new task)',
      strikes: 0,
      openChanges: [],
      storyId: taskId,
      updatedAt: new Date().toISOString(),
    });
    statusUpdated = true;
  } catch (err) {
    errors.push(`Failed to update STATUS.md: ${(err as Error).message}`);
  }

  // 6b) Task board + stop-hook signal for CompletionGate
  try {
    const { ensureTaskBoard } = await import('@azaloop/core');
    ensureTaskBoard(azaDir, {
      title: input.work_summary ?? taskId,
      phase: 'archive',
      status: 'complete',
      notes: 'finish_work completed',
    });
  } catch {
    /* best-effort */
  }

  // 7) Optional: signal stop by advancing to the 'archive' stage.
  let loopStopped = false;
  if (input.stop_loop !== false && stateManager) {
    try {
      // Best-effort: advance the current stage to 'completed' and move to 'archive'.
      const state = await stateManager.load();
      const currentStage = state.pipeline.current_stage;
      if (currentStage !== 'archive') {
        await stateManager.setStage(currentStage as any, 'completed');
      }
      // Update the inner story to undefined (no active story)
      await stateManager.update({
        loop: { ...state.loop, progress: '100%' },
      });
      loopStopped = true;
    } catch (err) {
      errors.push(`Failed to signal stop: ${(err as Error).message}`);
    }
  }

  const result: FinishWorkResult = {
    success: errors.length === 0,
    task_id: taskId,
    artifacts_written: artifactsWritten,
    journal_appended: journalAppended,
    status_updated: statusUpdated,
    loop_stopped: loopStopped,
    next_action: {
      tool: 'aza_init',
      action: 'restart',
      reason: errors.length === 0
        ? `Task ${taskId} finished cleanly. Use /aza:init to start a new task, or /aza:session-start to continue.`
        : `Task ${taskId} finished with ${errors.length} non-fatal errors. Review errors before restarting.`,
    },
    message: errors.length === 0
      ? `✓ Finish-work complete for ${taskId} (${artifactsWritten.length} artifacts, journal + status updated)`
      : `⚠ Finish-work partial for ${taskId} (${errors.length} errors: ${errors.slice(0, 3).join('; ')})`,
    duration_ms: Date.now() - start,
    errors,
  };

  return {
    success: result.success,
    data: result,
    next_action: {
      tool: result.next_action.tool,
      action: result.next_action.action,
      reason: result.next_action.reason,
    },
    metadata: { iteration: input.iteration ?? 0, progress: '100%', stage: 'archive' },
  };
}
