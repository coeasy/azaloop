// Task scheduler interface
// MVP: Basic FIFO scheduler

export interface ScheduledTask {
  id: string;
  priority: number;
  execute: () => Promise<void>;
}

export class Scheduler {
  private queue: ScheduledTask[] = [];

  enqueue(task: ScheduledTask): void {
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  async runNext(): Promise<boolean> {
    const task = this.queue.shift();
    if (!task) return false;
    await task.execute();
    return true;
  }

  async runAll(): Promise<void> {
    while (this.queue.length > 0) {
      await this.runNext();
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}
