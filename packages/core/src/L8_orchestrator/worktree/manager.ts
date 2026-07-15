/**
 * Git Worktree manager — creates/lists/removes isolated worktrees for
 * parallel host agents. Requires a real git repository at `repoRoot`.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WorktreeConfig {
  enabled: boolean;
  base_branch: string;
  worktree_prefix: string;
  /** Repository root (defaults to process.cwd()). */
  repo_root?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

export interface WorktreeCreateResult {
  ok: boolean;
  path?: string;
  branch?: string;
  error?: string;
}

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function isGitRepo(repoRoot: string): boolean {
  try {
    runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

export class WorktreeManager {
  private config: WorktreeConfig;
  private readonly repoRoot: string;

  constructor(config: WorktreeConfig) {
    this.config = config;
    this.repoRoot = path.resolve(config.repo_root || process.cwd());
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): WorktreeConfig {
    return { ...this.config };
  }

  /**
   * Create a new worktree on a branch named `<prefix><name>`.
   * Path defaults to `<repo>/.aza/worktrees/<name>`.
   */
  create(name: string, opts?: { branch?: string; base?: string; absPath?: string }): WorktreeCreateResult {
    if (!this.config.enabled) {
      return { ok: false, error: 'WorktreeManager is disabled' };
    }
    if (!isGitRepo(this.repoRoot)) {
      return { ok: false, error: `Not a git repository: ${this.repoRoot}` };
    }

    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const branch = opts?.branch || `${this.config.worktree_prefix}${safe}`;
    const base = opts?.base || this.config.base_branch;
    const wtPath =
      opts?.absPath ||
      path.join(this.repoRoot, '.aza', 'worktrees', safe);

    try {
      fs.mkdirSync(path.dirname(wtPath), { recursive: true });
      // Ensure base exists (local or remote tracking)
      try {
        runGit(this.repoRoot, ['rev-parse', '--verify', base]);
      } catch {
        try {
          runGit(this.repoRoot, ['fetch', 'origin', base]);
        } catch {
          /* best-effort */
        }
      }

      const branchExists = (() => {
        try {
          runGit(this.repoRoot, ['rev-parse', '--verify', branch]);
          return true;
        } catch {
          return false;
        }
      })();

      if (branchExists) {
        runGit(this.repoRoot, ['worktree', 'add', wtPath, branch]);
      } else {
        runGit(this.repoRoot, ['worktree', 'add', '-b', branch, wtPath, base]);
      }

      return { ok: true, path: wtPath, branch };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  remove(wtPath: string, force = false): { ok: boolean; error?: string } {
    if (!this.config.enabled) {
      return { ok: false, error: 'WorktreeManager is disabled' };
    }
    try {
      const args = ['worktree', 'remove', force ? '--force' : '', wtPath].filter(Boolean);
      runGit(this.repoRoot, args);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  list(): WorktreeInfo[] {
    if (!isGitRepo(this.repoRoot)) return [];
    try {
      const out = runGit(this.repoRoot, ['worktree', 'list', '--porcelain']);
      const blocks = out.split('\n\n').filter(Boolean);
      const infos: WorktreeInfo[] = [];
      for (const block of blocks) {
        const lines = block.split('\n');
        let wtPath = '';
        let head = '';
        let branch = '';
        let bare = false;
        for (const line of lines) {
          if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length);
          else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length);
          else if (line.startsWith('branch ')) branch = line.slice('branch '.length).replace('refs/heads/', '');
          else if (line === 'bare') bare = true;
        }
        if (wtPath) {
          infos.push({ path: wtPath, branch: branch || '(detached)', head, bare });
        }
      }
      return infos;
    } catch {
      return [];
    }
  }

  prune(): { ok: boolean; error?: string } {
    try {
      runGit(this.repoRoot, ['worktree', 'prune']);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
