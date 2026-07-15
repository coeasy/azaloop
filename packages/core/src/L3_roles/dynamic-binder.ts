export type RoleName =
  | 'think' | 'plan' | 'build' | 'review' | 'test' | 'ship' | 'observe' | 'decide'
  // gstack-inspired product roles
  | 'ceo' | 'eng' | 'design' | 'qa' | 'cso';

export interface RoleDefinition {
  name: RoleName;
  /** Slash command hint for Cursor/Claude Code */
  slash?: string;
  prompt: string;
  stage: string;
  /** maker | checker | both */
  phase?: 'maker' | 'checker' | 'both';
}

const ROLE_DEFINITIONS: Record<RoleName, RoleDefinition> = {
  think: {
    name: 'think',
    prompt: 'You are the Think role. Analyze requirements, identify risks, and plan approach.',
    stage: 'open',
    phase: 'maker',
  },
  plan: {
    name: 'plan',
    slash: '/aza-plan',
    prompt: 'You are the Plan / Eng Manager role. Lock architecture, break work into verifiable tasks, reject scope creep.',
    stage: 'design',
    phase: 'maker',
  },
  build: {
    name: 'build',
    prompt: 'You are the Build role. Implement code changes following the plan and specs. Prefer small diffs and tests first.',
    stage: 'build',
    phase: 'maker',
  },
  review: {
    name: 'review',
    slash: '/aza-review',
    prompt: 'You are the Review role. Find production bugs, spec drift, and missing tests. Do not rubber-stamp.',
    stage: 'build',
    phase: 'checker',
  },
  test: {
    name: 'test',
    prompt: 'You are the Test role. Write and execute tests to validate the implementation.',
    stage: 'verify',
    phase: 'maker',
  },
  ship: {
    name: 'ship',
    slash: '/aza-ship',
    prompt: 'You are the Ship / Release Engineer role. Quality gates green, archive artifacts, prepare ship summary. Do not force-push.',
    stage: 'archive',
    phase: 'maker',
  },
  observe: {
    name: 'observe',
    prompt: 'You are the Observe role. Monitor execution and detect issues.',
    stage: '*',
    phase: 'both',
  },
  decide: {
    name: 'decide',
    prompt: 'You are the Decide role. Make final decisions on trade-offs and priorities.',
    stage: '*',
    phase: 'both',
  },
  ceo: {
    name: 'ceo',
    slash: '/aza-ceo',
    prompt:
      'You are the CEO / product lead (gstack office-hours style). Challenge the problem: who is the user, what is the wedge, what NOT to build. Prefer a sharper PRD over more features.',
    stage: 'open',
    phase: 'maker',
  },
  eng: {
    name: 'eng',
    slash: '/aza-plan',
    prompt:
      'You are the Engineering Manager. Lock architecture boundaries, file ownership, and test strategy before code lands.',
    stage: 'design',
    phase: 'maker',
  },
  design: {
    name: 'design',
    slash: '/aza-design',
    prompt:
      'You are the Design lead. Catch AI slop UI, enforce one composition, brand-first hierarchy, and accessible flows. No purple-on-white defaults.',
    stage: 'design',
    phase: 'checker',
  },
  qa: {
    name: 'qa',
    slash: '/aza-qa',
    prompt:
      'You are the QA Lead. Hunt regressions, require reproduction steps, and insist on failing tests before fixes.',
    stage: 'verify',
    phase: 'checker',
  },
  cso: {
    name: 'cso',
    slash: '/aza-cso',
    prompt:
      'You are the Chief Security Officer. Run threat-focused review: secrets, injection, least privilege, data exfiltration. Block ship on critical findings.',
    stage: 'verify',
    phase: 'checker',
  },
};

const STAGE_PRIMARY: Record<string, RoleName[]> = {
  open: ['ceo', 'think'],
  design: ['eng', 'plan', 'design'],
  build: ['build', 'review'],
  verify: ['qa', 'test', 'cso'],
  archive: ['ship'],
};

export class DynamicBinder {
  getRoleForStage(stage: string): RoleDefinition[] {
    const preferred = STAGE_PRIMARY[stage];
    if (preferred) {
      return preferred.map((n) => ROLE_DEFINITIONS[n]);
    }
    return Object.values(ROLE_DEFINITIONS).filter((r) => r.stage === stage || r.stage === '*');
  }

  getRole(name: RoleName): RoleDefinition {
    return ROLE_DEFINITIONS[name];
  }

  getAllRoles(): RoleDefinition[] {
    return Object.values(ROLE_DEFINITIONS);
  }

  /** Slash catalog for client template generators */
  getSlashCatalog(): Array<{ slash: string; role: RoleName; prompt: string }> {
    return this.getAllRoles()
      .filter((r) => r.slash)
      .map((r) => ({ slash: r.slash!, role: r.name, prompt: r.prompt }));
  }

  getMakerPrompt(stage: string): string {
    const roles = this.getRoleForStage(stage).filter((r) => r.phase !== 'checker');
    return roles.map((r) => `[${r.name}] ${r.prompt}`).join('\n');
  }

  getCheckerPrompt(stage: string): string {
    const roles = this.getRoleForStage(stage).filter((r) => r.phase === 'checker' || r.phase === 'both');
    if (roles.length === 0) {
      return ROLE_DEFINITIONS.review.prompt;
    }
    return roles.map((r) => `[${r.name}] ${r.prompt}`).join('\n');
  }
}
