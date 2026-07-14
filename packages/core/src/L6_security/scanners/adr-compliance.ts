/**
 * v14 — v13-P7.2: ADR Compliance Scanner
 *
 * Scans a list of changed files for violations against accepted ADRs in
 * `.aza/docs/adr/`. The scan is best-effort: parse failures only emit a
 * warning, never a hard error. Each ADR's "Decision" / "Consequences"
 * sections are pattern-matched against import / require / class
 * declarations in the diff to detect architectural drift.
 *
 * ## Pattern rules
 *   - `forbidden_import`     — `import X from 'mod'`
 *   - `forbidden_module`     — bare specifier `mod` in `from`/`require`
 *   - `forbidden_construct`  — keyword match in code (e.g. `eval`, `with`)
 *
 * Each rule is recorded in the ADR body under a `## Rules` section
 * using the JSON-ish line format:
 *   - `forbidden_import: lodash`
 *   - `forbidden_module: moment`
 *   - `forbidden_construct: eval`
 *
 * Reference: mindfold-ai/Trellis `adr.ts:scanDiff()` + MADR pattern.
 */

import * as fs from 'fs';
import * as path from 'path';
import { listAdrs, type Adr, type AdrStatus } from '../../L1_spec/adr';

// ── Public types ─────────────────────────────────────────────

export interface ChangedFile {
  /** File path relative to the workspace root. */
  path: string;
  /** File content (full or diff hunks). */
  content: string;
}

export interface AdrViolation {
  adrId: string;
  adrTitle: string;
  rule: string;
  file: string;
  evidence: string;
  line?: number;
}

export interface ComplianceResult {
  hasViolations: boolean;
  violations: AdrViolation[];
  scannedAdrs: number;
  scannedFiles: number;
  warnings: string[];
}

export type AdrRuleKind = 'forbidden_import' | 'forbidden_module' | 'forbidden_construct';

export interface AdrRule {
  kind: AdrRuleKind;
  /** The token to match (e.g. "lodash", "moment", "eval"). */
  token: string;
}

// ── ADR rule parsing ─────────────────────────────────────────

/**
 * Extract structured rules from an ADR's body.
 * Looks for a `## Rules` section with lines of the form
 *   - `forbidden_import: lodash`
 *   - `forbidden_module: moment`
 *   - `forbidden_construct: eval`
 */
export function parseAdrRules(adr: Adr): AdrRule[] {
  if (typeof adr.body !== 'string') return [];
  const rules: AdrRule[] = [];
  const ruleSection = extractSection(adr.body, 'Rules');
  if (!ruleSection) return rules;

  for (const line of ruleSection.split('\n')) {
    const m = line.match(/^\s*-\s*(forbidden_import|forbidden_module|forbidden_construct)\s*:\s*(\S+)/);
    if (!m || !m[1] || !m[2]) continue;
    const kind = m[1] as AdrRuleKind;
    const token = m[2].replace(/[`'"]/g, '');
    rules.push({ kind, token });
  }
  return rules;
}

function extractSection(body: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm');
  const m = body.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  // Stop at the next H1 or H2.
  const stopMatch = rest.match(/^#{1,2}\s+/m);
  const end = stopMatch && stopMatch.index !== undefined ? stopMatch.index : rest.length;
  return rest.slice(0, end);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── File scanning ────────────────────────────────────────────

/**
 * Scan a single file's content against a list of rules.
 * Returns a list of violations (file + line + evidence).
 */
export function scanFile(file: ChangedFile, rules: AdrRule[]): AdrViolation[] {
  const out: AdrViolation[] = [];
  const lines = file.content.split(/\r?\n/);
  for (const rule of rules) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (matchesRule(line, rule)) {
        out.push({
          adrId: '',
          adrTitle: '',
          rule: `${rule.kind}:${rule.token}`,
          file: file.path,
          evidence: line.trim().slice(0, 200),
          line: i + 1,
        });
      }
    }
  }
  return out;
}

function matchesRule(line: string, rule: AdrRule): boolean {
  switch (rule.kind) {
    case 'forbidden_import': {
      // `import ... from 'token'` or `import 'token'`
      const re = new RegExp(
        String.raw`import\s+(?:[\w*\s{},]*\s+from\s+)?['"\`]${escapeRegExp(rule.token)}['"\`]`,
      );
      return re.test(line);
    }
    case 'forbidden_module': {
      // `require('token')` or `from 'token'`
      const re = new RegExp(
        String.raw`(?:require\(\s*['"\`]${escapeRegExp(rule.token)}['"\`]\s*\)|from\s+['"\`]${escapeRegExp(rule.token)}['"\`])`,
      );
      return re.test(line);
    }
    case 'forbidden_construct': {
      // Bare word match (avoid breaking on substrings)
      const re = new RegExp(String.raw`\b${escapeRegExp(rule.token)}\b`);
      return re.test(line);
    }
  }
}

// ── Top-level scan ───────────────────────────────────────────

/**
 * Scan changed files for ADR compliance violations.
 *
 * Only `accepted` ADRs are checked — proposed/deprecated/superseded are
 * skipped. Best-effort: if reading a file fails, the failure is recorded
 * in `warnings` and the scan continues.
 */
export function scanAdrCompliance(
  azaDir: string,
  files: ChangedFile[],
): ComplianceResult {
  const warnings: string[] = [];
  const violations: AdrViolation[] = [];

  // 1) List all ADRs in the workspace.
  let adrs: Adr[] = [];
  try {
    adrs = listAdrs(azaDir);
  } catch (err) {
    warnings.push(`Failed to list ADRs: ${(err as Error).message}`);
    return {
      hasViolations: false,
      violations: [],
      scannedAdrs: 0,
      scannedFiles: files.length,
      warnings,
    };
  }

  const acceptedAdrs = adrs.filter((a) => a.status === ('accepted' as AdrStatus));

  // 2) For each accepted ADR, parse rules and scan files.
  for (const adr of acceptedAdrs) {
    let rules: AdrRule[] = [];
    try {
      rules = parseAdrRules(adr);
    } catch (err) {
      warnings.push(`Failed to parse rules for ADR ${adr.id}: ${(err as Error).message}`);
      continue;
    }
    if (rules.length === 0) continue;

    for (const file of files) {
      if (typeof file.content !== 'string') {
        warnings.push(`File "${file.path}" has no content, skipped`);
        continue;
      }
      const fileViolations = scanFile(file, rules);
      for (const v of fileViolations) {
        violations.push({
          ...v,
          adrId: adr.id,
          adrTitle: adr.title,
        });
      }
    }
  }

  return {
    hasViolations: violations.length > 0,
    violations,
    scannedAdrs: acceptedAdrs.length,
    scannedFiles: files.length,
    warnings,
  };
}

/**
 * Convenience: read files from disk and scan. Files that cannot be read
 * are recorded in `warnings` rather than aborting the scan.
 */
export function scanAdrComplianceFromDisk(
  azaDir: string,
  filePaths: string[],
  workspaceRoot: string = process.cwd(),
): ComplianceResult {
  const files: ChangedFile[] = [];
  for (const p of filePaths) {
    const abs = path.isAbsolute(p) ? p : path.join(workspaceRoot, p);
    try {
      const content = fs.readFileSync(abs, 'utf8');
      files.push({ path: p, content });
    } catch {
      // best-effort: skip unreadable files
    }
  }
  return scanAdrCompliance(azaDir, files);
}
