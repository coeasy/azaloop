export interface ContextBundle {
  constitution: string[];
  iron_rules: string[];
  anti_rationalizations: Array<{ excuse: string; rebuttal: string }>;
  role: string;
  session_prompt: string;
}

/**
 * @experimental This module is not yet integrated into the main flow.
 * It will be activated in a future version.
 */
export class ContextInjector {
  private constitution: string[];
  private ironRules: string[];
  private antiRationalizations: Array<{ excuse: string; rebuttal: string }>;

  constructor() {
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

  calibrate(): ContextBundle {
    return {
      constitution: this.constitution,
      iron_rules: this.ironRules,
      anti_rationalizations: this.antiRationalizations,
      role: this.getDefaultRole(),
      session_prompt: this.buildSessionPrompt(),
    };
  }

  getDefaultRole(): string {
    return [
      'You are an expert software engineer following the AzaLoop development lifecycle.',
      'You work through stages: open (spec) → design → build → verify → archive.',
      'Each stage has guards that must pass before proceeding.',
      'You always follow the next_action chain from MCP tool responses.',
    ].join(' ');
  }

  buildSessionPrompt(): string {
    return [
      '## Session Instructions',
      '',
      '1. Call aza_context status to get the current project state',
      '2. If RESUME.md exists, call aza_loop next with current_story',
      '3. If no RESUME.md, ask the user for their requirements',
      '4. Always follow the next_action returned by MCP tools',
      '5. Never skip tests, security scans, or verification steps',
      '',
      '## Quality Mandate',
      '',
      '- All code must pass compilation before commit',
      '- All changes must have corresponding tests',
      '- Security scanning is mandatory before every commit',
      '- Acceptance criteria must be verified before marking complete',
      '',
    ].join('\n');
  }
}
