/**
 * client-rules-generator.ts
 *
 * Generates V12.2 rules files for all 25 supported AzaLoop clients from
 * the shared templates in `templates/_shared/`. This avoids manually
 * maintaining 25 near-identical rules files and keeps them in sync.
 *
 * Reference architecture: comet (30 platform uniform rules) +
 * spec-superflow (single-source execution contract).
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ── Client rules configuration ──

export type ClientTier = 'T1' | 'T2' | 'T3';

export interface ClientRulesConfig {
  /** Internal canonical name (lowercase, hyphenated). */
  name: string;
  /** Human-friendly description. */
  description: string;
  /** Tier classification — drives feature gating in rules. */
  tier: ClientTier;
  /** Path (relative to project root) where the rules file should be written. */
  rulesPath: string;
  /** Whether to inline the shared phase-guard fragment after the V12.2 rules. */
  includePhaseGuard: boolean;
  /** Whether the client requires a CLI wrapper (aider / hermes). */
  needsCliWrapper: boolean;
  /** Display name used in `{{CLIENT_NAME}}` substitution. */
  displayName: string;
}

/**
 * Master table of all 25 supported clients and where their rules land.
 * This is the single source of truth — never hardcode paths elsewhere.
 */
export const CLIENT_RULES_CONFIG: ClientRulesConfig[] = [
  // ── T1: Full support (already done in Phase 1) ──
  { name: 'cursor',         description: 'Cursor AI Editor',                tier: 'T1', rulesPath: 'cursor/.cursor/rules.md',  includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Cursor' },
  { name: 'claude-code',    description: 'Claude Code (CLI)',              tier: 'T1', rulesPath: 'claude-code/CLAUDE.md',     includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Claude Code' },
  { name: 'opencode',       description: 'OpenCode (CLI)',                 tier: 'T1', rulesPath: 'opencode/.opencode/AGENTS.md', includePhaseGuard: true,  needsCliWrapper: false, displayName: 'OpenCode' },
  { name: 'trae',           description: 'Trae (字节跳动)',                 tier: 'T1', rulesPath: 'trae/rules.md',             includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Trae' },

  // ── T2: Partial support (will be promoted to full) ──
  { name: 'vscode',         description: 'VS Code + Copilot Chat',         tier: 'T2', rulesPath: 'vscode/azaloop.md',           includePhaseGuard: true,  needsCliWrapper: false, displayName: 'VS Code' },
  { name: 'cline',          description: 'Cline (VS Code ext)',            tier: 'T2', rulesPath: 'cline/.clinerules',           includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Cline' },
  { name: 'roo-code',       description: 'Roo Code (VS Code ext)',         tier: 'T2', rulesPath: 'roo-code/.roo/azaloop.md',    includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Roo Code' },
  { name: 'continue',       description: 'Continue.dev',                   tier: 'T2', rulesPath: 'continue/.continuerules',     includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Continue' },
  { name: 'gemini-cli',     description: 'Gemini CLI (Google)',            tier: 'T2', rulesPath: 'gemini-cli/.gemini/rules.md', includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Gemini CLI' },
  { name: 'codex-cli',      description: 'Codex CLI (OpenAI)',             tier: 'T2', rulesPath: 'codex-cli/AGENTS.md',         includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Codex CLI' },
  { name: 'comate',         description: 'Comate (百度)',                   tier: 'T2', rulesPath: 'comate/instructions/azaloop.md', includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Comate' },
  { name: 'workbuddy',      description: 'Workbuddy (字节)',                tier: 'T2', rulesPath: 'workbuddy/.workbuddy/rules.md', includePhaseGuard: true, needsCliWrapper: false, displayName: 'Workbuddy' },
  { name: 'qwen-code',      description: 'Qwen Code (阿里)',                tier: 'T2', rulesPath: 'qwen-code/QWEN.md',           includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Qwen Code' },
  { name: 'github-copilot', description: 'GitHub Copilot Chat',            tier: 'T2', rulesPath: 'github-copilot/.github/copilot-instructions.md', includePhaseGuard: true,  needsCliWrapper: false, displayName: 'GitHub Copilot' },
  { name: 'claude-desktop', description: 'Claude Desktop App',             tier: 'T2', rulesPath: 'claude-desktop/CLAUDE.md',    includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Claude Desktop' },
  { name: 'openhands',      description: 'OpenHands',                      tier: 'T2', rulesPath: 'openhands/openhands_instructions.md', includePhaseGuard: true,  needsCliWrapper: false, displayName: 'OpenHands' },

  // ── T3: Basic (will be promoted to full) ──
  { name: 'aider',          description: 'Aider (CLI)',                    tier: 'T3', rulesPath: 'aider/CONVENTIONS.md',        includePhaseGuard: true,  needsCliWrapper: true,  displayName: 'Aider' },
  { name: 'zed',            description: 'Zed Editor',                     tier: 'T3', rulesPath: 'zed/.zed/rules.md',           includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Zed' },
  { name: 'goose',          description: 'Goose',                          tier: 'T3', rulesPath: 'goose/azaloop.md',            includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Goose' },
  { name: 'hermes',         description: 'Hermes',                         tier: 'T3', rulesPath: 'hermes/.hermes/skills/aza-loop.md', includePhaseGuard: true,  needsCliWrapper: true,  displayName: 'Hermes' },
  { name: 'openclaw',       description: 'OpenClaw',                       tier: 'T3', rulesPath: 'openclaw/.openclaw/rules.md', includePhaseGuard: true,  needsCliWrapper: false, displayName: 'OpenClaw' },
  { name: 'kiro',           description: 'Kiro',                           tier: 'T3', rulesPath: 'kiro/.kiro/rules.md',          includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Kiro' },
  { name: 'codeium',        description: 'Codeium',                        tier: 'T3', rulesPath: 'codeium/.codeium/rules.md',   includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Codeium' },
  { name: 'droid',          description: 'Droid',                          tier: 'T3', rulesPath: 'droid/AGENTS.md',             includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Droid' },
  { name: 'windsurf',       description: 'Windsurf Editor',                tier: 'T3', rulesPath: 'windsurf/rules/azaloop.md',  includePhaseGuard: true,  needsCliWrapper: false, displayName: 'Windsurf' },
];

const REQUIRED_KEYWORDS = ['PRD 先行', '自动循环', 'aza_session', 'aza_loop'] as const;

// ── Result types ──

export interface GenerateResult {
  client: string;
  path: string;
  bytes: number;
  validated: boolean;
  missingKeywords: string[];
}

export interface GenerateAllResult {
  generated: GenerateResult[];
  failed: Array<{ client: string; error: string }>;
}

// ── Core API ──

interface TemplateContext {
  CLIENT_NAME: string;
  RULES_PATH: string;
  CLIENT_TIER: ClientTier;
}

function findSharedDir(): string {
  // Try several candidate locations:
  //   1. <cliRoot>/../../templates/_shared           (compiled dist layout)
  //   2. <cliRoot>/../../../templates/_shared        (source src layout: packages/cli/src/generators)
  //   3. <cwd>/templates/_shared                     (running from repo root)
  //   4. AZALOOP_SHARED_DIR env override
  const candidates: string[] = [];
  if (process.env.AZALOOP_SHARED_DIR) candidates.push(process.env.AZALOOP_SHARED_DIR);
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'templates', '_shared'));
  candidates.push(path.resolve(__dirname, '..', '..', '..', '..', '..', 'templates', '_shared'));
  candidates.push(path.resolve(process.cwd(), 'templates', '_shared'));

  for (const dir of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs').accessSync(path.join(dir, 'v12.2-rules.md'));
      return dir;
    } catch {
      // try next
    }
  }
  // Fall back to the first candidate so the caller sees a clear ENOENT.
  return candidates[0]!;
}

function renderTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{\{CLIENT_NAME\}\}/g, ctx.CLIENT_NAME)
    .replace(/\{\{RULES_PATH\}\}/g, ctx.RULES_PATH)
    .replace(/\{\{CLIENT_TIER\}\}/g, ctx.CLIENT_TIER);
}

function validateGenerated(content: string): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const keyword of REQUIRED_KEYWORDS) {
    if (!content.includes(keyword)) missing.push(keyword);
  }
  return { valid: missing.length === 0, missing };
}

function findConfig(clientName: string): ClientRulesConfig | undefined {
  const normalized = clientName.toLowerCase().trim();
  return CLIENT_RULES_CONFIG.find(c => c.name === normalized);
}

/**
 * Generate the rules file for a single client and write it to disk.
 *
 * @param clientName - Canonical client name (e.g. "cline", "trae").
 * @param outputDir  - Root directory under which the configured `rulesPath` is created.
 * @param options.skipValidation - Skip keyword validation (for tests / regeneration).
 * @returns Metadata about the generated file.
 */
export async function generateClientRules(
  clientName: string,
  outputDir: string,
  options: { skipValidation?: boolean; sharedDir?: string } = {},
): Promise<GenerateResult> {
  const cfg = findConfig(clientName);
  if (!cfg) {
    throw new Error(
      `Unknown client "${clientName}". Supported: ${CLIENT_RULES_CONFIG.map(c => c.name).join(', ')}`,
    );
  }

  const sharedDir = options.sharedDir ?? findSharedDir();
  // Prefer V17 8-tool protocol; fall back to v16 shared auto-loop body
  const v17Path = path.join(sharedDir, 'v17-rules.md');
  const v16Path = path.join(sharedDir, '..', 'clients', '_shared', 'v16-auto-loop.md');
  const phaseGuardPath = path.join(sharedDir, 'phase-guard.md');

  let template: string;
  try {
    template = await fs.readFile(v17Path, 'utf8');
  } catch {
    template = await fs.readFile(v16Path, 'utf8');
  }
  const phaseGuard = cfg.includePhaseGuard ? await fs.readFile(phaseGuardPath, 'utf8') : '';

  const ctx: TemplateContext = {
    CLIENT_NAME: cfg.displayName,
    RULES_PATH: cfg.rulesPath,
    CLIENT_TIER: cfg.tier,
  };

  const rendered = renderTemplate(template, ctx);
  const finalContent = cfg.includePhaseGuard
    ? `${rendered}\n\n${renderTemplate(phaseGuard, ctx)}\n`
    : `${rendered}\n`;

  const target = path.join(outputDir, cfg.rulesPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, finalContent, 'utf8');

  const validation = options.skipValidation
    ? { valid: true, missing: [] as string[] }
    : validateGenerated(finalContent);

  return {
    client: cfg.name,
    path: path.relative(outputDir, target),
    bytes: Buffer.byteLength(finalContent, 'utf8'),
    validated: validation.valid,
    missingKeywords: validation.missing,
  };
}

/**
 * Generate rules files for all 25 clients.
 */
export async function generateAllClients(
  outputDir: string,
  options: { skipValidation?: boolean; sharedDir?: string; onlyTiers?: ClientTier[] } = {},
): Promise<GenerateAllResult> {
  const generated: GenerateResult[] = [];
  const failed: GenerateAllResult['failed'] = [];
  const targets = options.onlyTiers
    ? CLIENT_RULES_CONFIG.filter(c => options.onlyTiers!.includes(c.tier))
    : CLIENT_RULES_CONFIG;

  for (const cfg of targets) {
    try {
      const result = await generateClientRules(cfg.name, outputDir, options);
      generated.push(result);
    } catch (err) {
      failed.push({
        client: cfg.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { generated, failed };
}

/**
 * CLI wrapper — for direct invocation: `node client-rules-generator.js <client> <outputDir>`.
 */
export async function runCli(argv: string[]): Promise<number> {
  const [, , clientArg, outputDirArg] = argv;
  if (!clientArg || !outputDirArg) {
    console.error('Usage: client-rules-generator <client|all> <outputDir> [--skip-validation] [--tier T2]');
    return 1;
  }

  const skipValidation = argv.includes('--skip-validation');
  const tierIdx = argv.indexOf('--tier');
  const onlyTiers = tierIdx > 0 ? [argv[tierIdx + 1] as ClientTier] : undefined;

  if (clientArg === 'all') {
    const result = await generateAllClients(outputDirArg, { skipValidation, onlyTiers });
    console.log(`\n[client-rules-generator] generated ${result.generated.length} rules file(s)`);
    for (const g of result.generated) {
      const status = g.validated ? '✓' : '✗';
      const missing = g.missingKeywords.length ? ` (missing: ${g.missingKeywords.join(', ')})` : '';
      console.log(`  ${status} ${g.client.padEnd(20)} → ${g.path} (${g.bytes} bytes)${missing}`);
    }
    if (result.failed.length) {
      console.error(`\n[client-rules-generator] ${result.failed.length} failure(s):`);
      for (const f of result.failed) {
        console.error(`  ✗ ${f.client}: ${f.error}`);
      }
      return 1;
    }
    return 0;
  }

  try {
    const result = await generateClientRules(clientArg, outputDirArg, { skipValidation });
    console.log(`[client-rules-generator] ${result.client} → ${result.path} (${result.bytes} bytes)`);
    if (!result.validated) {
      console.error(`  ✗ missing keywords: ${result.missingKeywords.join(', ')}`);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`[client-rules-generator] error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// Run when invoked directly as the generator binary.
// NOTE: inside a Node SEA bundle, `require.main === module` is ALWAYS true
// (the whole bundle is one module), so we additionally require argv[1] to
// actually name this generator — otherwise importing it from the CLI (which
// happens transitively via setupCommand) would hijack argv and crash every
// `aza <subcommand>` invocation.
const _genArgv1 = process.argv[1] || '';
const isGeneratorEntry =
  _genArgv1.includes('client-rules-generator') ||
  _genArgv1.endsWith('client-rules-generator.js') ||
  _genArgv1.endsWith('client-rules-generator.cjs');
if (require.main === module && isGeneratorEntry) {
  runCli(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
