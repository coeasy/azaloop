/**
 * prompt-cache.ts
 *
 * R10 第5轮 (D13)：LLM 响应缓存。
 *
 * 相同 prompt（含上下文）的 LLM 响应直接返回缓存结果，
 * 避免重复模型请求、减少 token 消耗。
 *
 * 使用场景：
 * - PRD review：相同 PRD 草稿 + review prompt → 直接返回上次 review 结果
 * - PRD 生成：相同输入 → 直接返回上次生成的 PRD
 * - 任何确定性的 prompt → response 映射
 *
 * 缓存策略：
 * - key = SHA256(prompt + context) 前 16 位
 * - TTL 默认 1 小时（可配置），过期自动失效
 * - LRU 淘汰：超过 maxEntries 时淘汰最旧条目
 * - 可选持久化到 .aza/prompt-cache.jsonl（跨会话复用）
 */
import { createHash } from 'crypto';

export interface CacheEntry {
  /** SHA256 前 16 位 */
  key: string;
  /** 缓存的响应 */
  response: string;
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 最后访问时间戳（ms），用于 LRU */
  lastAccessedAt: number;
  /** 命中次数 */
  hitCount: number;
}

export interface PromptCacheOptions {
  /** TTL 毫秒，默认 1 小时 */
  ttlMs?: number;
  /** 最大条目数，默认 200 */
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_ENTRIES = 200;

/**
 * PromptResponseCache — 基于 prompt 内容 SHA256 的 LLM 响应缓存。
 *
 * 线程安全：所有方法同步且无副作用（除内部 Map 操作）。
 */
export class PromptResponseCache {
  private entries: Map<string, CacheEntry> = new Map();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: PromptCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * 计算 prompt + context 的缓存 key。
   * context 是可选的附加上下文（如 stage、storyId 等），
   * 会一起参与哈希，确保相同 prompt 在不同上下文下不误命中。
   */
  static computeKey(prompt: string, context?: Record<string, unknown>): string {
    const blob = context
      ? `${prompt}\n---context---\n${JSON.stringify(context)}`
      : prompt;
    return createHash('sha256').update(blob).digest('hex').slice(0, 16);
  }

  /**
   * 查询缓存。命中且未过期时返回响应，否则返回 null。
   * 命中时更新 lastAccessedAt 和 hitCount（LRU）。
   */
  get(prompt: string, context?: Record<string, unknown>): string | null {
    const key = PromptResponseCache.computeKey(prompt, context);
    const entry = this.entries.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.createdAt > this.ttlMs) {
      // 过期，淘汰
      this.entries.delete(key);
      return null;
    }

    // LRU 更新
    entry.lastAccessedAt = now;
    entry.hitCount += 1;
    return entry.response;
  }

  /**
   * 写入缓存。若已满，淘汰最旧的条目（LRU）。
   */
  set(prompt: string, response: string, context?: Record<string, unknown>): void {
    const key = PromptResponseCache.computeKey(prompt, context);
    const now = Date.now();

    // 容量淘汰
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.evictOldest();
    }

    this.entries.set(key, {
      key,
      response,
      createdAt: now,
      lastAccessedAt: now,
      hitCount: 0,
    });
  }

  /**
   * 淘汰最旧条目（按 lastAccessedAt 升序）。
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, e] of this.entries) {
      if (e.lastAccessedAt < oldestTime) {
        oldestTime = e.lastAccessedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) this.entries.delete(oldestKey);
  }

  /**
   * 清除所有过期条目。返回清除数量。
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > this.ttlMs) {
        this.entries.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * 返回缓存统计信息。
   */
  getStats(): {
    size: number;
    maxEntries: number;
    ttlMs: number;
    totalHits: number;
  } {
    let totalHits = 0;
    for (const e of this.entries.values()) totalHits += e.hitCount;
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      totalHits,
    };
  }

  /**
   * 清空缓存。
   */
  clear(): void {
    this.entries.clear();
  }
}
