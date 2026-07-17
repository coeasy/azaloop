import * as path from 'node:path';

/**
 * 计算 .aza 目录绝对路径，兼容 Windows / POSIX 分隔符。
 */
export function azaDir(workspace?: string): string {
  return path.join(workspace || process.cwd(), '.aza');
}
