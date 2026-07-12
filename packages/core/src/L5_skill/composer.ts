import { SkillRegistry, type SkillMeta } from './registry';

export interface ComposedSkill {
  name: string;
  skills: string[];
  description: string;
  chain: string[];
}

export class SkillComposer {
  private registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  compose(skillNames: string[]): ComposedSkill {
    const resolved: SkillMeta[] = [];
    const missing: string[] = [];

    for (const name of skillNames) {
      const skill = this.registry.get(name);
      if (skill) {
        resolved.push(skill);
      } else {
        missing.push(name);
      }
    }

    return {
      name: `composed-${skillNames.join('-')}`,
      skills: resolved.map(s => s.name),
      description: resolved.map(s => s.description).join(' → '),
      chain: resolved.map(s => s.name),
    };
  }

  getWorkflow(composed: ComposedSkill): string[] {
    const workflow: string[] = [];
    for (const skillName of composed.skills) {
      const skill = this.registry.get(skillName);
      if (skill) {
        workflow.push(`[${skill.type}] ${skill.name}: ${skill.description}`);
      }
    }
    return workflow;
  }
}
