import type { Stage } from '../L7_loop/state-machine';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Decision Point — the numbered gate between two stages.
 * Inspired by spec-superflow's DP-0 through DP-7 protocol.
 *
 * Each DP records the handoff state so recovery is auditable.
 */
export type DecisionPointId =
  | 'DP-0' // init → open
  | 'DP-1' // open → design
  | 'DP-2' // design → build
  | 'DP-3' // build → verify
  | 'DP-4' // verify → archive
  | 'DP-5' // archive → done (completion)
  | 'DP-6' // block → retry (circuit breaker)
  | 'DP-7' // escalate → human (strike/hard stop);
export type DPStatus = 'passed' | 'blocked' | 'escalated' | 'pending';

export interface DecisionPointRecord {
  id: DecisionPointId;
  stage_from: Stage | 'init';
  stage_to: Stage | 'done';
  status: DPStatus;
  gate_results?: Array<{ id: string; label: string; passed: boolean; detail: string }>;
  circuit_breaker?: { dimension: string; tripped: boolean };
  strike_count?: number;
  iteration: number;
  token_estimate: number;
  artifacts?: string[];
  reason?: string;
  timestamp: string;
}

/**
 * DP registry that tracks all decision points for a session.
 */
export class DecisionPointRegistry {
  private dps: Map<DecisionPointId, DecisionPointRecord> = new Map();
  private auditLogPath?: string;

  /**
   * Initialize the registry with an optional audit log path.
   */
  constructor(auditLogPath?: string) {
    this.auditLogPath = auditLogPath;
  }

  /**
   * Record a decision point. Called at every stage transition.
   */
  async record(
    id: DecisionPointId,
    stageFrom: Stage | 'init',
    stageTo: Stage | 'done',
    status: DPStatus,
    options: {
      gateResults?: Array<{ id: string; label: string; passed: boolean; detail: string }>;
      circuitBreaker?: { dimension: string; tripped: boolean };
      strikeCount?: number;
      iteration: number;
      tokenEstimate?: number;
      artifacts?: string[];
      reason?: string;
    },
  ): Promise<DecisionPointRecord> {
    const dp: DecisionPointRecord = {
      id,
      stage_from: stageFrom,
      stage_to: stageTo,
      status,
      gate_results: options.gateResults,
      circuit_breaker: options.circuitBreaker,
      strike_count: options.strikeCount,
      iteration: options.iteration,
      token_estimate: options.tokenEstimate ?? 0,
      artifacts: options.artifacts,
      reason: options.reason,
      timestamp: new Date().toISOString(),
    };

    this.dps.set(id, dp);

    // Append to audit log if path is set
    if (this.auditLogPath) {
      await this.appendAudit(dp);
    }

    return dp;
  }

  /**
   * Append a tool-name audit marker (e.g. aza_prd_approve) for T18 gate checks.
   * Distinct from DP records — scanned by hasAuditRecord().
   */
  async markToolEvent(
    tool: string,
    options?: { iteration?: number; reason?: string },
  ): Promise<void> {
    if (!this.auditLogPath) return;
    await fs.mkdir(path.dirname(this.auditLogPath), { recursive: true });
    const line =
      JSON.stringify({
        tool,
        iteration: options?.iteration ?? 0,
        reason: options?.reason,
        timestamp: new Date().toISOString(),
      }) + '\n';
    await fs.appendFile(this.auditLogPath, line, 'utf8');
  }

  /**
   * Get the status of a specific decision point.
   */
  getStatus(id: DecisionPointId): DPStatus | null {
    return this.dps.get(id)?.status ?? null;
  }

  /**
   * Check if all decision points required for a stage are passed.
   * DP-0 must pass to enter 'open', DP-1 to enter 'design', etc.
   *
   * T18: For stage 'design' we additionally enforce the comet-style
   * "brainstorming not skippable" rule: there must be a recorded
   * aza_prd_approve call in the audit log. The DP-1 status check alone
   * can be bypassed by manually setting the DP, so we double-check the
   * actual tool invocation in the audit log.
   */
  canEnterStage(stage: Stage): boolean {
    const dpMap: Record<Stage, DecisionPointId> = {
      open: 'DP-0',
      design: 'DP-1',
      build: 'DP-2',
      verify: 'DP-3',
      archive: 'DP-4',
    };
    const dpId = dpMap[stage];
    const status = this.getStatus(dpId);
    if (status !== 'passed') return false;

    // T18 enforcement: require an aza_prd_approve (or unified aza_prd) tool marker
    // in the DP audit log. Accept either legacy or unified name so approve via
    // aza_prd(action=approve) + markToolEvent unlocks design.
    if (stage === 'design') {
      return (
        this.hasAuditRecord('aza_prd_approve') ||
        this.hasAuditRecord('aza_prd')
      );
    }
    return true;
  }

  /**
   * Lightweight, sync scan of the audit log for a given tool name.
   * Returns false (fail-closed) on any error or missing log.
   */
  private hasAuditRecord(tool: string): boolean {
    if (!this.auditLogPath) return false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fsSync = require('fs');
      const content = fsSync.readFileSync(this.auditLogPath, 'utf8');
      // Each line is a JSON object; check for a 'tool' field equal to `tool`.
      // We keep this deliberately simple — the audit log is append-only
      // and small enough that a linear scan is fine.
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj && obj.tool === tool) return true;
        } catch {
          // skip malformed lines
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get all recorded decision points.
   */
  getAll(): DecisionPointRecord[] {
    return Array.from(this.dps.values());
  }

  /**
   * Get the last recorded decision point.
   */
  getLast(): DecisionPointRecord | null {
    const all = this.getAll();
    return all.length > 0 ? (all[all.length - 1] as DecisionPointRecord) : null;
  }

  /**
   * Check if the session has passed the completion DP.
   */
  isComplete(): boolean {
    return this.getStatus('DP-5') === 'passed';
  }

  /**
   * Get a summary of all DPs for reporting.
   */
  getSummary(): string {
    const all = this.getAll();
    const passed = all.filter(d => d.status === 'passed').length;
    const blocked = all.filter(d => d.status === 'blocked').length;
    const escalated = all.filter(d => d.status === 'escalated').length;
    const pending = all.filter(d => d.status === 'pending').length;
    return `[DP] ${passed} passed, ${blocked} blocked, ${escalated} escalated, ${pending} pending — ${all.length} total`;
  }

  /**
   * Load DP history from audit log file for session recovery.
   */
  async loadFromAudit(auditLogPath: string): Promise<void> {
    this.auditLogPath = auditLogPath;
    try {
      const content = await fs.readFile(auditLogPath, 'utf8');
      for (const line of content.split('\n')) {
        if (line.trim()) {
          const dp = JSON.parse(line) as DecisionPointRecord;
          if (dp.id && dp.timestamp) {
            this.dps.set(dp.id, dp);
          }
        }
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
  }

  // ── private helpers ──

  private async appendAudit(dp: DecisionPointRecord): Promise<void> {
    if (!this.auditLogPath) return;
    await fs.mkdir(path.dirname(this.auditLogPath), { recursive: true });
    const line = JSON.stringify(dp) + '\n';
    await fs.appendFile(this.auditLogPath, line, 'utf8');
  }
}

/**
 * Default DP to stage mapping for auto-recording transitions.
 */
export const STAGE_TO_DP: Record<Stage, { from: Stage | 'init'; dp: DecisionPointId }> = {
  open: { from: 'init', dp: 'DP-0' },
  design: { from: 'open', dp: 'DP-1' },
  build: { from: 'design', dp: 'DP-2' },
  verify: { from: 'build', dp: 'DP-3' },
  archive: { from: 'verify', dp: 'DP-4' },
};

/**
 * Compute SHA256 hash of content for content-level stale detection.
 * Used to detect drift without relying on file timestamps.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
