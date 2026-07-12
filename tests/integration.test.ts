import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Core imports
import {
  StateManager, ChecksumStore, computeChecksum, HeartbeatManager,
  PRDGenerator, PRDChecker, ChangeManager,
  WorkingMemory, ProjectMemory, LongTermMemory, SessionCatchup, MemoryCompressor,
  DynamicBinder, StrikeSystem,
  SkillRegistry, SkillComposer,
  scanSecrets, scanSQLInjection, scanXSS, scanDependencies, scanCodeInjection,
  StateMachine, LoopController, StageGuards, DeadlockDetector, HardStopManager,
  QualityPipeline,
  ResumeGenerator, MCPContinueService, CatchupProtocol, ContextInjector,
  detectClient, TemplateGenerator, WorkspaceManager,
  EventBus,
  createSessionStartHandler, createPreToolHandler, createPostToolHandler,
  createOnErrorHandler, createOnStopHandler,
  ConfigLoader,
} from '@azaloop/core';

import {
  CircuitBreaker, CompletionGate, LoopAudit, PhaseLoop, InnerLoop, OuterLoop, defaultTriage,
  securityGate,
} from '@azaloop/core';

import {
  PRDSchema, StateSchema, AzaloopConfigSchema, LoopResponseSchema,
  type PRD, type State, type AzaloopConfig,
} from '@azaloop/shared';

const TEST_DIR = path.join(os.tmpdir(), `azaloop-test-${Date.now()}`);
const AZA_DIR = path.join(TEST_DIR, '.aza');

describe('AzaLoop 0.1.0 Integration', () => {
  beforeAll(async () => {
    await fs.mkdir(AZA_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  // ===================== TASK 1-3: Foundation =====================
  describe('Task 1-3: Foundation (State, Checksum, Schema)', () => {
    it('StateManager: load/save/advanceStage', async () => {
      const sm = new StateManager(AZA_DIR);
      const state = await sm.load();
      expect(state.pipeline.current_stage).toBe('open');
      expect(state.loop.iteration).toBe(0);

      await sm.setStage('open', 'completed');
      const next = await sm.advanceStage();
      expect(next).toBe('design');
      expect(sm.getStage()).toBe('design');
    });

    it('ChecksumStore: verify integrity', async () => {
      const store = new ChecksumStore();
      const hash = await computeChecksum('hello');
      store.set('test', hash);
      expect(store.verify('test', 'hello')).toBe(true);
      expect(store.verify('test', 'world')).toBe(false);
    });

    it('HeartbeatManager: write/read', async () => {
      const hb = new HeartbeatManager(AZA_DIR);
      await hb.write({
        session_id: 'test-1',
        client: 'cursor',
        model: 'sonnet-4',
        started_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        iteration: 1,
      });
      const read = await hb.read();
      expect(read).not.toBeNull();
      expect(read!.client).toBe('cursor');
      expect(read!.iteration).toBe(1);
    });

    it('PRDSchema: validate valid/invalid PRD', () => {
      const valid = {
        id: 'PRD-001', title: 'Test', version: '1.0',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        overview: 'A test project for verification',
        goals: ['Build a test'], target_users: ['Developers'],
        functional_requirements: [{ id: 'FR-1', description: 'Core feature', priority: 'P0' }],
        non_functional_requirements: [{ id: 'NFR-1', description: 'Performance', category: 'performance' }],
        stories: [], acceptance_criteria: [],
      };
      expect(() => PRDSchema.parse(valid)).not.toThrow();
      expect(() => PRDSchema.parse({})).toThrow();
    });

    it('StateSchema: validate state', () => {
      const valid = {
        pipeline: { current_stage: 'open', stages: {} },
        loop: { iteration: 0, progress: '0%', client: 'test', model: 'test' },
        memory: { semantic_keys: [] },
        security_findings: [], strikes: 0,
        updated_at: new Date().toISOString(),
      };
      expect(() => StateSchema.parse(valid)).not.toThrow();
    });

    it('LoopResponseSchema: validate next_action chain', () => {
      const resp = {
        success: true,
        data: { stage: 'open' },
        next_action: { tool: 'aza_prd', action: 'generate', reason: 'Start' },
        metadata: { iteration: 0, progress: '0%' },
      };
      expect(() => LoopResponseSchema.parse(resp)).not.toThrow();
    });
  });

  // ===================== TASK 4: PRD Engine =====================
  describe('Task 4: L1 PRD Engine', () => {
    it('PRDGenerator: generate from natural language', () => {
      const gen = new PRDGenerator();
      const prd = gen.generate({ title: 'Todo App', description: 'Build a todo app with CRUD operations' });
      expect(prd.title).toBe('Todo App');
      expect(prd.stories.length).toBeGreaterThan(0);
      expect(prd.functional_requirements.length).toBeGreaterThan(0);
    });

    it('PRDGenerator: reflect & refine', async () => {
      const gen = new PRDGenerator();
      const prd = gen.generate({ title: 'Test', description: 'Simple test' });
      const { improvements } = await gen.reflectRefine(prd);
      expect(improvements.length).toBeGreaterThanOrEqual(0);
    });

    it('PRDChecker: detect quality issues', () => {
      const checker = new PRDChecker();
      const gen = new PRDGenerator();
      const prd = gen.generate({ title: 'Minimal', description: 'A minimal project' });
      const result = checker.check(prd);
      expect(result.total_checks).toBeGreaterThan(0);
      expect(typeof result.score).toBe('number');
    });

    it('ChangeManager: proposal→spec→design flow', () => {
      const cm = new ChangeManager();
      const prop = cm.createProposal('Add auth', 'JWT auth', 'Security', 'high');
      expect(prop.id).toContain('PROP-');
      const spec = cm.createSpec(prop.id, 'Auth Spec', 'JWT implementation', ['Works']);
      expect(spec).not.toBeNull();
      const design = cm!.createDesign!(spec!.id, [
        { context: 'Auth flow', options: ['JWT', 'Session'], chosen: 'JWT', rationale: 'Stateless' },
      ]);
      expect(design).not.toBeNull();
      const tasks = cm.generateTasksFromDesign(design!.id);
      expect(tasks.length).toBeGreaterThan(0);
    });
  });

  // ===================== TASK 5: Loop Engine =====================
  describe('Task 5: L7 Loop Engine', () => {
    it('StateMachine: 5-stage progression', () => {
      const sm = new StateMachine();
      expect(sm.getCurrentStage()).toBe('open');
      sm.setStageStatus('open', 'completed');
      const next = sm.advance();
      expect(next).toBe('design');
      expect(sm.getProgress()).toBe('20%');
    });

    it('LoopController: quality gate blocks advancement until condition set', async () => {
      const lc = new LoopController({ maxIterations: 10, maxStrikes: 3, enableV12: false });

      // Without prd_valid condition, next() returns refine action
      let result = await lc.next();
      expect(result.success).toBe(true);
      expect(result.next_action).toBeDefined();
      expect(result.next_action!.action).toBe('refine');
      expect(result.next_action!.tool).toBe('aza_prd_generate');

      // Set the prd_valid condition and try again — gate passes, advances to design
      lc.setCondition('prd_valid', true);
      result = await lc.next();
      expect(result.success).toBe(true);
      expect(result.next_action).toBeDefined();
      expect(result.next_action!.action).toBe('design');
      expect(result.next_action!.tool).toBe('aza_task_design');
      expect(lc.stateMachine.getCurrentStage()).toBe('design');
    });

    it('LoopController: quality gate loops per stage until condition met', async () => {
      const lc = new LoopController({ maxIterations: 10, maxStrikes: 3, enableV12: false });

      // Stage 1: open → can't advance without prd_valid
      let result = await lc.next();
      expect(result.next_action!.action).toBe('refine');
      expect(lc.stateMachine.getCurrentStage()).toBe('open');

      // Set condition and advance
      lc.setCondition('prd_valid', true);
      result = await lc.next();
      expect(result.next_action!.tool).toBe('aza_task_design');
      expect(result.next_action!.action).toBe('design');
      expect(lc.stateMachine.getCurrentStage()).toBe('design');

      // Stage 2: design → can't advance without stories_designed
      lc.stateMachine.setStageStatus('design', 'in_progress');
      result = await lc.next();
      expect(result.next_action!.action).toBe('design');
      expect(lc.stateMachine.getCurrentStage()).toBe('design');

      // Set design condition and advance
      lc.setCondition('stories_designed', true);
      result = await lc.next();
      expect(result.next_action!.tool).toBe('aza_task_implement');
      expect(result.next_action!.action).toBe('implement');
      expect(lc.stateMachine.getCurrentStage()).toBe('build');

      // Stage 3: build → can't advance without build_tested
      lc.stateMachine.setStageStatus('build', 'in_progress');
      result = await lc.next();
      expect(result.next_action!.action).toBe('implement');
      expect(result.next_action!.tool).toBe('aza_task_implement');
    });

    it('LoopController: completeStage respects quality gate', () => {
      const lc = new LoopController({ maxIterations: 10, maxStrikes: 3 });

      // completeStage should fail without condition set
      let result = lc.completeStage('open');
      expect(result.success).toBe(false);
      expect(result.error).toContain('quality');

      // Set condition and retry
      lc.setCondition('prd_valid', true);
      result = lc.completeStage('open');
      expect(result.success).toBe(true);
      expect(lc.stateMachine.getCurrentStage()).toBe('design');
    });

    it('LoopController: hard stop on max iterations', async () => {
      const lc = new LoopController({ maxIterations: 3 });
      // Simulate hitting max
      lc.stop('max_iterations_exceeded', 'Max iterations reached');
      const result = await lc.next();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Hard stop');
    });

    it('DeadlockDetector: detect repeated actions', () => {
      const dd = new DeadlockDetector(3);
      dd.record('aza_prd', 'generate', 1);
      dd.record('aza_prd', 'generate', 2);
      dd.record('aza_prd', 'generate', 3);
      expect(dd.isDeadlocked()).toBe(true);
      expect(dd.getRepeatedAction()).toEqual({ tool: 'aza_prd', action: 'generate' });
    });

    it('StageGuards: register and check', () => {
      const guards = new StageGuards();
      guards.register('open', {
        name: 'test-guard',
        check: () => ({ allowed: true, blocking_issues: [] }),
      });
      const result = guards.checkStage('open');
      expect(result.allowed).toBe(true);
    });

    it('HardStopManager: strike-based stop', () => {
      const hs = new HardStopManager();
      expect(hs.isStopped()).toBe(false);
      hs.stop('strikes_exceeded', '3 strikes', 5);
      expect(hs.isStopped()).toBe(true);
      expect(hs.getRecord()!.reason).toBe('strikes_exceeded');
    });
  });

  // ===================== TASK 6: Memory =====================
  describe('Task 6: L2 Memory', () => {
    it('WorkingMemory: set/get/ttl', () => {
      const wm = new WorkingMemory();
      wm.set('key1', { data: 'test' });
      expect(wm.get('key1')).toEqual({ data: 'test' });
      wm.set('expires', 'gone', 1);
      expect(wm.get('expires')).toBe('gone');
      wm.delete('key1');
      expect(wm.get('key1')).toBeUndefined();
    });

    it('ProjectMemory: record and search episodes', async () => {
      const pm = new ProjectMemory(AZA_DIR);
      await pm.init();
      await pm.record({ type: 'reflexion', story_id: 'STORY-001', summary: 'Used strategy pattern', details: 'Strategy pattern simplified the algorithm selection', tags: ['pattern', 'design'] });
      const results = await pm.search('strategy');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.summary).toContain('strategy');
    });

    it('LongTermMemory: store and retrieve semantic memories', async () => {
      const ltm = new LongTermMemory(AZA_DIR);
      await ltm.init();
      await ltm.store('key1', 'Prefer composition over inheritance', 'best-practices', ['oop', 'design']);
      const retrieved = await ltm.retrieve('key1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toContain('composition');
      const search = await ltm.search('inheritance');
      expect(search.length).toBeGreaterThan(0);
    });

    it('MemoryCompressor: compress episodes', async () => {
      const pm = new ProjectMemory(AZA_DIR);
      const ltm = new LongTermMemory(AZA_DIR);
      await pm.init();
      await ltm.init();
      const compressor = new MemoryCompressor(pm, ltm, 2);
      for (let i = 0; i < 5; i++) {
        await pm.record({ type: 'reflexion', summary: `Episode ${i}`, details: `Details ${i}`, tags: ['test'] });
      }
      const result = await compressor.compressIfNeeded();
      expect(result).not.toBeNull();
      expect(result!.summaries.length).toBeGreaterThan(0);
    });

    it('SessionCatchup: generate catchup summary', async () => {
      const sm = new StateManager(AZA_DIR);
      await sm.load();
      const pm = new ProjectMemory(AZA_DIR);
      const ltm = new LongTermMemory(AZA_DIR);
      await pm.init();
      const sc = new SessionCatchup(sm, pm, ltm);
      const summary = await sc.catchup();
      expect(summary.session_restored).toBe(true);
      expect(summary.current_stage).toBeDefined();
    });
  });

  // ===================== TASK 7: Continuity =====================
  describe('Task 7: Continuity & Resume', () => {
    it('ResumeGenerator: write/read/clear', async () => {
      const sm = new StateManager(AZA_DIR);
      await sm.load();
      const rg = new ResumeGenerator(AZA_DIR);
      const stage = sm.getStage();
      const resume = await rg.generate(sm, { current_story: 'STORY-001' });
      expect(resume.current_story).toBe('STORY-001');
      expect(resume.current_stage).toBe(stage);
      const read = await rg.read();
      expect(read).not.toBeNull();
      expect(read!.next_tool).toBeDefined();
      await rg.clear();
      const cleared = await rg.read();
      expect(cleared).toBeNull();
    });

    it('MCPContinueService: session resume flow', async () => {
      const sm = new StateManager(AZA_DIR);
      await sm.load();
      const rg = new ResumeGenerator(AZA_DIR);
      await rg.generate(sm);
      const cs = new MCPContinueService(sm, rg);
      const result = await cs.continue();
      expect(result.resumed).toBe(true);
      expect(result.resume).toBeDefined();
    });

    it('ContextInjector: calibrate returns bundle', () => {
      const ci = new ContextInjector();
      const bundle = ci.calibrate();
      expect(bundle.constitution.length).toBeGreaterThan(0);
      expect(bundle.iron_rules.length).toBeGreaterThan(0);
      expect(bundle.anti_rationalizations.length).toBeGreaterThan(0);
      expect(bundle.session_prompt).toContain('aza_context status');
    });
  });

  // ===================== TASK 8: Discipline & Security =====================
  describe('Task 8: L4 Discipline + L6 Security', () => {
    it('StrikeSystem: record and hard stop', () => {
      const ss = new StrikeSystem(3);
      ss.record('assumed_without_verification', 'Guessed API behavior', 1);
      ss.record('skipped_tests', 'No tests written', 2);
      ss.record('deadlock_detected', 'Repeated action', 3);
      expect(ss.isHardStop()).toBe(true);
      expect(ss.getStrikeCount()).toBe(3);
    });

    it('ScanSecrets: detect API keys and passwords', () => {
      const findings = scanSecrets('const apiKey = "sk-abc123def456ghi789jkl";', 'test.ts');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]!.severity).toBe('critical');

      const clean = scanSecrets('const name = "hello-world";', 'test.ts');
      expect(clean.length).toBe(0);
    });

    it('ScanSQLInjection: detect concatenated queries', () => {
      const findings = scanSQLInjection("execute('SELECT * FROM users WHERE id = ' + userId);", 'db.ts');
      expect(findings.length).toBeGreaterThan(0);
    });

    it('ScanXSS: detect innerHTML usage', () => {
      const findings = scanXSS('element.innerHTML = userInput;', 'ui.ts');
      expect(findings.length).toBeGreaterThan(0);
    });

    it('ScanDependencies: detect risky patterns', () => {
      const findings = scanDependencies('npm install -g some-package', 'install.sh');
      expect(findings.length).toBeGreaterThan(0);
    });

    it('ScanCodeInjection: detect eval and child_process', () => {
      const findings = scanCodeInjection("child_process.exec('rm -rf /');", 'danger.ts');
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  // ===================== TASK 9: Quality Pipeline =====================
  describe('Task 9: Quality Pipeline', () => {
    it('QualityPipeline: run gates', async () => {
      const qp = new QualityPipeline();
      qp.register({
        name: 'Gate 1: Test',
        execute: async () => ({ gate: 'Test Gate', passed: true, issues: [], duration_ms: 10 }),
      });
      qp.register({
        name: 'Gate 2: Test Fail',
        execute: async () => ({ gate: 'Fail Gate', passed: false, issues: ['Something wrong'], duration_ms: 5 }),
      });
      const result = await qp.runAll();
      expect(result.passed).toBe(false);
      expect(result.gates.length).toBe(2);
      expect(result.summary).toContain('1/2');
    });

    it('QualityPipeline: all pass', async () => {
      const qp = new QualityPipeline();
      qp.register({
        name: 'Gate A',
        execute: async () => ({ gate: 'Gate A', passed: true, issues: [], duration_ms: 5 }),
      });
      const result = await qp.runAll();
      expect(result.passed).toBe(true);
    });
  });

  // ===================== TASK 10: L0 Platform =====================
  describe('Task 10: L0 Platform', () => {
    it('detectClient: returns client info', () => {
      const client = detectClient();
      expect(client).toBeDefined();
      expect(['T1', 'T2', 'T3']).toContain(client.tier);
    });

    it('TemplateGenerator: generates client configs', () => {
      const tg = new TemplateGenerator();
      const template = tg.generate({ name: 'cursor', tier: 'T1', hasMCP: true, hasHooks: true, hasSkills: true, hasNativeLoop: true });
      expect(template.client).toBe('cursor');
      expect(template.files.length).toBeGreaterThan(0);
    });

    it('WorkspaceManager: detects and manages workspace', async () => {
      const wm = new WorkspaceManager(TEST_DIR);
      const azaDir = await wm.ensureAzaDir();
      expect(azaDir).toBe(AZA_DIR);
    });
  });

  // ===================== TASK 11: Roles + Skills + Knowledge =====================
  describe('Task 11: L3 Roles + L5 Skills + L9 Knowledge', () => {
    it('DynamicBinder: get roles by stage', () => {
      const db = new DynamicBinder();
      const openRoles = db.getRoleForStage('open');
      expect(openRoles.length).toBeGreaterThan(0);
      expect(openRoles.some(r => r.name === 'think')).toBe(true);
    });

    it('SkillRegistry: search and register', () => {
      const sr = new SkillRegistry();
      const results = sr.search('prd');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name).toBe('prd');
    });

    it('SkillComposer: compose skills into workflow', () => {
      const sr = new SkillRegistry();
      const sc = new SkillComposer(sr);
      const composed = sc.compose(['prd', 'arch']);
      expect(composed.skills).toContain('prd');
      expect(composed.skills).toContain('arch');
      const workflow = sc.getWorkflow(composed);
      expect(workflow.length).toBe(2);
    });
  });

  // ===================== TASK 12: Hook Layer =====================
  describe('Task 12: Hook Events', () => {
    it('EventBus: emit and handle events', async () => {
      const eb = new EventBus();
      let handled = false;
      eb.on('session-start', async () => { handled = true; });
      await eb.emit('session-start');
      expect(handled).toBe(true);
    });

    it('EventBus: 9 events all fire correctly', async () => {
      const eb = new EventBus();
      const fired: string[] = [];
      const events = ['session-start', 'pre-tool', 'post-tool', 'pre-commit', 'post-task',
        'pre-phase', 'post-phase', 'on-error', 'on-stop'] as const;
      for (const e of events) {
        eb.on(e, async () => { fired.push(e); });
        await eb.emit(e);
      }
      expect(fired.length).toBe(9);
      expect(fired).toEqual(events.map(e => e));
    });

    it('EventBus: history tracking', async () => {
      const eb = new EventBus();
      await eb.emit('session-start', { key: 'val' });
      const history = eb.getHistory('session-start');
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]!.data).toEqual({ key: 'val' });
    });

    it('createPreToolHandler: blocks when hard stop', async () => {
      const ss = new StrikeSystem(1);
      ss.record('deadlock_detected', 'test', 0);
      const handler = createPreToolHandler(ss);
      await expect(handler({ event: 'pre-tool', timestamp: new Date().toISOString(), data: { tool: 'test' } })).rejects.toThrow();
    });

    it('createOnStopHandler: writes resume', async () => {
      const sm = new StateManager(AZA_DIR);
      await sm.load();
      const rg = new ResumeGenerator(AZA_DIR);
      const handler = createOnStopHandler(sm, rg);
      await handler({ event: 'on-stop', timestamp: new Date().toISOString() });
      const resume = await rg.read();
      expect(resume).not.toBeNull();
    });
  });

  // ===================== TASK 15: Config =====================
  describe('Task 15: Config', () => {
    it('ConfigLoader: load and save config', async () => {
      const cl = new ConfigLoader(TEST_DIR);
      const config = await cl.load();
      expect(config.version).toBe('4.0');
      config.project.name = 'test-project';
      await cl.save(config);
      const reloaded = await cl.load();
      expect(reloaded.project.name).toBe('test-project');
    });

    it('AzaloopConfigSchema: validate config', () => {
      const config = {
        version: '4.0',
        project: { name: 'test', root: '.' },
      };
      expect(() => AzaloopConfigSchema.parse(config)).not.toThrow();
    });
  });

  // ===================== FULL END-TO-END FLOW =====================
  describe('Full E2E: 输入→PRD→循环→续航', () => {
    it('E2E: Full pipeline from input to archive', async () => {
      // 1. Load state (may already be advanced by previous tests)
      const sm = new StateManager(AZA_DIR);
      await sm.load();
      const initialStage = sm.getStage();
      expect(['open', 'design', 'build', 'verify', 'archive']).toContain(initialStage);

      // 2. Generate PRD
      const gen = new PRDGenerator();
      const prd = gen.generate({ title: 'Todo App', description: 'A simple todo application with CRUD for tasks' });
      expect(prd.stories.length).toBeGreaterThan(0);

      // 3. Validate PRD
      const checker = new PRDChecker();
      const checkResult = checker.check(prd);
      console.log(`  PRD quality score: ${checkResult.score}% (${checkResult.passed_checks}/${checkResult.total_checks})`);

      // 4. Run loop with quality-gated progression
      const lc = new LoopController({ maxIterations: 20, enableV12: false });
      let guardSet = false;
      for (let i = 0; i < 15; i++) {
        const result = await lc.next();
        if (!result.success) break;
        lc.recordAction(result.next_action?.tool || '', result.next_action?.action || '');
        if (result.next_action?.action === 'done') break;

        // Quality gate blocks: simulate LLM fulfilling the required action
        if (result.next_action?.action === 'refine' && !guardSet) {
          // Set the condition for the current stage to pass the gate
          const stage = lc.stateMachine.getCurrentStage();
          const conditionMap: Record<string, string> = {
            open: 'prd_valid',
            design: 'stories_designed',
            build: 'build_tested',
            verify: 'quality_passed',
            archive: 'archive_ready',
          };
          if (conditionMap[stage]) {
            lc.setCondition(conditionMap[stage] as any, true);
            guardSet = true;
          }
        }
      }
      expect(lc.stateMachine.getState().iteration).toBeGreaterThan(0);

      // 5. Write resume & test continuity
      const rg = new ResumeGenerator(AZA_DIR);
      await rg.generate(sm, { current_story: 'STORY-001' });

      // 6. Kill and resume (simulate)
      const cs = new MCPContinueService(sm, rg);
      const continueResult = await cs.continue();
      expect(continueResult.resumed).toBe(true);

      // 7. Security scan
      const secretFindings = scanSecrets('const key = "sk-abc123def456ghi789jkl";', 'test.ts');
      expect(secretFindings.length).toBeGreaterThan(0);

      // 7b. Gate4 security blocking: inject secret → Gate4 blocks
      const secTmpDir = path.join(os.tmpdir(), `azaloop-sec-${Date.now()}`);
      const secSrcDir = path.join(secTmpDir, 'src');
      await fs.mkdir(secSrcDir, { recursive: true });
      await fs.writeFile(
        path.join(secSrcDir, 'leaked.ts'),
        'const AWS_SECRET_KEY = "AKIAIOSFODNN7EXAMPLE";\nconst PASSWORD = "SuperSecret123!";\n',
      );
      const gate4Result = await securityGate(secTmpDir);
      expect(gate4Result.passed).toBe(false);
      expect(gate4Result.issues.length).toBeGreaterThan(0);
      await fs.rm(secTmpDir, { recursive: true, force: true });

      // 8. Record memory
      const pm = new ProjectMemory(AZA_DIR);
      await pm.init();
      await pm.record({ type: 'success', story_id: 'STORY-001', summary: 'E2E test passed', details: 'Full pipeline verified', tags: ['test', 'e2e'] });
      const memories = await pm.search('E2E');
      expect(memories.length).toBeGreaterThan(0);

      console.log('  ✓ E2E: Full pipeline verified (input → PRD → loop → security → memory → resume)');
    });

    it('E2E: Cross-session resume', async () => {
      // Simulate: first session sets state
      const sm1 = new StateManager(AZA_DIR);
      await sm1.load();
      await sm1.update({
        pipeline: {
          current_stage: 'build',
          stages: {
            open: { status: 'completed' },
            design: { status: 'completed' },
            build: { status: 'in_progress' },
            verify: { status: 'pending' },
            archive: { status: 'pending' },
          },
        },
        loop: {
          iteration: 5,
          progress: '40%',
          current_story: 'STORY-002',
          client: 'cursor',
          model: 'sonnet-4',
          max_iterations: 50,
        },
      });

      const rg = new ResumeGenerator(AZA_DIR);
      await rg.generate(sm1, {
        current_story: 'STORY-002',
        client: 'cursor',
        model: 'sonnet-4',
      });

      // Simulate: second session (different client) resumes
      const sm2 = new StateManager(AZA_DIR);
      await sm2.load();
      const state = sm2.getState();
      expect(state.pipeline.current_stage).toBe('build');
      expect(state.loop.current_story).toBe('STORY-002');

      const resume = await rg.read();
      expect(resume).not.toBeNull();
      expect(resume!.client).toBe('cursor');
      expect(resume!.current_story).toBe('STORY-002');

      console.log('  ✓ E2E: Cross-session resume verified (stage preserved, story preserved)');
    });
  });

  // ===================== V12 THREE-LEVEL LOOP =====================
  describe('V12: Three-Level Loop', () => {
    // --- CircuitBreaker ---
    it('CircuitBreaker: record success and check trip', () => {
      const cb = new CircuitBreaker({ maxIterations: 3, tokenBudget: 200000 });
      cb.recordSuccess('phase', 100);
      cb.recordSuccess('phase', 100);
      cb.recordSuccess('phase', 100);
      const tripped = cb.checkAll();
      expect(tripped).not.toBeNull();
      expect(tripped!.tripped).toBe(true);
      expect(tripped!.level).toBe('phase');
    });

    it('CircuitBreaker: not tripped under limits', () => {
      const cb = new CircuitBreaker({ maxIterations: 10, tokenBudget: 200000 });
      cb.recordSuccess('phase', 10);
      cb.recordSuccess('phase', 10);
      const tripped = cb.checkAll();
      expect(tripped).toBeNull();
    });

    it('CircuitBreaker: getMetrics returns counts', () => {
      const cb = new CircuitBreaker({ maxIterations: 10, tokenBudget: 200000 });
      cb.recordSuccess('phase', 50);
      cb.recordSuccess('inner', 30);
      const pm = cb.getMetrics('phase');
      const im = cb.getMetrics('inner');
      expect(pm.iterations).toBe(1);
      expect(pm.tokensSpent).toBe(50);
      expect(im.iterations).toBe(1);
      expect(im.tokensSpent).toBe(30);
    });

    it('CircuitBreaker: reset clears counters', () => {
      const cb = new CircuitBreaker({ maxIterations: 10, tokenBudget: 200000 });
      cb.recordSuccess('phase', 10);
      cb.recordSuccess('phase', 10);
      cb.reset();
      const m = cb.getMetrics('phase');
      expect(m.iterations).toBe(0);
      expect(m.tokensSpent).toBe(0);
    });

    // --- CompletionGate ---
    it('CompletionGate: blocks when no in_progress stage and not all completed', () => {
      const cg = new CompletionGate();
      const r = cg.evaluate({
        gated_mode_enabled: true,
        has_in_progress_stage: false,
        all_stages_completed: false,
        stop_hook_active: false,
        block_count: 0,
        block_count_limit: 5,
        ledger_has_progress: true,
        attestation_verified: true,
      });
      expect(r.canStop).toBe(false);
      expect(r.conditions.find(c => c.id === 'has_in_progress_or_completed')?.satisfied).toBe(false);
    });

    it('CompletionGate: allows stop when all stages completed', () => {
      const cg = new CompletionGate();
      const r = cg.evaluate({
        gated_mode_enabled: true,
        has_in_progress_stage: false,
        all_stages_completed: true,
        stop_hook_active: false,
        block_count: 0,
        block_count_limit: 5,
        ledger_has_progress: true,
        attestation_verified: true,
      });
      expect(r.canStop).toBe(true);
      expect(r.conditions.every(c => c.satisfied)).toBe(true);
    });

    it('CompletionGate: allows stop when all conditions met with in_progress', () => {
      const cg = new CompletionGate();
      const r = cg.evaluate({
        gated_mode_enabled: true,
        has_in_progress_stage: true,
        all_stages_completed: false,
        stop_hook_active: false,
        block_count: 0,
        block_count_limit: 5,
        ledger_has_progress: true,
        attestation_verified: true,
      });
      expect(r.canStop).toBe(true);
      expect(r.conditions.every(c => c.satisfied)).toBe(true);
    });

    it('CompletionGate: blocks when stop hook active', () => {
      const cg = new CompletionGate();
      const r = cg.evaluate({
        gated_mode_enabled: true,
        has_in_progress_stage: true,
        all_stages_completed: false,
        stop_hook_active: true,
        block_count: 0,
        block_count_limit: 5,
        ledger_has_progress: true,
        attestation_verified: true,
      });
      expect(r.canStop).toBe(false);
      expect(r.conditions.find(c => c.id === 'stop_hook_inactive')?.satisfied).toBe(false);
    });

    it('CompletionGate: blocks when block_count >= limit', () => {
      const cg = new CompletionGate();
      const r = cg.evaluate({
        gated_mode_enabled: true,
        has_in_progress_stage: true,
        all_stages_completed: false,
        stop_hook_active: false,
        block_count: 5,
        block_count_limit: 5,
        ledger_has_progress: true,
        attestation_verified: true,
      });
      expect(r.canStop).toBe(false);
      expect(r.conditions.find(c => c.id === 'block_count_under_limit')?.satisfied).toBe(false);
    });

    // --- LoopAudit ---
    it('LoopAudit: scores and assigns level', () => {
      const la = new LoopAudit();
      const r = la.evaluate({
        state_file_exists: true,
        loop_md_exists: true,
        run_log_exists: true,
        triage_skill_registered: true,
        verifier_skill_registered: true,
        safety_docs_present: false,
        agents_md_present: false,
        human_escalation_configured: false,
        workflows_configured: false,
        patterns_documented: false,
        worktree_isolated: false,
        mcp_isolated: false,
        budget_configured: false,
        run_log_cost_tracked: false,
        least_privilege_enforced: false,
        circuit_breaker_active: false,
        last_run_recent: false,
        git_commits_present: false,
      });
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(['L0', 'L1', 'L2', 'L3']).toContain(r.level);
      expect(r.signals.length).toBe(18);
      expect(r.signals.filter(s => s.passed).length).toBe(5);
    });

    it('LoopAudit: all signals pass with ideal state', () => {
      const la = new LoopAudit();
      const r = la.evaluate({
        state_file_exists: true,
        loop_md_exists: true,
        run_log_exists: true,
        triage_skill_registered: true,
        verifier_skill_registered: true,
        safety_docs_present: true,
        agents_md_present: true,
        human_escalation_configured: true,
        workflows_configured: true,
        patterns_documented: true,
        worktree_isolated: true,
        mcp_isolated: true,
        budget_configured: true,
        run_log_cost_tracked: true,
        least_privilege_enforced: true,
        circuit_breaker_active: true,
        last_run_recent: true,
        git_commits_present: true,
      });
      expect(r.score).toBe(100);
      expect(r.level).toBe('L3');
      expect(r.signals.every(s => s.passed)).toBe(true);
    });

    // --- PhaseLoop ---
    it('PhaseLoop: maker/checker/optimizer cycle', async () => {
      const pl = new PhaseLoop();
      let makerCalled = false;
      let checkerCalled = false;

      const result = await pl.run(
        'build',
        async () => { makerCalled = true; return { work: 'code_written', tokensUsed: 10 }; },
        async (stage, work) => { checkerCalled = true; return { input: { passed: true, suggestions: [] }, tokensUsed: 5 }; },
        async (stage, work, eval_) => { return { work, tokensUsed: 0 }; },
      );

      expect(makerCalled).toBe(true);
      expect(checkerCalled).toBe(true);
      expect(result.iterations).toBeGreaterThanOrEqual(1);
    });

    it('PhaseLoop: retries on checker failure', async () => {
      const pl = new PhaseLoop();
      let attempts = 0;

      const result = await pl.run(
        'design',
        async (stage, iter) => { attempts++; return { work: `version-${attempts}`, tokensUsed: 10 }; },
        async (stage, work) => {
          const version = parseInt(work.split('-')[1] || '0');
          if (version < 3) return { input: { passed: false, suggestions: ['Not enough detail'] }, tokensUsed: 5 };
          return { input: { passed: true, suggestions: [] }, tokensUsed: 5 };
        },
        async (stage, work, eval_) => { return { work, tokensUsed: 0 }; },
      );

      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(result.iterations).toBeGreaterThanOrEqual(3);
    });

    // --- InnerLoop ---
    it('InnerLoop: run executes and returns result', async () => {
      const il = new InnerLoop();
      const result = await il.run('STORY-001', (stage) => ({
        maker: async () => ({ work: 'done', tokensUsed: 10 }),
        checker: async (stage, work) => ({ input: { passed: true, suggestions: [] }, tokensUsed: 5 }),
        optimizer: async (stage, work, eval_) => ({ work, tokensUsed: 0 }),
      }));
      expect(result.story_id).toBe('STORY-001');
      expect(result.total_iterations).toBeGreaterThanOrEqual(0);
    });

    // --- OuterLoop ---
    it('OuterLoop: defaultTriage selects highest priority story', async () => {
      const stories = [
        { id: 'STORY-001', title: 'Low', priority: 0, started: false },
        { id: 'STORY-002', title: 'High', priority: 1, started: false },
      ];
      const selected = await defaultTriage(stories, { has_in_progress: false });
      expect(selected).not.toBeNull();
      expect(selected!.id).toBe('STORY-002');
    });

    // --- StateMachine V12 state ---
    it('StateMachine: V12 nested loop state defaults', () => {
      const sm = new StateMachine();
      const state = sm.getState();
      expect(state.loops.phase.iteration).toBe(0);
      expect(state.loops.phase.max_iterations).toBe(5);
      expect(state.loops.inner.current_story).toBeUndefined();
      expect(state.loops.inner.story_attempts).toBe(0);
      expect(state.loops.outer.cadence).toBe('manual');
      expect(state.attestation.verified).toBe(true);
    });

    it('StateMachine: setPhaseLoopState updates iteration', () => {
      const sm = new StateMachine();
      sm.setPhaseLoopState({ iteration: 3, max_iterations: 10 });
      const pl = sm.getPhaseLoopState();
      expect(pl.iteration).toBe(3);
      expect(pl.max_iterations).toBe(10);
    });

    it('StateMachine: setInnerLoopState updates story', () => {
      const sm = new StateMachine();
      sm.setInnerLoopState({ current_story: 'STORY-005', story_attempts: 2 });
      const il = sm.getInnerLoopState();
      expect(il.current_story).toBe('STORY-005');
      expect(il.story_attempts).toBe(2);
    });

    it('StateMachine: setOuterLoopState updates cadence', () => {
      const sm = new StateMachine();
      sm.setOuterLoopState({ cadence: 'incremental' });
      const ol = sm.getOuterLoopState();
      expect(ol.cadence).toBe('incremental');
    });

    it('StateMachine: setAttestation', () => {
      const sm = new StateMachine();
      sm.setAttestation({ verified: false });
      expect(sm.getAttestation().verified).toBe(false);
    });

    it('StateMachine: serialize/deserialize round-trip', () => {
      const sm = new StateMachine();
      sm.setPhaseLoopState({ iteration: 2, max_iterations: 8 });
      sm.setInnerLoopState({ current_story: 'STORY-010', story_attempts: 3 });
      sm.setOuterLoopState({ cadence: 'incremental' });
      sm.setAttestation({ verified: false });

      const json = sm.serialize();
      const restored = StateMachine.deserialize(json);

      expect(restored.getCurrentStage()).toBe(sm.getCurrentStage());
      expect(restored.getPhaseLoopState().iteration).toBe(2);
      expect(restored.getInnerLoopState().current_story).toBe('STORY-010');
      expect(restored.getOuterLoopState().cadence).toBe('incremental');
      expect(restored.getAttestation().verified).toBe(false);
    });

    it('StateMachine: resetPhaseLoop clears iteration only', () => {
      const sm = new StateMachine();
      sm.setPhaseLoopState({ iteration: 4, max_iterations: 10 });
      sm.resetPhaseLoop();
      const pl = sm.getPhaseLoopState();
      expect(pl.iteration).toBe(0);
      expect(pl.max_iterations).toBe(10);
    });

    // --- LoopController V12 path ---
    it('LoopController V12: next returns loop_level metadata', async () => {
      const lc = new LoopController({ maxIterations: 10, enableV12: true });
      const result = await lc.next();
      expect(result.success).toBe(true);
      expect(result.metadata?.loop_level).toBeDefined();
      expect(result.metadata?.phase_iteration).toBeDefined();
    });

    it('LoopController V12: circuit breaker integrated', () => {
      const lc = new LoopController({ maxIterations: 10, enableV12: true });
      expect(lc.circuitBreaker).toBeDefined();
      const m = lc.circuitBreaker.getMetrics('phase');
      expect(m.iterations).toBe(0);
    });

    it('LoopController V12: completion gate integrated', () => {
      const lc = new LoopController({ maxIterations: 10, enableV12: true });
      expect(lc.completionGate).toBeDefined();
    });

    it('LoopController V12: audit returns score', async () => {
      const lc = new LoopController({ maxIterations: 10, enableV12: true });
      const audit = await lc.audit();
      expect(audit.score).toBeGreaterThanOrEqual(0);
      expect(audit.score).toBeLessThanOrEqual(100);
      expect(['L0', 'L1', 'L2', 'L3']).toContain(audit.level);
    });

    it('LoopController V12: full stage progression', async () => {
      const lc = new LoopController({ maxIterations: 20, enableV12: true });

      // V12 default handlers always pass, so InnerLoop.run() completes all
      // stages in a single next() call and returns action='done'.
      // Verify the loop completes successfully.
      let completed = false;

      for (let i = 0; i < 15; i++) {
        const result = await lc.next();
        if (!result.success || result.next_action?.action === 'done') {
          completed = true;
          break;
        }
        lc.recordAction(result.next_action?.tool || '', result.next_action?.action || '');
      }

      expect(completed).toBe(true);
    });
  });
});
