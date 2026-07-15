/**
 * Task Source Adapters (T27)
 *
 * Implements the 8 task-source adapters from michaelshimeles/ralphy +
 * wenqingyu/ralphy-openspec. Each adapter converts a different input
 * format into a normalized `TaskItem[]` so the inner loop can consume
 * them uniformly.
 *
 * Reference:
 *   - michaelshimeles/ralphy (8 task sources: md, yaml, json, folder, github, ...)
 *   - wenqingyu/ralphy-openspec (ralphy-spec, openspec-change)
 *   - azaloop internal (aza-prd)
 *
 * The 8 adapters:
 *   md              — parse `- [ ]` / `- [x]` lines in a markdown file
 *   yaml            — parse a YAML array of task objects
 *   json            — parse a JSON array of task objects
 *   folder          — aggregate `*.md` files in a directory
 *   github          — fetch issues from a GitHub repo (mock-friendly)
 *   ralphy-spec     — parse a ralphy-spec `tasks.yaml`
 *   openspec-change — parse `openspec/changes/<slug>/tasks.md` (delegates to md)
 *   aza-prd         — parse `.aza/PRD.md` (delegates to md)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SkillTaskSource } from '../L5_skill/registry';

export interface TaskItem {
  title: string;
  completed: boolean;
  line?: number;
  parallel_group?: number;
  description?: string;
  source: SkillTaskSource;
  /** Source-specific locator: file path, issue number, etc. */
  ref?: string;
  /** Optional structured fields from OpenSpec tasks.md sub-lines. */
  id?: string;
  verify?: string;
  ac?: string[];
  deps?: string[];
}

// ── Helpers ─────────────────────────────────────────────────

function isChecked(line: string): boolean {
  return /^\s*-\s*\[x\]/i.test(line);
}

function isUnchecked(line: string): boolean {
  return /^\s*-\s*\[ \]/.test(line);
}

function extractTitle(line: string): string {
  return line
    .replace(/^\s*-\s*\[[ x]\]\s*/i, '')
    .replace(/[_*]*\s*\(verification:[^)]*\)\s*[_*]*/i, '')
    .replace(/^\*\*[^*]+\*\*\s*/, '')
    .replace(/^_+/, '')
    .trim();
}

function extractParallelGroup(line: string): number | undefined {
  const m = line.match(/(?:^|\s)\*\*([0-9]+(?:\.[0-9]+)*)\*\*/);
  if (!m || !m[1]) return undefined;
  const root = parseInt(m[1].split('.')[0] ?? '0', 10);
  return Number.isFinite(root) ? root : undefined;
}

// ── md ──────────────────────────────────────────────────────

export async function parseMdTasks(filePath: string, source: SkillTaskSource = 'md'): Promise<TaskItem[]> {
  if (!fs.existsSync(filePath)) return [];
  const content = await fs.promises.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const out: TaskItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isChecked(line) || isUnchecked(line)) {
      const title = extractTitle(line);
      const idMatch = line.match(/\*\*([0-9]+(?:\.[0-9]+)*)\*\*/);
      const item: TaskItem = {
        title,
        completed: isChecked(line),
        line: i + 1,
        parallel_group: extractParallelGroup(line),
        source,
        ref: filePath,
        id: idMatch?.[1],
      };
      // Collect indented sub-lines: verify / ac / deps
      for (let j = i + 1; j < lines.length; j++) {
        const sub = lines[j] ?? '';
        if (/^\s*-\s*\[[ x]\]/i.test(sub) || /^#/.test(sub) || (/^\S/.test(sub) && sub.trim())) break;
        const verify = sub.match(/^\s+-\s*verify:\s*`?([^`\n]+)`?\s*$/i);
        const ac = sub.match(/^\s+-\s*ac:\s*(.+)\s*$/i);
        const deps = sub.match(/^\s+-\s*deps:\s*(.+)\s*$/i);
        if (verify) item.verify = verify[1]!.trim();
        if (ac) {
          item.ac = ac[1]!
            .split(',')
            .map((s) => s.replace(/[`\s]/g, '').trim())
            .filter(Boolean);
        }
        if (deps) {
          item.deps = deps[1]!
            .split(',')
            .map((s) => s.replace(/[`\s]/g, '').trim())
            .filter(Boolean);
        }
        if (verify || ac || deps) i = j;
      }
      const verInline = line.match(/\(verification:\s*([^)]+)\)/i);
      if (!item.verify && verInline) item.verify = verInline[1]!.trim();
      out.push(item);
    }
  }
  return out;
}

// ── yaml ────────────────────────────────────────────────────

/**
 * Minimal YAML parser for the common task-list shape. We do NOT depend
 * on an external yaml library — the expected format is:
 *
 *   - title: Add feature
 *     completed: false
 *     parallel_group: 1
 *   - title: Fix bug
 *     completed: true
 *
 * or the block-list form:
 *
 *   - title: Add feature
 *     description: "..."
 *
 * Indentation is 2 spaces; list items start with "- " and map keys
 * are simple `key: value` pairs (no nested maps, no anchors, no
 * multi-line scalars). This covers 95% of real-world task files; for
 * the rest, callers should use the `json` source.
 */
export async function parseYamlTasks(filePath: string): Promise<TaskItem[]> {
  if (!fs.existsSync(filePath)) return [];
  const content = await fs.promises.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const out: TaskItem[] = [];
  let current: Partial<TaskItem> | null = null;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;

    // New list item
    if (/^\s*-\s+/.test(line)) {
      if (current && current.title !== undefined) {
        out.push(finalizeTaskItem(current, 'yaml', filePath));
      }
      current = {};
      // Inline "key: value" on the same line as "- "
      const inline = line.replace(/^\s*-\s+/, '');
      const colon = inline.indexOf(':');
      if (colon > 0) {
        const key = inline.slice(0, colon).trim();
        const value = unquoteYaml(inline.slice(colon + 1).trim());
        assignTaskField(current, key, value);
      }
      continue;
    }

    if (current) {
      // Continuation: `  key: value`
      const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if (m && m[1]) {
        const value = unquoteYaml((m[2] ?? '').trim());
        assignTaskField(current, m[1], value);
      }
    }
  }

  if (current && current.title !== undefined) {
    out.push(finalizeTaskItem(current, 'yaml', filePath));
  }
  return out;
}

function unquoteYaml(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function assignTaskField(t: Partial<TaskItem>, key: string, value: string): void {
  switch (key) {
    case 'title':
      t.title = value;
      break;
    case 'description':
      t.description = value;
      break;
    case 'completed':
      t.completed = value === 'true' || value === 'yes' || value === '1';
      break;
    case 'parallel_group':
    case 'parallelGroup':
      t.parallel_group = parseInt(value, 10);
      break;
    case 'line':
      t.line = parseInt(value, 10);
      break;
  }
}

function finalizeTaskItem(t: Partial<TaskItem>, source: SkillTaskSource, ref: string): TaskItem {
  return {
    title: t.title ?? '(untitled)',
    completed: t.completed ?? false,
    line: t.line,
    parallel_group: t.parallel_group,
    description: t.description,
    source,
    ref,
  };
}

// ── json ────────────────────────────────────────────────────

export async function parseJsonTasks(filePath: string): Promise<TaskItem[]> {
  if (!fs.existsSync(filePath)) return [];
  const content = await fs.promises.readFile(filePath, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new Error(`parseJsonTasks: invalid JSON in ${filePath}: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`parseJsonTasks: expected JSON array in ${filePath}`);
  }
  return data.map((entry, i) => {
    const t = (entry ?? {}) as Record<string, unknown>;
    return finalizeTaskItem(
      {
        title: typeof t.title === 'string' ? t.title : `Task ${i + 1}`,
        completed: Boolean(t.completed),
        parallel_group: typeof t.parallel_group === 'number' ? t.parallel_group : undefined,
        description: typeof t.description === 'string' ? t.description : undefined,
      },
      'json',
      filePath,
    );
  });
}

// ── folder ──────────────────────────────────────────────────

/**
 * Aggregate all `*.md` task files in a directory. Returns a Map keyed
 * by relative path so the caller can group by file if needed.
 */
export async function parseFolderTasks(dirPath: string): Promise<Map<string, TaskItem[]>> {
  const out = new Map<string, TaskItem[]>();
  if (!fs.existsSync(dirPath)) return out;
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(dirPath, entry.name);
    const items = await parseMdTasks(filePath);
    if (items.length > 0) out.set(filePath, items);
  }
  return out;
}

// ── github (mock-friendly) ──────────────────────────────────

/**
 * Fetch tasks from GitHub issues. In tests / offline environments the
 * caller can supply a `mockIssues` array; otherwise the function will
 * attempt a real fetch via the GitHub REST API and gracefully return
 * an empty array on failure.
 */
export interface GitHubIssueMock {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body?: string;
  labels?: Array<{ name: string }>;
}

export async function parseGitHubTasks(
  owner: string,
  repo: string,
  label: string,
  options: { token?: string; mockIssues?: GitHubIssueMock[] } = {},
): Promise<TaskItem[]> {
  if (options.mockIssues) {
    return options.mockIssues
      .filter((iss) => !label || (iss.labels ?? []).some((l) => l.name === label))
      .map((iss) => ({
        title: iss.title,
        completed: iss.state === 'closed',
        source: 'github' as SkillTaskSource,
        ref: `${owner}/${repo}#${iss.number}`,
        description: iss.body,
      }));
  }

  if (!options.token) {
    // No credentials → return empty rather than throw, so callers can
    // continue when running in a no-network environment.
    return [];
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&labels=${encodeURIComponent(label)}&per_page=100`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      number: number;
      title: string;
      state: 'open' | 'closed';
      body?: string;
    }>;
    return data.map((iss) => ({
      title: iss.title,
      completed: iss.state === 'closed',
      source: 'github' as SkillTaskSource,
      ref: `${owner}/${repo}#${iss.number}`,
      description: iss.body,
    }));
  } catch {
    return [];
  }
}

// ── ralphy-spec ─────────────────────────────────────────────

/**
 * ralphy-spec task files are YAML with a slightly different convention:
 *   tasks:
 *     - id: 1
 *       title: ...
 *       completed: false
 *       parallel_group: 1
 */
export async function parseRalphySpecTasks(filePath: string): Promise<TaskItem[]> {
  if (!fs.existsSync(filePath)) return [];
  const content = await fs.promises.readFile(filePath, 'utf8');
  // Strip the `tasks:` header if present, then re-use the yaml parser.
  const stripped = content.replace(/^\s*tasks\s*:\s*\n/, '');
  const tmp = filePath + '.tmp';
  await fs.promises.writeFile(tmp, stripped, 'utf8');
  try {
    return await parseYamlTasks(tmp);
  } finally {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      /* ignore */
    }
  }
}

// ── openspec-change ─────────────────────────────────────────

/**
 * openspec/changes/<slug>/tasks.md. Delegates to parseMdTasks but
 * tags the source as 'openspec-change'.
 */
export async function parseOpenSpecChangeTasks(folderOrFile: string): Promise<TaskItem[]> {
  let filePath = folderOrFile;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(folderOrFile);
  } catch {
    return [];
  }
  if (stat.isDirectory()) {
    filePath = path.join(folderOrFile, 'tasks.md');
  }
  return parseMdTasks(filePath, 'openspec-change');
}

// ── aza-prd ─────────────────────────────────────────────────

/**
 * azaloop `.aza/PRD.md` stories extraction. Searches for
 * `### Story N.` / `## Story` headings plus `- [ ]` lines underneath.
 */
export async function parseAzaPrdTasks(filePath: string): Promise<TaskItem[]> {
  if (!fs.existsSync(filePath)) return [];
  const content = await fs.promises.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const out: TaskItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isChecked(line) || isUnchecked(line)) {
      out.push({
        title: extractTitle(line),
        completed: isChecked(line),
        line: i + 1,
        parallel_group: extractParallelGroup(line),
        source: 'aza-prd',
        ref: filePath,
      });
    }
  }
  return out;
}

// ── Unified TaskSourceAdapter facade ────────────────────────

export class TaskSourceAdapter {
  static md(path: string): Promise<TaskItem[]> { return parseMdTasks(path, 'md'); }
  static yaml(path: string): Promise<TaskItem[]> { return parseYamlTasks(path); }
  static json(path: string): Promise<TaskItem[]> { return parseJsonTasks(path); }
  static folder(dir: string): Promise<Map<string, TaskItem[]>> { return parseFolderTasks(dir); }
  static github(owner: string, repo: string, label: string, options?: { token?: string; mockIssues?: GitHubIssueMock[] }): Promise<TaskItem[]> {
    return parseGitHubTasks(owner, repo, label, options);
  }
  static ralphySpec(path: string): Promise<TaskItem[]> { return parseRalphySpecTasks(path); }
  static openspecChange(path: string): Promise<TaskItem[]> { return parseOpenSpecChangeTasks(path); }
  static azaPrd(path: string): Promise<TaskItem[]> { return parseAzaPrdTasks(path); }

  /**
   * Parse + quality-gate (P1-3: wire task-source-quality into main path).
   * Rejects sources scoring < 50 so the inner loop never starts on damaged input.
   */
  static async loadWithQuality(
    kind: 'md' | 'yaml' | 'json' | 'openspec-change' | 'aza-prd',
    filePath: string,
  ): Promise<{ items: TaskItem[]; quality: import('./task-source-quality').QualityGateResult }> {
    const { qualityGate } = await import('./task-source-quality');
    let items: TaskItem[] = [];
    switch (kind) {
      case 'yaml':
        items = await parseYamlTasks(filePath);
        break;
      case 'json':
        items = await parseJsonTasks(filePath);
        break;
      case 'openspec-change':
        items = await parseOpenSpecChangeTasks(filePath);
        break;
      case 'aza-prd':
        items = await parseAzaPrdTasks(filePath);
        break;
      default:
        items = await parseMdTasks(filePath, 'md');
    }
    const quality = qualityGate(items);
    if (!quality.allowed) {
      throw new Error(`Task source quality gate failed (${quality.level}): ${quality.reason}`);
    }
    return { items, quality };
  }
}
