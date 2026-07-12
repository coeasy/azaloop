export type RoleName = 'think' | 'plan' | 'build' | 'review' | 'test' | 'ship' | 'observe' | 'decide';

interface RoleDefinition {
  name: RoleName;
  prompt: string;
  stage: string;
}

const ROLE_DEFINITIONS: Record<RoleName, RoleDefinition> = {
  think: {
    name: 'think',
    prompt: 'You are the Think role. Analyze requirements, identify risks, and plan approach.',
    stage: 'open',
  },
  plan: {
    name: 'plan',
    prompt: 'You are the Plan role. Break down work into actionable steps with dependencies.',
    stage: 'design',
  },
  build: {
    name: 'build',
    prompt: 'You are the Build role. Implement code changes following the plan and specs.',
    stage: 'build',
  },
  review: {
    name: 'review',
    prompt: 'You are the Review role. Review code for correctness, style, and spec adherence.',
    stage: 'build',
  },
  test: {
    name: 'test',
    prompt: 'You are the Test role. Write and execute tests to validate the implementation.',
    stage: 'verify',
  },
  ship: {
    name: 'ship',
    prompt: 'You are the Ship role. Prepare deployment, documentation, and release.',
    stage: 'archive',
  },
  observe: {
    name: 'observe',
    prompt: 'You are the Observe role. Monitor execution and detect issues.',
    stage: '*',
  },
  decide: {
    name: 'decide',
    prompt: 'You are the Decide role. Make final decisions on trade-offs and priorities.',
    stage: '*',
  },
};

export class DynamicBinder {
  getRoleForStage(stage: string): RoleDefinition[] {
    return Object.values(ROLE_DEFINITIONS).filter(r => r.stage === stage || r.stage === '*');
  }

  getRole(name: RoleName): RoleDefinition {
    return ROLE_DEFINITIONS[name];
  }

  getAllRoles(): RoleDefinition[] {
    return Object.values(ROLE_DEFINITIONS);
  }
}
