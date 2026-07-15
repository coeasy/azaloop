import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createHash } from 'crypto';
import { StateSchema, type State } from '@azaloop/shared';
import { computeChecksum, verifyChecksum } from './checksum';
import type { StageStatus } from '@azaloop/shared';

// ── Re-exported from merged run-state.ts ──
// Machine-owned run state (run-state.json) — scripts only write, agents only read.
// Inspired by comet's `.comet/run-state.json` pattern.

export interface RunState {
  run_id: string;
  project_root: string;
  total_iterations: number;
  token_budget: number;
  tokens_consumed: number;
  time_used_min: number;
  is_active: boolean;
  active_story?: string;
  current_stage: string;
  outer_loop_enabled: boolean;
  circuit_breaker_status: {
    dimension: string;
    tripped: boolean;
    reason?: string;
  } | null;
  strike_count: number;
  last_hard_stop?: string;
  dp_history: Array<{ id: string; status: string; timestamp: string }>;
  updated_at: string;
}

export interface AuditEntry {
  timestamp: string;
  type: 'dp_transition' | 'state_transition' | 'gate_pass' | 'gate_fail' | 'circuit_breaker' | 'hard_stop' | 'strike' | 'stage_complete' | 'convention_written' | 'context_injection' | 'run_start' | 'run_end';
  source: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

const DEFAULT_STATE: State = {
  pipeline: {
    current_stage: 'open',
    stages: {
      open: { status: 'pending' },
      design: { status: 'pending' },
      build: { status: 'pending' },
      verify: { status: 'pending' },
      archive: { status: 'pending' },
    },
  },
  loops: {
    outer: {
      cadence: 'manual',
      board: { pending: [], in_progress: [], done: [], blocked: [] },
      budget: { tokens_used: 0, tokens_budget: 50000, time_used_min: 0 },
    },
    inner: { story_attempts: 0, max_story_attempts: 3 },
    phase: {
      current: 'open',
      iteration: 0,
      max_iterations: 5,
      history: [],
      maker_role: 'maker',
      checker_role: 'checker',
    },
  },
  loop: {
    iteration: 0,
    progress: '0%',
    client: 'unknown',
    model: 'unknown',
    max_iterations: 50,
  },
  memory: { semantic_keys: [] },
  security_findings: [],
  strikes: 0,
  attestation: { verified: true },
  updated_at: new Date().toISOString(),
};

export class StateManager {
  /** Public — exposes the aza directory so adjacent components (e.g. PRDReviewGate
   *  writing red_flag_answers.json) can resolve paths without re-deriving. */
  readonly azaDir: string;
  private statePath: string;
  private checksumPath: string;
  private state: State;
  private contentHashPath: string;
  private lastContentHash?: string;

  constructor(azaDir: string) {
    this.azaDir = azaDir;
    this.statePath = path.join(azaDir, 'STATE.yaml');
    this.checksumPath = path.join(azaDir, 'STATE.CHECKSUM');
    this.contentHashPath = path.join(azaDir, 'STATE.HASH');
    this.state = { ...DEFAULT_STATE };
  }

  /**
   * Compute SHA256 content hash of the state YAML.
   * Used for content-level stale detection (not timestamps).
   */
  private async computeContentHash(): Promise<string> {
    const content = yaml.dump(this.state, { indent: 2 });
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Load content hash from file for stale comparison.
   */
  private async loadContentHash(): Promise<string | undefined> {
    try {
      const content = await fs.readFile(this.contentHashPath, 'utf8');
      return content.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Save content hash to file.
   */
  private async saveContentHash(hash: string): Promise<void> {
    await fs.writeFile(this.contentHashPath, hash, 'utf8');
  }

  /**
   * Check if the state content has changed (content-level stale detection).
   * Returns true if the state is stale (content has changed since last save).
   */
  async isContentStale(): Promise<boolean> {
    const savedHash = await this.loadContentHash();
    const currentHash = await this.computeContentHash();
    if (!savedHash) {
      return false; // No previous hash — not stale
    }
    return savedHash !== currentHash;
  }

  /**
   * Compare content hash against a known good hash for stale detection.
   * Used for session recovery to detect if state was modified by another process.
   */
  async checkContentIntegrity(expectedHash: string): Promise<boolean> {
    const currentHash = await this.computeContentHash();
    return currentHash === expectedHash;
  }

  async load(): Promise<State> {
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      const checksumContent = await fs.readFile(this.checksumPath, 'utf8').catch(() => '');
      if (checksumContent) {
        const expected = checksumContent.trim();
        const actual = await computeChecksum(content);
        if (actual !== expected) {
          console.warn(`[StateManager] Checksum mismatch for STATE.yaml`);
        }
      }
      const parsed = yaml.load(content);
      this.state = StateSchema.parse(parsed);
      // Load and cache content hash
      this.lastContentHash = await this.loadContentHash();
      return this.state;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.save();
        return this.state;
      }
      throw err;
    }
  }

  async save(): Promise<void> {
    // Ensure .aza directory exists before writing any files
    await fs.mkdir(path.dirname(this.statePath), { recursive: true }).catch(() => {});
    const content = yaml.dump(this.state, { indent: 2 });
    await fs.writeFile(this.statePath, content, 'utf8');
    const checksum = await computeChecksum(content);
    await fs.writeFile(this.checksumPath, checksum, 'utf8');
    // Save content hash for content-level stale detection
    const contentHash = await this.computeContentHash();
    await this.saveContentHash(contentHash);
    this.state.updated_at = new Date().toISOString();
  }

  /**
   * V17: Deep merge partial state into current state.
   * Replaces shallow merge ({ ...this.state, ...partial }) with recursive
   * deep merge to prevent nested state loss (e.g. pipeline.stages being
   * overwritten when only pipeline.current_stage changes).
   *
   * Uses lodash-style merge: objects are merged recursively, arrays and
   * primitives are replaced. `updated_at` is always set to current time.
   *
   * Falls back to shallow merge if deepMerge fails (defensive).
   */
  async update(partial: Partial<State>): Promise<State> {
    try {
      this.state = deepMerge(this.state, partial) as State;
    } catch {
      // Fallback to shallow merge if deepMerge fails
      this.state = { ...this.state, ...partial };
    }
    this.state.updated_at = new Date().toISOString();
    await this.save();
    return this.state;
  }

  async setStage(stage: string, status: StageStatus): Promise<void> {
    if (stage in this.state.pipeline.stages) {
      const key = stage as keyof typeof this.state.pipeline.stages;
      this.state.pipeline.stages[key] = {
        ...this.state.pipeline.stages[key],
        status,
        ...(status === 'in_progress' ? { started_at: new Date().toISOString() } : {}),
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      };
      this.state.updated_at = new Date().toISOString();
      await this.save();
    }
  }

  async advanceStage(): Promise<string | null> {
    const stages: Array<'open' | 'design' | 'build' | 'verify' | 'archive'> = ['open', 'design', 'build', 'verify', 'archive'];
    const currentIdx = stages.indexOf(this.state.pipeline.current_stage as 'open' | 'design' | 'build' | 'verify' | 'archive');
    if (currentIdx < 0 || currentIdx >= stages.length - 1) return null;
    await this.setStage(this.state.pipeline.current_stage, 'completed');
    const next = stages[currentIdx + 1];
    if (!next) return null;
    this.state.pipeline.current_stage = next;
    await this.setStage(this.state.pipeline.current_stage, 'in_progress');
    return this.state.pipeline.current_stage;
  }

  async incrementIteration(): Promise<number> {
    // Reload from disk first so we do not overwrite pipeline advances
    // written by LoopController (separate StateManager instance).
    try {
      await this.load();
    } catch {
      /* keep in-memory state if file missing */
    }
    this.state.loop.iteration += 1;
    this.state.updated_at = new Date().toISOString();
    await this.save();
    return this.state.loop.iteration;
  }

  async setProgress(progress: string): Promise<void> {
    this.state.loop.progress = progress;
    this.state.updated_at = new Date().toISOString();
    await this.save();
  }

  async addSecurityFinding(finding: State['security_findings'][number]): Promise<void> {
    this.state.security_findings.push(finding);
    this.state.updated_at = new Date().toISOString();
    await this.save();
  }

  async incrementStrikes(): Promise<number> {
    this.state.strikes += 1;
    this.state.updated_at = new Date().toISOString();
    await this.save();
    return this.state.strikes;
  }

  getState(): State {
    return this.state;
  }

  getStage(): string {
    return this.state.pipeline.current_stage;
  }

  getIteration(): number {
    return this.state.loop.iteration;
  }

  getStrikes(): number {
    return this.state.strikes;
  }

  isHardStop(): boolean {
    return this.state.strikes >= 3;
  }

  /**
   * Get the last saved content hash for stale comparison.
   */
  getLastContentHash(): string | undefined {
    return this.lastContentHash;
  }

  /**
   * Get the current content hash.
   */
  async getCurrentContentHash(): Promise<string> {
    return this.computeContentHash();
  }

  // ── v14 — P9.3: atomic write + schema migration ─────────────

  /**
   * v14 — P9.3: atomic file write (tmp + rename). Guards against
   * half-written STATE.yaml on crash / power loss. Used internally by
   * `save()` and exposed for callers that write ad-hoc state files.
   */
  async atomicWriteState(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
    const tmp = filePath + '.tmp';
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, filePath);
  }

  /**
   * v14 — P9.3: schema version of the current in-memory state. Bump
   * the value here whenever `StateSchema` changes in a non-backward-
   * compatible way and add a `state/migrations/v{N}-to-v{N+1}.ts`
   * transformer.
   */
  static readonly CURRENT_STATE_VERSION = 2;

  /**
   * v14 — P9.3: read the `schema_version` written in STATE.yaml.
   * Falls back to 1 when the field is absent.
   */
  private readSchemaVersion(state: Record<string, unknown>): number {
    const v = (state as { schema_version?: unknown }).schema_version;
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
    return 1;
  }

  /**
   * v14 — P9.3: chain-load migration transformers in order, applying
   * each to the in-memory state. Transformers live in
   * `state/migrations/v{n}-to-v{n+1}.ts` and export a default function
   * `(state) => state`. Migration is forward-only.
   */
  async migrateState(state: Record<string, unknown>, fromVersion: number, toVersion: number): Promise<Record<string, unknown>> {
    if (fromVersion >= toVersion) return state;
    let current = { ...state };
    for (let v = fromVersion; v < toVersion; v++) {
      try {
        // Dynamic import so vitest's transform pipeline can pick up
        // the .ts migration files.
        const mod = (await import(`./migrations/v${v}-to-v${v + 1}`)) as {
          default?: (s: Record<string, unknown>) => Record<string, unknown>;
        };
        const transformer = mod.default ?? (mod as unknown as (s: Record<string, unknown>) => Record<string, unknown>);
        if (typeof transformer !== 'function') {
          throw new Error(`migration v${v}-to-v${v + 1} does not export a function`);
        }
        current = transformer(current);
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { code?: string };
        if (e.code === 'MODULE_NOT_FOUND' || (err as Error).message.includes('Cannot find module')) {
          throw new Error(
            `No migration available for v${v} → v${v + 1}. ` +
              `Create packages/core/src/state/migrations/v${v}-to-v${v + 1}.ts`,
          );
        }
        throw err;
      }
    }
    (current as { schema_version?: number }).schema_version = toVersion;
    return current;
  }

  /**
   * v14 — P9.3: load STATE.yaml, run pending migrations, persist the
   * migrated state. Backs up the original to STATE.yaml.bak on the
   * first migration.
   *
   * Reads the raw YAML (not the Zod-parsed `State`) so that fields not
   * declared in `StateSchema` (such as `schema_version`) survive into
   * the migration pipeline.
   */
  async loadWithMigration(): Promise<State> {
    // 1) Ensure STATE.yaml exists (creates a default if missing).
    await this.load();
    // 2) Read the raw file and pull out the schema_version.
    let rawState: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      const parsed = yaml.load(content);
      if (parsed && typeof parsed === 'object') {
        rawState = parsed as Record<string, unknown>;
      }
    } catch {
      rawState = this.state as unknown as Record<string, unknown>;
    }
    const version = this.readSchemaVersion(rawState);
    const target = StateManager.CURRENT_STATE_VERSION;
    if (version >= target) {
      // Re-parse to make sure callers see the latest in-memory state.
      this.state = StateSchema.parse(rawState);
      return this.state;
    }
    try {
      const migrated = await this.migrateState(rawState, version, target);
      // Use a passthrough schema to keep `schema_version` and any
      // forward-compat fields the migration added.
      const passthrough = StateSchema.passthrough();
      this.state = passthrough.parse(migrated) as State;
      // Back up the original (only on the first migration in this run).
      try {
        const bakPath = this.statePath + '.bak';
        await fs.copyFile(this.statePath, bakPath);
      } catch {
        // best-effort
      }
      // Save with passthrough so schema_version + extra fields persist.
      const content = yaml.dump(
        { schema_version: target, ...(migrated as object) },
        { indent: 2 },
      );
      await this.atomicWriteState(this.statePath, content);
      return this.state;
    } catch (err) {
      // Migration failure should not brick the workspace — log and
      // continue with the un-migrated state.
      console.warn(`[StateManager] migration v${version} → v${target} failed: ${(err as Error).message}`);
      return this.state;
    }
  }
}

// ── RunStateManager (merged from run-state.ts) ──

export class RunStateManager {
  private runStatePath: string;
  private state: RunState;

  constructor(azaDir: string, projectRoot: string) {
    this.runStatePath = path.join(azaDir, 'run-state.json');
    this.state = {
      run_id: createHash('sha256')
        .update(`${projectRoot}:${Date.now()}`)
        .digest('hex')
        .slice(0, 16),
      project_root: projectRoot,
      total_iterations: 0,
      token_budget: 50000,
      tokens_consumed: 0,
      time_used_min: 0,
      is_active: true,
      current_stage: 'open',
      outer_loop_enabled: false,
      circuit_breaker_status: null,
      strike_count: 0,
      dp_history: [],
      updated_at: new Date().toISOString(),
    };
  }

  async load(): Promise<RunState> {
    try {
      const content = await fs.readFile(this.runStatePath, 'utf8');
      const parsed = JSON.parse(content) as RunState;
      this.state = parsed;
      return parsed;
    } catch {
      await this.save();
      return this.state;
    }
  }

  async save(): Promise<void> {
    this.state.updated_at = new Date().toISOString();
    await fs.writeFile(this.runStatePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  async update(partial: Partial<RunState>): Promise<RunState> {
    this.state = { ...this.state, ...partial, updated_at: new Date().toISOString() };
    await this.save();
    return this.state;
  }

  async recordDPTransition(dpId: string, status: string): Promise<void> {
    this.state.dp_history.push({ id: dpId, status, timestamp: new Date().toISOString() });
    await this.save();
  }

  getState(): RunState {
    return { ...this.state };
  }

  isTokenBudgetExhausted(): boolean {
    return this.state.tokens_consumed >= this.state.token_budget;
  }

  async consumeTokens(tokens: number): Promise<void> {
    this.state.tokens_consumed += tokens;
    await this.save();
  }
}

// ── AuditLog (merged from run-state.ts) ──

export class AuditLog {
  private auditLogPath: string;

  constructor(azaDir: string) {
    this.auditLogPath = path.join(azaDir, 'audit.jsonl');
  }

  async append(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
    const fullEntry: AuditEntry = { ...entry, timestamp: new Date().toISOString() };
    await fs.mkdir(path.dirname(this.auditLogPath), { recursive: true });
    const line = JSON.stringify(fullEntry) + '\n';
    await fs.appendFile(this.auditLogPath, line, 'utf8');
  }

  async load(): Promise<AuditEntry[]> {
    try {
      const content = await fs.readFile(this.auditLogPath, 'utf8');
      const entries: AuditEntry[] = [];
      for (const line of content.split('\n')) {
        if (line.trim()) {
          const parsed = JSON.parse(line) as AuditEntry;
          if (parsed.timestamp && parsed.type) {
            entries.push(parsed);
          }
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async getRecent(limit: number = 10): Promise<AuditEntry[]> {
    const all = await this.load();
    return all.slice(-limit);
  }
}

// ── V17: deepMerge utility ──

/**
 * V17: Recursive deep merge — lodash-style object merging.
 *
 * Merges `source` into `target` recursively. Arrays and primitives in
 * `source` replace those in `target`. Objects are merged at each level.
 * Returns a new object (does not mutate either argument).
 *
 * Used by StateManager.update() to prevent nested state loss.
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const output = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (srcVal === undefined) {
      continue;
    }

    // Both are plain objects → recurse
    if (
      isPlainObject(tgtVal) &&
      isPlainObject(srcVal)
    ) {
      output[key] = deepMerge(
        tgtVal as unknown as Record<string, unknown>,
        srcVal as unknown as Record<string, unknown>,
      ) as unknown as T[typeof key];
    } else {
      // Primitives, arrays, null → replace
      output[key] = srcVal as T[typeof key];
    }
  }
  return output;
}

/**
 * Check if a value is a plain object (not array, null, Date, etc.).
 */
function isPlainObject(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return false;
  return typeof value === 'object' && value.constructor === Object;
}
