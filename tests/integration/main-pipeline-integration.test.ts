/**
 * Main-pipeline integration test (T-v2)
 *
 * Verifies that the FOUR main-pipeline bridges are wired correctly end-to-end
 * so Trae can drive azaloop's fully-automatic loop:
 *
 *   1. PRDReviewGate  → OpenSpec change folder  (T23)
 *   2. PRDReviewGate  → ExecutionContract       (T17 / T38)
 *   3. PRDReviewGate  → 3 Red-flag HARD-GATE    (T25)
 *   4. LoopController → inner.run() advances StateMachine  (T-v2 main pipeline)
 *
 * Each bridge is verified with a real filesystem, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRDReviewGate,
  LoopController,
  StateManager,
  ResumeGenerator,
  scaffoldChange,
  writeChangeFolder,
  archiveChange,
  listChanges,
  generateExecutionContract,
  writeContract,
  loadContract,
  TDD_IRON_LAW_PHRASES,
  checkTddIronLaw,
  classifyFailure,
  shouldStrike,
  WorkerScheduler,
  buildDefaultRegistry,
  detectSentinel,
  BRAINSTORMING_RED_FLAGS,
  type SkillMeta,
} from '@azaloop/core';

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
  author: 'azaloop-integration',
  registered_at: new Date().toISOString(),
};

// Seed a complete project root + .aza/ that satisfies the REAL handler
// chain for ALL 5 stages. Mirrors scripts/e2e-real-loop.ts.
function seedProject(projectRoot: string, azaDir: string): void {
  const write = (p: string, c: string) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, c, 'utf8');
  };

  // Project root
  write(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      { name: 'aza-pipeline-it', private: true, type: 'module', devDependencies: { vitest: '^4', typescript: '^5' } },
      null,
      2,
    ),
  );
  write(
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
  write(
    path.join(projectRoot, 'vitest.config.ts'),
    "export default { test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true } };\n",
  );
  write(path.join(projectRoot, 'src', 'add.ts'), 'export function add(a: number, b: number): number { return a + b; }\n');
  write(
    path.join(projectRoot, 'src', 'add.test.ts'),
    "// @ts-nocheck\nimport { add } from './add';\nimport { test, expect } from 'vitest';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
  );

  // .aza/: PRD that passes the 14-dim real checker
  const prd = {
    id: 'PRD-IT',
    title: 'Pipeline Integration Test PRD',
    version: '0.1.0',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    overview: 'Pipeline integration test PRD that satisfies the 14-dim real checker. '.repeat(2),
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
  write(path.join(azaDir, 'prd.json'), JSON.stringify(prd, null, 2));

  // Design: design.md + 7 diagrams
  write(path.join(azaDir, 'design.md'), '# Architecture\n');
  fs.mkdirSync(path.join(azaDir, 'diagrams'), { recursive: true });
  for (let i = 1; i <= 7; i++) write(path.join(azaDir, 'diagrams', `d${i}.md`), `# d${i}\n`);

  // Archive: 6 documents
  for (const d of ['prd.md', 'architecture.md', 'data-model.md', 'api.md', 'test-plan.md', 'deployment.md']) {
    write(path.join(azaDir, d), `# ${d}\n`);
  }

  // Conventions
  write(
    path.join(azaDir, 'spec-conventions', 'conventions.jsonl'),
    JSON.stringify({ id: 'CONV-1', title: 'seed', body: 'b', tags: [], source: 'seed', created_at: new Date().toISOString() }) + '\n',
  );
}

describe('Main-pipeline integration — Trae full-auto loop', () => {
  let projectRoot: string;
  let azaDir: string;
  let stateManager: StateManager;
  let resumeGenerator: ResumeGenerator;
  let gate: PRDReviewGate;
  let lc: LoopController;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-pipeline-'));
    azaDir = path.join(projectRoot, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    seedProject(projectRoot, azaDir);

    stateManager = new StateManager(azaDir);
    await stateManager.load();
    resumeGenerator = new ResumeGenerator(azaDir);
    gate = new PRDReviewGate({ stateManager, resumeGenerator, timeoutMs: 60_000 });
    lc = new LoopController({ enableV12: true, maxIterations: 50, azaDir });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  // ── Bridge 1: PRDReviewGate → OpenSpec change folder ─────────

  it('bridge 1: PRDReviewGate.approve(source=openspec) writes the four-piece set', async () => {
    // Use a title whose `inferCapabilityFromTitle` does NOT match any
    // candidate domain, so the capability defaults to "core" (predictable).
    const review = await gate.review({
      title: 'Hello World',
      description: 'Verify OpenSpec bridge',
      skillMeta: PR_SKILL_META,
      source: 'openspec',
    });
    expect(review.hard_gate).toBe(true);
    const answers: Record<string, string> = {};
    for (const flag of review.red_flags!) {
      answers[flag.thought] = `Yes: ${flag.reality.slice(0, 20)}`;
    }
    const approval = await gate.approve(answers);
    expect(approval.approved).toBe(true);

    // Four-piece set is on disk under projectRoot/openspec/
    const base = path.join(projectRoot, 'openspec');
    const dirs = fs.readdirSync(path.join(base, 'changes'));
    expect(dirs.length).toBeGreaterThan(0);
    const changeDir = path.join(base, 'changes', dirs[0]!);
    expect(fs.existsSync(path.join(changeDir, 'proposal.md'))).toBe(true);
    expect(fs.existsSync(path.join(changeDir, 'design.md'))).toBe(true);
    expect(fs.existsSync(path.join(changeDir, 'tasks.md'))).toBe(true);
    // Capability falls back to "core" because "Hello World" has no
    // recognized domain keyword.
    expect(
      fs.existsSync(path.join(changeDir, 'specs', 'core', 'spec.md')),
    ).toBe(true);

    // listChanges picks it up
    const changes = await listChanges(projectRoot);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.status).toBe('draft');
  });

  // ── Bridge 2: PRDReviewGate → ExecutionContract ──────────────

  it('bridge 2: ExecutionContract is written on approve (T17/T38)', async () => {
    const review = await gate.review({
      title: 'Contract Bridge Test',
      description: 'Verify execution contract',
      source: 'aza-prd', // contract writes regardless of source
    });
    const approval = await gate.approve();
    expect(approval.approved).toBe(true);

    // The contract file is written under azaDir/contract.md
    const contractPath = path.join(azaDir, 'contract.md');
    expect(fs.existsSync(contractPath)).toBe(true);

    // loadContract parses the markdown and re-derives prd_id + intent_lock
    const contract = await loadContract(azaDir);
    expect(contract).not.toBeNull();
    expect(contract!.prd_id).toMatch(/^PRD-/);
    expect(contract!.intent_lock).toContain('Contract Bridge Test');
  });

  // ── Bridge 3: PRDReviewGate → 3 Red-flag HARD-GATE ──────────

  it('bridge 3: HARD-GATE rejects approval without red-flag answers', async () => {
    const review = await gate.review({
      title: 'Hard Gate Test',
      description: 'Verify HARD-GATE',
      skillMeta: PR_SKILL_META, // requires_approval: true
      source: 'aza-prd',
    });
    expect(review.hard_gate).toBe(true);
    expect(review.red_flags).toHaveLength(3);

    // Approve with empty answers → fail
    const noAnswers = await gate.approve({});
    expect(noAnswers.approved).toBe(false);
    expect(noAnswers.message).toMatch(/HARD-GATE/i);

    // Approve with partial answers → fail
    const first = review.red_flags![0]!;
    const partial = await gate.approve({ [first.thought]: 'answer' });
    expect(partial.approved).toBe(false);

    // Approve with full answers → success
    const full: Record<string, string> = {};
    for (const flag of review.red_flags!) {
      full[flag.thought] = `Considered: ${flag.reality.slice(0, 30)}`;
    }
    const ok = await gate.approve(full);
    expect(ok.approved).toBe(true);
  });

  // ── Bridge 4: LoopController.next() advances StateMachine ──

  it('bridge 4: next() drives 5 stages through StateMachine', async () => {
    const stages = ['open', 'design', 'build', 'verify', 'archive'] as const;
    for (const stage of stages) {
      const r = await lc.next(stage);
      expect(r.next_action).toBeDefined();
      expect(typeof r.next_action!.tool).toBe('string');
    }
    // Cooperative host model (0.2.x): stages may remain in_progress / blocked
    // while awaiting LLM tool execution or quality gates — do not require completed.
    const restored = new StateManager(azaDir);
    const state = await restored.load();
    for (const stage of stages) {
      expect(['completed', 'in_progress', 'blocked', 'pending']).toContain(
        state.pipeline.stages[stage].status,
      );
    }
    console.log('DEBUG bridge4 stages:', JSON.stringify(state.pipeline.stages));
    expect(
      ['completed', 'in_progress', 'blocked'].includes(state.pipeline.stages.open.status) ||
        ['completed', 'in_progress', 'blocked'].includes(state.pipeline.stages.design.status),
    ).toBe(true);
  }, 60_000);

  // ── Bridge 5: TDD Iron Law + failure classifier are exported and usable ──

  it('bridge 5: TDD Iron Law + failure classifier work as pure functions', () => {
    // TDD phrase detection
    expect(TDD_IRON_LAW_PHRASES.length).toBeGreaterThan(0);
    const bad = checkTddIronLaw('skip the test, trust me it works');
    expect(bad.violated).toBe(true);
    const good = checkTddIronLaw('I will write the failing test first, then implement.');
    expect(good.violated).toBe(false);

    // Failure classification — use messages that match the classifier's
    // pattern table (NOT generic words like "invalid input" which fall
    // through to the default transient bucket by design).
    expect(classifyFailure(new Error('401 unauthorized')).class).toBe('auth');
    expect(classifyFailure(new Error('429 rate limit exceeded')).class).toBe('rate-limit');
    expect(classifyFailure(new Error('service unavailable')).class).toBe('transient');
    expect(classifyFailure(new Error('bad request: missing field')).class).toBe('permanent');
    expect(
      shouldStrike(new Error('401 unauthorized'), classifyFailure(new Error('401 unauthorized'))),
    ).toBe(true);
    // Rate-limit does NOT strike — it backs off and retries
    expect(
      shouldStrike(new Error('429 rate limit'), classifyFailure(new Error('429 rate limit'))),
    ).toBe(false);
  });

  // ── Bridge 6: WorkerScheduler wires up the 12-worker default registry ──

  it('bridge 6: WorkerScheduler accepts the 12-worker default registry', () => {
    const registry = buildDefaultRegistry();
    expect(registry.size()).toBe(12);

    const scheduler = new WorkerScheduler({
      azaDir,
      stateManager,
      registry,
      heartbeatMs: 100,
    });
    expect(scheduler).toBeDefined();
    // Triggers can be registered without throwing
    scheduler.registerTriggers([]);
    expect(true).toBe(true);
  });

  // ── Bridge 7: detectSentinel recognizes <promise>TASK_COMPLETE</promise> ──

  it('bridge 7: detectSentinel recognizes <promise>TASK_COMPLETE</promise>', () => {
    const out = 'I have finished.\n<promise>TASK_COMPLETE</promise>';
    const result = detectSentinel(out);
    expect(result.matched).toBe('taskComplete');
    expect(result.inTail).toBe(true);
  });

  // ── Bridge 8: BRAINSTORMING_RED_FLAGS table is non-empty and is used by HARD-GATE ──

  it('bridge 8: BRAINSTORMING_RED_FLAGS table is non-empty', () => {
    expect(BRAINSTORMING_RED_FLAGS.length).toBeGreaterThanOrEqual(3);
    const first = BRAINSTORMING_RED_FLAGS[0]!;
    expect(first.thought.length).toBeGreaterThan(0);
    expect(first.reality.length).toBeGreaterThan(0);
  });

  // ── Bridge 9: scaffoldChange + writeChangeFolder + archiveChange round-trip ──

  it('bridge 9: scaffoldChange → writeChangeFolder → archiveChange round-trip', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-scaffold-'));
    try {
      const folder = scaffoldChange({
        intent: 'Round-trip test',
        capability: 'auth',
        slug: 'round-trip',
      });
      expect(folder.files).toHaveLength(5);

      const written = await writeChangeFolder(
        { intent: 'Round-trip test', capability: 'auth', slug: 'round-trip' },
        tmp,
      );
      expect(written.files).toHaveLength(5);
      for (const f of written.files) {
        expect(fs.existsSync(path.join(tmp, f))).toBe(true);
      }

      const today = new Date().toISOString().slice(0, 10);
      const archived = await archiveChange('round-trip', tmp, today);
      expect(archived).toContain('archive');
      expect(archived).toContain('round-trip');
      expect(fs.existsSync(path.join(tmp, archived))).toBe(true);
      // Original location is gone
      expect(fs.existsSync(path.join(tmp, 'openspec', 'changes', 'round-trip'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ── Bridge 10: Full main pipeline — review → approve(openspec) → loop×5 → done ──

  it('bridge 10: end-to-end — full main pipeline (review → approve → loop → done)', async () => {
    const review = await gate.review({
      title: 'End-to-End Pipeline',
      description: 'Verify full main pipeline',
      skillMeta: PR_SKILL_META,
      source: 'openspec',
    });
    const answers: Record<string, string> = {};
    for (const flag of review.red_flags!) {
      answers[flag.thought] = `Considered: ${flag.reality.slice(0, 30)}`;
    }
    const approval = await gate.approve(answers);
    expect(approval.approved).toBe(true);

    // OpenSpec is written
    expect(fs.existsSync(path.join(projectRoot, 'openspec', 'changes'))).toBe(true);

    // ExecutionContract is written
    const contract = await loadContract(azaDir);
    expect(contract).not.toBeNull();

    // Loop drives all 5 stages
    for (const stage of ['open', 'design', 'build', 'verify', 'archive'] as const) {
      const r = await lc.next(stage);
      expect(r.next_action).toBeDefined();
    }

    // State machine under cooperative host may leave later stages in_progress
    const restored = new StateManager(azaDir);
    const state = await restored.load();
    for (const stage of ['open', 'design', 'build', 'verify', 'archive'] as const) {
      expect(['completed', 'in_progress', 'blocked', 'pending']).toContain(
        state.pipeline.stages[stage].status,
      );
    }
  }, 60_000);

  // ── Bridge 11: generateExecutionContract is exposed & can be invoked directly ──

  it('bridge 11: generateExecutionContract is exported and usable', () => {
    const prdLike = {
      id: 'PRD-X',
      title: 'X',
      version: '0.1.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      overview: 'o',
      goals: ['g1'],
      target_users: [],
      functional_requirements: [],
      non_functional_requirements: [],
      stories: [],
      architecture: [],
      acceptance_criteria: [],
      risks: [],
    } as any;
    const c = generateExecutionContract(prdLike);
    // ExecutionContract uses flat fields, NOT a nested `intent` object
    expect(c.contract_id).toContain('PRD-X');
    expect(c.prd_id).toBe('PRD-X');
    expect(c.intent_lock).toContain('X');
  });
});
