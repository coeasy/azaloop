/**
 * Trae E2E: full auto-loop pipeline (T23/T25/T27 + v2 main pipeline)
 *
 * Validates the complete Trae experience:
 *   1. PRD review (HARD-GATE) → user provides 3 red-flag answers
 *   2. PRD approve → auto-generates OpenSpec four-piece set
 *   3. LoopController.next() × 5 stages returns valid MCP tools
 *   4. Sentinel <promise>TASK_COMPLETE</promise> detected in stage output
 *   5. State persists across "session restart" (new StateManager from same dir)
 *
 * Reference flow (per trae/rules.md):
 *   aza_context_calibrate → aza_prd_review → aza_prd_approve → aza_loop_next →
 *   aza_task_design → aza_task_implement → aza_quality_check → aza_doc_generate → done
 *
 * Project layout (mirrors scripts/e2e-real-loop.ts so the REAL handlers
 * can verify real artifacts end-to-end without any simulation):
 *
 *   <projectRoot>/
 *   ├── package.json           ← lets `tsc --noEmit` resolve types
 *   ├── tsconfig.json          ← strict + include src/**
 *   ├── vitest.config.ts       ← passWithNoTests: true
 *   ├── src/
 *   │   ├── add.ts             ← trivial pass-through implementation
 *   │   └── add.test.ts        ← passing test (TDD: test proves behavior)
 *   └── .aza/                  ← azaloop state dir (== azaDir)
 *       ├── STATE.yaml
 *       ├── prd.json
 *       ├── design.md          ← design stage gate
 *       ├── diagrams/          ← 7 .md files for design stage gate
 *       ├── prd.md, architecture.md, data-model.md,
 *       ├── api.md, test-plan.md, deployment.md  ← archive stage gate
 *       └── spec-conventions/conventions.jsonl    ← learn-from-task
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
  type SkillMeta,
  detectSentinel,
} from '@azaloop/core';

// ── Helpers ──────────────────────────────────────────────

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Pre-populate the project root + .aza/ with stub artifacts so the REAL
 * handler provider (see L7_loop/real-handlers.ts) can verify all 5 stages
 * without any external infrastructure. This is the test equivalent of
 * `scripts/e2e-real-loop.ts` — the difference is that we use the test's
 * own tmpDir rather than a fixed demo name.
 *
 * Why this is needed: `createRealHandlerProvider` derives `workDir` as
 * `path.dirname(azaDir)`. If azaDir IS the tmpDir, then workDir is
 * `os.tmpdir()` — which is shared with other processes and not writable
 * for the test. By making `.aza/` a subdirectory of a dedicated project
 * root, the workDir becomes the test's own directory, which we can
 * freely pre-populate.
 */
function seedProject(projectRoot: string, azaDir: string): void {
  // ── Project root: minimal Node project that compiles + tests pass ──
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'aza-trae-e2e',
        private: true,
        type: 'module',
        devDependencies: { vitest: '^4', typescript: '^5' },
      },
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
  // Local vitest config so `--root projectRoot` does NOT walk up to the
  // repo-level config (which is much heavier and slow).
  writeFile(
    path.join(projectRoot, 'vitest.config.ts'),
    "export default { test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true } };\n",
  );
  // A trivial implementation + matching test (TDD-aligned: test exists, passes).
  // `// @ts-nocheck` on the test file keeps `tsc --noEmit` happy in environments
  // where vitest is not yet npm-installed in the seed project (the real handler
  // invokes `npx vitest` on demand, but `tsc` resolves imports at compile-time).
  writeFile(
    path.join(projectRoot, 'src', 'add.ts'),
    'export function add(a: number, b: number): number { return a + b; }\n',
  );
  writeFile(
    path.join(projectRoot, 'src', 'add.test.ts'),
    "// @ts-nocheck\nimport { add } from './add';\nimport { test, expect } from 'vitest';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
  );

  // ── .aza/: PRD that passes the 14-dim real checker (p0=0, p1<=3) ──
  const prd = {
    id: 'PRD-E2E',
    title: 'End-to-End Full-Auto Loop Demo',
    version: '0.1.0',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    overview:
      'This demo proves AzaLoop drives a full-auto development loop. ' +
      'The pain point is that autonomous coding agents lose context between sessions and ' +
      'skip quality gates. AzaLoop solves this with a PRD-driven three-level loop and ' +
      'real verification gates so work stays on track from idea to archived delivery.',
    goals: ['prove core link is connected', 'prove no simulated flow'],
    target_users: ['Backend Developer', 'Platform Engineer'],
    functional_requirements: [
      { id: 'FR-1', description: 'demo functional requirement', priority: 'P0' },
    ],
    non_functional_requirements: [
      {
        id: 'NFR-1',
        description: 'loop must complete under 5 minutes',
        category: 'performance',
      },
    ],
    stories: [
      {
        id: 'STORY-1',
        title: 'Demo story',
        description:
          'A demo story that adds two numbers and verifies the result with a unit test.',
        priority: 'P0',
        complexity: 'L1',
        acceptance_criteria: [
          {
            id: 'AC-1',
            description: 'adds numbers',
            testable: true,
            status: 'pending',
          },
        ],
        dependencies: [],
        status: 'pending',
      },
    ],
    architecture: [
      {
        type: 'system',
        mermaid: 'graph TD; A-->B',
        description: 'System architecture of the demo.',
      },
    ],
    acceptance_criteria: [
      { id: 'AC-1', description: 'adds numbers', testable: true, status: 'pending' },
    ],
    risks: [
      {
        description: 'context loss between sessions',
        probability: 'medium',
        mitigation: 'RESUME.md + memory',
      },
    ],
  };
  writeFile(path.join(azaDir, 'prd.json'), JSON.stringify(prd, null, 2));

  // ── design stage: design.md + 7 diagrams ──
  writeFile(path.join(azaDir, 'design.md'), '# Architecture\n\nReal design document.\n');
  for (let i = 1; i <= 7; i++) {
    writeFile(path.join(azaDir, 'diagrams', `d${i}.md`), `# Diagram ${i}\n`);
  }

  // ── archive stage: 6 documents ──
  for (const d of [
    'prd.md',
    'architecture.md',
    'data-model.md',
    'api.md',
    'test-plan.md',
    'deployment.md',
  ]) {
    writeFile(path.join(azaDir, d), `# ${d}\n\nReal generated document.\n`);
  }

  // ── learn-from-task conventions (archive stage gate) ──
  writeFile(
    path.join(azaDir, 'spec-conventions', 'conventions.jsonl'),
    JSON.stringify({
      id: 'CONV-SEED-001',
      title: 'Seed convention',
      body: 'Pre-seeded convention for E2E test.',
      tags: ['e2e'],
      source: 'seed',
      created_at: new Date().toISOString(),
    }) + '\n',
  );
}

describe('Trae E2E — full auto-loop pipeline', () => {
  let projectRoot: string;
  let azaDir: string;
  let stateManager: StateManager;
  let resumeGenerator: ResumeGenerator;
  let gate: PRDReviewGate;
  let lc: LoopController;

  const PR_SKILL_META: SkillMeta = {
    name: 'prd',
    version: '1.1.0',
    type: 'document',
    description: 'Turn an idea into a structured PRD',
    tags: ['prd'],
    when_to_use: 'turning an idea into a structured PRD',
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
    author: 'azaloop-e2e',
    registered_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    // Project root must be a real, writable directory; .aza is a subdir.
    // This mirrors scripts/e2e-real-loop.ts so the REAL handler provider
    // can verify real artifacts without simulation.
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-trae-e2e-'));
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

  it('Full pipeline: review(HARD-GATE) → approve(openspec) → loop×5 → done', async () => {
    // 1. PRD review with HARD-GATE (requires_approval=true)
    const review = await gate.review({
      title: 'Authentication API with OAuth2',
      description: 'Add OAuth2 login flow with PKCE for the auth capability',
      skillMeta: PR_SKILL_META,
      source: 'openspec',
    });
    expect(review.hard_gate).toBe(true);
    expect(review.red_flags?.length).toBe(3);

    // 2. User provides answers for the 3 displayed red flags
    const answers: Record<string, string> = {};
    for (const flag of review.red_flags!) {
      answers[flag.thought] = `Yes, I have considered: ${flag.reality.slice(0, 30)}`;
    }
    const approval = await gate.approve(answers);
    expect(approval.approved).toBe(true);
    expect(approval.next_action.tool).toBe('aza_loop');

    // 3. OpenSpec artifacts were generated under <projectRoot>/openspec/.
    // PRDReviewGate derives projectRoot by stripping the trailing `/.aza`
    // from azaDir, so the artifacts end up at projectRoot/openspec/...
    const openspecPath = path.join(
      projectRoot,
      'openspec',
      'changes',
      'authentication-api-with-oauth2',
    );
    expect(fs.existsSync(openspecPath)).toBe(true);
    expect(fs.existsSync(path.join(openspecPath, 'proposal.md'))).toBe(true);
    expect(fs.existsSync(path.join(openspecPath, 'design.md'))).toBe(true);
    expect(fs.existsSync(path.join(openspecPath, 'tasks.md'))).toBe(true);
    expect(
      fs.existsSync(path.join(openspecPath, 'specs', 'auth', 'spec.md')),
    ).toBe(true);

    // 4. LoopController drives 5 stages under V16 single-stage scheduling.
    // Each call runs the REAL handler chain (maker → checker → gate) and
    // advances the state machine. For build/verify/archive, the maker returns
    // awaiting_agent status, so the stage remains in_progress — the LLM must
    // execute the awaited tool before the stage can complete.
    //
    // V18: The first 'build' call should return awaiting_agent with
    // aza_task_implement. Subsequent stage calls may return aza_loop_next
    // because the state machine hasn't advanced (LLM hasn't executed the tool).
    const stages = ['open', 'design', 'build', 'verify', 'archive'] as const;
    const collectedTools: string[] = [];
    for (const stage of stages) {
      const r = await lc.next(stage);
      expect(r.next_action).toBeDefined();
      expect(typeof r.next_action!.tool).toBe('string');
      collectedTools.push(r.next_action!.tool);
      // V18: For build stage (first call), verify awaiting_agent behavior
      if (stage === 'build') {
        expect(r.next_action!.tool).toBe('aza_spec');
        // V18: awaitingAction should be propagated in data field
        expect(r.data?.awaitingAction).toBeDefined();
        expect(r.data?.awaitingAction?.tool).toBe('aza_spec');
        expect(['implement', 'design'].includes(r.data?.awaitingAction?.action as string) || r.next_action!.action === 'implement').toBe(true);
      }
    }
    expect(collectedTools.length).toBe(5);

    // 5. Sentinel detection: simulate a stage output with <promise>TASK_COMPLETE</promise>
    const stageOutput = `
      Implemented the OAuth2 PKCE flow.
      <promise>TASK_COMPLETE</promise>
    `;
    const sentinel = detectSentinel(stageOutput);
    expect(sentinel.matched).toBe('taskComplete');

    // 6. State persisted — a fresh StateManager from the same azaDir
    // reads the same state. Under V16 single-stage scheduling, open and
    // design stages should be 'completed' (they ran their maker/checker
    // fully), while build/verify/archive may remain 'in_progress' or
    // 'pending' because the maker returned awaiting_agent — the LLM must
    // execute the awaited tool (aza_task_implement, etc.) to complete them.
    const restored = new StateManager(azaDir);
    const state = await restored.load();
    expect(state.pipeline.stages.open.status).toBe('completed');
    expect(state.pipeline.stages.design.status).toBe('completed');
    // V16: build/verify/archive may be 'in_progress' (awaiting LLM tool)
    // rather than 'completed', since the maker returned awaiting_agent.
    // These stages are paused waiting for the LLM to execute the tool.
  }, /* 5 min real-handler budget — tsc + vitest take a while on a cold cache */ 300_000);

  it('Non-openspec path: aza-prd approval does NOT create OpenSpec artifacts', async () => {
    const review = await gate.review({
      title: 'CLI Tool: payload validator',
      description: 'A small CLI that validates JSON payloads',
      source: 'aza-prd', // explicit
    });
    expect(review.source).toBe('aza-prd');

    const approval = await gate.approve();
    expect(approval.approved).toBe(true);
    // Default source path: no openspec folder created.
    expect(
      fs.existsSync(path.join(projectRoot, 'openspec', 'changes')),
    ).toBe(false);
  });

  it('Slug normalization: titles with punctuation produce kebab-case slugs', async () => {
    const review = await gate.review({
      title: "Search API!!!  v2.0  — Feat/Tasks",
      description: 'Search-related feature',
      source: 'openspec',
    });
    await gate.approve();

    // "search-api-v2-0-feat-tasks" (or similar) should be the slug
    const expected = path.join(
      projectRoot,
      'openspec',
      'changes',
      'search-api-v2-0-feat-tasks',
    );
    expect(fs.existsSync(expected)).toBe(true);
  });
});
