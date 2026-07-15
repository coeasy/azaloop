import { sparcPhaseForStage } from './sparc-gates';

export type Stage = 'open' | 'design' | 'build' | 'verify' | 'archive';
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface StageInfo {
  status: StageStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface PhaseLoopState {
  current: Stage;
  iteration: number;
  max_iterations: number;
  history: Array<{ iter: number; result: 'pass' | 'fail' | 'pending'; reason?: string; suggestions?: string }>;
  maker_role: string;
  checker_role: string;
}

export interface OuterLoopState {
  cadence: 'manual' | 'daily' | 'event';
  triage_at?: string;
  board: { pending: string[]; in_progress: string[]; done: string[]; blocked: string[] };
  budget: { tokens_used: number; tokens_budget: number; time_used_min: number };
}

export interface InnerLoopState {
  current_story?: string;
  story_attempts: number;
  max_story_attempts: number;
}

export interface AttestationState {
  prd_hash?: string;
  plan_hash?: string;
  verified: boolean;
}

export interface StateMachineState {
  current_stage: Stage;
  stages: Record<Stage, StageInfo>;
  iteration: number;
  progress: string;
  loops: {
    outer: OuterLoopState;
    inner: InnerLoopState;
    phase: PhaseLoopState;
  };
  attestation: AttestationState;
}

const STAGE_ORDER: Stage[] = ['open', 'design', 'build', 'verify', 'archive'];

export class StateMachine {
  private state: StateMachineState;

  constructor(initial?: Partial<StateMachineState>) {
    const def = this.defaultState();
    if (initial) {
      this.state = {
        ...def,
        ...initial,
        stages: { ...def.stages, ...initial.stages },
        loops: {
          outer: { ...def.loops.outer, ...initial.loops?.outer },
          inner: { ...def.loops.inner, ...initial.loops?.inner },
          phase: { ...def.loops.phase, ...initial.loops?.phase },
        },
        attestation: { ...def.attestation, ...initial.attestation },
      };
    } else {
      this.state = def;
    }
  }

  /**
   * Replace the internal state IN PLACE (same merge semantics as the
   * constructor). Unlike constructing a new StateMachine, this preserves the
   * object reference so collaborators (InnerLoop/OuterLoop) that hold a
   * reference to this instance keep observing the same state.
   */
  loadState(initial: Partial<StateMachineState>): void {
    const def = this.defaultState();
    this.state = {
      ...def,
      ...initial,
      stages: { ...def.stages, ...initial.stages },
      loops: {
        outer: { ...def.loops.outer, ...initial.loops?.outer },
        inner: { ...def.loops.inner, ...initial.loops?.inner },
        phase: { ...def.loops.phase, ...initial.loops?.phase },
      },
      attestation: { ...def.attestation, ...initial.attestation },
    };
  }

  private defaultState(): StateMachineState {
    return {
      current_stage: 'open',
      stages: {
        open: { status: 'pending' },
        design: { status: 'pending' },
        build: { status: 'pending' },
        verify: { status: 'pending' },
        archive: { status: 'pending' },
      },
      iteration: 0,
      progress: '0%',
      loops: {
        outer: {
          cadence: 'manual',
          board: { pending: [], in_progress: [], done: [], blocked: [] },
          budget: { tokens_used: 0, tokens_budget: 50000, time_used_min: 0 },
        },
        inner: {
          story_attempts: 0,
          max_story_attempts: 3,
        },
        phase: {
          current: 'open',
          iteration: 0,
          max_iterations: 5,
          history: [],
          maker_role: 'maker',
          checker_role: 'checker',
        },
      },
      attestation: { verified: true },
    };
  }

  canAdvance(): boolean {
    const current = this.state.stages[this.state.current_stage];
    return current.status === 'completed' || current.status === 'blocked';
  }

  advance(): Stage | null {
    if (!this.canAdvance()) return null;
    const idx = STAGE_ORDER.indexOf(this.state.current_stage);
    if (idx < 0 || idx >= STAGE_ORDER.length - 1) return null;
    this.state.stages[this.state.current_stage] = {
      ...this.state.stages[this.state.current_stage],
      status: 'completed',
      completed_at: new Date().toISOString(),
    };
    const nextStage = STAGE_ORDER[idx + 1];
    if (!nextStage) return null;
    this.state.current_stage = nextStage;
    this.state.stages[this.state.current_stage] = {
      status: 'in_progress',
      started_at: new Date().toISOString(),
    };
    this.state.iteration++;
    this.resetPhaseLoop();
    return this.state.current_stage;
  }

  setStageStatus(stage: Stage, status: StageStatus, error?: string): void {
    this.state.stages[stage] = {
      ...this.state.stages[stage],
      status,
      ...(status === 'in_progress' ? { started_at: new Date().toISOString() } : {}),
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      ...(error ? { error } : {}),
    };
  }

  getCurrentStage(): Stage {
    return this.state.current_stage;
  }

  getStageInfo(stage: Stage): StageInfo {
    return this.state.stages[stage];
  }

  getProgress(): string {
    const completed = STAGE_ORDER.filter(s => this.state.stages[s].status === 'completed').length;
    const blocked = STAGE_ORDER.some(s => this.state.stages[s].status === 'blocked');
    let pct = Math.round((completed / STAGE_ORDER.length) * 100);
    // Never claim 100% while a stage is blocked or archive is incomplete
    if (blocked || (pct === 100 && this.state.stages.archive.status !== 'completed')) {
      pct = Math.min(pct, 99);
    }
    if (blocked && pct === 0) pct = Math.max(pct, 1);
    return `${pct}%`;
  }

  getState(): StateMachineState {
    return { ...this.state, progress: this.getProgress() };
  }

  isCompleted(): boolean {
    return this.state.stages.archive.status === 'completed';
  }

  reset(): void {
    this.state = this.defaultState();
  }

  // ── V12: Phase loop state ──

  setPhaseLoopState(patch: Partial<PhaseLoopState>): void {
    Object.assign(this.state.loops.phase, patch);
  }

  getPhaseLoopState(): PhaseLoopState {
    return { ...this.state.loops.phase };
  }

  resetPhaseLoop(): void {
    this.state.loops.phase.iteration = 0;
    this.state.loops.phase.history = [];
  }

  // ── V12: Inner loop state ──

  setInnerLoopState(patch: Partial<InnerLoopState>): void {
    Object.assign(this.state.loops.inner, patch);
  }

  getInnerLoopState(): InnerLoopState {
    return { ...this.state.loops.inner };
  }

  // ── V12: Outer loop state ──

  setOuterLoopState(patch: Partial<OuterLoopState>): void {
    Object.assign(this.state.loops.outer, patch);
  }

  getOuterLoopState(): OuterLoopState {
    return { ...this.state.loops.outer };
  }

  // ── V12: Attestation ──

  setAttestation(patch: Partial<AttestationState>): void {
    Object.assign(this.state.attestation, patch);
  }

  getAttestation(): AttestationState {
    return { ...this.state.attestation };
  }

  // ── V12: Serialization ──

  serialize(): string {
    return JSON.stringify(this.getState(), null, 2);
  }

  static deserialize(json: string): StateMachine {
    const data = JSON.parse(json);
    return new StateMachine(data);
  }

  // ── O-9: Stage-tool validation helper ──

  /**
   * Lightweight helper that asks the StageToolGuard whether a tool is
   * allowed in the given stage. Returns `null` when the guard is not
   * available (e.g. during isolated unit tests) so callers can decide
   * whether to fail-open or fail-closed.
   *
   * This is intentionally a thin wrapper — the authoritative check lives
   * in `stage-tool-guard.ts` (which the MCP layer consults at dispatch
   * time). This method exists so state-machine consumers can validate
   * their own decisions without re-implementing the stage→tool matrix.
   */
  isValidStageForTool(toolName: string, stage: Stage = this.state.current_stage): boolean | null {
    try {
      // Lazy-import to avoid a circular import between state-machine and
      // stage-tool-guard at module load time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { findStageForTool } = require('./stage-tool-guard');
      const allowed = findStageForTool(toolName);
      if (!allowed) return true; // unknown tools are not blocked at this layer
      return allowed === stage;
    } catch {
      return null;
    }
  }

  // ── T26: SPARC 5-phase mapping ──

  /**
   * Return the SPARC phase that the state machine is currently in. The
   * mapping is defined by `sparcPhaseForStage()` in `./sparc-gates.ts`.
   *
   * - `open`       → `specification`
   * - `design`     → `pseudocode` (front 30%) or `architecture` (back 70%)
   * - `build`      → `refinement`
   * - `verify`     → `completion`
   * - `archive`    → `completion`
   *
   * The `designProgress` is read from the inner-loop's `story_attempts`
   * ratio as a rough proxy when explicit progress is not available.
   */
  getCurrentSparcPhase(): 'specification' | 'pseudocode' | 'architecture' | 'refinement' | 'completion' {
    const storyAttempts = this.state.loops.inner.story_attempts;
    const maxAttempts = this.state.loops.inner.max_story_attempts || 3;
    const designProgress = storyAttempts / maxAttempts;
    return sparcPhaseForStage(this.state.current_stage, designProgress);
  }
}
