/**
 * OpenSpec Change Folder Generator (T23)
 *
 * Aligns with upstream OpenSpec / ralphy three-file layout:
 *   openspec/changes/<slug>/{proposal,design,tasks}.md
 * Specs are isolated per change (draft-safe), then apply/archive may merge:
 *   openspec/changes/<slug>/specs/<capability>/spec.md
 *
 * Lean rules (azaloop):
 *   - Do NOT embed Execution Contract / task_batches into proposal.md
 *   - proposal ends with a Contract pointer to `.aza/contract.md`
 *   - tasks.md uses structured verify / ac / deps sub-lines
 *   - optional change.yaml sidecar for machine status (synced from same input)
 *
 * Reference: wenqingyu/ralphy-openspec
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Public types ─────────────────────────────────────────────

export interface ChangeTaskInput {
  id: string;
  title: string;
  verification?: string;
  ac?: string[];
  deps?: string[];
  status?: 'pending' | 'done' | 'blocked';
}

export interface ChangeInput {
  /** User's raw intent / one-line description. */
  intent: string;
  /** Capability domain, e.g. 'auth', 'billing', 'review'. */
  capability: string;
  /** URL-safe slug, e.g. 'add-oauth-flow'. */
  slug: string;
  /** Author of the change (defaults to 'unknown'). */
  author?: string;
  /** ISO date string (defaults to today). */
  date?: string;
  /** Why this change is needed (optional — uses intent if omitted). */
  why?: string;
  /** What changes are being proposed (optional — bullet list). */
  whatChanges?: string[];
  /** Impact assessment. */
  impact?: 'low' | 'medium' | 'high' | 'critical';
  /** Non-goals (out of scope items). */
  nonGoals?: string[];
  /** Risks (with mitigation if any). */
  risks?: string[];
  /** Initial ADDED requirements (MUST/SHALL style). */
  addedRequirements?: string[];
  /** Initial MODIFIED requirements (MUST/SHALL style). */
  modifiedRequirements?: Array<{ id: string; before: string; after: string }>;
  /** Initial REMOVED requirements. */
  removedRequirements?: string[];
  /** Initial tasks checklist. */
  tasks?: ChangeTaskInput[];
  /** Technical approach paragraphs. */
  technicalApproach?: string[];
  /** Open questions to resolve. */
  openQuestions?: string[];
  /** Trade-offs considered. */
  tradeoffs?: Array<{ choice: string; alternative: string; rationale: string }>;
  /**
   * Pointer-only contract ref (never inject task_batches into proposal).
   * Defaults to `.aza/contract.md` when intent_lock is present.
   */
  contract?: {
    intent_lock?: string;
    /** Absolute or repo-relative path; default `.aza/contract.md`. */
    path?: string;
  };
  /** Write optional change.yaml sidecar (default true). */
  writeSidecar?: boolean;
}

export interface ChangeFolder {
  proposal: string;
  design: string;
  tasks: string;
  specs: string;
  sidecar?: string;
  folderPath: string;
  files: string[];
}

export interface ChangeListEntry {
  slug: string;
  status: 'draft' | 'applied' | 'archived';
  path: string;
  updatedAt: string;
}

// ── Section builders ────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildProposal(input: ChangeInput): string {
  const date = input.date ?? todayISO();
  const author = input.author ?? 'unknown';
  const whatChanges = input.whatChanges ?? [`Implement: ${input.intent}`];
  const nonGoals = input.nonGoals ?? [];
  const risks = input.risks ?? [];
  const contractPath = input.contract?.path ?? (input.contract ? '.aza/contract.md' : undefined);

  const body = `# Change: ${input.slug}

> Capability: \`${input.capability}\` · Date: ${date} · Author: ${author}
> Intent: ${input.intent}

## Why

${input.why ?? input.intent}

## What Changes

${whatChanges.map((w) => `- ${w}`).join('\n')}

## Impact

**Severity**: \`${input.impact ?? 'medium'}\`

This change affects the \`${input.capability}\` capability domain.

## Non-Goals

${nonGoals.length === 0 ? '_None specified._' : nonGoals.map((g) => `- ${g}`).join('\n')}

## Risks

${risks.length === 0 ? '_None specified._' : risks.map((r) => `- ${r}`).join('\n')}
`;

  if (!contractPath) return body;
  return `${body}
## Contract

Contract: \`${contractPath}\` (source of truth for intent lock / task batches — do not duplicate here)
`;
}

function buildSpec(input: ChangeInput): string {
  const date = input.date ?? todayISO();
  const added = input.addedRequirements ?? [
    `The system MUST support ${input.intent}.`,
  ];
  const modified = input.modifiedRequirements ?? [];
  const removed = input.removedRequirements ?? [];

  const addedSection =
    added.length === 0
      ? '_No new requirements._'
      : added.map((r, i) => `#### ${input.capability.toUpperCase()}-${String(i + 1).padStart(3, '0')}\n\n${r}`).join('\n\n');
  const modifiedSection =
    modified.length === 0
      ? '_No modifications._'
      : modified
          .map((m) => `#### ${m.id}\n\n**Before**: ${m.before}\n\n**After**: ${m.after}`)
          .join('\n\n');
  const removedSection =
    removed.length === 0
      ? '_No removals._'
      : removed.map((r, i) => `#### ${input.capability.toUpperCase()}-REM-${String(i + 1).padStart(3, '0')}\n\n${r}`).join('\n\n');

  return `# Specification: ${input.capability}

> Updated: ${date} · Change: ${input.slug}

## ADDED Requirements

${addedSection}

## MODIFIED Requirements

${modifiedSection}

## REMOVED Requirements

${removedSection}
`;
}

function buildTasks(input: ChangeInput): string {
  const tasks: ChangeTaskInput[] = input.tasks ?? [
    { id: '1.1', title: `Implement: ${input.intent}`, verification: 'Code review approved' },
    { id: '1.2', title: 'Write tests (TDD)', verification: 'All tests green' },
    { id: '1.3', title: 'Update documentation', verification: 'Docs review approved' },
  ];
  const date = input.date ?? todayISO();

  const blocks = tasks.map((t) => {
    const checked = t.status === 'done' ? 'x' : ' ';
    const lines = [`- [${checked}] **${t.id}** ${t.title}`];
    if (t.verification) lines.push(`  - verify: \`${t.verification}\``);
    if (t.ac && t.ac.length > 0) lines.push(`  - ac: ${t.ac.map((a) => `\`${a}\``).join(', ')}`);
    if (t.deps && t.deps.length > 0) lines.push(`  - deps: ${t.deps.map((d) => `\`${d}\``).join(', ')}`);
    return lines.join('\n');
  });

  return `# Tasks: ${input.slug}

> Capability: \`${input.capability}\` · Date: ${date}

${blocks.join('\n')}
`;
}

function buildDesign(input: ChangeInput): string {
  const date = input.date ?? todayISO();
  const approach =
    input.technicalApproach && input.technicalApproach.length > 0
      ? input.technicalApproach
      : [
          `- Keep OpenSpec three-piece (proposal/design/tasks) lean; contract lives only in \`.aza/contract.md\`.`,
          `- Implement: ${input.intent}`,
        ];
  const openQ = input.openQuestions ?? [];
  const tradeoffs = input.tradeoffs ?? [];

  // Design body must be >=80 chars for design-ready gate (without filler essays).
  return `# Design: ${input.slug}

> Capability: \`${input.capability}\` · Date: ${date}

## Technical Approach

${approach.join('\n')}

## Open Questions

${openQ.length === 0 ? '_None._' : openQ.map((q) => `- ${q}`).join('\n')}

## Trade-offs

${
  tradeoffs.length === 0
    ? '_None documented._'
    : tradeoffs
        .map((t) => `- **Chosen**: ${t.choice}\n  - **Alternative**: ${t.alternative}\n  - **Rationale**: ${t.rationale}`)
        .join('\n')
}
`;
}

function yamlQuote(s: string): string {
  if (/[:#\n"'{}[\],]|^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function buildSidecar(input: ChangeInput): string {
  const tasks = input.tasks ?? [];
  const lines: string[] = [
    `schema: azaloop.change/v1`,
    `slug: ${input.slug}`,
    `capability: ${input.capability}`,
    `status: draft`,
    `updated_at: ${yamlQuote(new Date().toISOString())}`,
    `intent: ${yamlQuote(input.intent)}`,
  ];
  if (input.contract) {
    lines.push(`contract_ref: ${yamlQuote(input.contract.path ?? '.aza/contract.md')}`);
  }
  lines.push('tasks:');
  if (tasks.length === 0) {
    lines.push('  []');
  } else {
    for (const t of tasks) {
      lines.push(`  - id: ${yamlQuote(t.id)}`);
      lines.push(`    title: ${yamlQuote(t.title)}`);
      lines.push(`    status: ${t.status ?? 'pending'}`);
      if (t.verification) lines.push(`    verify: ${yamlQuote(t.verification)}`);
      if (t.ac && t.ac.length) lines.push(`    ac: [${t.ac.map(yamlQuote).join(', ')}]`);
      if (t.deps && t.deps.length) lines.push(`    deps: [${t.deps.map(yamlQuote).join(', ')}]`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// ── Public API ──────────────────────────────────────────────

/**
 * Build a {@link ChangeFolder} in-memory. Does NOT touch the filesystem.
 */
export function scaffoldChange(input: ChangeInput): ChangeFolder {
  if (!input.intent?.trim()) {
    throw new Error('scaffoldChange: intent is required');
  }
  if (!input.capability?.trim()) {
    throw new Error('scaffoldChange: capability is required');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(input.slug)) {
    throw new Error(`scaffoldChange: slug must be kebab-case (got "${input.slug}")`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(input.capability)) {
    throw new Error(`scaffoldChange: capability must be kebab-case (got "${input.capability}")`);
  }

  const proposal = buildProposal(input);
  const writeSidecar = input.writeSidecar !== false;
  const sidecar = writeSidecar ? buildSidecar(input) : undefined;

  const folderPath = path.join('openspec', 'changes', input.slug);
  const files = [
    path.join(folderPath, 'proposal.md'),
    path.join(folderPath, 'design.md'),
    path.join(folderPath, 'tasks.md'),
    path.join(folderPath, 'specs', input.capability, 'spec.md'),
  ];
  if (sidecar) {
    files.push(path.join(folderPath, 'change.yaml'));
  }

  return {
    proposal,
    design: buildDesign(input),
    tasks: buildTasks(input),
    specs: buildSpec(input),
    sidecar,
    folderPath,
    files,
  };
}

/**
 * Persist a {@link ChangeFolder} to disk under `<baseDir>/openspec/...`.
 */
export async function writeChangeFolder(
  input: ChangeInput,
  baseDir: string,
): Promise<{ path: string; files: string[] }> {
  const folder = scaffoldChange(input);

  const writeOne = async (rel: string, content: string) => {
    const abs = path.join(baseDir, rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content, 'utf8');
  };

  await writeOne(folder.files[0]!, folder.proposal);
  await writeOne(folder.files[1]!, folder.design);
  await writeOne(folder.files[2]!, folder.tasks);
  await writeOne(folder.files[3]!, folder.specs);
  if (folder.sidecar && folder.files[4]) {
    await writeOne(folder.files[4], folder.sidecar);
  }

  return { path: folder.folderPath, files: folder.files };
}

/**
 * Archive a change to `openspec/changes/archive/YYYY-MM-DD-<slug>/`.
 */
export async function archiveChange(
  slug: string,
  baseDir: string,
  date: string,
): Promise<string> {
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    throw new Error(`archiveChange: slug must be kebab-case (got "${slug}")`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`archiveChange: date must be YYYY-MM-DD (got "${date}")`);
  }

  const source = path.join(baseDir, 'openspec', 'changes', slug);
  const target = path.join(baseDir, 'openspec', 'changes', 'archive', `${date}-${slug}`);

  if (!fs.existsSync(source)) {
    throw new Error(`archiveChange: source change not found at ${source}`);
  }

  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.rename(source, target);
  return path.relative(baseDir, target);
}

/**
 * List all changes under `openspec/changes/`, distinguishing draft / archived.
 */
export async function listChanges(baseDir: string): Promise<ChangeListEntry[]> {
  const root = path.join(baseDir, 'openspec', 'changes');
  if (!fs.existsSync(root)) return [];

  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const out: ChangeListEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'archive') continue;

    const slug = entry.name;
    const changeDir = path.join(root, slug);
    const proposalPath = path.join(changeDir, 'proposal.md');
    let updatedAt = '';
    try {
      const stat = await fs.promises.stat(proposalPath);
      updatedAt = stat.mtime.toISOString();
    } catch {
      updatedAt = new Date(0).toISOString();
    }
    out.push({
      slug,
      status: 'draft',
      path: path.relative(baseDir, changeDir),
      updatedAt,
    });
  }

  const archiveRoot = path.join(root, 'archive');
  if (fs.existsSync(archiveRoot)) {
    const archived = await fs.promises.readdir(archiveRoot, { withFileTypes: true });
    for (const entry of archived) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
      if (!match) continue;
      const archiveDir = path.join(archiveRoot, entry.name);
      let updatedAt = '';
      try {
        const stat = await fs.promises.stat(archiveDir);
        updatedAt = stat.mtime.toISOString();
      } catch {
        updatedAt = new Date(0).toISOString();
      }
      out.push({
        slug: match[2]!,
        status: 'archived',
        path: path.relative(baseDir, archiveDir),
        updatedAt,
      });
    }
  }

  return out;
}

/** Runtime fingerprint so MCP health can prove this lean scaffold is loaded. */
export const CHANGE_FOLDER_FINGERPRINT = 'lean-three-piece-v1-no-contract-embed';
