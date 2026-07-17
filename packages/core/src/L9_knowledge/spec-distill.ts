/**
 * Spec distillation — archive/finish → `.aza/stores` + vector reindex.
 * Closes the OpenSpec ↔ Stores gap (Trellis-style knowledge store).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ensureStores,
  putStoreDoc,
  reindexStores,
  type StoreDoc,
} from '../L2_memory/stores';

export interface DistillResult {
  docs: StoreDoc[];
  indexed: number;
  sources: string[];
}

function readIfExists(p: string, max = 12000): string {
  if (!fs.existsSync(p)) return '';
  try {
    return fs.readFileSync(p, 'utf8').slice(0, max);
  } catch {
    return '';
  }
}

/**
 * Distill an OpenSpec change folder (active or archived) into Stores.
 * @param azaDir `.aza` directory
 * @param changeDir absolute path to change folder
 * @param slug change slug
 */
export function distillChangeToStore(
  azaDir: string,
  changeDir: string,
  slug: string,
): DistillResult {
  ensureStores(azaDir);
  const sources: string[] = [];
  const docs: StoreDoc[] = [];

  const proposal = readIfExists(path.join(changeDir, 'proposal.md'));
  const design = readIfExists(path.join(changeDir, 'design.md'));
  const tasks = readIfExists(path.join(changeDir, 'tasks.md'));
  if (proposal) sources.push('proposal.md');
  if (design) sources.push('design.md');
  if (tasks) sources.push('tasks.md');

  const body = [
    proposal && `## Proposal\n\n${proposal}`,
    design && `## Design\n\n${design}`,
    tasks && `## Tasks\n\n${tasks}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  if (body) {
    docs.push(
      putStoreDoc(azaDir, 'changes', {
        id: `change:${slug}`,
        title: slug,
        body,
        tags: ['openspec', 'distilled', slug],
        meta: { slug, sources },
      }),
    );
  }

  // Canonical specs under openspec/specs/<cap>/spec.md adjacent to project root
  const projectRoot = path.dirname(azaDir);
  const specsRoot = path.join(projectRoot, 'openspec', 'specs');
  if (fs.existsSync(specsRoot)) {
    const walk = (dir: string, rel = ''): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(abs, r);
        else if (e.isFile() && e.name === 'spec.md') {
          const cap = path.dirname(r).replace(/\\/g, '/');
          const text = readIfExists(abs);
          if (!text) continue;
          sources.push(`openspec/specs/${r}`);
          docs.push(
            putStoreDoc(azaDir, 'specs', {
              id: `spec:${cap || slug}`,
              title: cap || slug,
              body: text,
              tags: ['openspec', 'spec', 'distilled', slug],
              meta: { capability: cap, from_change: slug },
            }),
          );
        }
      }
    };
    walk(specsRoot);
  }

  // Change-local specs/
  const localSpecs = path.join(changeDir, 'specs');
  if (fs.existsSync(localSpecs)) {
    const walkLocal = (dir: string, rel = ''): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walkLocal(abs, r);
        else if (e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.json'))) {
          const text = readIfExists(abs);
          if (!text) continue;
          sources.push(`change/specs/${r}`);
          docs.push(
            putStoreDoc(azaDir, 'specs', {
              id: `change-spec:${slug}:${r.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
              title: `${slug}/${r}`,
              body: text,
              tags: ['openspec', 'change-spec', 'distilled', slug],
              meta: { slug, rel: r },
            }),
          );
        }
      }
    };
    walkLocal(localSpecs);
  }

  const { indexed } = reindexStores(azaDir);
  return { docs, indexed, sources };
}

/** Distill `.aza/spec-conventions/conventions.jsonl` into Stores. */
export function distillConventionsToStore(azaDir: string): DistillResult {
  ensureStores(azaDir);
  const jsonl = path.join(azaDir, 'spec-conventions', 'conventions.jsonl');
  const sources: string[] = [];
  const docs: StoreDoc[] = [];
  if (!fs.existsSync(jsonl)) {
    return { docs, indexed: 0, sources };
  }
  sources.push('spec-conventions/conventions.jsonl');
  const lines = fs.readFileSync(jsonl, 'utf8').split(/\n/).filter(Boolean);
  let i = 0;
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const body = String(row.rule || row.text || row.content || JSON.stringify(row));
      const id = String(row.id || `convention-${++i}`);
      docs.push(
        putStoreDoc(azaDir, 'specs', {
          id: `convention:${id}`,
          title: String(row.title || id),
          body,
          tags: ['convention', 'distilled', ...((row.tags as string[]) || [])],
          meta: row,
        }),
      );
    } catch {
      /* skip bad line */
    }
  }
  const { indexed } = reindexStores(azaDir);
  return { docs, indexed, sources };
}

/**
 * Distill from project root: prefers active change, else latest archive.
 */
export function distillProjectChange(
  projectRoot: string,
  changeId?: string,
): DistillResult {
  const azaDir = path.join(projectRoot, '.aza');
  const changesRoot = path.join(projectRoot, 'openspec', 'changes');
  if (!fs.existsSync(changesRoot)) {
    return distillConventionsToStore(azaDir);
  }

  let changeDir: string | null = null;
  let slug = changeId || '';

  if (changeId) {
    const active = path.join(changesRoot, changeId);
    if (fs.existsSync(active)) {
      changeDir = active;
      slug = changeId;
    } else {
      // search archive
      const archive = path.join(changesRoot, 'archive');
      if (fs.existsSync(archive)) {
        for (const name of fs.readdirSync(archive)) {
          if (name.endsWith(`-${changeId}`) || name === changeId) {
            changeDir = path.join(archive, name);
            slug = changeId;
            break;
          }
        }
      }
    }
  }

  if (!changeDir) {
    // pick first non-archive dir, else newest archive
    const entries = fs.readdirSync(changesRoot, { withFileTypes: true });
    const active = entries.find((e) => e.isDirectory() && e.name !== 'archive');
    if (active) {
      changeDir = path.join(changesRoot, active.name);
      slug = active.name;
    } else {
      const archive = path.join(changesRoot, 'archive');
      if (fs.existsSync(archive)) {
        const archives = fs
          .readdirSync(archive, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort()
          .reverse();
        if (archives[0]) {
          changeDir = path.join(archive, archives[0]);
          slug = archives[0].replace(/^\d{4}-\d{2}-\d{2}-/, '');
        }
      }
    }
  }

  const conv = distillConventionsToStore(azaDir);
  if (!changeDir) return conv;

  const change = distillChangeToStore(azaDir, changeDir, slug);
  return {
    docs: [...change.docs, ...conv.docs],
    indexed: change.indexed,
    sources: [...change.sources, ...conv.sources],
  };
}
