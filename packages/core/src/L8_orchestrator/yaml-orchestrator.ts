// YAML-based DAG orchestration for sequential/parallel task execution
// MVP: Basic sequential execution

export interface OrchestrationStep {
  id: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
  depends_on: string[];
}

export class YAMLOrchestrator {
  private steps: OrchestrationStep[] = [];

  load(steps: OrchestrationStep[]): void {
    this.steps = steps;
  }

  getExecutionOrder(): OrchestrationStep[][] {
    const levels: OrchestrationStep[][] = [];
    const executed = new Set<string>();

    while (executed.size < this.steps.length) {
      const nextLevel = this.steps.filter(s =>
        !executed.has(s.id) &&
        s.depends_on.every(d => executed.has(d))
      );
      if (nextLevel.length === 0) break;
      levels.push(nextLevel);
      nextLevel.forEach(s => executed.add(s.id));
    }

    return levels;
  }
}
