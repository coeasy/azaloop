import { PRDChecker } from '@azaloop/core';
const prd: any = {
  id: 'PRD-E2E', title: 'E2E', version: '0.1.0',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  overview: 'x', goals: ['demo'], target_users: ['dev'],
  functional_requirements: [{ id: 'FR-1', description: 'fr', priority: 'P0' }],
  non_functional_requirements: [],
  stories: [{ id: 'STORY-1', title: 's', description: 'd', priority: 'P0', complexity: 'L1',
    acceptance_criteria: [{ id: 'AC-1', description: 'adds', testable: true, status: 'pending' }],
    dependencies: [], status: 'pending' }],
  architecture: [], acceptance_criteria: [{ id: 'AC-1', description: 'adds', testable: true, status: 'pending' }],
  risks: [],
};
const r = new PRDChecker().check(prd);
console.log('passed=', r.passed, 'p0=', r.p0_count, 'p1=', r.p1_count, 'score=', r.score);
console.log(r.details.filter((d: any) => !d.passed).map((d: any) => `${d.severity}:${d.category}:${d.description}`).join('\n'));
