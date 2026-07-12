export type StopReason =
  | 'max_iterations_exceeded'
  | 'strikes_exceeded'
  | 'security_blocker'
  | 'deadlock_detected'
  | 'critical_error'
  | 'user_requested';

export interface HardStopRecord {
  reason: StopReason;
  detail: string;
  timestamp: string;
  iteration: number;
}

export class HardStopManager {
  private stopped: boolean = false;
  private record?: HardStopRecord;

  stop(reason: StopReason, detail: string, iteration: number): void {
    this.stopped = true;
    this.record = { reason, detail, timestamp: new Date().toISOString(), iteration };
  }

  isStopped(): boolean {
    return this.stopped;
  }

  getRecord(): HardStopRecord | undefined {
    return this.record;
  }

  reset(): void {
    this.stopped = false;
    this.record = undefined;
  }

  static checkIterations(current: number, max: number): { exceeded: boolean; detail?: string } {
    if (current >= max) {
      return { exceeded: true, detail: `Max iterations (${max}) exceeded at iteration ${current}` };
    }
    return { exceeded: false };
  }

  static checkStrikes(strikes: number, max: number): { exceeded: boolean; detail?: string } {
    if (strikes >= max) {
      return { exceeded: true, detail: `Max strikes (${max}) exceeded with ${strikes} strikes` };
    }
    return { exceeded: false };
  }
}
