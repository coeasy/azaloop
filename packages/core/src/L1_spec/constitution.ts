/**
 * Project constitution (P3 / spec-kit /constitution inspired).
 * Persists to `.aza/constitution.md` and is injected on calibrate.
 */

import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_CONSTITUTION = `# AzaLoop Constitution

## Principles
1. All requirements must trace to user value (CONST-001)
2. All acceptance criteria must be testable (CONST-002)
3. MVP first — at most 3 P0 stories (CONST-003)
4. Spec before code — PRD/OpenSpec is executable truth (CONST-004)
5. Never skip verify / quality gates (CONST-005)
6. Follow MCP \`next_action\` automatically — no manual Continue (CONST-006)
7. Prefer host-LLM; keep the 8-tool MCP surface (CONST-007)

## Anti-rationalizations
- "Write code first, tests later" → Code without tests is debt
- "Too small to verify" → Most bugs come from small changes
- "I know this file" → Familiarity breeds bugs
`;

export function constitutionPath(projectRoot: string): string {
  return path.join(projectRoot, '.aza', 'constitution.md');
}

export function ensureConstitution(projectRoot: string, content?: string): string {
  const aza = path.join(projectRoot, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  const p = constitutionPath(projectRoot);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content || DEFAULT_CONSTITUTION, 'utf8');
  }
  return p;
}

export function readConstitution(projectRoot: string): string {
  const p = ensureConstitution(projectRoot);
  return fs.readFileSync(p, 'utf8');
}

export function writeConstitution(projectRoot: string, content: string): string {
  const p = constitutionPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

/** Persist crash-proof plan file (planning-with-files). */
export function writePlanMd(
  projectRoot: string,
  plan: { title: string; stage: string; next: string; bullets?: string[] },
): string {
  const aza = path.join(projectRoot, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  const p = path.join(aza, 'plan.md');
  const md = [
    `# Plan: ${plan.title}`,
    '',
    `> Updated: ${new Date().toISOString()}`,
    `> Stage: ${plan.stage}`,
    `> Next: ${plan.next}`,
    '',
    '## Steps',
    '',
    ...(plan.bullets || [
      'Follow aza_session → aza_prd → aza_loop(full)',
      'Honor awaitingAction + report_tool',
      'Do not skip verify',
    ]).map((b) => `- [ ] ${b}`),
    '',
  ].join('\n');
  fs.writeFileSync(p, md, 'utf8');
  return p;
}

export function readPlanMd(projectRoot: string): string | null {
  const p = path.join(projectRoot, '.aza', 'plan.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}
