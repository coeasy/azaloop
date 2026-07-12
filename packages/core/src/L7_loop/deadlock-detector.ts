export interface ActionRecord {
  tool: string;
  action: string;
  timestamp: string;
  iteration: number;
}

export class DeadlockDetector {
  private actions: ActionRecord[] = [];
  private threshold: number;

  constructor(threshold: number = 3) {
    this.threshold = threshold;
  }

  record(tool: string, action: string, iteration: number): void {
    this.actions.push({ tool, action, timestamp: new Date().toISOString(), iteration });
  }

  isDeadlocked(): boolean {
    if (this.actions.length < this.threshold) return false;
    const recent = this.actions.slice(-this.threshold);
    const first = recent[0];
    if (!first) return false;
    return recent.every(a => a.tool === first.tool && a.action === first.action);
  }

  getRepeatedAction(): { tool: string; action: string } | null {
    if (!this.isDeadlocked()) return null;
    const recent = this.actions.slice(-this.threshold);
    const first = recent[0];
    return first ? { tool: first.tool, action: first.action } : null;
  }

  clear(): void {
    this.actions = [];
  }

  getActionCount(): number {
    return this.actions.length;
  }

  getRecentActions(n: number): ActionRecord[] {
    return this.actions.slice(-n);
  }
}
