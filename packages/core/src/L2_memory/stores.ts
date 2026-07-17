/**
 * Product stores under `.aza/stores/{specs,changes,vectors}`.
 * Specs/changes are JSON documents; vectors persist a local NSW index.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createNSWIndex, type SearchResult } from './hnsw-index';

export type StoreKind = 'specs' | 'changes';

export interface StoreDoc {
  id: string;
  title?: string;
  body: string;
  tags?: string[];
  updated_at: string;
  meta?: Record<string, unknown>;
}

export interface StorePaths {
  root: string;
  specs: string;
  changes: string;
  vectors: string;
}

export function resolveStorePaths(azaDir: string): StorePaths {
  const root = path.join(azaDir, 'stores');
  return {
    root,
    specs: path.join(root, 'specs'),
    changes: path.join(root, 'changes'),
    vectors: path.join(root, 'vectors'),
  };
}

export function ensureStores(azaDir: string): StorePaths {
  const paths = resolveStorePaths(azaDir);
  for (const p of [paths.root, paths.specs, paths.changes, paths.vectors]) {
    fs.mkdirSync(p, { recursive: true });
  }
  return paths;
}

function docPath(azaDir: string, kind: StoreKind, id: string): string {
  const paths = ensureStores(azaDir);
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(kind === 'specs' ? paths.specs : paths.changes, `${safe}.json`);
}

export function putStoreDoc(azaDir: string, kind: StoreKind, doc: Omit<StoreDoc, 'updated_at'> & { updated_at?: string }): StoreDoc {
  const full: StoreDoc = {
    ...doc,
    updated_at: doc.updated_at || new Date().toISOString(),
  };
  const p = docPath(azaDir, kind, full.id);
  fs.writeFileSync(p, JSON.stringify(full, null, 2), 'utf8');
  return full;
}

export function getStoreDoc(azaDir: string, kind: StoreKind, id: string): StoreDoc | null {
  const p = docPath(azaDir, kind, id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as StoreDoc;
  } catch {
    return null;
  }
}

export function listStoreDocs(azaDir: string, kind: StoreKind): StoreDoc[] {
  const paths = ensureStores(azaDir);
  const dir = kind === 'specs' ? paths.specs : paths.changes;
  if (!fs.existsSync(dir)) return [];
  const out: StoreDoc[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as StoreDoc);
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function deleteStoreDoc(azaDir: string, kind: StoreKind, id: string): boolean {
  const p = docPath(azaDir, kind, id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

/** Very small bag-of-hashes embedding for local text search (dim=32). */
export function embedText(text: string, dimensions = 32): number[] {
  const v = new Array(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dimensions;
    v[idx] += 1;
  }
  return v;
}

export interface VectorStore {
  upsert(key: string, text: string): void;
  search(query: string, k?: number): Array<SearchResult & { text?: string }>;
  size(): number;
  persist(): void;
  /** R10 第11轮 (P4 可观测性)：NSW 索引指标 */
  stats?(): { size: number; insertCount: number; searchCount: number; avgHitRate: number; bruteForce: boolean; dimensions: number; M: number };
}

/**
 * Persistable vector store backed by NSW index at `.aza/stores/vectors/index.json`.
 */
export function openVectorStore(azaDir: string, dimensions = 32): VectorStore {
  const paths = ensureStores(azaDir);
  const indexFile = path.join(paths.vectors, 'index.json');
  const textsFile = path.join(paths.vectors, 'texts.json');
  const index = createNSWIndex({ dimensions, M: 8, efSearch: 32 });
  const texts: Record<string, string> = {};

  if (fs.existsSync(indexFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as {
        entries: Array<{ key: string; vector: number[] }>;
      };
      for (const e of raw.entries || []) {
        if (Array.isArray(e.vector) && e.vector.length === dimensions) {
          index.insert(e.key, e.vector);
        }
      }
    } catch {
      /* fresh index */
    }
  }
  if (fs.existsSync(textsFile)) {
    try {
      Object.assign(texts, JSON.parse(fs.readFileSync(textsFile, 'utf8')));
    } catch {
      /* ignore */
    }
  }

  function persist(): void {
    const entries = index.keys().map((key) => ({
      key,
      vector: embedText(texts[key] || key, dimensions),
    }));
    fs.writeFileSync(indexFile, JSON.stringify({ dimensions, entries }, null, 2), 'utf8');
    fs.writeFileSync(textsFile, JSON.stringify(texts, null, 2), 'utf8');
  }

  return {
    upsert(key: string, text: string): void {
      texts[key] = text;
      index.insert(key, embedText(text, dimensions));
      persist();
    },
    search(query: string, k = 5): Array<SearchResult & { text?: string }> {
      return index.search(embedText(query, dimensions), k).map((r) => ({
        ...r,
        text: texts[r.key],
      }));
    },
    size(): number {
      return index.size();
    },
    stats(): { size: number; insertCount: number; searchCount: number; avgHitRate: number; bruteForce: boolean; dimensions: number; M: number } {
      const s = index.stats();
      return {
        size: s.size,
        insertCount: s.insertCount,
        searchCount: s.searchCount,
        avgHitRate: s.avgHitRate,
        bruteForce: s.bruteForce,
        dimensions: s.dimensions,
        M: s.M,
      };
    },
    persist,
  };
}

/** Index all specs+changes into the vector store. */
export function reindexStores(azaDir: string): { indexed: number } {
  const vs = openVectorStore(azaDir);
  let n = 0;
  for (const kind of ['specs', 'changes'] as StoreKind[]) {
    for (const doc of listStoreDocs(azaDir, kind)) {
      vs.upsert(`${kind}:${doc.id}`, `${doc.title || ''}\n${doc.body}\n${(doc.tags || []).join(' ')}`);
      n++;
    }
  }
  return { indexed: n };
}
