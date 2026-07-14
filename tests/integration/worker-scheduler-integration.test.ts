/**
 * v13 — WorkerScheduler integration test (P1.1)
 *
 * Verifies that the AutoLoopEngine wires up the WorkerScheduler correctly
 * and that stage transitions / strike events / completion events
 * trigger the corresponding `on-stage-advance` / `on-strike` / `on-completion`
 * workers.
 *
 * Mirrors `tests/integration/main-pipeline-integration.test.ts` style:
 * real filesystem, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AutoLoopEngine,
  PRDReviewGate,
  StateManager,
  ResumeGenerator,
  LoopController,
  WorkerScheduler,
  WorkerRegistry,
  buildDefaultRegistry,
  DEFAULT_TRIGGERS,
  runConsolidate,
  runDocument,
  runDeepdive,
  type SkillMeta,
  type WorkerReport,
} from '@azaloop/core';

// ── Helpers ──────────────────────────────────────────────

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function seedProject(projectRoot: string, azaDir: string): void {
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      { name: 'aza-wsched-it', private: true, type: 'module', devDependencies: { vitest: '^4', typescript: '^5' } },
      null,
      2,
    ),
  );
  writeFile(
    path.join(projectRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          target: 'ES2020',
          types: [],
          skipLibCheck: true,
          noEmit: true,
          strict: false,
          esModuleInterop: true,
          resolveJsonModule: true,
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
  );
  writeFile(
    path.join(projectRoot, 'vitest.config.ts'),
    "export default { test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true } };\n",
  );
  writeFile(
    path.join(projectRoot, 'src', 'add.ts'),
    'export function add(a: number, b: number): number { return a + b; }\n',
  );
  writeFile(
    path.join(projectRoot, 'src', 'add.test.ts'),
    "// @ts-nocheck\nimport { add } from './add';\nimport { test, expect } from 'vitest';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
  );

  // PRD for the 14-dim checker
  const prd = {
    id: 'PRD-WI',
    title: 'WorkerScheduler Integration Test',
    version: '0.1.0',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    overview: 'WorkerScheduler integration test that satisfies the 14-dim real checker. '.repeat(2),
    goals: ['integration', 'verify'],
    target_users: ['developer'],
    functional_requirements: [{ id: 'FR-1', description: 'integration', priority: 'P0' }],
    non_functional_requirements: [{ id: 'NFR-1', description: 'fast', category: 'performance' }],
    stories: [
      {
        id: 'STORY-1',
        title: 'Demo',
        description: 'demo',
        priority: 'P0',
        complexity: 'L1',
        acceptance_criteria: [{ id: 'AC-1', description: 'demo', testable: true, status: 'pending' }],
        dependencies: [],
        status: 'pending',
      },
    ],
    architecture: [{ type: 'system', mermaid: 'graph TD; A-->B', description: 'sys' }],
    acceptance_criteria: [{ id: 'AC-1', description: 'demo', testable: true, status: 'pending' }],
    risks: [],
  };
  writeFile(path.join(azaDir, 'prd.json'), JSON.stringify(prd, null, 2));

  // design stage artifacts
  writeFile(path.join(azaDir, 'design.md'), '# Architecture\n');
  fs.mkdirSync(path.join(azaDir, 'diagrams'), { recursive: true });
  for (let i = 1; i <= 7; i++) writeFile(path.join(azaDir, 'diagrams', `d${i}.md`), `# d${i}\n`);

  // archive stage artifacts
  for (const d of ['prd.md', 'architecture.md', 'data-model.md', 'api.md', 'test-plan.md', 'deployment.md']) {
    writeFile(path.join(azaDir, d), `# ${d}\n`);
  }

  // conventions
  writeFile(
    path.join(azaDir, 'spec-conventions', 'conventions.jsonl'),
    JSON.stringify({ id: 'CONV-1', title: 'seed', body: 'b', tags: [], source: 'seed', created_at: new Date().toISOString() }) + '\n',
  );
}

const PR_SKILL_META: SkillMeta = {
  name: 'prd',
  version: '1.1.0',
  type: 'document',
  description: 'Test skill meta',
  tags: ['prd', 'integration'],
  when_to_use: 'integration test',
  red_flags: [],
  rationalizations: [],
  quick_reference: [],
  related_skills: [],
  evals: [],
  requires_approval: true,
  body_sections: [],
  namespaces: ['aza-prd'],
  reserved_namespaces: ['pattern', 'claude-memories', 'default'],
  smoke_test: { command: 'echo test', expected: 'test' },
  gate_criteria: [],
  isolation: 'none',
  boundaries_never_touch: [],
  completion_sentinel: '<promise>TASK_COMPLETE</promise>',
  task_sources: ['md', 'aza-prd'],
  language: 'both',
  author: 'azaloop-wsched-it',
  registered_at: new Date().toISOString(),
};

// ── Test suite ───────────────────────────────────────────

describe('v13 P1.1 — WorkerScheduler wired into AutoLoopEngine', () => {
  let projectRoot: string;
  let azaDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-wsched-'));
    azaDir = path.join(projectRoot, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    seedProject(projectRoot, azaDir);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('1) AutoLoopEngine constructs with scheduler and starts/stops cleanly', async () => {
    const engine = new AutoLoopEngine({
      azaDir,
      client: 'integration-test',
      model: 'test-model',
      maxIterations: 5,
      // Use a 100ms heartbeat so timers can be cleared quickly.
      workerHeartbeatMs: 100,
    });
    const started = await engine.start();
    expect(started.started).toBe(true);
    expect((engine as any).workerScheduler).not.toBeNull();

    // stop() must release the scheduler without throwing.
    await expect(engine.stop()).resolves.not.toThrow();
  });

  it('2) stage advance fans out to on-stage-advance workers (consolidate)', async () => {
    const stateManager = new StateManager(azaDir);
    await stateManager.load();
    const registry = new WorkerRegistry();
    registry.register('consolidate', runConsolidate);
    const scheduler = new WorkerScheduler({
      azaDir,
      stateManager,
      registry,
      heartbeatMs: 100,
    });
    scheduler.registerTriggers([
      { name: 'consolidate', schedule: 'on-stage-advance', enabled: true },
    ]);

    const lc = new LoopController({ enableV12: true, maxIterations: 5, azaDir });
    lc.setWorkerScheduler(scheduler);

    // Trigger a stage advance via syncStateFromFile. First call seeds the
    // lastObservedStage; second call with a different stage fires the event.
    const first = fs.readFileSync(path.join(azaDir, 'STATE.yaml'), 'utf8');
    expect(first).toBeDefined();

    // Update STATE.yaml so the loaded stage differs.
    const stateMgr2 = new StateManager(azaDir);
    await stateMgr2.update({ pipeline: { ...(await stateMgr2.load()).pipeline, current_stage: 'design' as any } });
    await lc.syncStateFromFile();

    // Poll for async runOne — same pattern as worker-scheduler.test.ts
    let report: WorkerReport | null = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      report = await scheduler.getReport('consolidate');
      if (report) break;
    }
    expect(report).not.toBeNull();
    await scheduler.stop();
  });

  it('3) strike event fans out to on-strike workers (deepdive)', async () => {
    const stateManager = new StateManager(azaDir);
    await stateManager.load();
    const registry = new WorkerRegistry();
    registry.register('deepdive', runDeepdive);
    const scheduler = new WorkerScheduler({
      azaDir,
      stateManager,
      registry,
      heartbeatMs: 100,
    });
    scheduler.registerTriggers([
      { name: 'deepdive', schedule: 'on-strike', enabled: true },
    ]);

    const lc = new LoopController({ enableV12: true, maxIterations: 5, azaDir });
    lc.setWorkerScheduler(scheduler);

    // recordAction with repeated actions triggers a strike.
    for (let i = 0; i < 4; i++) {
      lc.recordAction('aza_quality_check', 'check');
    }
    lc.notifyStrike('test_strike');

    let report: WorkerReport | null = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      report = await scheduler.getReport('deepdive');
      if (report) break;
    }
    expect(report).not.toBeNull();
    await scheduler.stop();
  });

  it('4) completion event fans out to on-completion workers (document)', async () => {
    const stateManager = new StateManager(azaDir);
    await stateManager.load();
    const registry = new WorkerRegistry();
    registry.register('document', runDocument);
    const scheduler = new WorkerScheduler({
      azaDir,
      stateManager,
      registry,
      heartbeatMs: 100,
    });
    scheduler.registerTriggers([
      { name: 'document', schedule: 'on-completion', enabled: true },
    ]);

    const lc = new LoopController({ enableV12: true, maxIterations: 5, azaDir });
    lc.setWorkerScheduler(scheduler);
    lc.notifyCompletion();

    let report: WorkerReport | null = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      report = await scheduler.getReport('document');
      if (report) break;
    }
    expect(report).not.toBeNull();
    await scheduler.stop();
  });

  it('5) buildDefaultRegistry registers all 12 workers (sanity)', () => {
    const r = buildDefaultRegistry();
    expect(r.size()).toBe(12);
    expect(r.has('consolidate')).toBe(true);
    expect(r.has('document')).toBe(true);
    expect(r.has('deepdive')).toBe(true);
  });

  it('6) DEFAULT_TRIGGERS wires all 12 schedules correctly', () => {
    const names = DEFAULT_TRIGGERS.map((t) => t.name);
    const schedules = DEFAULT_TRIGGERS.map((t) => t.schedule);
    expect(names).toHaveLength(12);
    // Verify a few key schedules
    const map = new Map(DEFAULT_TRIGGERS.map((t) => [t.name, t.schedule]));
    expect(map.get('consolidate')).toBe('on-stage-advance');
    expect(map.get('document')).toBe('on-completion');
    expect(map.get('deepdive')).toBe('on-strike');
    expect(map.get('ultralearn')).toBe('every-270s');
    expect(schedules.filter((s) => s === 'every-270s')).toHaveLength(4);
  });

  it('7) AutoLoopEngine with disableWorkerScheduler=true does not create a scheduler', async () => {
    const engine = new AutoLoopEngine({
      azaDir,
      client: 'integration-test',
      maxIterations: 5,
      disableWorkerScheduler: true,
    });
    expect((engine as any).workerScheduler).toBeNull();
    await engine.start();
    await engine.stop();
  });
});
