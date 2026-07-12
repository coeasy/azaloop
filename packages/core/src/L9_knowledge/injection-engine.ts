export interface InjectionContext {
  stage: string;
  story_type?: string;
  language?: string;
  tags: string[];
}

export class InjectionEngine {
  private knowledgeBase: Map<string, string[]> = new Map();

  constructor() {
    this.initializeKnowledge();
  }

  inject(context: InjectionContext): string[] {
    const results: string[] = [];

    for (const [category, techniques] of this.knowledgeBase) {
      if (this.matchesContext(category, context)) {
        results.push(...techniques);
      }
    }

    return results.slice(0, 10); // Limit to 10 techniques per injection
  }

  private initializeKnowledge(): void {
    this.knowledgeBase.set('architecture', [
      'Use layered architecture for maintainability',
      'Prefer composition over inheritance',
      'SOLID principles apply to all designs',
    ]);
    this.knowledgeBase.set('typescript', [
      'Use strict mode — no implicit any',
      'Prefer interfaces over type aliases for public APIs',
      'Use discriminated unions for state machines',
    ]);
    this.knowledgeBase.set('testing', [
      'TDD: RED → GREEN → REFACTOR',
      'Test behaviors, not implementation',
      'Mock external boundaries only',
    ]);
    this.knowledgeBase.set('security', [
      'Validate all inputs — never trust user data',
      'Use parameterized queries for SQL',
      'Never hardcode secrets',
    ]);
    this.knowledgeBase.set('build', [
      'Fail fast — validate inputs at boundaries',
      'Profile before optimizing',
      'Atomic commits per concern',
    ]);
  }

  private matchesContext(category: string, context: InjectionContext): boolean {
    const stageLower = context.stage.toLowerCase();
    const tagsLower = context.tags.map(t => t.toLowerCase());

    if (category === 'testing' && (stageLower === 'verify' || tagsLower.includes('test'))) return true;
    if (category === 'security' && (stageLower === 'build' || tagsLower.includes('security'))) return true;
    if (category === 'architecture' && (stageLower === 'design' || tagsLower.includes('architecture'))) return true;
    if (category === 'typescript' && context.language === 'typescript') return true;
    if (category === 'build' && (stageLower === 'build' || stageLower === 'verify')) return true;

    return false;
  }
}
