/**
 * R12 P6 Plus14 (P1 主链路拆分第14轮) — Workspace 解析器。
 *
 * 借鉴 OpenSpec「project-root resolution」+ agency-orchestrator「marker-based walk-up」：
 * 把 index.ts 中 73 行的 resolveWorkspaceRoot + ensureWorkspaceBoot 抽出为独立模块。
 *
 * 核心问题：Cursor user-level MCP 经常以 cwd=HOME 启动，导致把 OpenSpec 写到 ~/openspec，
 * 把 .aza 写到 ~/.aza — 表现为"azaloop not taking effect"。
 *
 * 解决：
 * 1. 优先使用 args.workspace_path > AZA_WORKSPACE > AZA_PROJECT_ROOT > process.cwd()
 * 2. 若解析到 HOME（除非显式 AZA_ALLOW_HOME_WORKSPACE=true），向上查找项目标记
 * 3. 项目标记：.aza / openspec / package.json / pnpm-workspace.yaml
 * 4. 找不到项目标记 → 硬失败，提示用户
 * 5. ensureWorkspaceBoot() 在启动时一次性调用，确保 cwd 切到项目根
 */
import * as path from 'path';
import * as fs from 'fs';

/** 项目标记（向上查找） */
const PROJECT_MARKERS = ['.aza', 'openspec', 'package.json', 'pnpm-workspace.yaml'];

/** HOME guard 软失败回退到 cwd */
const HOME = path.resolve(process.env.USERPROFILE || process.env.HOME || '');

/**
 * Resolve the project workspace. Cursor user-level MCP often starts with cwd=HOME,
 * which previously wrote OpenSpec into ~/openspec and .aza into ~/.aza — appearing
 * as "azaloop not taking effect" in the repo.
 *
 * R10 第1轮 (D8)：修复 HOME 软失败 — 不再静默落到 HOME，而是向上查找项目标记。
 */
export function resolveWorkspaceRoot(args?: Record<string, unknown>): string {
  const fromArgs = typeof args?.workspace_path === 'string' ? args.workspace_path.trim() : '';
  const fromEnv = (process.env.AZA_WORKSPACE || process.env.AZA_PROJECT_ROOT || '').trim();
  let raw = fromArgs || fromEnv || process.cwd();
  raw = path.resolve(raw);

  // Reject HOME / user profile as workspace unless explicitly forced
  const forceHome = process.env.AZA_ALLOW_HOME_WORKSPACE === 'true';
  if (!forceHome && HOME && path.resolve(raw) === HOME) {
    const found = walkUpForProjectMarker(process.cwd());
    if (found) {
      return path.resolve(found);
    }
    // Hard fail: refuse to write into HOME without explicit override
    throw new Error(
      `[azaloop] workspace resolved to HOME ("${HOME}"). Set AZA_WORKSPACE=<project-path> ` +
      `or run MCP from the project directory. To allow HOME, set AZA_ALLOW_HOME_WORKSPACE=true.`,
    );
  }
  return raw;
}

/**
 * 向上查找项目标记，返回第一个匹配的目录路径。
 * 最多向上 10 层，防止无限循环。
 */
export function walkUpForProjectMarker(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    for (const m of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(dir, m))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return null;
}

/**
 * 启动时一次性调用：解析 workspace + 切换 cwd + 创建 .aza 目录。
 * 失败时回退到 cwd（不阻塞 MCP 启动）。
 */
export function ensureWorkspaceBoot(): string {
  let root: string;
  try {
    root = resolveWorkspaceRoot();
  } catch (err) {
    // R10 D8: workspace resolution failed (HOME guard) — log and fall back to cwd
    console.error(String(err));
    root = process.cwd();
  }
  try {
    if (path.resolve(process.cwd()) !== root && fs.existsSync(root)) {
      process.chdir(root);
    }
  } catch {
    /* best-effort */
  }
  const azaDir = path.join(root, '.aza');
  try {
    fs.mkdirSync(azaDir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return root;
}
