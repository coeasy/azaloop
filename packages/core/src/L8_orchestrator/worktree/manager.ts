// Interface reserved for future Git Worktree management
// MVP: Not implemented — interfaces only

export interface WorktreeConfig {
  enabled: boolean;
  base_branch: string;
  worktree_prefix: string;
}

export class WorktreeManager {
  private config: WorktreeConfig;

  constructor(config: WorktreeConfig) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): WorktreeConfig {
    return { ...this.config };
  }
}
