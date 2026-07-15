import * as fs from 'fs';
import * as path from 'path';

export interface ContextBundle {
  constitution: string[];
  iron_rules: string[];
  anti_rationalizations: Array<{ excuse: string; rebuttal: string }>;
  role: string;
  session_prompt: string;
  /** Optional pointers — hosts rehydrate from disk, not chat */
  artifacts?: string[];
  ledger_tail?: string[];
  stage_context_tail?: string[];
}

/**
 * Slim session context injector.
 * Prefer .aza artifact paths + short digests over dumping full PRD/constitution.
 */
export class ContextInjector {
  private constitution: string[];
  private ironRules: string[];
  private antiRationalizations: Array<{ excuse: string; rebuttal: string }>;
  private azaDir?: string;

  constructor(azaDir?: string) {
    this.azaDir = azaDir;
    this.constitution = [
      'CONST-001: All requirements must trace to user value',
      'CONST-002: All acceptance criteria must be testable',
      'CONST-003: MVP first, avoid big-design-up-front',
      'CONST-004: Solution complexity must match problem complexity',
      'CONST-005: Architecture must support incremental evolution',
      'CONST-010: Each story must be verified against acceptance criteria',
    ];
    this.ironRules = [
      'Rule 1: No assumptions — verify before acting',
      'Rule 2: Minimize change scope — only modify required files',
      'Rule 3: Precise changes — understand code before editing',
      'Rule 4: Goal-driven — every operation must have a clear objective',
    ];
    this.antiRationalizations = [
      { excuse: 'Write code first, tests later', rebuttal: 'Code without tests is technical debt' },
      { excuse: 'This change is too small to verify', rebuttal: '80% of bugs come from "small" changes' },
      { excuse: 'I know this file well enough', rebuttal: 'Familiarity is a breeding ground for bugs' },
    ];
  }

  /** Bind to a project .aza directory for ledger/JSONL tails. */
  withAzaDir(azaDir: string): ContextInjector {
    this.azaDir = azaDir;
    return this;
  }

  calibrate(stage?: string): ContextBundle {
    const ledgerTail = this.readTail(path.join(this.azaDir || '', 'run-ledger.jsonl'), 3);
    const stageFile = stage
      ? path.join(this.azaDir || '', 'context', `${stage}.jsonl`)
      : '';
    const stageTail = stageFile ? this.readTail(stageFile, 2) : [];

    return {
      constitution: this.constitution.slice(0, 3),
      iron_rules: this.ironRules.slice(0, 2),
      anti_rationalizations: this.antiRationalizations.slice(0, 1),
      role: this.getDefaultRole(),
      session_prompt: this.buildSessionPrompt(),
      artifacts: [
        '.aza/STATE.yaml',
        '.aza/RESUME.md',
        '.aza/task_plan.md',
        '.aza/prd.md',
      ],
      ledger_tail: ledgerTail,
      stage_context_tail: stageTail,
    };
  }

  getDefaultRole(): string {
    return 'AzaLoop engineer: follow MCP next_action; stages open→design→build→verify→archive; never skip verify.';
  }

  buildSessionPrompt(): string {
    return [
      '## Session (slim)',
      '1. aza_session(continue|calibrate) → follow next_action',
      '2. New work: aza_prd(review)→approve → aza_loop(full)',
      '3. awaitingAction → host tool → aza_loop(report_tool)',
      '4. Artifacts: .aza/STATE.yaml RESUME.md task_plan.md — do not paste full PRD into chat',
    ].join('\n');
  }

  private readTail(filePath: string, n: number): string[] {
    if (!filePath || !fs.existsSync(filePath)) return [];
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
      return lines.slice(-n).map((l) => (l.length > 160 ? `${l.slice(0, 160)}…` : l));
    } catch {
      return [];
    }
  }
}
