/**
 * Auto-select best execution plan (L3 unattended).
 * Runs explore → pick highest score → persist → never ask the user.
 */
import * as fs from 'fs';
import * as path from 'path';
import { exploreWorkspace, type ExploreOption, type ExploreResult } from './tools/aza-explore';
import { createTaskIdentity } from './workflows/auto/task-identity';

export interface ChosenPlan {
  task_fingerprint: string;
  selected: ExploreOption;
  explore: ExploreResult;
  ranked_options: RankedPlanOption[];
  decision_factors: PlanDecisionFactor[];
  confidence: number;
  rationale: string;
  chosen_at: string;
  user_input: string;
}

export interface PlanDecisionFactor {
  signal: 'localized_change' | 'cross_cutting_change' | 'explicit_rewrite' | 'rewrite_safety';
  option: string;
  delta: number;
  evidence: string;
}

export interface RankedPlanOption extends ExploreOption {
  base_score: number;
  factors: PlanDecisionFactor[];
  eligible: boolean;
}

export function isAutoPickEnabled(workspace?: string): boolean {
  if (process.env.AZA_AUTO_PICK === '0' || process.env.AZA_AUTO_PICK === 'false') {
    return false;
  }
  if (process.env.AZA_AUTO_PICK === '1') return true;
  // Default on when L3 / hard-continue / auto-approve
  if (process.env.AZA_AUTO_APPROVE_PRD === 'true') return true;
  if (process.env.AZA_HARD_CONTINUE === '1') return true;
  try {
    const root = workspace || process.cwd();
    const yaml = path.join(root, 'azaloop.yaml');
    if (fs.existsSync(yaml)) {
      const txt = fs.readFileSync(yaml, 'utf8');
      if (/level:\s*L3/i.test(txt) || /auto_approve_prd:\s*true/i.test(txt)) return true;
    }
  } catch {
    /* ignore */
  }
  return true; // product default: always pick for aza_auto
}

function optionKind(name: string): 'incremental' | 'refactor' | 'rewrite' | 'unknown' {
  const normalized = name.toLowerCase();
  if (/incremental|minimal|improvement|enhancement/.test(normalized)) return 'incremental';
  if (/architecture|refactor|restructure/.test(normalized)) return 'refactor';
  if (/rewrite|greenfield|replace/.test(normalized)) return 'rewrite';
  return 'unknown';
}

function requirementSignals(userInput: string): {
  localized: boolean;
  crossCutting: boolean;
  explicitRewrite: boolean;
} {
  const input = userInput.trim().toLowerCase();
  return {
    localized:
      /修复|bug|fix|局部|单个|小改|补充.{0,12}测试|回归测试|typo|文案|配置错误|localized|targeted/.test(
        input,
      ),
    crossCutting:
      /全面|系统性|架构|重构|可靠性|可维护|技术债|模块化|全链路|性能|安全|architecture|refactor|reliability|maintainability|cross[- ]cutting|system[- ]wide/.test(
        input,
      ),
    explicitRewrite:
      /从零.{0,8}(重写|重建|实现)|彻底重写|废弃现有|替换整个|重新实现整个|full rewrite|rewrite.{0,20}(entire|whole)|from scratch|replace.{0,20}(existing|entire|whole)/.test(
        input,
      ),
  };
}

function factor(
  signal: PlanDecisionFactor['signal'],
  option: string,
  delta: number,
  evidence: string,
): PlanDecisionFactor {
  return { signal, option, delta, evidence };
}

export function rankOptions(explore: ExploreResult, userInput: string): RankedPlanOption[] {
  const signals = requirementSignals(userInput);
  return explore.options
    .map((option) => {
      const kind = optionKind(option.name);
      const factors: PlanDecisionFactor[] = [];
      const eligible = kind !== 'rewrite' || signals.explicitRewrite;

      if (signals.localized) {
        const delta = kind === 'incremental' ? 30 : kind === 'refactor' ? -15 : kind === 'rewrite' ? -40 : 0;
        if (delta !== 0) {
          factors.push(factor('localized_change', option.name, delta, 'Requirement describes a bounded fix or regression.'));
        }
      }
      if (signals.crossCutting) {
        const delta = kind === 'refactor' ? 25 : kind === 'incremental' ? -10 : kind === 'rewrite' ? -15 : 0;
        if (delta !== 0) {
          factors.push(factor('cross_cutting_change', option.name, delta, 'Requirement spans architecture or system-wide quality.'));
        }
      }
      if (signals.explicitRewrite) {
        const delta = kind === 'rewrite' ? 50 : kind === 'incremental' ? -35 : kind === 'refactor' ? -20 : 0;
        if (delta !== 0) {
          factors.push(factor('explicit_rewrite', option.name, delta, 'Requirement explicitly requests replacing the existing implementation.'));
        }
      } else if (kind === 'rewrite') {
        factors.push(
          factor(
            'rewrite_safety',
            option.name,
            -100,
            'Greenfield replacement is unsafe without explicit rewrite intent.',
          ),
        );
      }

      const adjusted = option.score + factors.reduce((sum, item) => sum + item.delta, 0);
      return {
        ...option,
        base_score: option.score,
        score: Math.max(0, Math.min(100, adjusted)),
        factors,
        eligible,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.score - a.score ||
        b.base_score - a.base_score ||
        a.name.localeCompare(b.name),
    );
}

export function pickBestOption(explore: ExploreResult, userInput: string): ExploreOption {
  const ranked = rankOptions(explore, userInput);
  if (process.env.AZA_DEBUG_PICK === '1') {
    console.log(
      '[pickBestOption]',
      ranked.map((o) => `${o.name}=${o.score}`).join(', '),
    );
  }
  return ranked[0] || {
    name: 'Incremental Enhancement',
    description: 'Proceed with minimal safe changes aligned to user input.',
    pros: ['Low risk'],
    cons: ['May need follow-ups'],
    score: 70,
  };
}

export function persistChosenPlan(workspace: string, plan: ChosenPlan): string {
  const aza = path.join(workspace, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  const jsonPath = path.join(aza, 'chosen-plan.json');
  const mdPath = path.join(aza, 'chosen-plan.md');
  const md = [
    '# Auto-selected execution plan',
    '',
    `> chosen_at: ${plan.chosen_at}`,
    `> task_fingerprint: ${plan.task_fingerprint}`,
    `> user_input: ${plan.user_input.slice(0, 200)}`,
    '',
    `## Selected: ${plan.selected.name} (score ${plan.selected.score}/100)`,
    '',
    plan.selected.description,
    '',
    '### Pros',
    ...plan.selected.pros.map((p) => `- ${p}`),
    '',
    '### Cons',
    ...plan.selected.cons.map((c) => `- ${c}`),
    '',
    `## Rationale`,
    '',
    plan.rationale,
    '',
    `**Decision confidence:** ${Math.round(plan.confidence * 100)}%`,
    '',
    '### Decision factors',
    ...plan.decision_factors.map(
      (item) => `- ${item.option}: ${item.delta >= 0 ? '+' : ''}${item.delta} — ${item.evidence}`,
    ),
    '',
    '## Alternatives considered',
    '',
    ...plan.ranked_options.map(
      (o) =>
        `- **${o.name}** (${o.score}/100, base ${o.base_score}${o.eligible ? '' : ', ineligible'}): ${o.description}`,
    ),
    '',
    '_Auto-picked under L3 — do not ask the user to choose._',
    '',
  ].join('\n');
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const jsonTemp = `${jsonPath}.${suffix}.tmp`;
  const mdTemp = `${mdPath}.${suffix}.tmp`;
  try {
    fs.writeFileSync(jsonTemp, JSON.stringify(plan, null, 2), 'utf8');
    fs.writeFileSync(mdTemp, md, 'utf8');
    fs.renameSync(mdTemp, mdPath);
    // JSON is the machine-readable commit point; publish it after the Markdown projection.
    fs.renameSync(jsonTemp, jsonPath);
  } catch (error) {
    for (const temp of [jsonTemp, mdTemp]) {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // Preserve the original persistence error.
      }
    }
    throw error;
  }
  return mdPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isExploreOption(value: unknown): value is ExploreOption {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    isStringArray(value.pros) &&
    isStringArray(value.cons) &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    value.score >= 0 &&
    value.score <= 100
  );
}

function isDecisionFactor(value: unknown): value is PlanDecisionFactor {
  if (!isRecord(value)) return false;
  return (
    ['localized_change', 'cross_cutting_change', 'explicit_rewrite', 'rewrite_safety'].includes(
      String(value.signal),
    ) &&
    typeof value.option === 'string' &&
    typeof value.delta === 'number' &&
    Number.isFinite(value.delta) &&
    typeof value.evidence === 'string'
  );
}

function isRankedPlanOption(value: unknown): value is RankedPlanOption {
  return (
    isExploreOption(value) &&
    isRecord(value) &&
    typeof value.base_score === 'number' &&
    Number.isFinite(value.base_score) &&
    value.base_score >= 0 &&
    value.base_score <= 100 &&
    Array.isArray(value.factors) &&
    value.factors.every(isDecisionFactor) &&
    typeof value.eligible === 'boolean'
  );
}

function isExploreResult(value: unknown): value is ExploreResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.target === 'string' &&
    typeof value.current_state === 'string' &&
    isStringArray(value.files_analyzed) &&
    Array.isArray(value.options) &&
    value.options.every(isExploreOption) &&
    typeof value.recommendation === 'string' &&
    isStringArray(value.risks) &&
    ['low', 'medium', 'high'].includes(String(value.effort))
  );
}

function isChosenPlan(value: unknown): value is ChosenPlan {
  if (!isRecord(value)) return false;
  return (
    typeof value.task_fingerprint === 'string' &&
    /^[a-f0-9]{32}$/.test(value.task_fingerprint) &&
    isExploreOption(value.selected) &&
    isExploreResult(value.explore) &&
    Array.isArray(value.ranked_options) &&
    value.ranked_options.every(isRankedPlanOption) &&
    Array.isArray(value.decision_factors) &&
    value.decision_factors.every(isDecisionFactor) &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 100 &&
    typeof value.rationale === 'string' &&
    typeof value.chosen_at === 'string' &&
    typeof value.user_input === 'string'
  );
}

export function deleteChosenPlan(workspace: string): void {
  const aza = path.join(workspace, '.aza');
  fs.rmSync(path.join(aza, 'chosen-plan.json'), { force: true });
  fs.rmSync(path.join(aza, 'chosen-plan.md'), { force: true });
}

export function loadChosenPlan(
  workspace: string,
  expectedFingerprint: string,
): ChosenPlan | null {
  const p = path.join(workspace, '.aza', 'chosen-plan.json');
  if (!fs.existsSync(p)) return null;
  try {
    const candidate: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!isChosenPlan(candidate) || candidate.task_fingerprint !== expectedFingerprint) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Explore + pick + persist. Returns enriched PRD description for draft.
 */
export function autoSelectBestPlan(workspace: string, userInput: string): {
  plan: ChosenPlan;
  enriched_description: string;
  plan_path: string;
} {
  const normalizedInput = userInput.trim();
  if (!normalizedInput) {
    throw new Error('User requirement must not be empty');
  }
  const taskIdentity = createTaskIdentity(normalizedInput);
  const explore = exploreWorkspace(workspace, normalizedInput.slice(0, 200));
  const rankedOptions = rankOptions(explore, normalizedInput);
  const selected = rankedOptions[0] || pickBestOption(explore, normalizedInput);
  const runnerUpScore = rankedOptions[1]?.score ?? selected.score;
  const confidence = Math.max(0, Math.min(1, (selected.score - runnerUpScore) / 100));
  const decisionFactors = rankedOptions.flatMap((option) => option.factors);
  const rationale =
    `L3 全自动：在 ${explore.options.length} 个方案中按需求意图与仓库证据选定「${selected.name}」，` +
    `不向用户征询确认；评分依据为需求意图与仓库证据，无人值守本身不改变技术路线。Explore state: ${explore.current_state}`;
  const plan: ChosenPlan = {
    task_fingerprint: taskIdentity.fingerprint,
    selected,
    explore,
    ranked_options: rankedOptions,
    decision_factors: decisionFactors,
    confidence,
    rationale,
    chosen_at: new Date().toISOString(),
    user_input: normalizedInput,
  };
  const plan_path = persistChosenPlan(workspace, plan);
  const enriched_description = [
    normalizedInput,
    '',
    '## Auto-selected plan (do not ask user)',
    '',
    `**Chosen:** ${selected.name} (score ${selected.score}/100)`,
    selected.description,
    '',
    `**Rationale:** ${rationale}`,
    '',
    '**Constraints:** L3 hard-continue to ship; forbid mid-loop user confirmation.',
  ].join('\n');
  return { plan, enriched_description, plan_path };
}
