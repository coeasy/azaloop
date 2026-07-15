/**
 * GitHub competitive research for PRD enrichment (0.4.0).
 *
 * Best-effort, unauthenticated search via GitHub API. Offline or
 * rate-limited environments fall back to curated template competitors
 * covering the AzaLoop reference landscape.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

/**
 * Default differentiators surfaced in every PRD's competitive section.
 * Exported so callers (and researchCompetitors) share one canonical list.
 */
export const DEFAULT_DIFFERENTIATORS: string[] = [
  '8 unified MCP tools',
  'Host LLM preferred',
  'Completion / circuit gates',
  'OpenSpec + planning-with-files hybrid',
  'Cross-session full-auto next_action chain',
];

/**
 * Default + visible competitive research control.
 *  - 'always' : force live GitHub search every run (no cache shortcut).
 *  - 'auto'   : DEFAULT. Always research; L1 tasks use the curated pool
 *               (offline, zero network) while L2–L4 run the live GitHub
 *               search (cached). This keeps competitor data in EVERY PRD
 *               by default while still saving tokens on trivial tasks.
 *  - 'off'    : skip entirely (legacy behavior).
 */
export type CompetitorResearchMode = 'always' | 'auto' | 'off';

function resolveCompetitorMode(): CompetitorResearchMode {
  const v = (process.env.AZA_COMPETITOR_RESEARCH || 'auto').toLowerCase().trim();
  return (['always', 'auto', 'off'].includes(v) ? v : 'auto') as CompetitorResearchMode;
}

const COMPETITIVE_CACHE_FILE = '.competitive-cache.json';
const COMPETITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CompetitiveCacheEntry {
  key: string;
  result: CompetitiveResearchResult;
  cachedAt: string;
}

function competitiveCacheKey(title: string, description: string): string {
  return `${title} ${description}`.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 160);
}

function loadCompetitiveCache(azaDir: string): Record<string, CompetitiveCacheEntry> {
  try {
    const p = path.join(azaDir, COMPETITIVE_CACHE_FILE);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    /* corrupt cache — ignore */
  }
  return {};
}

function saveCompetitiveCache(azaDir: string, cache: Record<string, CompetitiveCacheEntry>): void {
  try {
    if (!fs.existsSync(azaDir)) fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(path.join(azaDir, COMPETITIVE_CACHE_FILE), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    /* best-effort */
  }
}

// Lightweight stopword list to extract domain keywords from a PRD brief.
const COMPETITIVE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'our',
  'agent', 'loop', 'prd', 'mcp', 'tool', 'tools', 'build', 'code', 'coding',
  'system', 'app', 'application', 'product', 'project', 'feature', 'features',
  'user', 'users', 'data', 'api', 'use', 'using', 'based', 'support', 'please',
  '需求', '生成', '工具', '系统', '用户', '项目', '功能', '支持', '我们', '一个', '实现',
]);

/**
 * Build a focused GitHub search query from the actual brief instead of a
 * fixed keyword bag — yields far more relevant competitors.
 */
function buildSearchKeywords(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  const tokens = text
    .split(/[^a-z0-9一-龥]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !COMPETITIVE_STOPWORDS.has(t));
  const picked = tokens.slice(0, 6).join(' ').trim() || 'agent prd mcp openspec loop';
  return encodeURIComponent(picked.slice(0, 80));
}

export interface CompetitorHit {
  full_name: string;
  html_url: string;
  description?: string;
  stars: number;
  language?: string;
  /** R5: 标识来源（api=GitHub live, curated=离线） */
  source?: 'api' | 'curated';
}

export interface CompetitiveResearchResult {
  query: string;
  searched_at: string;
  source: 'github_api' | 'fallback';
  competitors: CompetitorHit[];
  differentiators: string[];
  prd_supplements: {
    goals: string[];
    risks: Array<{ description: string; probability: string; mitigation: string }>;
    overview_appendix: string;
  };
}

function httpGetJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'azaloop-competitive-research/0.4',
      Accept: 'application/vnd.github+json',
    };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = https.get(
      url,
      {
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/** Curated landscape from AzaLoop competitive alignment (always available offline). */
function curatedPool(): CompetitorHit[] {
  return [
    {
      full_name: 'Fission-AI/OpenSpec',
      html_url: 'https://github.com/Fission-AI/OpenSpec',
      description: 'Spec-driven changes: propose → apply → archive',
      stars: 0,
      language: 'TypeScript',
      source: 'curated' as const,
    },
    {
      full_name: 'github/spec-kit',
      html_url: 'https://github.com/github/spec-kit',
      description: 'GitHub Spec Kit — structured specification workflows for agents',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'OthmanAdi/planning-with-files',
      html_url: 'https://github.com/OthmanAdi/planning-with-files',
      description: 'Persistent file-based planning + completion gate across context loss',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'obra/superpowers',
      html_url: 'https://github.com/obra/superpowers',
      description: 'Mandatory skills: brainstorm, TDD, verify-before-completion',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'jnMetaCode/superpowers-zh',
      html_url: 'https://github.com/jnMetaCode/superpowers-zh',
      description: 'Chinese localization of Superpowers agent skills',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'michaelshimeles/ralphy',
      html_url: 'https://github.com/michaelshimeles/ralphy',
      description: 'PRD task loop with retries, worktrees, rules/boundaries',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'wenqingyu/ralphy-openspec',
      html_url: 'https://github.com/wenqingyu/ralphy-openspec',
      description: 'Ralph loop × OpenSpec lifecycle integration',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'mindfold-ai/Trellis',
      html_url: 'https://github.com/mindfold-ai/Trellis',
      description: 'Persistent specs, journals, multi-platform agent layer',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'cobusgreyling/loop-engineering',
      html_url: 'https://github.com/cobusgreyling/loop-engineering',
      description: 'Loop engineering patterns: audit, cost, agent orchestration',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'rpamis/comet',
      html_url: 'https://github.com/rpamis/comet',
      description: 'Machine run-state and agent loop continuity',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'garrytan/gstack',
      html_url: 'https://github.com/garrytan/gstack',
      description: 'Agent stack with review gates and tool discipline',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'ruvnet/ruflo',
      html_url: 'https://github.com/ruvnet/ruflo',
      description: 'Multi-agent swarm / worker orchestration patterns',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'addyosmani/agent-skills',
      html_url: 'https://github.com/addyosmani/agent-skills',
      description: 'Spec-driven / TDD / review skills with verification gates',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'Fokkyp/claude-skills',
      html_url: 'https://github.com/Fokkyp/claude-skills',
      description: 'Claude skill packs for coding agents',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'twj515895394/andrej-karpathy-skills-12',
      html_url: 'https://github.com/twj515895394/andrej-karpathy-skills-12',
      description: 'Karpathy-style iron rules for agent coding discipline',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'jnMetaCode/agency-orchestrator',
      html_url: 'https://github.com/jnMetaCode/agency-orchestrator',
      description: 'Agency orchestration queues for multi-agent coding',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'jnMetaCode/ai-coding-guide',
      html_url: 'https://github.com/jnMetaCode/ai-coding-guide',
      description: 'Practical AI coding guide and workflow conventions',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'jnMetaCode/shellward',
      html_url: 'https://github.com/jnMetaCode/shellward',
      description: 'Shell/tool-level PII and injection safety scanning',
      stars: 0,
      language: 'TypeScript',
    },
    {
      full_name: 'pmYangKun/create-prd-skill',
      html_url: 'https://github.com/pmYangKun/create-prd-skill',
      description: '14-chapter B-end PRD generation with product typing',
      stars: 0,
      language: 'Markdown',
    },
    {
      full_name: 'pmYangKun/check-prd-skill',
      html_url: 'https://github.com/pmYangKun/check-prd-skill',
      description: '14-dimension PRD quality review with P0-P3 grading',
      stars: 0,
      language: 'Markdown',
    },
  ];
}

function fallbackCompetitors(query: string): CompetitorHit[] {
  const q = query.toLowerCase();
  const pool = curatedPool();
  if (/prd|product|需求|spec/.test(q)) {
    return pool
      .filter((p) =>
        /prd|OpenSpec|spec-kit|superpowers|agent-skills|planning-with-files|ralphy/i.test(
          p.full_name + p.description,
        ),
      )
      .slice(0, 6);
  }
  if (/loop|agent|mcp|coding|orchestr/.test(q)) {
    return pool
      .filter((p) =>
        /loop|ralphy|comet|Trellis|ruflo|gstack|agency|planning/i.test(p.full_name + p.description),
      )
      .slice(0, 6);
  }
  return pool.slice(0, 6);
}

function buildSupplements(competitors: CompetitorHit[]): CompetitiveResearchResult['prd_supplements'] {
  const names = competitors.map((c) => c.full_name).join(', ');
  return {
    goals: [
      `Absorb competitive gaps vs ${competitors.slice(0, 3).map((c) => c.full_name).join(', ')} without expanding MCP tool count`,
      'Ship evidence-based PRD→build loop that survives cross-client session resumes',
      'Keep planning-with-files + OpenSpec hybrid artifacts under the project .aza/ and openspec/ folders',
    ],
    risks: [
      {
        description: `Feature parity pressure from ${names || 'known open-source agent harnesses'}`,
        probability: 'medium',
        mitigation: 'Scoped absorption matrix; YAGNI; keep 8-tool surface',
      },
      {
        description: 'Cross-session STATE/RESUME drift causes false resume stage',
        probability: 'high',
        mitigation: 'STATE.yaml single source of truth; mtime cache invalidation; CompletionGate',
      },
    ],
    overview_appendix: [
      '',
      '## Competitive Landscape (auto-researched)',
      '',
      ...competitors.map(
        (c) =>
          // R5: stars 真实化——curated 池标记 unrated，API 数据展示真实数
          `- [${c.full_name}](${c.html_url}) — ${c.description || 'n/a'}${
            c.source === 'api' && c.stars ? ` (★${c.stars})` : ' (unrated — curated)'
          }`,
      ),
      '',
      '### Differentiation',
      '',
      '- Host-LLM-first MCP loop with durable .aza planning files',
      '- Strict PRD gate before build (GitHub competitor enrichment)',
      '- Cross-session resume via STATE/RESUME + next_action chain',
      '- Sequential multi-story outer board without expanding tool count',
      '',
    ].join('\n'),
  };
}

export interface RunCompetitiveResearchResult {
  /** Competitive research (null only when mode === 'off'). */
  research: CompetitiveResearchResult | null;
  /** True when served from the on-disk cache (no network request). */
  fromCache: boolean;
  /** Effective mode after resolving AZA_COMPETITOR_RESEARCH. */
  mode: CompetitorResearchMode;
  /** True when research was skipped because mode === 'off'. */
  skipped: boolean;
}

/**
 * Single chokepoint for PRD competitive research.
 *
 * Every PRD-creation path (aza_prd review / generate) MUST call this so the
 * GitHub competitor search is default, visible, and impossible to bypass by
 * choosing a different action. Adds:
 *   - mode resolution (AZA_COMPETITOR_RESEARCH, default 'auto')
 *   - 24h on-disk cache keyed by normalized query (saves token/requests)
 *   - L1 → curated pool (offline), L2–L4 → live GitHub search
 *   - always writes `.aza/competitive-research.md`
 *
 * Never throws: if live search fails it falls back to the curated pool, so
 * a PRD always carries SOME competitive context.
 */
export async function runCompetitiveResearch(
  azaDir: string,
  title: string,
  description: string,
  opts: { complexity?: 'L1' | 'L2' | 'L3' | 'L4'; force?: boolean } = {},
): Promise<RunCompetitiveResearchResult> {
  const mode = resolveCompetitorMode();
  if (mode === 'off') {
    return { research: null, fromCache: false, mode, skipped: true };
  }

  const liveAllowed =
    mode === 'always' || (mode === 'auto' && (opts.complexity ?? 'L2') !== 'L1');
  const key = competitiveCacheKey(title, description);
  const cache = loadCompetitiveCache(azaDir);

  if (!opts.force && cache[key]) {
    const entry = cache[key]!;
    const age = Date.now() - new Date(entry.cachedAt).getTime();
    if (age < COMPETITIVE_CACHE_TTL_MS) {
      try {
        writeCompetitiveResearch(azaDir, entry.result);
      } catch {
        /* best-effort */
      }
      return { research: entry.result, fromCache: true, mode, skipped: false };
    }
  }

  let research: CompetitiveResearchResult;
  if (liveAllowed) {
    research = await researchCompetitors(title, description);
  } else {
    const competitors = getCuratedCompetitorsSync(`${title} ${description}`);
    research = {
      query: `${title} ${description}`.replace(/\s+/g, ' ').trim().slice(0, 120),
      searched_at: new Date().toISOString(),
      source: 'fallback',
      competitors,
      differentiators: DEFAULT_DIFFERENTIATORS,
      prd_supplements: buildSupplements(competitors),
    };
  }

  try {
    writeCompetitiveResearch(azaDir, research);
  } catch {
    /* best-effort */
  }
  cache[key] = { key, result: research, cachedAt: new Date().toISOString() };
  saveCompetitiveCache(azaDir, cache);
  return { research, fromCache: false, mode, skipped: false };
}

/**
 * Research similar GitHub projects for the given product title/description.
 */
export async function researchCompetitors(
  title: string,
  description: string,
): Promise<CompetitiveResearchResult> {
  const query = `${title} ${description}`.replace(/\s+/g, ' ').trim().slice(0, 120);
  const keywords = buildSearchKeywords(title, description);

  const differentiators = DEFAULT_DIFFERENTIATORS;

  try {
    const data = await httpGetJson(
      `https://api.github.com/search/repositories?q=${keywords}&sort=stars&order=desc&per_page=8`,
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) throw new Error('empty');
    const apiHits: CompetitorHit[] = items.map((it: any) => ({
      full_name: String(it.full_name || ''),
      html_url: String(it.html_url || ''),
      description: String(it.description || ''),
      stars: Number(it.stargazers_count || 0),
      language: it.language ? String(it.language) : undefined,
    }));
    // Merge curated peers so PRD always cites known landscape (≥2 github URLs)
    const curated = curatedPool().slice(0, 4);
    const seen = new Set(apiHits.map((c) => c.full_name.toLowerCase()));
    const merged = [
      ...apiHits,
      ...curated.filter((c) => !seen.has(c.full_name.toLowerCase())),
    ].slice(0, 8);
    const supplements = buildSupplements(merged);
    return {
      query,
      searched_at: new Date().toISOString(),
      source: 'github_api',
      competitors: merged,
      differentiators,
      prd_supplements: supplements,
    };
  } catch {
    const competitors = fallbackCompetitors(query);
    return {
      query,
      searched_at: new Date().toISOString(),
      source: 'fallback',
      competitors,
      differentiators,
      prd_supplements: buildSupplements(competitors),
    };
  }
}

/** Sync curated landscape for PRDGenerator.generate() (no network). */
export function getCuratedCompetitorsSync(query = 'agent prd mcp loop'): CompetitorHit[] {
  return fallbackCompetitors(query);
}

/** Build overview appendix + goals/risks from curated peers (sync). */
export function buildCompetitiveAppendixSync(query = 'agent prd mcp loop'): {
  competitors: CompetitorHit[];
  differentiators: string[];
  overview_appendix: string;
  goals: string[];
  risks: CompetitiveResearchResult['prd_supplements']['risks'];
} {
  const competitors = getCuratedCompetitorsSync(query);
  const supplements = buildSupplements(competitors);
  return {
    competitors,
    differentiators: [
      '8 unified MCP tools',
      'Host LLM preferred',
      'Completion / circuit gates',
      'OpenSpec + planning-with-files hybrid',
      'Cross-session full-auto next_action chain',
    ],
    overview_appendix: supplements.overview_appendix,
    goals: supplements.goals,
    risks: supplements.risks,
  };
}

/** Persist research markdown under project `.aza/`. */
export function writeCompetitiveResearch(azaDir: string, research: CompetitiveResearchResult): string {
  if (!fs.existsSync(azaDir)) fs.mkdirSync(azaDir, { recursive: true });
  const out = path.join(azaDir, 'competitive-research.md');
  const md = [
    `# Competitive Research`,
    ``,
    `> Query: ${research.query}`,
    `> Searched: ${research.searched_at}`,
    `> Source: ${research.source}`,
    ``,
    `## Competitors`,
    ``,
    ...research.competitors.map(
      (c) => `- **${c.full_name}** — ${c.description || 'n/a'} — ${c.html_url}`,
    ),
    ``,
    `## Differentiators`,
    ``,
    ...research.differentiators.map((d) => `- ${d}`),
    ``,
    research.prd_supplements.overview_appendix,
  ].join('\n');
  fs.writeFileSync(out, md, 'utf8');
  return out;
}

/** Persist human-readable PRD markdown. */
export function writePrdMarkdown(azaDir: string, prd: {
  id: string;
  title: string;
  overview: string;
  goals: string[];
  stories: Array<{ id: string; title: string; description: string; priority: string }>;
}, research?: CompetitiveResearchResult | null): string {
  if (!fs.existsSync(azaDir)) fs.mkdirSync(azaDir, { recursive: true });
  const out = path.join(azaDir, 'prd.md');

  // Default + visible competitive section — rendered into every PRD so the
  // GitHub competitor research is impossible to miss (and bypass-proof).
  const competitiveSection = research && research.competitors.length
    ? [
        ``,
        `## Competitive Research`,
        ``,
        `> Source: ${research.source} — Query: ${research.query}`,
        ``,
        ...research.competitors.slice(0, 8).map(
          (c) => `- [${c.full_name}](${c.html_url}) — ${c.description || 'n/a'}${c.stars ? ` (★${c.stars})` : ''}`,
        ),
        ``,
        `### Differentiation`,
        ``,
        ...research.differentiators.map((d) => `- ${d}`),
        ``,
      ].join('\n')
    : '';

  const md = [
    `# ${prd.title}`,
    ``,
    `> ID: ${prd.id}`,
    ``,
    `## Overview`,
    ``,
    prd.overview,
    competitiveSection,
    `## Goals`,
    ``,
    ...prd.goals.map((g) => `- ${g}`),
    ``,
    `## Stories`,
    ``,
    ...prd.stories.map((s) => `- **${s.id}** [${s.priority}] ${s.title} — ${s.description}`),
    ``,
  ].join('\n');
  fs.writeFileSync(out, md, 'utf8');
  return out;
}
