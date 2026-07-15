/**
 * v13 — P2.1: Architecture Decision Record (ADR) lifecycle
 *
 * Implements Trellis / MADR-style ADRs that drive the ruflo-style
 * client-capability detection logic. Each ADR lives at
 * `.aza/docs/adr/NNNN-slug.md` and progresses through 4 states:
 *
 *   proposed → accepted → (deprecated | superseded)
 *
 * ADRs are the source of truth for architectural constraints:
 *   - `scanDiff(azaDir, candidateChange)` checks whether a code change
 *     would violate any accepted ADR's "Decision" / "Consequences" clauses.
 *   - `listAdrs(azaDir)` returns the full inventory for the agent to read.
 *   - `updateAdr(id, patch)` enforces legal status transitions.
 *
 * Reference: mindfold-ai/Trellis (adr.ts pattern) + MADR 4.x.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseFrontmatter,
  serializeFrontmatter,
  type ParsedFrontmatter,
} from './adr-frontmatter';

// ---------------------------------------------------------------------------
// Status state machine
// ---------------------------------------------------------------------------

export type AdrStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

const LEGAL_TRANSITIONS: Record<AdrStatus, AdrStatus[]> = {
  proposed: ['accepted', 'deprecated'],
  accepted: ['deprecated', 'superseded'],
  deprecated: [],
  superseded: [],
};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface Adr {
  /** Zero-padded numeric id, e.g. "0001". */
  id: string;
  /** Full file path. */
  path: string;
  /** Title (from frontmatter or first H1). */
  title: string;
  /** Current status. */
  status: AdrStatus;
  /** Date in ISO-8601 (date or datetime). */
  date: string;
  /** Deciders (list of names). */
  deciders: string[];
  /** Tags. */
  tags: string[];
  /** Other ADR ids this one supersedes. */
  supersedes: string[];
  /** Other ADR id that supersedes this one (when status=superseded). */
  supersededBy: string[];
  /** Body of the ADR (markdown after frontmatter). */
  body: string;
}

export interface CreateAdrInput {
  /** e.g. "Use TypeScript strict mode" — required. */
  title: string;
  /** Initial status. Defaults to 'proposed'. */
  status?: AdrStatus;
  /** Date in ISO-8601. Defaults to now. */
  date?: string;
  /** Deciders list. */
  deciders?: string[];
  /** Tags list. */
  tags?: string[];
  /** Body (markdown). */
  body: string;
}

export interface UpdateAdrPatch {
  title?: string;
  status?: AdrStatus;
  date?: string;
  deciders?: string[];
  tags?: string[];
  supersedes?: string[];
  supersededBy?: string[];
  body?: string;
}

export interface ScanDiffResult {
  /** True if any violation was detected. */
  hasViolations: boolean;
  /** Per-ADR list of detected violations. */
  violations: Array<{ adrId: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical filename for an ADR with the given id and slug.
 * Format: `NNNN-slug.md` (MADR convention).
 */
export function adrFilename(id: string, slug: string): string {
  const numericId = id.replace(/^0+/, '') || '0';
  const paddedId = numericId.padStart(4, '0');
  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${paddedId}-${safeSlug}.md`;
}

/**
 * Get the `.aza/docs/adr` directory, creating it if needed.
 */
export function adrDir(azaDir: string): string {
  return path.join(azaDir, 'docs', 'adr');
}

function ensureAdrDir(azaDir: string): string {
  const dir = adrDir(azaDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single ADR markdown file into an Adr object.
 */
export function parseAdr(filePath: string, content: string): Adr {
  const { fields, body, hasFrontmatter } = parseFrontmatter(content);
  // Filename: `0001-record-architecture-decisions.md`
  const base = path.basename(filePath, '.md');
  const idMatch = base.match(/^(\d{4})-(.+)$/);
  const id = idMatch && idMatch[1] ? idMatch[1] : '0000';
  const inferredTitle = idMatch && idMatch[2]
    ? idMatch[2].split('-').map(capitalize).join(' ')
    : 'Untitled';

  const status = parseStatus(fields['status']);
  const title = stringOr(fields['title'], inferredTitle);
  const date = stringOr(fields['date'], new Date().toISOString().slice(0, 10));
  const deciders = arrayOr(fields['deciders'], []);
  const tags = arrayOr(fields['tags'], []);
  const supersedes = arrayOr(fields['supersedes'], []);
  const supersededBy = arrayOr(fields['superseded_by'], []);

  return {
    id,
    path: filePath,
    title,
    status,
    date,
    deciders,
    tags,
    supersedes,
    supersededBy,
    body,
  };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function parseStatus(raw: string | string[] | undefined): AdrStatus {
  if (typeof raw !== 'string') return 'proposed';
  const s = raw.toLowerCase();
  if (s === 'proposed' || s === 'accepted' || s === 'deprecated' || s === 'superseded') {
    return s;
  }
  return 'proposed';
}

function stringOr(raw: string | string[] | undefined, fallback: string): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw.join(', ');
  return fallback;
}

function arrayOr(raw: string | string[] | undefined, fallback: string[]): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return fallback;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Compute the next available ADR id (zero-padded to 4 digits).
 * Returns "0001" if no ADRs exist.
 */
export function nextAdrId(azaDir: string): string {
  const adrs = listAdrs(azaDir);
  if (adrs.length === 0) return '0001';
  const max = adrs.reduce((m, a) => {
    const n = parseInt(a.id, 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return String(max + 1).padStart(4, '0');
}

/**
 * Create a new ADR file. Returns the created Adr.
 */
export function createAdr(azaDir: string, input: CreateAdrInput): Adr {
  const dir = ensureAdrDir(azaDir);
  const id = nextAdrId(azaDir);
  const filename = adrFilename(id, input.title);
  const filePath = path.join(dir, filename);
  const status = input.status ?? 'proposed';
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const deciders = input.deciders ?? [];
  const tags = input.tags ?? [];

  const fields: Record<string, string | string[]> = {
    id: `ADR-${id}`,
    title: input.title,
    status,
    date,
    deciders,
    tags,
    supersedes: [],
    superseded_by: [],
  };

  const body = input.body.startsWith('#') ? input.body : `# ${input.title}\n\n${input.body}`;
  const markdown = serializeFrontmatter(fields, body);
  fs.writeFileSync(filePath, markdown, 'utf8');
  return parseAdr(filePath, fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * List all ADRs in the given `.aza` directory, sorted by id ascending.
 * ADRs are loaded lazily; missing directory returns [].
 */
export function listAdrs(azaDir: string): Adr[] {
  const dir = adrDir(azaDir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const adrs: Adr[] = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    try {
      const content = fs.readFileSync(fp, 'utf8');
      adrs.push(parseAdr(fp, content));
    } catch {
      // skip unreadable files
    }
  }
  adrs.sort((a, b) => a.id.localeCompare(b.id));
  return adrs;
}

/**
 * Get a single ADR by id (e.g. "0001" or "ADR-0001").
 * Returns null if not found.
 */
export function getAdr(azaDir: string, id: string): Adr | null {
  const numeric = id.replace(/^ADR-/, '');
  const adrs = listAdrs(azaDir);
  return adrs.find((a) => a.id === numeric) ?? null;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Update an existing ADR. Validates status transitions. Throws on
 * illegal transitions or missing files.
 */
export function updateAdr(azaDir: string, id: string, patch: UpdateAdrPatch): Adr {
  const adr = getAdr(azaDir, id);
  if (!adr) {
    throw new Error(`ADR ${id} not found in ${azaDir}`);
  }

  // Status transition validation
  if (patch.status && patch.status !== adr.status) {
    const legal = LEGAL_TRANSITIONS[adr.status];
    if (!legal.includes(patch.status)) {
      throw new Error(
        `Illegal status transition for ADR ${id}: ${adr.status} → ${patch.status}. ` +
        `Allowed: ${legal.join(', ') || '(none)'}`,
      );
    }
  }

  const fields: Record<string, string | string[]> = {
    id: `ADR-${adr.id}`,
    title: patch.title ?? adr.title,
    status: patch.status ?? adr.status,
    date: patch.date ?? adr.date,
    deciders: patch.deciders ?? adr.deciders,
    tags: patch.tags ?? adr.tags,
    supersedes: patch.supersedes ?? adr.supersedes,
    superseded_by: patch.supersededBy ?? adr.supersededBy,
  };
  const body = patch.body ?? adr.body;
  const markdown = serializeFrontmatter(fields, body);
  fs.writeFileSync(adr.path, markdown, 'utf8');
  return parseAdr(adr.path, fs.readFileSync(adr.path, 'utf8'));
}

// ---------------------------------------------------------------------------
// scanDiff: detect ADR violations in a candidate change
// ---------------------------------------------------------------------------

/**
 * Naive scanDiff: parse the candidate change for "violation markers"
 * that map to ADR `Consequences` sections.
 *
 * Heuristics (best-effort, intentionally simple):
 *   - If the candidate change contains a known violation phrase that
 *     matches a `## Consequences` bullet marked with "MUST NOT" or
 *     "DO NOT", a violation is reported.
 *   - File paths matching "forbidden_paths" in any ADR trigger a violation.
 *
 * The function is best-effort; it never throws. If the candidate change
 * is empty or no ADRs exist, returns `{ hasViolations: false }`.
 */
export function scanDiff(azaDir: string, candidateChange: string): ScanDiffResult {
  const result: ScanDiffResult = { hasViolations: false, violations: [] };
  if (typeof candidateChange !== 'string' || candidateChange.length === 0) {
    return result;
  }
  const adrs = listAdrs(azaDir);
  for (const adr of adrs) {
    if (adr.status !== 'accepted') continue;

    // Extract MUST NOT / DO NOT phrases from the body
    const mustNotMatches = extractMustNotPhrases(adr.body);
    for (const phrase of mustNotMatches) {
      if (phraseMatchesChange(phrase, candidateChange)) {
        result.violations.push({
          adrId: adr.id,
          reason: `ADR-${adr.id} forbids: "${phrase}"`,
        });
      }
    }

    // Extract forbidden file paths (e.g. `forbidden_paths: [src/legacy/**]`)
    const forbiddenPaths = extractForbiddenPaths(adr.body);
    for (const fp of forbiddenPaths) {
      if (candidateChange.includes(fp)) {
        result.violations.push({
          adrId: adr.id,
          reason: `ADR-${adr.id} forbids edits to: ${fp}`,
        });
      }
    }
  }
  result.hasViolations = result.violations.length > 0;
  return result;
}

/**
 * Extract MUST NOT / DO NOT / SHALL NOT phrases from ADR body.
 * Looks for bullets starting with those keywords.
 */
function extractMustNotPhrases(body: string): string[] {
  const phrases: string[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+(MUST NOT|DO NOT|SHALL NOT|NEVER|FORBIDDEN)\s+(.+)$/i);
    if (m && m[2]) {
      phrases.push(m[2].trim());
    }
  }
  return phrases;
}

/**
 * Match a MUST NOT phrase against a candidate change.
 * Full-phrase match first; then distinctive code-like tokens (e.g. console.log).
 */
function phraseMatchesChange(phrase: string, candidateChange: string): boolean {
  const lowerChange = candidateChange.toLowerCase();
  const lowerPhrase = phrase.toLowerCase();
  if (lowerChange.includes(lowerPhrase)) return true;
  const codeTokens = phrase.match(/[A-Za-z_][\w.]{3,}/g) ?? [];
  for (const tok of codeTokens) {
    // Skip generic English words that appear in policy prose
    if (/^(use|using|used|production|code|never|always|should|must|not)$/i.test(tok)) {
      continue;
    }
    if (lowerChange.includes(tok.toLowerCase())) return true;
  }
  return false;
}

/**
 * Extract `forbidden_paths: [a, b, c]` declarations from ADR body.
 */
function extractForbiddenPaths(body: string): string[] {
  const paths: string[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*forbidden_paths\s*:\s*\[(.*)\]\s*$/i);
    if (m && m[1]) {
      const inner = m[1];
      for (const part of inner.split(',')) {
        const cleaned = part.trim().replace(/^["']|["']$/g, '');
        if (cleaned) paths.push(cleaned);
      }
    }
  }
  return paths;
}
