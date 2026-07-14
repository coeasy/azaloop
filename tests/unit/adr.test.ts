/**
 * v13 — P2.1: ADR lifecycle + scanDiff unit tests
 *
 * Covers:
 *   1) createAdr → next id is 0001 in a fresh dir
 *   2) createAdr → fields roundtrip through serialize/parse
 *   3) listAdrs → returns ADRs in id order
 *   4) updateAdr → legal status transitions
 *   5) updateAdr → illegal status transitions throw
 *   6) scanDiff → detects MUST NOT phrases from an accepted ADR
 *   7) parseFrontmatter → handles list values and quoted strings
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createAdr,
  listAdrs,
  getAdr,
  updateAdr,
  nextAdrId,
  parseAdr,
  scanDiff,
  adrDir,
  adrFilename,
} from '@azaloop/core';
import {
  parseFrontmatter,
  serializeFrontmatter,
  splitFrontmatter,
} from '@azaloop/core';

describe('v13 P2.1 — ADR lifecycle', () => {
  let azaDir: string;

  beforeEach(() => {
    azaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-adr-'));
  });

  afterEach(() => {
    fs.rmSync(azaDir, { recursive: true, force: true });
  });

  it('1) createAdr assigns next id 0001 in a fresh .aza', () => {
    const adr = createAdr(azaDir, {
      title: 'Use TypeScript strict mode',
      body: 'We adopt strict mode for safety.',
    });
    expect(adr.id).toBe('0001');
    expect(adr.status).toBe('proposed');
    expect(adr.title).toBe('Use TypeScript strict mode');
    expect(fs.existsSync(adr.path)).toBe(true);
  });

  it('2) createAdr fields roundtrip through serialize/parse', () => {
    const adr = createAdr(azaDir, {
      title: 'Adopt MADR template',
      status: 'accepted',
      tags: ['meta', 'process'],
      deciders: ['azaloop-team'],
      body: '## Decision\n\nUse MADR.\n\n## Consequences\n\n* MUST NOT use other templates',
    });
    const read = parseAdr(adr.path, fs.readFileSync(adr.path, 'utf8'));
    expect(read.id).toBe(adr.id);
    expect(read.status).toBe('accepted');
    expect(read.tags).toEqual(['meta', 'process']);
    expect(read.deciders).toEqual(['azaloop-team']);
    expect(read.body).toContain('MUST NOT use other templates');
  });

  it('3) listAdrs returns ADRs in ascending id order', () => {
    createAdr(azaDir, { title: 'First decision', body: 'body1' });
    createAdr(azaDir, { title: 'Second decision', body: 'body2' });
    createAdr(azaDir, { title: 'Third decision', body: 'body3' });
    const all = listAdrs(azaDir);
    expect(all.map((a) => a.id)).toEqual(['0001', '0002', '0003']);
    expect(all.map((a) => a.title)).toEqual(['First decision', 'Second decision', 'Third decision']);
  });

  it('4) updateAdr allows legal status transition (proposed → accepted)', () => {
    const created = createAdr(azaDir, { title: 'Test', body: 'body' });
    const updated = updateAdr(azaDir, created.id, { status: 'accepted' });
    expect(updated.status).toBe('accepted');
  });

  it('5) updateAdr throws on illegal status transition (proposed → superseded)', () => {
    const created = createAdr(azaDir, { title: 'Test', body: 'body' });
    expect(() => updateAdr(azaDir, created.id, { status: 'superseded' })).toThrow(/Illegal status transition/);
  });

  it('6) updateAdr allows accepted → deprecated', () => {
    const created = createAdr(azaDir, { title: 'Test', body: 'body', status: 'accepted' });
    const updated = updateAdr(azaDir, created.id, { status: 'deprecated' });
    expect(updated.status).toBe('deprecated');
  });

  it('7) scanDiff detects MUST NOT phrases from an accepted ADR', () => {
    const adr = createAdr(azaDir, {
      title: 'No console.log',
      status: 'accepted',
      body: '## Consequences\n\n* MUST NOT use console.log in production code',
    });
    const result = scanDiff(azaDir, 'I added a console.log("hi") line here.');
    expect(result.hasViolations).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]!.adrId).toBe(adr.id);
  });

  it('8) scanDiff does NOT detect violations in proposed ADRs (only accepted)', () => {
    createAdr(azaDir, {
      title: 'No console.log',
      status: 'proposed',
      body: '## Consequences\n\n* MUST NOT use console.log',
    });
    const result = scanDiff(azaDir, 'I added a console.log line.');
    expect(result.hasViolations).toBe(false);
  });

  it('9) scanDiff detects forbidden_paths entries', () => {
    createAdr(azaDir, {
      title: 'No legacy edits',
      status: 'accepted',
      body: '## Constraints\n\nforbidden_paths: [src/legacy/, .aza/old/]',
    });
    const result = scanDiff(azaDir, 'I want to edit src/legacy/old.ts to fix a bug.');
    expect(result.hasViolations).toBe(true);
  });

  it('10) getAdr returns null for unknown id', () => {
    const adr = getAdr(azaDir, '9999');
    expect(adr).toBeNull();
  });

  it('11) nextAdrId returns 0001 for empty dir and increments', () => {
    expect(nextAdrId(azaDir)).toBe('0001');
    createAdr(azaDir, { title: 'First', body: 'b' });
    createAdr(azaDir, { title: 'Second', body: 'b' });
    expect(nextAdrId(azaDir)).toBe('0003');
  });

  it('12) adrFilename uses zero-padded id and slug', () => {
    const name = adrFilename('1', 'Record Architecture Decisions');
    expect(name).toBe('0001-record-architecture-decisions.md');
  });

  it('13) adrDir returns expected path under .aza', () => {
    expect(adrDir(azaDir)).toBe(path.join(azaDir, 'docs', 'adr'));
  });
});

describe('v13 P2.1 — ADR frontmatter parser', () => {
  it('1) splitFrontmatter returns empty frontmatter when no --- delimiters', () => {
    const md = '# Hello\n\nbody';
    const r = splitFrontmatter(md);
    expect(r.frontmatter).toBe('');
    expect(r.body).toBe(md);
  });

  it('2) splitFrontmatter extracts frontmatter between --- delimiters', () => {
    const md = '---\nkey: value\n---\n# body';
    const r = splitFrontmatter(md);
    expect(r.frontmatter).toBe('key: value');
    expect(r.body).toBe('# body');
  });

  it('3) parseFrontmatter parses string values', () => {
    const md = '---\nid: 0001\ntitle: Test\n---\n# body';
    const r = parseFrontmatter(md);
    expect(r.hasFrontmatter).toBe(true);
    expect(r.fields['id']).toBe('0001');
    expect(r.fields['title']).toBe('Test');
    expect(r.body).toBe('# body');
  });

  it('4) parseFrontmatter parses list values', () => {
    const md = '---\ntags: [meta, process]\n---\n# body';
    const r = parseFrontmatter(md);
    expect(r.fields['tags']).toEqual(['meta', 'process']);
  });

  it('5) parseFrontmatter parses quoted strings', () => {
    const md = '---\ntitle: "Use strict mode"\n---\n# body';
    const r = parseFrontmatter(md);
    expect(r.fields['title']).toBe('Use strict mode');
  });

  it('6) serializeFrontmatter roundtrips through parseFrontmatter', () => {
    const fields = {
      id: '0001',
      title: 'Test ADR',
      tags: ['meta', 'process'],
    };
    const md = serializeFrontmatter(fields, '# Body\n');
    const r = parseFrontmatter(md);
    expect(r.fields['id']).toBe('0001');
    expect(r.fields['title']).toBe('Test ADR');
    expect(r.fields['tags']).toEqual(['meta', 'process']);
    expect(r.body).toBe('# Body\n');
  });
});
