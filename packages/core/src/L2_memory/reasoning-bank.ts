/**
 * ReasoningBank — outcome-tagged reasoning traces (ruflo-style MVP).
 * Persists under `.aza/memory/reasoning/*.json` for cross-process recall.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openVectorStore } from './stores';

export interface ReasoningTrace {
  id: string;
  problem: string;
  steps: string[];
  outcome: 'success' | 'failure' | 'partial' | 'unknown';
  tags: string[];
  confidence: number;
  source?: string;
  created_at: string;
  updated_at: string;
}

export interface ReasoningBankOptions {
  /** When true, upsert traces into `.aza/stores/vectors` under key `reasoning:<id>`. */
  vectorIndex?: boolean;
}

function bankDir(azaDir: string): string {
  return path.join(azaDir, 'memory', 'reasoning');
}

function safeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export class ReasoningBank {
  private traces = new Map<string, ReasoningTrace>();
  private dir: string;
  private azaDir: string;
  private vectorIndex: boolean;

  constructor(azaDir: string, options: ReasoningBankOptions = {}) {
    this.azaDir = azaDir;
    this.dir = bankDir(azaDir);
    this.vectorIndex = options.vectorIndex !== false;
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.traces.clear();
    if (!fs.existsSync(this.dir)) return;
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const t = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as ReasoningTrace;
        if (t?.id) this.traces.set(t.id, t);
      } catch {
        /* skip corrupt */
      }
    }
  }

  async upsert(
    input: Omit<ReasoningTrace, 'id' | 'created_at' | 'updated_at'> & { id?: string },
  ): Promise<ReasoningTrace> {
    const now = new Date().toISOString();
    const id = input.id || `rb-${now.slice(0, 10)}-${this.traces.size + 1}`;
    const existing = this.traces.get(id);
    const trace: ReasoningTrace = {
      id,
      problem: input.problem,
      steps: input.steps ?? [],
      outcome: input.outcome ?? 'unknown',
      tags: input.tags ?? [],
      confidence: input.confidence ?? 0.7,
      source: input.source,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    this.traces.set(id, trace);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${safeId(id)}.json`), JSON.stringify(trace, null, 2), 'utf8');
    if (this.vectorIndex) {
      try {
        const vs = openVectorStore(this.azaDir);
        const doc = [trace.problem, ...trace.steps, trace.outcome, ...(trace.tags || [])].join('\n');
        vs.upsert(`reasoning:${id}`, doc);
      } catch {
        /* best-effort */
      }
    }
    return trace;
  }

  async search(query: string, limit = 5): Promise<ReasoningTrace[]> {
    const q = query.toLowerCase();
    const scored: Array<{ t: ReasoningTrace; score: number }> = [];
    for (const t of this.traces.values()) {
      const hay = `${t.problem}\n${t.steps.join('\n')}\n${t.tags.join(' ')}\n${t.outcome}`.toLowerCase();
      if (!q || hay.includes(q) || q.split(/\s+/).some((tok) => tok && hay.includes(tok))) {
        scored.push({ t, score: t.confidence + (t.outcome === 'success' ? 0.2 : 0) });
      }
    }
    if (scored.length === 0 && this.vectorIndex) {
      try {
        const vs = openVectorStore(this.azaDir);
        const hits = vs.search(query, limit);
        for (const h of hits) {
          const m = h.key.match(/^reasoning:(.+)$/);
          if (m && this.traces.has(m[1]!)) {
            scored.push({ t: this.traces.get(m[1]!)!, score: h.similarity ?? 0 });
          }
        }
      } catch {
        /* ignore */
      }
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.t);
  }

  async list(): Promise<ReasoningTrace[]> {
    return [...this.traces.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async get(id: string): Promise<ReasoningTrace | undefined> {
    return this.traces.get(id);
  }
}

/** Promote episodic-style text into a reasoning trace. */
export function episodeToReasoningInput(
  summary: string,
  details: string,
  tags: string[],
  type?: string,
): Omit<ReasoningTrace, 'id' | 'created_at' | 'updated_at'> {
  const steps = details
    .split(/\n+/)
    .map((s) => s.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
  const outcomeTag = tags.find((t) => /^(success|failure|partial)$/i.test(t));
  const outcome = (outcomeTag?.toLowerCase() as ReasoningTrace['outcome']) ||
    (type === 'error' ? 'failure' : type === 'success' ? 'success' : 'unknown');
  return {
    problem: summary,
    steps: steps.length > 0 ? steps : [details.slice(0, 500)],
    outcome,
    tags: [...new Set([...tags, 'reasoning'])],
    confidence: outcome === 'success' ? 0.85 : 0.6,
    source: 'aza_memory',
  };
}
