/**
 * execution-contract.ts
 *
 * Spec-superflow-style execution contract. Generated when a PRD is approved
 * and committed to `.aza/contract.md`. The contract is the hard bridge
 * between "what the user wants" (PRD) and "what the build stage is allowed
 * to do" — StageToolGuard and LoopController both consult it.
 *
 * Contents:
 *   - intent_lock         : the immutable summary of the user's intent
 *   - approved_behaviors  : the bullet list of behaviors the agent is allowed to ship
 *   - design_constraints  : hard "must" / "must not" rules distilled from the PRD
 *   - task_batches        : the implementation groups (one per P0 story by default)
 *   - test_obligations    : acceptance criteria that must be covered by tests
 *
 * Reference: https://github.com/MageByte-Zero/spec-superflow (execution-contract.md)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { PRD, Story } from '@azaloop/shared';
import type { PRDReviewResult } from './prd-review-gate';

export interface TaskBatch {
  /** Story id this batch implements. */
  story_id: string;
  /** Human-friendly title. */
  title: string;
  /** Acceptance criteria ids that this batch must satisfy. */
  acceptance_ids: string[];
  /** Allowed files / globs the implementation may touch. */
  allowed_paths: string[];
  /** Hard constraints distilled from the story description. */
  constraints: string[];
}

export interface ExecutionContract {
  /** Stable id — derived from the PRD id and a content hash. */
  contract_id: string;
  /** SHA-256 of the intent_lock string — used for drift detection. */
  intent_hash: string;
  /** PRD id this contract was generated from. */
  prd_id: string;
  /** PRD version (semver) — bumped when the contract is regenerated. */
  prd_version: string;
  /** ISO timestamp the contract was generated. */
  generated_at: string;
  /** The single, immutable sentence describing the user's intent. */
  intent_lock: string;
  /** Behaviors the agent is allowed to ship. */
  approved_behaviors: string[];
  /** Hard "must" / "must not" rules. */
  design_constraints: string[];
  /** Implementation groups — one batch per P0/P1 story by default. */
  task_batches: TaskBatch[];
  /** Acceptance criteria ids that must be covered by tests. */
  test_obligations: string[];
}

const HARD_CONSTRAINT_PATTERNS: Array<{ rx: RegExp; tag: string }> = [
  { rx: /\b(must (not )?(be|use|support|remain))\b/i, tag: 'must' },
  { rx: /\b(shall (not )?(be|use|support))\b/i, tag: 'must' },
  { rx: /\b(禁止|不得|必须)\b/, tag: 'must' },
];

/**
 * Build a one-sentence intent lock from the PRD title + first goal.
 * Returns an empty string if no goal is available.
 */
function buildIntentLock(prd: PRD): string {
  const firstGoal = prd.goals?.[0] ?? '';
  if (!firstGoal) return prd.title;
  // Strip trailing punctuation so we can re-add a period consistently.
  return `${prd.title}: ${firstGoal.replace(/[.。]+$/, '')}.`;
}

function deriveConstraints(prd: PRD): string[] {
  const out: string[] = [];
  const push = (text: string) => {
    const trimmed = text.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };

  for (const req of prd.non_functional_requirements) {
    if (HARD_CONSTRAINT_PATTERNS.some(p => p.rx.test(req.description))) {
      push(req.description);
    }
  }
  for (const risk of prd.risks ?? []) {
    if (risk.probability === 'high' && risk.mitigation) {
      push(risk.mitigation);
    }
  }
  return out;
}

function deriveBehaviors(prd: PRD): string[] {
  const vague = /^(.*?feature\s+\d+\s+)?works as expected[.!]?$/i;
  const out: string[] = [];
  for (const req of prd.functional_requirements ?? []) {
    if (req.priority === 'P0' && req.description && !vague.test(req.description.trim())) {
      out.push(req.description);
    }
  }
  for (const story of prd.stories ?? []) {
    if (story.priority === 'P0') {
      for (const ac of story.acceptance_criteria ?? []) {
        const text = (ac.description || '').trim();
        if (ac.testable && text && !vague.test(text)) out.push(text);
      }
    }
  }
  return Array.from(new Set(out));
}

function deriveTestObligations(prd: PRD): string[] {
  const out: string[] = [];
  for (const story of prd.stories ?? []) {
    for (const ac of story.acceptance_criteria ?? []) {
      if (ac.testable) out.push(`${story.id}::${ac.id}`);
    }
  }
  return Array.from(new Set(out));
}

function buildBatches(prd: PRD): TaskBatch[] {
  const out: TaskBatch[] = [];
  for (const story of prd.stories ?? []) {
    if (story.priority !== 'P0' && story.priority !== 'P1') continue;
    out.push({
      story_id: story.id,
      title: story.title,
      acceptance_ids: (story.acceptance_criteria ?? []).map(ac => `${story.id}::${ac.id}`),
      allowed_paths: inferAllowedPaths(story),
      constraints: [],
    });
  }
  return out;
}

/**
 * Heuristic mapping from a story to the paths it is allowed to touch.
 * Falls back to "src/**" + "tests/**" when we cannot infer more.
 */
function inferAllowedPaths(story: Story): string[] {
  const text = `${story.title} ${story.description}`.toLowerCase();
  const paths: string[] = ['src/**', 'tests/**'];
  if (/(api|server|backend|endpoint|route)/.test(text)) paths.push('packages/api/**');
  if (/(ui|web|frontend|component|page)/.test(text)) paths.push('packages/web/**');
  if (/(cli|command|script)/.test(text)) paths.push('packages/cli/**');
  if (/(doc|readme|guide)/.test(text)) paths.push('docs/**');
  return Array.from(new Set(paths));
}

/**
 * Generate an ExecutionContract from a PRD or PRDReviewResult.
 * Pure function — does not touch disk.
 */
export function generateExecutionContract(input: PRD | (PRDReviewResult & { prd?: PRD })): ExecutionContract {
  // Tolerate either a real PRD or a PRDReviewResult wrapper.
  const prd = (input as any).prd ?? (input as PRD);
  const intentLock = buildIntentLock(prd);
  const intentHash = crypto.createHash('sha256').update(intentLock, 'utf8').digest('hex');
  return {
    contract_id: `${prd.id}-${intentHash.slice(0, 8)}`,
    intent_hash: intentHash,
    prd_id: prd.id,
    prd_version: prd.version,
    generated_at: new Date().toISOString(),
    intent_lock: intentLock,
    approved_behaviors: deriveBehaviors(prd),
    design_constraints: deriveConstraints(prd),
    task_batches: buildBatches(prd),
    test_obligations: deriveTestObligations(prd),
  };
}

/**
 * Serialize a contract as a Markdown document — the format committed
 * to `.aza/contract.md` so it's both human-readable and easy to drift-check.
 */
export function contractToMarkdown(contract: ExecutionContract): string {
  const lines: string[] = [
    `# Execution Contract — ${contract.prd_id}`,
    ``,
    `> Generated: ${contract.generated_at}`,
    `> PRD version: ${contract.prd_version}`,
    `> Contract id: ${contract.contract_id}`,
    `> Intent hash (sha256): \`${contract.intent_hash}\``,
    ``,
    `## Intent Lock`,
    ``,
    `> ${contract.intent_lock}`,
    ``,
    `This sentence is the single source of truth. If a behavior contradicts it, the behavior is wrong.`,
    ``,
    `## Approved Behaviors`,
    ``,
    ...(contract.approved_behaviors.length === 0
      ? ['_No P0 behaviors recorded._']
      : contract.approved_behaviors.map(b => `- ${b}`)),
    ``,
    `## Design Constraints (硬约束)`,
    ``,
    ...(contract.design_constraints.length === 0
      ? ['_No hard constraints surfaced from the PRD._']
      : contract.design_constraints.map(c => `- ${c}`)),
    ``,
    `## Task Batches`,
    ``,
    ...(contract.task_batches.length === 0
      ? ['_No P0/P1 stories to batch._']
      : contract.task_batches.flatMap(b => [
          `### ${b.story_id} — ${b.title}`,
          ``,
          `Acceptance ids: ${b.acceptance_ids.map(id => `\`${id}\``).join(', ')}`,
          `Allowed paths: ${b.allowed_paths.map(p => `\`${p}\``).join(', ')}`,
          ``,
        ])),
    `## Test Obligations`,
    ``,
    ...(contract.test_obligations.length === 0
      ? ['_No testable acceptance criteria._']
      : contract.test_obligations.map(id => `- \`${id}\``)),
    ``,
    `---`,
    `Drift check: if \`intent_lock\` changes, regenerate this contract from the PRD.`,
  ];
  return lines.join('\n');
}

/**
 * Write the contract to `<azaDir>/contract.md`. Returns the absolute path.
 */
export async function writeContract(contract: ExecutionContract, azaDir: string = '.aza'): Promise<string> {
  const target = path.join(azaDir, 'contract.md');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contractToMarkdown(contract), 'utf8');
  return target;
}

/**
 * Load a contract from disk. Returns null if no contract exists yet.
 */
export async function loadContract(azaDir: string = '.aza'): Promise<ExecutionContract | null> {
  const file = path.join(azaDir, 'contract.md');
  try {
    const content = await fs.readFile(file, 'utf8');
    // Re-derive the contract fields from the markdown by looking up
    // well-known headings. This is intentionally simple — for full
    // round-tripping use the structured `ExecutionContract` from
    // `generateExecutionContract` and write the JSON sibling.
    const idMatch = content.match(/^# Execution Contract — (.+)$/m);
    if (!idMatch) return null;
    const prdId = idMatch[1]!;

    // The intent_lock lives under the `## Intent Lock` section, not as
    // the first `> ...` line in the file (which is the `> Generated:`
    // metadata line). Find the section, then read the blockquote line
    // immediately following it.
    const intentSection = content.split(/^## Intent Lock\s*$/m)[1] ?? '';
    const intentLine = intentSection.match(/^>\s*(.+)$/m);
    if (!intentLine) return null;
    const intent = intentLine[1]!.trim();

    // Pull a few other fields from the same metadata block so callers
    // can verify drift / version without re-running the generator.
    const generatedAt = content.match(/^> Generated:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const prdVersion = content.match(/^> PRD version:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const contractId = content.match(/^> Contract id:\s*(.+)$/m)?.[1]?.trim() ?? prdId;
    const intentHash = content.match(/^> Intent hash \(sha256\):\s*`?([0-9a-fA-F]+)`?/m)?.[1]?.trim() ?? '';

    return {
      contract_id: contractId,
      intent_hash: intentHash,
      prd_id: prdId,
      prd_version: prdVersion,
      generated_at: generatedAt,
      intent_lock: intent,
      approved_behaviors: [],
      design_constraints: [],
      task_batches: [],
      test_obligations: [],
    };
  } catch {
    return null;
  }
}

/**
 * Compute the content-hash of the on-disk contract. Used by LoopController's
 * drift detection in `syncStateFromFile`.
 */
export async function contentHashContract(azaDir: string = '.aza'): Promise<string | null> {
  const file = path.join(azaDir, 'contract.md');
  try {
    const content = await fs.readFile(file, 'utf8');
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  } catch {
    return null;
  }
}
