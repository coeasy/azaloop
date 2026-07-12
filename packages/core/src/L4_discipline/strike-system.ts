export type StrikeReason =
  | 'assumed_without_verification'
  | 'modified_unrelated_code'
  | 'skipped_tests'
  | 'skipped_security'
  | 'committed_broken_code'
  | 'ignored_spec'
  | 'duplicate_error'
  | 'deadlock_detected';

export interface StrikeRecord {
  reason: StrikeReason;
  detail: string;
  timestamp: string;
  iteration: number;
}

export class StrikeSystem {
  private strikes: StrikeRecord[] = [];
  private maxStrikes: number;
  private onResumeNeeded?: (reason: string, strikes: StrikeRecord[]) => void;

  constructor(maxStrikes: number = 3, onResumeNeeded?: (reason: string, strikes: StrikeRecord[]) => void) {
    this.maxStrikes = maxStrikes;
    this.onResumeNeeded = onResumeNeeded;
  }

  record(reason: StrikeReason, detail: string, iteration: number): StrikeRecord {
    const record: StrikeRecord = {
      reason,
      detail,
      timestamp: new Date().toISOString(),
      iteration,
    };
    this.strikes.push(record);
    // V12: Trigger RESUME write when max strikes reached
    if (this.isHardStop() && this.onResumeNeeded) {
      this.onResumeNeeded(`3-Strike triggered: ${this.strikes.length} strikes`, this.strikes);
    }
    return record;
  }

  getStrikes(): StrikeRecord[] {
    return [...this.strikes];
  }

  getStrikeCount(): number {
    return this.strikes.length;
  }

  isHardStop(): boolean {
    return this.strikes.length >= this.maxStrikes;
  }

  hasDuplicateError(reason: StrikeReason): boolean {
    const recent = this.strikes.slice(-3);
    return recent.filter(s => s.reason === reason).length >= 2;
  }

  clear(): void {
    this.strikes = [];
  }
}
