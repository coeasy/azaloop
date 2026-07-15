/**
 * T23 — OpenSpec Change Folder tests
 *
 * Verifies the four core behaviors:
 *   1. scaffoldChange returns 4 markdown strings + folder metadata
 *   2. writeChangeFolder persists files at the canonical path
 *   3. archiveChange moves the change to the archive/ directory
 *   4. listChanges correctly distinguishes draft / archived
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  scaffoldChange,
  writeChangeFolder,
  archiveChange,
  listChanges,
} from '@azaloop/core';

describe('OpenSpec change-folder (T23)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azaloop-openspec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('scaffoldChange (in-memory)', () => {
    it('returns lean OpenSpec three-piece + change-local spec (no contract embed)', () => {
      const folder = scaffoldChange({
        intent: 'Add OAuth flow',
        capability: 'auth',
        slug: 'add-oauth',
        contract: { intent_lock: 'Add OAuth flow.', path: '.aza/contract.md' },
      });
      expect(folder.proposal).toContain('## Why');
      expect(folder.proposal).toContain('## What Changes');
      expect(folder.proposal).toContain('## Impact');
      expect(folder.proposal).toContain('## Non-Goals');
      expect(folder.proposal).toContain('## Risks');
      expect(folder.proposal).toContain('## Contract');
      expect(folder.proposal).toContain('.aza/contract.md');
      expect(folder.proposal).not.toContain('## Execution Contract');
      expect(folder.proposal).not.toContain('**Task Batches**');
      expect(folder.design).toContain('## Technical Approach');
      expect(folder.design).toContain('## Open Questions');
      expect(folder.design).toContain('## Trade-offs');
      expect(folder.tasks).toMatch(/- \[ \] \*\*1\.1\*\*/);
      expect(folder.tasks).toMatch(/- verify:/);
      expect(folder.specs).toContain('## ADDED Requirements');
      expect(folder.folderPath).toBe(path.join('openspec', 'changes', 'add-oauth'));
      expect(folder.files).toContain(path.join('openspec', 'changes', 'add-oauth', 'change.yaml'));
      expect(folder.files).toContain(
        path.join('openspec', 'changes', 'add-oauth', 'specs', 'auth', 'spec.md'),
      );
    });

    it('throws on missing intent / capability / invalid slug', () => {
      expect(() => scaffoldChange({ intent: '', capability: 'auth', slug: 'x' })).toThrow(/intent/);
      expect(() => scaffoldChange({ intent: 'x', capability: '', slug: 'x' })).toThrow(/capability/);
      expect(() => scaffoldChange({ intent: 'x', capability: 'auth', slug: 'Invalid Slug' })).toThrow(/kebab-case/);
      expect(() => scaffoldChange({ intent: 'x', capability: 'Auth', slug: 'x' })).toThrow(/kebab-case/);
    });

    it('emits MUST/SHALL language in spec requirements when supplied', () => {
      const folder = scaffoldChange({
        intent: 'Add token refresh',
        capability: 'auth',
        slug: 'token-refresh',
        addedRequirements: [
          'The system MUST refresh expired tokens within 60s.',
          'The system SHALL emit a metric on every refresh.',
        ],
      });
      expect(folder.specs).toContain('MUST refresh expired tokens');
      expect(folder.specs).toContain('SHALL emit a metric');
    });
  });

  describe('writeChangeFolder (filesystem)', () => {
    it('persists three-piece + change-local spec + sidecar', async () => {
      const result = await writeChangeFolder(
        { intent: 'Add OAuth', capability: 'auth', slug: 'add-oauth', contract: { path: '.aza/contract.md' } },
        tmpDir,
      );
      expect(result.path).toBe(path.join('openspec', 'changes', 'add-oauth'));
      for (const rel of result.files) {
        const abs = path.join(tmpDir, rel);
        expect(fs.existsSync(abs)).toBe(true);
      }
      const proposal = fs.readFileSync(path.join(tmpDir, result.files[0]!), 'utf8');
      expect(proposal).toContain('## Why');
      expect(proposal).not.toContain('## Execution Contract');
    });

    it('isolates specs under the change folder (no shared overwrite)', async () => {
      const result = await writeChangeFolder(
        { intent: 'New billing flow', capability: 'billing-v2', slug: 'new-billing' },
        tmpDir,
      );
      const specFile = path.join(
        tmpDir,
        'openspec',
        'changes',
        'new-billing',
        'specs',
        'billing-v2',
        'spec.md',
      );
      expect(fs.existsSync(specFile)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'openspec', 'specs', 'billing-v2', 'spec.md'))).toBe(false);
      expect(result.files.some((f) => f.endsWith('spec.md'))).toBe(true);
    });

    it('two drafts with same capability do not clobber each other', async () => {
      await writeChangeFolder(
        { intent: 'A', capability: 'core', slug: 'change-a', addedRequirements: ['MUST A'] },
        tmpDir,
      );
      await writeChangeFolder(
        { intent: 'B', capability: 'core', slug: 'change-b', addedRequirements: ['MUST B'] },
        tmpDir,
      );
      const a = fs.readFileSync(
        path.join(tmpDir, 'openspec/changes/change-a/specs/core/spec.md'),
        'utf8',
      );
      const b = fs.readFileSync(
        path.join(tmpDir, 'openspec/changes/change-b/specs/core/spec.md'),
        'utf8',
      );
      expect(a).toContain('MUST A');
      expect(b).toContain('MUST B');
      expect(a).not.toContain('MUST B');
    });
  });

  describe('archiveChange', () => {
    it('moves a draft change into archive/YYYY-MM-DD-<slug>/', async () => {
      await writeChangeFolder(
        { intent: 'Add feature', capability: 'misc', slug: 'feature-x' },
        tmpDir,
      );
      const archived = await archiveChange('feature-x', tmpDir, '2026-07-13');
      expect(archived).toBe(path.join('openspec', 'changes', 'archive', '2026-07-13-feature-x'));
      const moved = path.join(tmpDir, archived, 'proposal.md');
      expect(fs.existsSync(moved)).toBe(true);
      const original = path.join(tmpDir, 'openspec', 'changes', 'feature-x');
      expect(fs.existsSync(original)).toBe(false);
    });

    it('rejects invalid slug or date', async () => {
      await expect(archiveChange('BadSlug', tmpDir, '2026-07-13')).rejects.toThrow(/kebab-case/);
      await expect(archiveChange('feature-y', tmpDir, '2026/07/13')).rejects.toThrow(/YYYY-MM-DD/);
    });

    it('throws when source change does not exist', async () => {
      await expect(archiveChange('ghost', tmpDir, '2026-07-13')).rejects.toThrow(/not found/);
    });
  });

  describe('listChanges', () => {
    it('returns an empty list when openspec/ does not exist', async () => {
      const out = await listChanges(tmpDir);
      expect(out).toEqual([]);
    });

    it('returns drafts and archived entries with correct status', async () => {
      // Create two drafts
      await writeChangeFolder(
        { intent: 'A', capability: 'auth', slug: 'feature-a' },
        tmpDir,
      );
      await writeChangeFolder(
        { intent: 'B', capability: 'auth', slug: 'feature-b' },
        tmpDir,
      );
      // Archive one
      await archiveChange('feature-a', tmpDir, '2026-07-13');

      const all = await listChanges(tmpDir);
      const drafts = all.filter((e) => e.status === 'draft');
      const archived = all.filter((e) => e.status === 'archived');

      expect(drafts.map((d) => d.slug).sort()).toEqual(['feature-b']);
      expect(archived.map((a) => a.slug).sort()).toEqual(['feature-a']);
      // Path may use either separator depending on OS — check the trailing component.
      const expectedTail = `2026-07-13-feature-a`;
      expect(archived[0].path).toMatch(new RegExp(`archive[\\\\/]${expectedTail}$`));
    });
  });
});
