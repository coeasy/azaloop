import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { StateManager } from '../../packages/core/src/state/state-manager';
import migrateV1ToV2 from '../../packages/core/src/state/migrations/v1-to-v2';
import { MIGRATIONS } from '../../packages/core/src/state/migrations/registry';

describe('v14-P9.3 State migration + atomic writes', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aza-migrate-'));
  });
  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1) v2 state (already current) loads without migration', async () => {
    // First create a valid state with the StateManager (which produces
    // a v2 state under the hood). Then verify loadWithMigration doesn't
    // re-migrate it.
    const sm = new StateManager(tmpDir);
    await sm.load();
    const fp = path.join(tmpDir, 'STATE.yaml');
    const content = await fs.readFile(fp, 'utf8');
    expect(content).toContain('schema_version: 2');
    const sm2 = new StateManager(tmpDir);
    const r = await sm2.loadWithMigration();
    expect(r).toBeDefined();
    // Re-read the file to confirm no .bak was created (no migration ran).
    const after = await fs.readFile(fp, 'utf8');
    expect(after).toContain('schema_version: 2');
    const files = await fs.readdir(tmpDir);
    expect(files.some((f) => f.endsWith('.bak'))).toBe(false);
  });

  it('2) normal production load auto-migrates v1 state to v2 and creates a .bak', async () => {
    // Write a v1 state (no schema_version) by stripping the field from
    // a valid STATE.yaml.
    const sm = new StateManager(tmpDir);
    await sm.load();
    const fp = path.join(tmpDir, 'STATE.yaml');
    const v2yaml = await fs.readFile(fp, 'utf8');
    // Strip any schema_version line.
    const v1yaml = v2yaml
      .split('\n')
      .filter((l) => !/^schema_version\s*:/.test(l))
      .join('\n');
    await fs.writeFile(fp, v1yaml, 'utf8');
    const sm2 = new StateManager(tmpDir);
    const r = await sm2.load();
    expect(r).toBeDefined();
    // The .bak file should exist (from migration).
    const bak = await fs.stat(path.join(tmpDir, 'STATE.yaml.bak'));
    expect(bak.size).toBeGreaterThan(0);
    // The on-disk file should now have schema_version: 2.
    const after = await fs.readFile(fp, 'utf8');
    expect(after).toContain('schema_version: 2');
    expect(after).toContain('completion_gate');
  });

  it('3) atomicWriteState uses tmp + rename (no partial write)', async () => {
    const sm = new StateManager(tmpDir);
    const target = path.join(tmpDir, 'atomic-test.yaml');
    await sm.atomicWriteState(target, 'hello: world\n');
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('hello: world\n');
    // No leftover .tmp file
    const tmpFile = target + '.tmp';
    let threw = false;
    try {
      await fs.stat(tmpFile);
    } catch (err) {
      threw = (err as NodeJS.ErrnoException).code === 'ENOENT';
    }
    expect(threw).toBe(true);
  });

  it('4) migrateV1ToV2 is idempotent and adds required fields', () => {
    const v1 = { pipeline: { current_stage: 'open' } };
    const v2a = migrateV1ToV2(v1 as unknown as Record<string, unknown>);
    const v2b = migrateV1ToV2(v2a);
    expect((v2a as { schema_version: number }).schema_version).toBe(2);
    expect((v2b as { schema_version: number }).schema_version).toBe(2);
    const pipeline = v2b.pipeline as { completion_gate?: { required_phases: string[] } };
    expect(pipeline.completion_gate?.required_phases).toEqual([]);
  });

  it('5) migrateState chains multiple migrations when fromVersion < target-1', async () => {
    const sm = new StateManager(tmpDir);
    const r = await sm.migrateState({ pipeline: {} } as unknown as Record<string, unknown>, 1, 2);
    expect((r as { schema_version: number }).schema_version).toBe(2);
  });

  it('6) migration registry owns the executable transformer', () => {
    const migration = MIGRATIONS.find((item) => item.from === 1 && item.to === 2);

    expect(migration).toBeDefined();
    expect((migration as unknown as { transformer?: unknown }).transformer).toBe(migrateV1ToV2);
  });

  it('7) normal load fails closed when the migration path is incomplete', async () => {
    const sm = new StateManager(tmpDir);
    await sm.load();
    const currentVersion = StateManager.CURRENT_STATE_VERSION;
    Object.defineProperty(StateManager, 'CURRENT_STATE_VERSION', {
      configurable: true,
      value: currentVersion + 1,
    });

    try {
      await expect(new StateManager(tmpDir).load()).rejects.toThrow(
        new RegExp(`No migration available for v${currentVersion}.*v${currentVersion + 1}`),
      );
    } finally {
      Object.defineProperty(StateManager, 'CURRENT_STATE_VERSION', {
        configurable: true,
        value: currentVersion,
      });
    }
  });

  it('8) normal load preserves a backup and rejects transformer failures', async () => {
    const sm = new StateManager(tmpDir);
    await sm.load();
    const statePath = path.join(tmpDir, 'STATE.yaml');
    const current = await fs.readFile(statePath, 'utf8');
    await fs.writeFile(
      statePath,
      current.replace(/^schema_version:\s*\d+\s*\r?\n/m, ''),
      'utf8',
    );
    const migration = MIGRATIONS[0] as unknown as {
      transformer: (state: Record<string, unknown>) => Record<string, unknown>;
    };
    const original = migration.transformer;
    migration.transformer = () => {
      throw new Error('synthetic transformer failure');
    };

    try {
      await expect(new StateManager(tmpDir).load()).rejects.toThrow(
        /Migration v1.*v2 failed: synthetic transformer failure/,
      );
      const backup = await fs.readFile(`${statePath}.bak`, 'utf8');
      expect(backup).not.toContain('schema_version:');
    } finally {
      migration.transformer = original;
    }
  });
});
