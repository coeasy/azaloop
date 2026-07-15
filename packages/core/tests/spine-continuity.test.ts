import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ResumeGenerator } from '../src/continuity/resume-generator';
import { MCPContinueService } from '../src/continuity/mcp-continue';
import { StateManager } from '../src/state/state-manager';
import { DeadlockDetector } from '../src/L7_loop/deadlock-detector';
import { StateMachine } from '../src/L7_loop/state-machine';
import { researchCompetitors } from '../src/L1_spec/github-competitive-research';
import type { CompetitorHit } from '../src/L1_spec/github-competitive-research';
import { ContextInjector } from '../src/continuity/context-injector';
import { createDefaultStoryProvider } from '../src/L7_loop/outer-loop';

describe('spine continuity (0.4.0 plan)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-spine-'));
    fs.mkdirSync(path.join(tmp, '.aza'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('ResumeGenerator prefers blocked stage over stale pipeline.current_stage', async () => {
    const aza = path.join(tmp, '.aza');
    const sm = new StateManager(aza);
    await sm.load();
    await sm.update({
      pipeline: {
        current_stage: 'open',
        stages: {
          open: { status: 'completed' },
          design: { status: 'completed' },
          build: { status: 'blocked', error: 'Circuit breaker' },
          verify: { status: 'pending' },
          archive: { status: 'pending' },
        },
      },
      loop: {
        iteration: 10,
        progress: '100%',
        current_story: 'S1',
        client: 'cursor',
        model: 'test',
        max_iterations: 50,
      },
    });
    const gen = new ResumeGenerator(aza);
    const resume = await gen.generate(sm);
    expect(resume.current_stage).toBe('build');
    expect(resume.next_action).toBe('reset');
    expect(resume.progress).not.toBe('100%');
  });

  it('MCPContinueService does not let stale RESUME overwrite STATE stage', async () => {
    const aza = path.join(tmp, '.aza');
    const sm = new StateManager(aza);
    await sm.load();
    await sm.update({
      pipeline: {
        current_stage: 'open',
        stages: {
          open: { status: 'completed' },
          design: { status: 'completed' },
          build: { status: 'blocked' },
          verify: { status: 'pending' },
          archive: { status: 'pending' },
        },
      },
      loop: {
        iteration: 5,
        progress: '40%',
        current_story: 'S1',
        client: 'unknown',
        model: 'unknown',
        max_iterations: 50,
      },
    });
    // Write stale RESUME claiming open/full
    fs.writeFileSync(
      path.join(aza, 'RESUME.md'),
      `# AzaLoop Resume\n## Current State\n- **Stage:** open\n- **Iteration:** 1\n- **Progress:** 100%\n- **Client:** unknown\n- **Model:** unknown\n## Next Action\n- **Tool:** aza_loop\n- **Action:** full\n`,
      'utf8',
    );
    const svc = new MCPContinueService(sm, new ResumeGenerator(aza));
    const result = await svc.continue({ client: 'cursor' });
    expect(result.resume?.current_stage).toBe('build');
    expect(result.resume?.client).toBe('cursor');
  });

  it('DeadlockDetector detects ping-pong report_tool ↔ host tool', () => {
    const d = new DeadlockDetector(3);
    for (let i = 0; i < 3; i++) {
      d.record('aza_spec', 'implement', i);
      d.record('aza_loop', 'report_tool', i);
    }
    expect(d.isDeadlocked()).toBe(true);
  });

  it('StateMachine getProgress never returns 100% when blocked', () => {
    const sm = new StateMachine({
      current_stage: 'build',
      stages: {
        open: { status: 'completed' },
        design: { status: 'completed' },
        build: { status: 'blocked' },
        verify: { status: 'pending' },
        archive: { status: 'pending' },
      },
      iteration: 1,
      progress: '0%',
      loops: {
        outer: { cadence: 'manual', board: { pending: [], in_progress: [], done: [], blocked: [] }, budget: { tokens_used: 0, tokens_budget: 0, time_used_min: 0 } },
        inner: { story_attempts: 0, max_story_attempts: 3 },
        phase: { current: 'build', iteration: 0, max_iterations: 5, history: [], maker_role: 'maker', checker_role: 'checker' },
      },
      attestation: { verified: true },
    } as any);
    const pct = Number(sm.getProgress().replace('%', ''));
    expect(pct).toBeLessThan(100);
  });

  it('competitive research fallback cites ≥2 github URLs', async () => {
    // Force fallback by using impossible network (function falls back on error)
    const prev = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const result = await researchCompetitors('azaloop agent loop', 'prd mcp openspec');
    expect(result.competitors.length).toBeGreaterThanOrEqual(2);
    const urls = result.competitors.map((c: CompetitorHit) => c.html_url).filter((u: string) => /github\.com\//.test(u));
    expect(urls.length).toBeGreaterThanOrEqual(2);
    if (prev) process.env.GITHUB_TOKEN = prev;
  });

  it('ContextInjector calibrate is slim and reads artifact pointers', () => {
    const aza = path.join(tmp, '.aza');
    fs.writeFileSync(path.join(aza, 'run-ledger.jsonl'), '{"m":"a"}\n{"m":"b"}\n{"m":"c"}\n', 'utf8');
    const inj = new ContextInjector(aza);
    const bundle = inj.calibrate('build');
    expect(bundle.session_prompt.length).toBeLessThan(500);
    expect(bundle.artifacts).toContain('.aza/STATE.yaml');
    expect(bundle.ledger_tail?.length).toBeGreaterThan(0);
    expect(bundle.constitution.length).toBeLessThanOrEqual(3);
  });

  it('createDefaultStoryProvider prefers outer board ids', async () => {
    const provider = createDefaultStoryProvider({
      getState: () => ({
        loops: {
          outer: {
            board: {
              pending: ['S2', 'S3'],
              in_progress: ['S1'],
              done: [],
              blocked: [],
            },
          },
        },
        pipeline: { stages: {} },
      }),
    });
    const stories = await provider();
    expect(stories.map((s) => s.id)).toEqual(['S1', 'S2', 'S3']);
  });
});
