/**
 * R10 第11轮 (P6 反漂移) — ReasoningBank。
 *
 * 借鉴 ruflo「ReasoningBank + Reasoning Vectors + Counterfactual Reasoning」+ 通用「swarm dedup」：
 *
 * 痛点：跨会话/跨 client 复用记忆时，相似但语境不同的 memory 容易污染；
 *       长时间 session 后 memory 出现「概念漂移」（同一关键词但语义已变）。
 *
 * 解法：
 *   1. ReasoningBank: 存"推理轨迹"而非"最终结果"
 *   2. 反漂移：每条 bank 记录"有效次数"+"应用次数"+"最近漂移分数"
 *   3. 决策：相似度 < threshold 的不插入；高应用/低漂移的提升优先级
 *
 * 数据结构：
 *   - ReasoningRecord: { id, query, reasoning, conclusion, refs, appliedCount, driftScore, ts }
 *   - Dedup: 基于 query embedding 的 cosine sim 拒绝重复
 *   - Anti-drift: 当同一 query 出现 >N 次但 conclusion 变化 >M% → 标记 drift
 */
import * as fs from 'fs';
import * as path from 'path';
import { embedText, openVectorStore, type VectorStore } from '../L2_memory/stores';

export interface ReasoningRecord {
  id: string;
  query: string;
  queryVector: number[];     // 32-dim
  reasoning: string;         // 推理过程
  conclusion: string;        // 结论
  refs: string[];            // 引用 evidence id 列表
  appliedCount: number;
  driftScore: number;        // 0-1，越高越不稳定
  createdAt: string;
  updatedAt: string;
}

export interface ReasoningStats {
  total: number;
  applied: number;
  driftFlagged: number;
  dedupedToday: number;
  avgDriftScore: number;
  topApplied: Array<{ id: string; query: string; appliedCount: number }>;
}

export interface AntiDriftBankOptions {
  azaDir: string;
  /** 同 query 重复的 drift 检测阈值（默认 0.3） */
  driftThreshold?: number;
  /** dedup 相似度阈值（默认 0.95） */
  dedupThreshold?: number;
  /** drift 检测窗口：同 query 出现次数（默认 3） */
  driftOccurrenceThreshold?: number;
}

export class AntiDriftBank {
  private filePath: string;
  private vectorStore: VectorStore;
  private records: Map<string, ReasoningRecord> = new Map();
  private driftThreshold: number;
  private dedupThreshold: number;
  private driftOccurrenceThreshold: number;
  private dedupedToday = 0;

  constructor(options: AntiDriftBankOptions) {
    this.filePath = path.join(options.azaDir, 'evidence', 'reasoning-bank.jsonl');
    this.driftThreshold = options.driftThreshold ?? 0.3;
    this.dedupThreshold = options.dedupThreshold ?? 0.95;
    this.driftOccurrenceThreshold = options.driftOccurrenceThreshold ?? 3;
    this.vectorStore = openVectorStore(path.join(options.azaDir, 'stores'), 32);
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as ReasoningRecord;
          this.records.set(rec.id, rec);
        } catch { /* skip corrupt */ }
      }
    } catch { /* ignore */ }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const lines = Array.from(this.records.values()).map((r) => JSON.stringify(r));
    fs.writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf8');
  }

  private cosineSim(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * 记录一条推理；返回 { added, deduped, drifted }
   *
   * - 如果 query 相似度 > dedupThreshold 且 conclusion 相同 → deduped
   * - 如果 query 相似度 > dedupThreshold 但 conclusion 变化 → 触发 drift
   * - 否则新增
   */
  record(input: { query: string; reasoning: string; conclusion: string; refs?: string[] }): {
    added: boolean;
    deduped: boolean;
    drifted: boolean;
    record: ReasoningRecord;
  } {
    return this.recordWithVector(input, embedText(input.query));
  }

  private jaccardDistance(a: string, b: string): number {
    const tok = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((t) => t.length > 2));
    const sa = tok(a);
    const sb = tok(b);
    if (sa.size === 0 && sb.size === 0) return 0;
    let inter = 0;
    for (const x of sa) if (sb.has(x)) inter++;
    const union = sa.size + sb.size - inter;
    return union > 0 ? 1 - inter / union : 0;
  }

  /**
   * 检索相关推理（top-k by cosine）。
   */
  search(query: string, k: number = 5): ReasoningRecord[] {
    const results = this.vectorStore.search(query, k);
    const out: ReasoningRecord[] = [];
    for (const r of results) {
      const m = r.key.match(/^reasoning:(.+)$/);
      if (m && m[1]) {
        const rec = this.records.get(m[1]);
        if (rec) out.push(rec);
      }
    }
    return out;
  }

  /**
   * P6 第12轮 (P6-1 批处理) — 批量记录推理。
   *
   * 借鉴 ruflo ReasoningBank batch ingestion：避免单条 insert 带来的
   * 重复扫描开销。在批量场景下，先把所有 qvec 算好，再用 O(n×m) 一次性比较。
   */
  recordBatch(inputs: Array<{ query: string; reasoning: string; conclusion: string; refs?: string[] }>): Array<{
    added: boolean;
    deduped: boolean;
    drifted: boolean;
    record: ReasoningRecord;
  }> {
    // 一次性预热所有 query vectors
    const prepared = inputs.map((i) => ({ input: i, qvec: embedText(i.query) }));
    const out: Array<{
      added: boolean;
      deduped: boolean;
      drifted: boolean;
      record: ReasoningRecord;
    }> = [];
    for (const p of prepared) {
      out.push(this.recordWithVector(p.input, p.qvec));
    }
    return out;
  }

  /**
   * P6 第12轮 (P6-1 反漂移过滤) — 按漂移分数过滤高风险记录。
   *
   * 当同一 query 的 driftScore 持续高于 threshold 时，返回该记录供运营审查。
   */
  listDrifted(minScore: number = this.driftThreshold): ReasoningRecord[] {
    return Array.from(this.records.values())
      .filter((r) => r.driftScore >= minScore)
      .sort((a, b) => b.driftScore - a.driftScore);
  }

  /**
   * P6 第12轮 (P6-1 反漂移聚类) — 按 query 关键词聚类高漂移记录。
   */
  groupByQueryKeyword(): Array<{ keyword: string; records: ReasoningRecord[]; avgDrift: number }> {
    const groups = new Map<string, ReasoningRecord[]>();
    for (const rec of this.records.values()) {
      const tokens = rec.query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
      for (const tok of tokens) {
        if (!groups.has(tok)) groups.set(tok, []);
        groups.get(tok)!.push(rec);
      }
    }
    return Array.from(groups.entries())
      .filter(([, recs]) => recs.length >= 2)
      .map(([keyword, recs]) => ({
        keyword,
        records: recs,
        avgDrift: recs.reduce((s, r) => s + r.driftScore, 0) / recs.length,
      }))
      .sort((a, b) => b.avgDrift - a.avgDrift);
  }

  /**
   * P6 第12轮 (P6-1 性能) — 用预算向量复用 record。
   */
  private recordWithVector(
    input: { query: string; reasoning: string; conclusion: string; refs?: string[] },
    qvec: number[],
  ): { added: boolean; deduped: boolean; drifted: boolean; record: ReasoningRecord } {
    const now = new Date().toISOString();
    let bestMatch: ReasoningRecord | null = null;
    let bestSim = 0;
    for (const rec of this.records.values()) {
      const sim = this.cosineSim(qvec, rec.queryVector);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = rec;
      }
    }
    if (bestMatch && bestSim >= this.dedupThreshold) {
      if (bestMatch.conclusion === input.conclusion) {
        bestMatch.appliedCount++;
        bestMatch.updatedAt = now;
        this.dedupedToday++;
        this.persist();
        return { added: false, deduped: true, drifted: false, record: bestMatch };
      }
      if (bestMatch.appliedCount >= this.driftOccurrenceThreshold) {
        const oldConc = bestMatch.conclusion;
        const driftScore = this.jaccardDistance(oldConc, input.conclusion);
        bestMatch.driftScore = Math.max(bestMatch.driftScore, driftScore);
        if (driftScore > this.driftThreshold) {
          bestMatch.conclusion = input.conclusion;
          bestMatch.reasoning = input.reasoning;
          bestMatch.refs = input.refs ?? [];
          bestMatch.updatedAt = now;
          this.persist();
          return { added: false, deduped: false, drifted: true, record: bestMatch };
        }
      }
      bestMatch.appliedCount++;
      bestMatch.updatedAt = now;
      this.persist();
      return { added: false, deduped: false, drifted: false, record: bestMatch };
    }
    const id = `RB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rec: ReasoningRecord = {
      id,
      query: input.query,
      queryVector: qvec,
      reasoning: input.reasoning,
      conclusion: input.conclusion,
      refs: input.refs ?? [],
      appliedCount: 1,
      driftScore: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, rec);
    this.vectorStore.upsert(`reasoning:${id}`, `${input.query}\n${input.conclusion}`);
    this.persist();
    return { added: true, deduped: false, drifted: false, record: rec };
  }

  /**
   * 标记应用（提升优先级）。当某次推理真正被使用时调用。
   */
  apply(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec) return false;
    rec.appliedCount++;
    rec.updatedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  /**
   * 强制重置一条记录的 drift score。
   */
  resetDrift(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec) return false;
    rec.driftScore = 0;
    rec.appliedCount = 0;
    this.persist();
    return true;
  }

  stats(): ReasoningStats {
    const total = this.records.size;
    const driftFlagged = Array.from(this.records.values()).filter((r) => r.driftScore > this.driftThreshold).length;
    const topApplied = Array.from(this.records.values())
      .sort((a, b) => b.appliedCount - a.appliedCount)
      .slice(0, 5)
      .map((r) => ({ id: r.id, query: r.query, appliedCount: r.appliedCount }));
    const avgDrift = total > 0
      ? Array.from(this.records.values()).reduce((s, r) => s + r.driftScore, 0) / total
      : 0;
    return {
      total,
      applied: Array.from(this.records.values()).filter((r) => r.appliedCount > 1).length,
      driftFlagged,
      dedupedToday: this.dedupedToday,
      avgDriftScore: avgDrift,
      topApplied,
    };
  }

  list(): ReasoningRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export function defaultAntiDriftBank(workspaceRoot: string = process.cwd()): AntiDriftBank {
  return new AntiDriftBank({ azaDir: path.join(workspaceRoot, '.aza') });
}
