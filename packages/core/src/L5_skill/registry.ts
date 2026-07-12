export interface SkillMeta {
  name: string;
  version: string;
  type: 'document' | 'workflow' | 'analysis' | 'utility';
  description: string;
  tags: string[];
}

export class SkillRegistry {
  private skills: Map<string, SkillMeta> = new Map();

  constructor() {
    this.registerCoreSkills();
  }

  register(skill: SkillMeta): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillMeta | undefined {
    return this.skills.get(name);
  }

  search(query: string): SkillMeta[] {
    const q = query.toLowerCase();
    return Array.from(this.skills.values()).filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  listByType(type: SkillMeta['type']): SkillMeta[] {
    return Array.from(this.skills.values()).filter(s => s.type === type);
  }

  getAll(): SkillMeta[] {
    return Array.from(this.skills.values());
  }

  private registerCoreSkills(): void {
    const core: SkillMeta[] = [
      { name: 'prd', version: '1.0', type: 'document', description: 'Generate PRD from natural language requirements', tags: ['prd', 'spec', 'requirements'] },
      { name: 'arch', version: '1.0', type: 'document', description: 'Generate architecture diagrams and documentation', tags: ['architecture', 'design', 'mermaid'] },
      { name: 'db', version: '1.0', type: 'document', description: 'Generate database schema and migration plans', tags: ['database', 'schema', 'migration'] },
      { name: 'api', version: '1.0', type: 'document', description: 'Generate API documentation and specifications', tags: ['api', 'endpoints', 'rest'] },
      { name: 'test', version: '1.0', type: 'workflow', description: 'TDD workflow: RED-GREEN-REFACTOR cycle', tags: ['test', 'tdd', 'quality'] },
      { name: 'deploy', version: '1.0', type: 'workflow', description: 'Deployment pipeline and release management', tags: ['deploy', 'release', 'ci-cd'] },
      { name: 'security', version: '1.0', type: 'analysis', description: 'Security audit and hardening checklist', tags: ['security', 'audit', 'owasp'] },
      { name: 'review', version: '1.0', type: 'workflow', description: 'Code review process and checklist', tags: ['review', 'code-quality', 'best-practices'] },
    ];
    for (const skill of core) {
      this.register(skill);
    }
  }
}
