/**
 * v13 — P2.1: ADR Frontmatter Parser
 *
 * Lightweight YAML frontmatter parser for Architecture Decision Records.
 * We intentionally avoid a `yaml` dependency to keep the bundle small
 * and the surface predictable — ADR frontmatter is a small, well-known
 * subset of YAML (key: value, with optional quoted strings and lists).
 *
 * Supported frontmatter shape (MADR 4.x compatible):
 *   ---
 *   id: ADR-0001
 *   title: "Record architecture decisions"
 *   status: accepted
 *   date: 2026-07-13
 *   deciders: [azaloop-team]
 *   tags: [meta, process]
 *   supersedes: []
 *   superseded_by: []
 *   ---
 *
 * Anything more complex (multiline strings, anchors) is out of scope.
 */

export interface FrontmatterField {
  key: string;
  value: string | string[];
}

export interface ParsedFrontmatter {
  /** Map of key → value (string or list of strings). */
  fields: Record<string, string | string[]>;
  /** Body content after the closing `---`. */
  body: string;
  /** Whether frontmatter was present at all. */
  hasFrontmatter: boolean;
}

/**
 * Split a markdown document into its frontmatter and body. The frontmatter
 * is delimited by `---` on its own lines at the start of the document.
 */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  if (typeof markdown !== 'string') {
    return { frontmatter: '', body: '' };
  }
  const trimmed = markdown.replace(/^\uFEFF/, '').replace(/^\r?\n/, '');
  // The first line must be `---` exactly (after trimming)
  const firstLineEnd = trimmed.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? trimmed : trimmed.slice(0, firstLineEnd);
  if (firstLine.trim() !== '---') {
    return { frontmatter: '', body: markdown };
  }
  // Find the closing `---` on its own line AFTER the frontmatter body
  const rest = firstLineEnd === -1 ? '' : trimmed.slice(firstLineEnd + 1);
  const closeMatch = rest.match(/(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    return { frontmatter: '', body: markdown };
  }
  const frontmatter = rest.slice(0, closeMatch.index).replace(/\r?\n$/, '');
  const body = rest.slice(closeMatch.index + closeMatch[0].length);
  return { frontmatter, body };
}

/**
 * Parse a single frontmatter line `key: value` into a field. Lists like
 * `tags: [a, b, c]` or `tags: ["a", "b"]` are returned as `string[]`.
 */
function parseFrontmatterLine(line: string): FrontmatterField | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return null;
  const key = trimmed.slice(0, colonIdx).trim();
  const rawValue = trimmed.slice(colonIdx + 1).trim();
  if (key === '') return null;
  const value = parseValue(rawValue);
  return { key, value };
}

/**
 * Parse a YAML-ish value: quoted strings, bracketed lists, or raw text.
 */
function parseValue(raw: string): string | string[] {
  if (raw === '') return '';
  // Bracketed list: [a, b, c] or ["a", "b"]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return splitListItems(inner).map(stripQuotes);
  }
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Split a list body on commas while respecting quoted substrings.
 */
function splitListItems(body: string): string[] {
  const items: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === ',' && !inSingle && !inDouble) {
      items.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') items.push(buf.trim());
  return items;
}

/**
 * Strip surrounding quotes from a list item.
 */
function stripQuotes(s: string): string {
  const trimmed = s.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse a full markdown document into a ParsedFrontmatter.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const { frontmatter, body } = splitFrontmatter(markdown);
  if (frontmatter === '') {
    return { fields: {}, body: markdown, hasFrontmatter: false };
  }
  const fields: Record<string, string | string[]> = {};
  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const field = parseFrontmatterLine(line);
    if (field) {
      fields[field.key] = field.value;
    }
  }
  return { fields, body, hasFrontmatter: true };
}

/**
 * Serialize a frontmatter object back into a markdown string. The body
 * is appended verbatim (caller decides).
 */
export function serializeFrontmatter(
  fields: Record<string, string | string[]>,
  body: string,
): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        const items = value.map((v) => `"${escapeQuoted(v)}"`).join(', ');
        lines.push(`${key}: [${items}]`);
      }
    } else {
      // Quote strings that contain colons or special chars
      if (value.includes(':') || value.includes('"') || value.includes("'")) {
        lines.push(`${key}: "${escapeQuoted(value)}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

function escapeQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
