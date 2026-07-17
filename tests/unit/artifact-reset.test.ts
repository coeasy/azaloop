import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../packages/core/src/state/state-manager';
import { ResumeGenerator } from '../../packages/core/src/continuity/resume-generator';
import { handleAzaAuto } from '../../packages/mcp-server/src/unified-handlers';
import {
  ArtifactResetError,
  ArtifactResetProcessCrash,
  resetArtifacts,
} from '../../packages/mcp-server/src/workflows/auto/artifact-reset';

const tempDirs: string[] = [];

function fingerprint(input: string): string {
  return createHash('sha256')
    .update(input.normalize('NFKC').trim().replace(/\s+/g, ' '))
    .digest('hex')
    .slice(0, 32);
}

function writeRecoveryClaimDir(
  azaDir: string,
  claim: { owner: string; pid: number; acquired_at: string; expires_at: string },
): { claimPath: string; raw: string } {
  const claimPath = path.join(azaDir, '.artifact-reset.recovery-claim');
  const raw = JSON.stringify(claim);
  fs.mkdirSync(claimPath);
  fs.writeFileSync(path.join(claimPath, 'lease.json'), raw, 'utf8');
  return { claimPath, raw };
}

function writeLockDir(
  azaDir: string,
  lease: { owner: string; pid: number; acquired_at: string; expires_at: string },
): { lockPath: string; raw: string } {
  const lockPath = path.join(azaDir, '.artifact-reset.lock');
  const raw = JSON.stringify(lease);
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'lease.json'), raw, 'utf8');
  return { lockPath, raw };
}

afterEach(() => {
  delete process.env.AZA_AUTO_PICK;
  delete process.env.AZA_AUTO_MAX_STEPS;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('automatic artifact reset', () => {
  it('commits a successful reset with audit reason and a full new state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-success-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const state = new StateManager(azaDir);
    await state.update({
      loop: { current_story: 'old story', iteration: 9, progress: '90%' },
    } as any);
    fs.writeFileSync(path.join(azaDir, 'quality-passed.marker'), 'old task', 'utf8');

    const result = await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('new task'),
        reason: 'terminal',
      },
      { clearRuntime: () => {}, resetState: () => state.resetVNext().then(() => {}) },
    );

    expect(result.reason).toBe('terminal');
    expect(result.moved).toEqual(
      expect.arrayContaining(['quality-passed.marker', 'STATE.yaml', 'STATE.CHECKSUM', 'STATE.HASH']),
    );
    expect(fs.readFileSync(path.join(azaDir, 'task-epoch'), 'utf8')).toBe(
      fingerprint('new task'),
    );
    expect(state.getState().loop.current_story).toBeUndefined();
    const audit = JSON.parse(
      fs.readFileSync(path.join(result.history_dir, 'reset-audit.json'), 'utf8'),
    );
    expect(audit).toMatchObject({ reason: 'terminal', transaction_id: result.transaction_id });
  });

  it('does not reset authoritative state when epoch commit fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-epoch-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'quality-passed.marker'), 'old task', 'utf8');
    let stateReset = false;

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('new task'),
          reason: 'hash_mismatch',
        },
        {
          clearRuntime: () => {},
          writeEpoch: async () => {
            throw new Error('injected epoch commit failure');
          },
          resetState: async () => {
            stateReset = true;
          },
        },
      ),
    ).rejects.toBeInstanceOf(ArtifactResetError);

    expect(stateReset).toBe(false);
    expect(fs.existsSync(path.join(azaDir, 'task-epoch'))).toBe(false);
    expect(fs.readFileSync(path.join(azaDir, 'quality-passed.marker'), 'utf8')).toBe(
      'old task',
    );
  });

  it('recovers a write-ahead transaction abandoned after the first artifact move', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-wal-crash-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'design.md'), 'old design', 'utf8');
    fs.writeFileSync(path.join(azaDir, 'quality-passed.marker'), 'old marker', 'utf8');

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('wal crash task'),
          reason: 'residual_artifacts',
        },
        {
          clearRuntime: () => {},
          resetState: async () => {},
          onArtifactMoved: (_artifact, movedCount) => {
            if (movedCount === 1) throw new ArtifactResetProcessCrash('after first move');
          },
        },
      ),
    ).rejects.toThrow(/after first move/);

    const historyRoot = path.join(azaDir, 'history');
    const abandonedName = fs
      .readdirSync(historyRoot)
      .find((name) => name.startsWith('.') && name.endsWith('.tmp'));
    expect(abandonedName).toBeTruthy();
    const abandonedDir = path.join(historyRoot, abandonedName!);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(abandonedDir, 'transaction.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({ status: 'preparing', reason: 'residual_artifacts' });
    expect(manifest.candidates).toEqual(
      expect.arrayContaining(['design.md', 'quality-passed.marker']),
    );
    expect(fs.existsSync(path.join(abandonedDir, 'design.md'))).toBe(true);
    expect(fs.readFileSync(path.join(azaDir, 'quality-passed.marker'), 'utf8')).toBe(
      'old marker',
    );

    const recovered: string[] = [];
    const result = await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('wal recovery task'),
        reason: 'residual_artifacts',
      },
      {
        clearRuntime: () => {},
        resetState: async () => {},
        onAbandonedArtifactRestored: (artifact) => {
          recovered.push(artifact);
        },
      },
    );

    expect(result.committed).toBe(true);
    expect(recovered).toContain('design.md');
    const abortedDir = path.join(historyRoot, abandonedName!.slice(1, -'.tmp'.length));
    expect(JSON.parse(fs.readFileSync(path.join(abortedDir, 'aborted-audit.json'), 'utf8'))).toMatchObject(
      { status: 'aborted', recovery: 'write_ahead_replay' },
    );
  });

  it('replays an abandoned transaction idempotently after recovery crashes again', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-wal-replay-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'design.md'), 'old design', 'utf8');
    fs.writeFileSync(path.join(azaDir, 'quality-passed.marker'), 'old marker', 'utf8');

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('wal replay seed'),
          reason: 'residual_artifacts',
        },
        {
          clearRuntime: () => {},
          resetState: async () => {},
          onArtifactMoved: (_artifact, movedCount) => {
            if (movedCount === 2) throw new ArtifactResetProcessCrash('after second move');
          },
        },
      ),
    ).rejects.toThrow(/after second move/);

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('wal replay interrupted'),
          reason: 'residual_artifacts',
        },
        {
          clearRuntime: () => {},
          resetState: async () => {},
          onAbandonedArtifactRestored: (_artifact, restoredCount) => {
            if (restoredCount === 1) {
              throw new ArtifactResetProcessCrash('during abandoned recovery');
            }
          },
        },
      ),
    ).rejects.toThrow(/during abandoned recovery/);

    expect(fs.readFileSync(path.join(azaDir, 'design.md'), 'utf8')).toBe('old design');
    const abandonedDir = path.join(
      azaDir,
      'history',
      fs
        .readdirSync(path.join(azaDir, 'history'))
        .find((name) => name.startsWith('.') && name.endsWith('.tmp'))!,
    );
    expect(fs.existsSync(path.join(abandonedDir, 'design.md'))).toBe(false);
    expect(fs.readFileSync(path.join(abandonedDir, 'quality-passed.marker'), 'utf8')).toBe(
      'old marker',
    );

    const restoredOnRetry: string[] = [];
    const result = await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('wal replay final'),
        reason: 'residual_artifacts',
      },
      {
        clearRuntime: () => {},
        resetState: async () => {},
        onAbandonedArtifactRestored: (artifact) => {
          restoredOnRetry.push(artifact);
        },
      },
    );

    expect(result.committed).toBe(true);
    expect(restoredOnRetry).toEqual(['quality-passed.marker']);
    expect(
      fs.readdirSync(path.join(azaDir, 'history')).some(
        (name) => name.startsWith('.') && name.endsWith('.tmp'),
      ),
    ).toBe(false);
  });

  it('fails loud and preserves the abandoned copy when recovery finds a root conflict', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-wal-conflict-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'design.md'), 'abandoned original', 'utf8');

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('wal conflict seed'),
          reason: 'residual_artifacts',
        },
        {
          clearRuntime: () => {},
          resetState: async () => {},
          onArtifactMoved: () => {
            throw new ArtifactResetProcessCrash('leave design in transaction');
          },
        },
      ),
    ).rejects.toThrow(/leave design/);

    const abandonedDir = path.join(
      azaDir,
      'history',
      fs
        .readdirSync(path.join(azaDir, 'history'))
        .find((name) => name.startsWith('.') && name.endsWith('.tmp'))!,
    );
    fs.writeFileSync(path.join(azaDir, 'design.md'), 'new conflicting root', 'utf8');

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('wal conflict recovery'),
          reason: 'residual_artifacts',
        },
        { clearRuntime: () => {}, resetState: async () => {} },
      ),
    ).rejects.toMatchObject({ phase: 'rollback' });

    expect(fs.readFileSync(path.join(azaDir, 'design.md'), 'utf8')).toBe(
      'new conflicting root',
    );
    expect(fs.readFileSync(path.join(abandonedDir, 'design.md'), 'utf8')).toBe(
      'abandoned original',
    );
  });

  it('restores all state files and memory when full state reset fails mid-save', async () => {
    class FailingStateManager extends StateManager {
      private failAt = Number.POSITIVE_INFINITY;
      private writes = 0;

      armFailure(writeNumber: number): void {
        this.writes = 0;
        this.failAt = writeNumber;
      }

      override async atomicWriteState(filePath: string, content: string): Promise<void> {
        this.writes += 1;
        if (this.writes === this.failAt) throw new Error('injected state write failure');
        await super.atomicWriteState(filePath, content);
      }
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-state-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    const state = new FailingStateManager(azaDir);
    await state.update({
      loop: { current_story: 'must survive rollback', iteration: 7, progress: '70%' },
    } as any);
    const beforeMemory = structuredClone(state.getState());
    const stateFiles = ['STATE.yaml', 'STATE.CHECKSUM', 'STATE.HASH'] as const;
    const beforeDisk = Object.fromEntries(
      stateFiles.map((name) => [name, fs.readFileSync(path.join(azaDir, name), 'utf8')]),
    );
    state.armFailure(2);

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('state failure task'),
          reason: 'hash_mismatch',
        },
        { clearRuntime: () => {}, resetState: () => state.resetVNext().then(() => {}) },
      ),
    ).rejects.toBeInstanceOf(ArtifactResetError);

    expect(state.getState()).toEqual(beforeMemory);
    for (const name of stateFiles) {
      expect(fs.readFileSync(path.join(azaDir, name), 'utf8')).toBe(beforeDisk[name]);
    }
    expect(fs.existsSync(path.join(azaDir, 'task-epoch'))).toBe(false);
  });

  it('serializes concurrent resets and a rejected owner cannot remove the winner epoch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-lock-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'design.md'), 'old design', 'utf8');
    let releaseFirst!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const winningFingerprint = fingerprint('winning task');

    const first = resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: winningFingerprint,
        reason: 'hash_mismatch',
      },
      {
        clearRuntime: () => {},
        resetState: async () => {
          markEntered();
          await gate;
        },
      },
    );
    await entered;

    const second = resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('losing task'),
        reason: 'hash_mismatch',
      },
      { clearRuntime: () => {}, resetState: async () => {} },
    );
    await expect(second).rejects.toMatchObject({ phase: 'lock' });
    expect(fs.readFileSync(path.join(azaDir, 'task-epoch'), 'utf8')).toBe(
      winningFingerprint,
    );

    releaseFirst();
    await first;
    expect(fs.readFileSync(path.join(azaDir, 'task-epoch'), 'utf8')).toBe(
      winningFingerprint,
    );
  });

  it('atomically recovers an expired lease whose owner process is gone', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-stale-lock-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    writeLockDir(azaDir, {
      owner: 'dead-owner',
      pid: 2_147_483_647,
      acquired_at: new Date(0).toISOString(),
      expires_at: new Date(1).toISOString(),
    });

    await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('after stale lock'),
        reason: 'residual_artifacts',
      },
      { clearRuntime: () => {}, resetState: async () => {} },
    );

    expect(fs.existsSync(path.join(azaDir, '.artifact-reset.lock'))).toBe(false);
    expect(fs.readFileSync(path.join(azaDir, 'task-epoch'), 'utf8')).toBe(
      fingerprint('after stale lock'),
    );
  });

  it('ignores an abandoned prepared lock temp directory when publishing the next lock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-lock-temp-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    const abandonedTemp = path.join(azaDir, '.artifact-reset.lock.dead-owner.tmp');
    fs.mkdirSync(abandonedTemp);
    fs.writeFileSync(
      path.join(abandonedTemp, 'lease.json'),
      JSON.stringify({
        owner: 'dead-owner',
        pid: 2_147_483_647,
        acquired_at: new Date(0).toISOString(),
        expires_at: new Date(1).toISOString(),
      }),
      'utf8',
    );

    const result = await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('after abandoned lock temp'),
        reason: 'residual_artifacts',
      },
      { clearRuntime: () => {}, resetState: async () => {} },
    );

    expect(result.committed).toBe(true);
    expect(fs.existsSync(path.join(azaDir, '.artifact-reset.lock'))).toBe(false);
    expect(fs.readFileSync(path.join(abandonedTemp, 'lease.json'), 'utf8')).toContain(
      'dead-owner',
    );
  });

  it('elects only one stale-lock recovery winner under a controlled race', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-election-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    const { lockPath, raw: staleLock } = writeLockDir(azaDir, {
      owner: 'dead-owner-race',
      pid: 2_147_483_647,
      acquired_at: new Date(0).toISOString(),
      expires_at: new Date(1).toISOString(),
    });
    let releaseWinner!: () => void;
    let winnerClaimed!: () => void;
    const claimed = new Promise<void>((resolve) => {
      winnerClaimed = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    const winnerFingerprint = fingerprint('election winner');

    const winner = resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: winnerFingerprint,
        reason: 'residual_artifacts',
      },
      {
        clearRuntime: () => {},
        resetState: async () => {},
        onRecoveryClaimed: async () => {
          winnerClaimed();
          await barrier;
        },
      },
    );
    await claimed;

    const fixedClaimDir = path.join(azaDir, '.artifact-reset.recovery-claim');
    expect(fs.statSync(fixedClaimDir).isDirectory()).toBe(true);
    const publishedClaim = fs.readFileSync(path.join(fixedClaimDir, 'lease.json'), 'utf8');

    const loser = resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('election loser'),
        reason: 'residual_artifacts',
      },
      { clearRuntime: () => {}, resetState: async () => {} },
    );
    await expect(loser).rejects.toMatchObject({ phase: 'lock' });
    expect(fs.readFileSync(path.join(lockPath, 'lease.json'), 'utf8')).toBe(
      staleLock,
    );
    expect(fs.readFileSync(path.join(fixedClaimDir, 'lease.json'), 'utf8')).toBe(
      publishedClaim,
    );

    releaseWinner();
    const result = await winner;
    expect(result.committed).toBe(true);
    expect(fs.readFileSync(path.join(azaDir, 'task-epoch'), 'utf8')).toBe(
      winnerFingerprint,
    );
    expect(fs.existsSync(path.join(azaDir, '.artifact-reset.recovery-claim'))).toBe(false);
  });

  it('keeps rollback ownership while a legal competitor is rejected', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-owner-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'quality-passed.marker'), 'restore me', 'utf8');
    let releaseFailure!: () => void;
    let stateEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      stateEntered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });

    const owner = resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('owner task'),
        reason: 'hash_mismatch',
      },
      {
        clearRuntime: () => {},
        resetState: async () => {
          stateEntered();
          await barrier;
          throw new Error('force owner rollback');
        },
      },
    );
    await entered;
    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('owner thief'),
          reason: 'hash_mismatch',
        },
        { clearRuntime: () => {}, resetState: async () => {} },
      ),
    ).rejects.toMatchObject({ phase: 'lock' });

    releaseFailure();
    await expect(owner).rejects.toMatchObject({ phase: 'commit' });
    expect(fs.readFileSync(path.join(azaDir, 'quality-passed.marker'), 'utf8')).toBe(
      'restore me',
    );
    expect(fs.existsSync(path.join(azaDir, 'task-epoch'))).toBe(false);
  });

  it('returns a committed non-retryable result when lease release fails after commit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-release-ok-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });

    const result = await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('committed release warning'),
        reason: 'residual_artifacts',
      },
      {
        clearRuntime: () => {},
        resetState: async () => {},
        releaseLease: async () => {
          throw new Error('injected unlink failure');
        },
      },
    );

    expect(result).toMatchObject({ committed: true, non_retryable: true });
    expect(result.warnings.join(' ')).toMatch(/unlink failure/);
    expect(fs.readFileSync(path.join(azaDir, 'task-epoch'), 'utf8')).toBe(
      fingerprint('committed release warning'),
    );
  });

  it('preserves the primary reset error when rollback succeeds but release fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-release-fail-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    let caught: unknown;

    try {
      await resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('primary error'),
          reason: 'hash_mismatch',
        },
        {
          clearRuntime: () => {},
          resetState: async () => {},
          writeEpoch: async () => {
            throw new Error('primary epoch failure');
          },
          releaseLease: async () => {
            throw new Error('secondary release failure');
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ArtifactResetError);
    expect(caught).toMatchObject({ phase: 'commit' });
    expect((caught as Error).message).toMatch(/primary epoch failure/);
    expect((caught as ArtifactResetError).release_error).toBeInstanceOf(Error);
  });

  it('cleans an abandoned expired recovery claim without permanently blocking resets', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-claim-crash-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    writeRecoveryClaimDir(azaDir, {
      owner: 'dead-recovery-owner',
      pid: 2_147_483_647,
      acquired_at: new Date(0).toISOString(),
      expires_at: new Date(1).toISOString(),
    });

    const result = await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('after claim crash'),
        reason: 'residual_artifacts',
      },
      { clearRuntime: () => {}, resetState: async () => {} },
    );

    expect(result.committed).toBe(true);
    expect(fs.existsSync(path.join(azaDir, '.artifact-reset.recovery-claim'))).toBe(false);
    const quarantine = fs
      .readdirSync(azaDir)
      .find((name) => name.startsWith('.artifact-reset.recovery-claim.stale-'));
    expect(quarantine).toBeTruthy();
    const quarantinePath = path.join(azaDir, quarantine!);
    expect(fs.statSync(quarantinePath).isDirectory()).toBe(true);
    expect(fs.readdirSync(quarantinePath).length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(quarantinePath, 'lease.json'))).toBe(true);
  });

  it('continues after a crash that already moved the directory claim into quarantine', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-claim-moved-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    const quarantineDir = path.join(azaDir, '.artifact-reset.recovery-claim.stale-moved');
    fs.mkdirSync(quarantineDir);
    fs.writeFileSync(path.join(quarantineDir, 'lease.json'), 'already quarantined', 'utf8');

    const result = await resetArtifacts(
      {
        aza_dir: azaDir,
        next_fingerprint: fingerprint('after completed claim move'),
        reason: 'residual_artifacts',
      },
      { clearRuntime: () => {}, resetState: async () => {} },
    );

    expect(result.committed).toBe(true);
    expect(fs.readFileSync(path.join(quarantineDir, 'lease.json'), 'utf8')).toBe(
      'already quarantined',
    );
  });

  it('never overwrites an existing quarantine or removes the fixed directory claim', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-claim-safe-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    const owner = 'dead-recovery-owner-quarantine-exists';
    const { claimPath, raw } = writeRecoveryClaimDir(azaDir, {
      owner,
      pid: 2_147_483_647,
      acquired_at: new Date(0).toISOString(),
      expires_at: new Date(1).toISOString(),
    });
    const observedOwner = createHash('sha256').update(owner).digest('hex').slice(0, 16);
    const quarantineDir = path.join(
      azaDir,
      `.artifact-reset.recovery-claim.stale-${observedOwner}`,
    );
    fs.mkdirSync(quarantineDir);
    fs.writeFileSync(path.join(quarantineDir, 'lease.json'), 'older cleanup winner', 'utf8');

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('must not delete fixed claim'),
          reason: 'residual_artifacts',
        },
        { clearRuntime: () => {}, resetState: async () => {} },
      ),
    ).rejects.toMatchObject({ phase: 'lock' });

    expect(fs.statSync(claimPath).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(claimPath, 'lease.json'), 'utf8')).toBe(raw);
    expect(fs.readFileSync(path.join(quarantineDir, 'lease.json'), 'utf8')).toBe(
      'older cleanup winner',
    );
  });

  it('treats corrupt RESUME as an error instead of a fresh workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-corrupt-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'RESUME.md'), 'not vNext resume data', 'utf8');
    const resume = new ResumeGenerator(azaDir);

    await expect(resume.read()).rejects.toThrow(/RESUME\.md/);
    const result = (await handleAzaAuto(
      { user_input: 'new task', workspace_path: root },
      new StateManager(azaDir),
      resume,
    )) as { success?: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/RESUME\.md/);
  });

  it('resets residual task artifacts even when RESUME is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-residual-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'quality-passed.marker'), 'orphan marker', 'utf8');
    process.env.AZA_AUTO_PICK = '0';
    process.env.AZA_AUTO_MAX_STEPS = '0';

    const result = (await handleAzaAuto(
      { user_input: 'new residual task', workspace_path: root },
      new StateManager(azaDir),
      new ResumeGenerator(azaDir),
    )) as { success?: boolean; error?: string };

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(azaDir, 'quality-passed.marker'))).toBe(false);
    const histories = fs.readdirSync(path.join(azaDir, 'history'));
    expect(
      histories.some((name) =>
        fs.existsSync(path.join(azaDir, 'history', name, 'quality-passed.marker')),
      ),
    ).toBe(true);
  });

  it('rejects a workspace and StateManager .aza mismatch without mutation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-path-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-other-'));
    tempDirs.push(root, other);
    const expectedAza = path.join(root, '.aza');
    const otherAza = path.join(other, '.aza');
    fs.mkdirSync(expectedAza, { recursive: true });
    fs.writeFileSync(path.join(expectedAza, 'quality-passed.marker'), 'keep me', 'utf8');

    const result = (await handleAzaAuto(
      { user_input: 'path mismatch', workspace_path: root },
      new StateManager(otherAza),
      new ResumeGenerator(expectedAza),
    )) as { success?: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/workspace\/\.aza mismatch/i);
    expect(fs.readFileSync(path.join(expectedAza, 'quality-passed.marker'), 'utf8')).toBe(
      'keep me',
    );
  });

  it('rejects symbolic-link history before acquiring the reset lock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-symlink-'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-external-'));
    tempDirs.push(root, external);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.symlinkSync(external, path.join(azaDir, 'history'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('symlink task'),
          reason: 'residual_artifacts',
        },
        { clearRuntime: () => {}, resetState: async () => {} },
      ),
    ).rejects.toMatchObject({ phase: 'prepare' });
    expect(fs.existsSync(path.join(azaDir, '.artifact-reset.lock'))).toBe(false);
  });

  it.each([
    '.artifact-reset.lock.attacker.tmp',
    '.artifact-reset.lock.stale-attacker',
    '.artifact-reset.recovery-claim.attacker.tmp',
    '.artifact-reset.recovery-claim.stale-attacker',
  ])('rejects symbolic reset control directory %s', async (controlName) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-control-link-'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-control-target-'));
    tempDirs.push(root, external);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.symlinkSync(
      external,
      path.join(azaDir, controlName),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint(`reject ${controlName}`),
          reason: 'residual_artifacts',
        },
        { clearRuntime: () => {}, resetState: async () => {} },
      ),
    ).rejects.toBeInstanceOf(ArtifactResetError);
    expect(fs.existsSync(path.join(azaDir, '.artifact-reset.lock'))).toBe(false);
  });

  it('rejects a symbolic abandoned history transaction without traversing it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-history-tx-link-'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-history-target-'));
    tempDirs.push(root, external);
    const azaDir = path.join(root, '.aza');
    const historyDir = path.join(azaDir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.symlinkSync(
      external,
      path.join(historyDir, '.attacker.tmp'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      resetArtifacts(
        {
          aza_dir: azaDir,
          next_fingerprint: fingerprint('reject abandoned transaction symlink'),
          reason: 'residual_artifacts',
        },
        { clearRuntime: () => {}, resetState: async () => {} },
      ),
    ).rejects.toMatchObject({ phase: 'rollback' });
    expect(fs.readdirSync(external)).toEqual([]);
  });

  it('creates isolated nested defaults for every StateManager instance', () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-state-default-a-'));
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-state-default-b-'));
    tempDirs.push(firstRoot, secondRoot);
    const first = new StateManager(path.join(firstRoot, '.aza'));
    const second = new StateManager(path.join(secondRoot, '.aza'));

    first.getState().loops.outer.board.pending.push('only first');
    expect(second.getState().loops.outer.board.pending).toEqual([]);
  });

  it('preserves stale markers when prepare fails because history is not a directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-artifact-reset-failure-'));
    tempDirs.push(root);
    const azaDir = path.join(root, '.aza');
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, 'quality-passed.marker'), 'old task', 'utf8');
    // A regular file at the required directory path deterministically injects
    // a prepare failure without relying on platform permissions.
    fs.writeFileSync(path.join(azaDir, 'history'), 'not a directory', 'utf8');

    const oldInput = '旧任务';
    const newInput = '全新任务';
    const resume = new ResumeGenerator(azaDir);
    resume.read = async () => ({
      current_stage: 'verify',
      iteration: 4,
      progress: '80%',
      client: 'test',
      model: 'test',
      next_action: 'check',
      next_tool: 'aza_quality',
      errors_to_avoid: [],
      last_milestone: new Date().toISOString(),
      task_id: `aza-${fingerprint(oldInput)}`,
      user_input_hash: fingerprint(oldInput),
    });
    process.env.AZA_AUTO_PICK = '0';
    process.env.AZA_AUTO_MAX_STEPS = '0';

    const result = (await handleAzaAuto(
      { user_input: newInput, workspace_path: root },
      new StateManager(azaDir),
      resume,
    )) as { success?: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/artifact reset/i);
    expect(fs.existsSync(path.join(azaDir, 'task-epoch'))).toBe(false);
    expect(fs.existsSync(path.join(azaDir, 'quality-passed.marker'))).toBe(true);
  });
});
