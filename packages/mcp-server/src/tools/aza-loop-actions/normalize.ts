/**
 * 路径规范化工具（从 aza-loop.ts 提取，避免循环依赖）。
 */
import * as path from 'path';

export function normalizeRoot(projectRoot: string): string {
  try {
    return path.resolve(projectRoot || process.cwd());
  } catch {
    return projectRoot || process.cwd();
  }
}
