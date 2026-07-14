/**
 * OpenSpec Change Folder Generator (T23)
 *
 * Synthesizes the ralphy-openspec artifact flow into azaloop's L1_spec layer.
 * Mirrors the `openspec/changes/<slug>/{proposal,design,tasks}.md` + `specs/<capability>/spec.md`
 * four-piece set, allowing spec-first industrial-grade change management.
 *
 * Reference: wenqingyu/ralphy-openspec (https://github.com/wenqingyu/ralphy-openspec)
 *
 * File layout produced by `writeChangeFolder`:
 *   <baseDir>/openspec/changes/<slug>/proposal.md
 *   <baseDir>/openspec/changes/<slug>/design.md
 *   <baseDir>/openspec/changes/<slug>/tasks.md
 *   <baseDir>/openspec/changes/<capability>/spec.md
 *
 * Sections enforced (per ralphy-openspec convention):
 *   proposal.md: ## Why / ## What Changes / ## Impact / ## Non-Goals / ## Risks
 *   spec.md:     ## ADDED Requirements / ## MODIFIED Requirements / ## REMOVED Requirements
 *   tasks.md:    `1.1 [ ]` checkbox + verification remark
 *   design.md:   ## Technical Approach / ## Open Questions / ## Trade-offs
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Public types ─────────────────────────────────────────────

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
  tasks?: Array<{ id: string; title: string; verification?: string }>;
  /** Technical approach paragraphs. */
  technicalApproach?: string[];
  /** Open questions to resolve. */
  openQuestions?: string[];
  /** Trade-offs considered. */
  tradeoffs?: Array<{ choice: string; alternative: string; rationale: string }>;
  /**
   * v13 — P3.1: optional ExecutionContract reference. When provided,
   * `writeChangeFolder` injects a `## Execution Contract` section at the
   * top of `proposal.md` referencing the contract's `intent_lock` and
   * `task_batches`. This is the hard bridge between OpenSpec and the
   * spec-superflow execution contract.
   */
  contract?: {
    intent_lock?: string;
    task_batches?: Array<{ id: string; title: string; verification?: string }>;
  };
}

export interface ChangeFolder {
  proposal: string;
  design: string;
  tasks: string;
  specs: string;
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

  return `# Change: ${input.slug}

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
  const tasks = input.tasks ?? [
    { id: '1.1', title: `Implement: ${input.intent}`, verification: 'Code review approved' },
    { id: '1.2', title: 'Write tests (TDD)', verification: 'All tests green' },
    { id: '1.3', title: 'Update documentation', verification: 'Docs review approved' },
  ];
  const date = input.date ?? todayISO();

  return `# Tasks: ${input.slug}

> Capability: \`${input.capability}\` · Date: ${date}

${tasks
  .map((t) => `- [ ] **${t.id}** ${t.title}${t.verification ? ` _(verification: ${t.verification})_` : ''}`)
  .join('\n')}
`;
}

function buildDesign(input: ChangeInput): string {
  const date = input.date ?? todayISO();
  const approach = input.technicalApproach ?? [
    `1. Add the core implementation for "${input.intent}".`,
    `2. Wire it into the existing ${input.capability} module.`,
    `3. Expose a typed interface for downstream consumers.`,
  ];
  const openQ = input.openQuestions ?? [];
  const tradeoffs = input.tradeoffs ?? [];

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

// ── Public API ──────────────────────────────────────────────

/**
 * Build a {@link ChangeFolder} in-memory. Does NOT touch the filesystem.
 * This is the pure-data core; {@link writeChangeFolder} persists it.
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

  let proposal = buildProposal(input);

  // v13 — P3.1: if a contract is provided, inject a `## Execution Contract`
  // section at the top of the proposal so the build stage has a hard
  // bridge to the approved intent.
  if (input.contract) {
    const contractSection = buildContractSection(input.contract);
    proposal = contractSection + '\n' + proposal;
  }

  return {
    proposal,
    design: buildDesign(input),
    tasks: buildTasks(input),
    specs: buildSpec(input),
    folderPath: path.join('openspec', 'changes', input.slug),
    files: [
      path.join('openspec', 'changes', input.slug, 'proposal.md'),
      path.join('openspec', 'changes', input.slug, 'design.md'),
      path.join('openspec', 'changes', input.slug, 'tasks.md'),
      path.join('openspec', 'specs', input.capability, 'spec.md'),
    ],
  };
}

/**
 * v13 — P3.1: build the `## Execution Contract` section that bridges
 * OpenSpec → ExecutionContract (T17).
 */
function buildContractSection(contract: NonNullable<ChangeInput['contract']>): string {
  const lines: string[] = ['## Execution Contract', ''];
  if (contract.intent_lock) {
    lines.push(`**Intent Lock**: \`${contract.intent_lock}\``);
  }
  if (contract.task_batches && contract.task_batches.length > 0) {
    lines.push('', '**Task Batches**:', '');
    for (const b of contract.task_batches) {
      lines.push(`- \`${b.id}\`: ${b.title}${b.verification ? ` — _${b.verification}_` : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Persist a {@link ChangeFolder} to disk under `<baseDir>/openspec/...`.
 * Creates directories as needed. Returns the relative path and the list of
 * written files (relative to baseDir).
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

  return { path: folder.folderPath, files: folder.files };
}

/**
 * Archive a change to `openspec/changes/archive/YYYY-MM-DD-<slug>/`.
 * Returns the new archive path (relative to baseDir).
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
 * `applied` is currently always false (no applied/<slug>/ convention is set in
 * this Phase — Phase 4 may add an applied folder).
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
      // expected: YYYY-MM-DD-<slug>
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
