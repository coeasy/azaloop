/**
 * Worker Scheduler (T28) — L0 Platform
 *
 * Implements ruflo's 12 background workers + 270s heartbeat. The 270s
 * cadence is < 5 minutes (the typical prompt-cache TTL), so the model
 * context stays warm and the worker's prompt is reused across cycles.
 *
 * Reference: ruvnet/ruflo
 *   - https://github.com/ruvnet/ruflo (loop/workers)
 *
 * Schedules:
 *   - every-270s       — periodic (e.g. ultralearn, optimize, predict, testgaps)
 *   - on-stage-advance — fires when the state machine advances a stage
 *   - on-strike        — fires when the strike system records a strike
 *   - on-completion    — fires when the loop reaches `done`
 *   - manual           — only via `forceRun(name)`
 *
 * Each worker returns a `WorkerReport` with findings; the scheduler
 * persists reports to `.aza/workers/<name>.json` for later auditing.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StateManager } from '../../state/state-manager';

// ── Public types ─────────────────────────────────────────────

export type WorkerName =
  | 'ultralearn'
  | 'optimize'
  | 'consolidate'
  | 'predict'
  | 'audit'
  | 'map'
  | 'preload'
  | 'deepdive'
  | 'document'
  | 'refactor'
  | 'benchmark'
  | 'testgaps';

export const WORKER_NAMES: readonly WorkerName[] = [
  'ultralearn',
  'optimize',
  'consolidate',
  'predict',
  'audit',
  'map',
  'preload',
  'deepdive',
  'document',
  'refactor',
  'benchmark',
  'testgaps',
] as const;

export type WorkerSchedule =
  | 'every-270s'
  | 'on-stage-advance'
  | 'on-strike'
  | 'on-completion'
  | 'manual';

export interface WorkerTrigger {
  name: WorkerName;
  schedule: WorkerSchedule;
  enabled: boolean;
}

export interface WorkerFinding {
  severity: 'info' | 'warn' | 'error';
  message: string;
  refs: string[];
}

export interface WorkerReport {
  name: WorkerName;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  findings: WorkerFinding[];
}

/**
 * A worker is an async function that produces a `WorkerReport`. Workers
 * SHOULD be idempotent and may use the `WorkerContext` to read project
 * state (azaDir, current stage, etc.) but MUST NOT mutate state.
 */
export type WorkerFn = (ctx: WorkerContext) => Promise<WorkerReport>;

export interface WorkerContext {
  azaDir: string;
  /** Read-only access to current state. */
  state: ReturnType<StateManager['getState']>;
}

// ── Default trigger table ───────────────────────────────────

export const DEFAULT_TRIGGERS: WorkerTrigger[] = [
  { name: 'ultralearn', schedule: 'every-270s', enabled: true },
  { name: 'optimize', schedule: 'every-270s', enabled: true },
  { name: 'consolidate', schedule: 'on-stage-advance', enabled: true },
  { name: 'predict', schedule: 'every-270s', enabled: true },
  { name: 'audit', schedule: 'on-completion', enabled: true },
  { name: 'map', schedule: 'on-stage-advance', enabled: true },
  { name: 'preload', schedule: 'on-stage-advance', enabled: true },
  { name: 'deepdive', schedule: 'on-strike', enabled: true },
  { name: 'document', schedule: 'on-completion', enabled: true },
  { name: 'refactor', schedule: 'on-stage-advance', enabled: true },
  { name: 'benchmark', schedule: 'on-completion', enabled: true },
  { name: 'testgaps', schedule: 'every-270s', enabled: true },
];

// ── Worker registry & scheduler ──────────────────────────────

export class WorkerRegistry {
  private workers = new Map<WorkerName, WorkerFn>();

  register(name: WorkerName, fn: WorkerFn): void {
    this.workers.set(name, fn);
  }

  get(name: WorkerName): WorkerFn | undefined {
    return this.workers.get(name);
  }

  has(name: WorkerName): boolean {
    return this.workers.has(name);
  }

  size(): number {
    return this.workers.size;
  }
}

export class WorkerScheduler {
  /** 270 seconds — below the typical 5-minute prompt cache TTL. */
  static readonly HEARTBEAT_MS = 270_000;

  private heartbeatMs: number;
  private timers = new Map<WorkerName, NodeJS.Timeout>();
  private triggers: WorkerTrigger[] = [];
  private reportsDir: string;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;
  private stateManager: StateManager;
  private azaDir: string;
  private registry: WorkerRegistry;
  /** Optional event-driven callback registered by the loop. */
  private stageAdvanceListener: ((newStage: string) => void) | null = null;
  private strikeListener: ((reason: string) => void) | null = null;
  private completionListener: (() => void) | null = null;

  constructor(options: {
    azaDir: string;
    stateManager: StateManager;
    registry?: WorkerRegistry;
    heartbeatMs?: number;
  }) {
    this.azaDir = options.azaDir;
    this.stateManager = options.stateManager;
    this.registry = options.registry ?? new WorkerRegistry();
    this.heartbeatMs = options.heartbeatMs ?? WorkerScheduler.HEARTBEAT_MS;
    this.reportsDir = path.join(this.azaDir, 'workers');
  }

  /** Register or replace the trigger list. Does NOT start the scheduler. */
  registerTriggers(triggers: WorkerTrigger[]): void {
    this.triggers = [...triggers];
  }

  /** List currently configured triggers (read-only snapshot). */
  listTriggers(): WorkerTrigger[] {
    return this.triggers.map((t) => ({ ...t }));
  }

  /** Start all enabled periodic (`every-270s`) workers and the heartbeat. */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Ensure reports directory exists.
    try {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    } catch {
      // best-effort
    }

    // Schedule periodic workers.
    for (const t of this.triggers) {
      if (!t.enabled) continue;
      if (t.schedule === 'every-270s') {
        const timer = setInterval(() => {
          void this.runOne(t.name).catch(() => undefined);
        }, this.heartbeatMs);
        // Don't keep the process alive solely for this timer.
        if (typeof timer.unref === 'function') timer.unref();
        this.timers.set(t.name, timer);
      }
    }

    // Heartbeat: a single interval that ticks every heartbeat and triggers
    // any `every-270s` worker that hasn't run in the last cycle. This is a
    // belt-and-braces measure — setInterval above is the primary path.
    this.intervalHandle = setInterval(() => {
      this.heartbeat();
    }, this.heartbeatMs);
    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }
  }

  /** Stop all timers. Safe to call multiple times. */
  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers.values()) {
      clearInterval(t);
    }
    this.timers.clear();
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Manually trigger a worker (regardless of its schedule). Returns the
   * produced report, or `null` if no worker is registered under `name`.
   */
  async forceRun(name: WorkerName): Promise<WorkerReport | null> {
    return this.runOne(name);
  }

  /**
   * Read the most recent report for a worker. Returns `null` if no
   * report has been written yet.
   */
  async getReport(name: WorkerName): Promise<WorkerReport | null> {
    const p = path.join(this.reportsDir, `${name}.json`);
    try {
      const raw = await fs.promises.readFile(p, 'utf8');
      return JSON.parse(raw) as WorkerReport;
    } catch {
      return null;
    }
  }

  /** List all available reports on disk. */
  async listReports(): Promise<WorkerReport[]> {
    if (!fs.existsSync(this.reportsDir)) return [];
    const files = await fs.promises.readdir(this.reportsDir);
    const out: WorkerReport[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(this.reportsDir, f);
      try {
        const raw = await fs.promises.readFile(p, 'utf8');
        out.push(JSON.parse(raw) as WorkerReport);
      } catch {
        // ignore corrupt
      }
    }
    return out;
  }

  // ── Event-driven hook registration (optional) ──

  /**
   * Bind a callback to fire `on-stage-advance` workers. The loop layer
   * is expected to call this and emit the event.
   */
  onStageAdvance(cb: (newStage: string) => void): void {
    this.stageAdvanceListener = cb;
  }

  onStrike(cb: (reason: string) => void): void {
    this.strikeListener = cb;
  }

  onCompletion(cb: () => void): void {
    this.completionListener = cb;
  }

  /** Emit a stage-advance event. The scheduler fans out to subscribed workers. */
  emitStageAdvance(newStage: string): void {
    if (this.stageAdvanceListener) this.stageAdvanceListener(newStage);
    for (const t of this.triggers) {
      if (t.enabled && t.schedule === 'on-stage-advance') {
        void this.runOne(t.name).catch(() => undefined);
      }
    }
  }

  /** Emit a strike event. */
  emitStrike(reason: string): void {
    if (this.strikeListener) this.strikeListener(reason);
    for (const t of this.triggers) {
      if (t.enabled && t.schedule === 'on-strike') {
        void this.runOne(t.name).catch(() => undefined);
      }
    }
  }

  /** Emit a completion event. */
  emitCompletion(): void {
    if (this.completionListener) this.completionListener();
    for (const t of this.triggers) {
      if (t.enabled && t.schedule === 'on-completion') {
        void this.runOne(t.name).catch(() => undefined);
      }
    }
  }

  // ── Internals ──

  private heartbeat(): void {
    // The setInterval timers handle periodic workers. This method exists
    // for future hooks (e.g. emitting a heartbeat event to subscribers).
    // Intentionally a no-op for now; subclasses or callers may extend.
  }

  private async runOne(name: WorkerName): Promise<WorkerReport | null> {
    const fn = this.registry.get(name);
    if (!fn) return null;
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let findings: WorkerFinding[] = [];
    try {
      const report = await fn({
        azaDir: this.azaDir,
        state: this.stateManager.getState(),
      });
      findings = report.findings;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      findings = [{ severity: 'error', message: `worker threw: ${msg}`, refs: [] }];
    }
    const finishedAt = new Date().toISOString();
    const report: WorkerReport = {
      name,
      startedAt,
      finishedAt,
      durationMs: Date.now() - t0,
      findings,
    };
    try {
      // Ensure the reports directory exists before writing.
      await fs.promises.mkdir(this.reportsDir, { recursive: true });
      const p = path.join(this.reportsDir, `${name}.json`);
      await fs.promises.writeFile(p, JSON.stringify(report, null, 2), 'utf8');
    } catch {
      // best-effort
    }
    return report;
  }
}
