import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRDGenerator,
  PRDChecker,
  researchCompetitors,
  writeCompetitiveResearch,
  writePrdMarkdown,
} from '@azaloop/core';

describe('0.4.x+ PRD depth + competitive research + slim measurable AC', () => {
  it('rejects shallow one-liner PRDs at P0 / score gate', () => {
    const checker = new PRDChecker();
    const result = checker.check({
      id: 'PRD-shallow',
      title: 'App',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      overview: 'short',
      goals: [],
      target_users: ['Users'],
      functional_requirements: [],
      non_functional_requirements: [],
      stories: [],
      architecture: [],
      acceptance_criteria: [],
      risks: [],
    } as any);
    expect(result.passed).toBe(false);
    expect(result.p0_count).toBeGreaterThan(0);
  });

  it('rejects vague "works as expected" ACs as P0', () => {
    const checker = new PRDChecker();
    const result = checker.check({
      id: 'PRD-vague',
      title: 'Measurable AC Gate',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      overview:
        'Pain: vague PRDs stall loops. Peers: OpenSpec, Superpowers, ralphy. Ship measurable gates and clear P0/P1.',
      goals: [
        'Clear P0/P1 with weighted score ≥ 90',
        'Differentiate vs OpenSpec without expanding MCP tools',
      ],
      target_users: ['Developers', 'Agent operators'],
      functional_requirements: [{ id: 'FR-1', description: 'Enforce measurable AC', priority: 'P0' }],
      non_functional_requirements: [
        { id: 'NFR-1', description: 'reliability: gate reports P0=0 P1=0', category: 'reliability' },
      ],
      stories: [
        {
          id: 'STORY-001',
          title: 'Gate',
          description: 'As a developer, enforce measurable acceptance criteria for every story.',
          priority: 'P0',
          complexity: 'L2',
          acceptance_criteria: [
            { id: 'AC-1-1', description: 'Gate feature 0 works as expected', testable: true, status: 'pending' },
          ],
          dependencies: [],
          status: 'pending',
        },
      ],
      architecture: [
        {
          type: 'component',
          mermaid: 'graph TD\n  A-->B',
          description: 'loop',
        },
      ],
      acceptance_criteria: [
        { id: 'AC-1-1', description: 'Gate feature 0 works as expected', testable: true, status: 'pending' },
      ],
      risks: [
        {
          description: 'Vague AC risk',
          probability: 'medium',
          mitigation: 'AC-004 rejects placeholders',
        },
      ],
    } as any);
    expect(result.details.some((d) => d.id === 'AC-004' && !d.passed)).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('self-optimizes short input into P0+P1 clear / score≥90 PRD with measurable ACs', () => {
    const gen = new PRDGenerator();
    const prd = gen.generate(
      {
        title: 'AzaLoop PRD Gate',
        description: 'Full-auto MCP loop needs deeper PRDs and competitive analysis',
      },
      {
        enable_self_optimization: true,
        max_optimization_rounds: 5,
        auto_stories: true,
        auto_architecture: true,
      },
    );
    const checker = new PRDChecker();
    const check = checker.check(prd);
    expect(check.p0_count).toBe(0);
    expect(check.p1_count).toBe(0);
    expect(check.score).toBeGreaterThanOrEqual(90);
    expect(check.passed).toBe(true);
    expect(prd.overview.length).toBeGreaterThanOrEqual(120);
    expect(prd.stories.every((s) => (s.acceptance_criteria?.length ?? 0) >= 1)).toBe(true);
    expect(
      prd.stories.every((s) =>
        (s.acceptance_criteria || []).every((a) => {
          const t = a.description.trim();
          if (/拒绝|reject|禁止/.test(t) && /assert|via automated|observable/i.test(t)) return true;
          return !/^(.*?feature\s+\d+\s+)?works as expected[.!]?$/i.test(t);
        }),
      ),
    ).toBe(true);
    expect(/compet|OpenSpec|peers|landscape|github/i.test(prd.overview)).toBe(true);
    expect(prd.functional_requirements.some((f) => /as described/i.test(f.description))).toBe(false);
  });

  it('parses structured numbered description into lean goals/FR without UI chrome', () => {
    const gen = new PRDGenerator();
    const prd = gen.generate(
      {
        title: 'Slim PRD',
        description: [
          '目标：',
          '1) 质量门禁：全部 P0+P1 清零；加权分≥90',
          '2) AC：每条可测；每 story ≥1 条 AC',
          '3) PRD 生成优化：少无关信息',
          'Pain: vague PRDs stall loops.',
          'Peers: OpenSpec, Superpowers, ralphy.',
        ].join('\n'),
      },
      { enable_self_optimization: true, max_optimization_rounds: 5, auto_stories: true, auto_architecture: true },
    );
    expect(prd.goals.some((g) => /P0|加权|≥90|90/.test(g))).toBe(true);
    expect(prd.overview).not.toMatch(/确认后输入|开始执行|质量评分：/);
    expect(prd.stories.length).toBeGreaterThanOrEqual(1);
    expect(prd.stories.length).toBeLessThanOrEqual(5);
    const checker = new PRDChecker();
    const check = checker.check(prd);
    expect(check.p0_count).toBe(0);
    expect(check.p1_count).toBe(0);
    expect(check.passed).toBe(true);
  });

  it('writes competitive research + prd.md under project .aza/', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-prd-04-'));
    const azaDir = path.join(tmp, '.aza');
    const research = await researchCompetitors('azaloop mcp prd', 'agent skills openspec');
    const researchPath = writeCompetitiveResearch(azaDir, research);
    expect(fs.existsSync(researchPath)).toBe(true);
    expect(research.competitors.length).toBeGreaterThan(0);

    const gen = new PRDGenerator();
    const prd = gen.generate(
      { title: 'Demo', description: research.prd_supplements.overview_appendix },
      { enable_self_optimization: true, auto_stories: true, auto_architecture: true },
    );
    const mdPath = writePrdMarkdown(azaDir, prd);
    expect(fs.existsSync(mdPath)).toBe(true);
    expect(fs.readFileSync(mdPath, 'utf8')).toContain('# ');
  });
});
