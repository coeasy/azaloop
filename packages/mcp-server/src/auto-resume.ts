/**
 * R12 P6 Plus14 (P1 主链路拆分第14轮) — 跨客户端自动续航触发器。
 *
 * 借鉴 comet「cross-session resume」+ Trellis「client context preservation」+ ruflo「worktree-aware resume」：
 * 把 index.ts 中 110 行的 autoResumeOnBoot + AutoResumeResult 抽出为独立模块。
 *
 * 触发时机：MCP 服务器启动时调用。
 * 行为：
 * 1. 读取 RESUME.md（同步，避免 async at module load）
 * 2. 解析 YAML frontmatter
 * 3. 判断是否需要续跑：终态 / 全新开始 → noop
 * 4. 版本不兼容 → restart
 * 5. 客户端切换 → 自动续跑
 * 6. 返回结构化结果，由宿主 AI 决定是否调用 aza_session(continue) + aza_loop(full)
 */
import * as path from 'path';
import * as fs from 'fs';
import { detectClient, detectClientSwitch } from '@azaloop/core';
import { resolveWorkspaceRoot } from './workspace-resolver';

/** 自动续跑结果（结构化） */
export interface AutoResumeResult {
  should_resume: boolean;
  action: 'resume' | 'restart' | 'noop';
  reason: string;
  client_switched: boolean;
  previous_client: string;
  current_client: string;
  resume_stage: string | null;
  resume_iteration: number;
  next_tool: string | null;
  next_action: string | null;
}

/** 解析后的 resume frontmatter 字段 */
interface ResumeFrontmatter {
  stage: string;
  iteration: number;
  client: string;
  next_tool: string;
  next_action: string;
  progress: string;
  engine_version: string;
}

/**
 * Parse RESUME.md YAML frontmatter (sync).
 * Returns null if file missing or frontmatter invalid.
 */
export function parseResumeFrontmatter(content: string): ResumeFrontmatter | null {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm || !fm[1]) return null;
  const data: Record<string, string> = {};
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m && m[1]) {
      let v = (m[2] || '').trim();
      // 去除引号包裹
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      data[m[1]] = v;
    }
  }
  if (!data.stage && !data.next_tool) return null;
  return {
    stage: data.stage || 'open',
    iteration: parseInt(data.iteration || '0', 10),
    client: data.client || 'unknown',
    next_tool: data.next_tool || 'aza_loop',
    next_action: data.next_action || 'full',
    progress: data.progress || '0%',
    engine_version: data.engine_version || '0',
  };
}

/** 检查是否是终态（archive + done/ship/100%） */
export function isTerminalState(stage: string, nextAction: string, progress: string): boolean {
  return stage === 'archive' && (nextAction === 'done' || nextAction === 'ship' || progress === '100%');
}

/** 检查是否是全新开始（open + iteration=0） */
export function isFreshStart(stage: string, iteration: number): boolean {
  return stage === 'open' && iteration === 0;
}

/** 检查引擎版本是否兼容（major version 必须一致） */
export function isEngineCompatible(resumeVersion: string, currentVersion: string = '0.1.0'): boolean {
  const resumeMajor = resumeVersion.split('.')[0];
  const engineMajor = currentVersion.split('.')[0];
  return resumeMajor === engineMajor;
}

/**
 * 跨客户端自动续航触发器 — MCP 服务器启动时调用。
 *
 * 返回结构化结果（不直接执行循环，避免阻塞 MCP 启动）。
 * 由宿主 AI 或 MCP tool handler 决定是否调用 aza_session(continue) + aza_loop(full)。
 */
export function autoResumeOnBoot(root?: string): AutoResumeResult {
  const wsRoot = root || resolveWorkspaceRoot();
  const azaDir = path.join(wsRoot, '.aza');
  const currentClient = detectClient().name;

  const noop: AutoResumeResult = {
    should_resume: false,
    action: 'noop',
    reason: 'No resume needed',
    client_switched: false,
    previous_client: 'unknown',
    current_client: currentClient,
    resume_stage: null,
    resume_iteration: 0,
    next_tool: null,
    next_action: null,
  };

  // 同步读取 RESUME.md（sync for boot — avoid async at module load）
  const resumePath = path.join(azaDir, 'RESUME.md');
  if (!fs.existsSync(resumePath)) {
    return noop;
  }

  try {
    const content = fs.readFileSync(resumePath, 'utf8');
    const fm = parseResumeFrontmatter(content);
    if (!fm) return noop;

    // 终态 / 全新开始 → noop
    if (isTerminalState(fm.stage, fm.next_action, fm.progress)) return noop;
    if (isFreshStart(fm.stage, fm.iteration)) return noop;

    // 版本不兼容 → restart
    if (!isEngineCompatible(fm.engine_version)) {
      return {
        ...noop,
        action: 'restart',
        reason: `Engine version mismatch: resume=${fm.engine_version} vs current=0.1.0`,
      };
    }

    // 客户端切换检测
    const switchResult = detectClientSwitch(fm.client);

    return {
      should_resume: true,
      action: 'resume',
      reason: switchResult.switched
        ? `Auto-resume: ${fm.client}→${currentClient}, stage=${fm.stage} (iter ${fm.iteration})`
        : `Auto-resume: stage=${fm.stage} (iter ${fm.iteration})`,
      client_switched: switchResult.switched,
      previous_client: fm.client,
      current_client: currentClient,
      resume_stage: fm.stage,
      resume_iteration: fm.iteration,
      next_tool: fm.next_tool,
      next_action: fm.next_action,
    };
  } catch {
    return noop;
  }
}
