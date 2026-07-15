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
    // Same tool:action repeated
    if (recent.every(a => a.tool === first.tool && a.action === first.action)) {
      return true;
    }
    // Ping-pong: A→B→A→B… (cooperative report_tool ↔ host tool)
    if (this.actions.length >= this.threshold * 2) {
      const window = this.actions.slice(-this.threshold * 2);
      const keys = window.map(a => `${a.tool}:${a.action}`);
      const unique = new Set(keys);
      if (unique.size === 2) {
        const a = keys[0];
        const b = keys[1];
        if (a !== b && keys.every((k, i) => k === (i % 2 === 0 ? a : b))) {
          return true;
        }
      }
    }
    return false;
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
