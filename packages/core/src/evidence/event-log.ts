/**
 * R10 第11轮 (P5 审计) — EventLog 编辑追踪。
 *
 * 借鉴 superpowers「verification before completion」+ audit log 通用模式：
 *
 * 需求（来自 18 竞品文档）：
 *   - 每次 .aza/ 下文件变更都记录 actor / tool / action / hash / ts
 *   - 跨 session / 跨 client 累计可回放
 *   - 不依赖外部 DB，append-only JSONL
 *
 * 设计：
 *   - 单一文件 .aza/evidence/event-log.jsonl（追加）
 *   - 每行 = 一个 Event（含 hash chain，借鉴区块链思维）
 *   - 集成点：tool-orchestrator 中间件层 + batch / client-certify 工具
 *   - 查询 API：按 actor / tool / 时间窗口 / hash 链
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type EventKind =
  | 'tool_call'          // MCP 工具调用
  | 'tool_blocked'       // 中间件拦截
  | 'middleware_pass'    // 通过所有 middleware
  | 'middleware_fail'    // 拒绝
  | 'file_written'       // .aza/ 文件变更
  | 'file_read'          // 读取 .aza/ 文件
  | 'state_changed'      // state machine transition
  | 'capability_loaded'  // capability 加载
  | 'verify_pass'        // 验证通过
  | 'verify_fail'        // 验证失败
  | 'skill_gate'         // process skills 拦截
  | 'dlp_block'          // shellward 拦截
  | 'autonomy_block';    // autonomy gate 拦截

export interface AzaEvent {
  ts: string;
  kind: EventKind;
  actor: string;             // 客户端 + 模型（例: 'cursor+qwen2.5:7b'）
  tool?: string;
  action?: string;
  ref?: string;              // 文件路径 / story id / test name
  prevHash?: string;         // 上一事件 hash
  hash: string;              // 当前事件 hash
  detail?: Record<string, unknown>;
  note?: string;
}

export interface EventQuery {
  kind?: EventKind;
  tool?: string;
  actor?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export function computeHash(prev: string | undefined, body: object): string {
  const h = createHash('sha256');
  h.update(prev ?? '');
  h.update(JSON.stringify(body));
  return h.digest('hex').slice(0, 16);
}

/**
 * EventLog — append-only，hash-chained。
 */
export class EventLog {
  private filePath: string;
  private lastHash: string | undefined;
  private dirty = false;

  constructor(azaDir: string) {
    this.filePath = path.join(azaDir, 'evidence', 'event-log.jsonl');
  }

  private loadLastHash(): string | undefined {
    if (!fs.existsSync(this.filePath)) return undefined;
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
      if (lines.length === 0) return undefined;
      const lastLine = lines[lines.length - 1];
      if (!lastLine) return undefined;
      const last = JSON.parse(lastLine) as AzaEvent;
      return last.hash;
    } catch {
      return undefined;
    }
  }

  append(input: Omit<AzaEvent, 'ts' | 'hash' | 'prevHash'> & { ts?: string }): AzaEvent {
    if (!this.lastHash) this.lastHash = this.loadLastHash();
    const body = {
      ts: input.ts ?? new Date().toISOString(),
      kind: input.kind,
      actor: input.actor,
      tool: input.tool,
      action: input.action,
      ref: input.ref,
      detail: input.detail,
      note: input.note,
    };
    const hash = computeHash(this.lastHash, body);
    const event: AzaEvent = {
      ...body,
      ts: body.ts,
      prevHash: this.lastHash,
      hash,
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf8');
    this.lastHash = hash;
    this.dirty = false;
    return event;
  }

  readAll(): AzaEvent[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      return fs.readFileSync(this.filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as AzaEvent);
    } catch {
      return [];
    }
  }

  query(q: EventQuery): AzaEvent[] {
    let out = this.readAll();
    if (q.kind) out = out.filter((e) => e.kind === q.kind);
    if (q.tool) out = out.filter((e) => e.tool === q.tool);
    if (q.actor) out = out.filter((e) => e.actor === q.actor);
    if (q.since) out = out.filter((e) => e.ts >= q.since!);
    if (q.until) out = out.filter((e) => e.ts <= q.until!);
    if (q.limit) out = out.slice(-q.limit);
    return out;
  }

  /**
   * 校验 hash 链完整性。
   * 返回不一致的 index 列表（空数组 = 完整）。
   */
  verifyChain(): { valid: boolean; brokenIndices: number[]; totalEvents: number } {
    const events = this.readAll();
    let prev: string | undefined = undefined;
    const broken: number[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.prevHash !== prev) {
        broken.push(i);
      }
      const expected = computeHash(prev, {
        ts: e.ts,
        kind: e.kind,
        actor: e.actor,
        tool: e.tool,
        action: e.action,
        ref: e.ref,
        detail: e.detail,
        note: e.note,
      });
      if (expected !== e.hash) {
        broken.push(i);
      }
      prev = e.hash;
    }
    return { valid: broken.length === 0, brokenIndices: broken, totalEvents: events.length };
  }
}

/**
 * 单例：默认落盘到 .aza/evidence/event-log.jsonl
 */
export function defaultEventLog(workspaceRoot: string = process.cwd()): EventLog {
  return new EventLog(path.join(workspaceRoot, '.aza'));
}

/**
 * 便捷事件记录 helper — 让 middleware/business 只需一行调用。
 */
export function logEvent(
  workspaceRoot: string,
  kind: EventKind,
  payload: { tool?: string; action?: string; ref?: string; actor?: string; detail?: Record<string, unknown>; note?: string },
): AzaEvent {
  return defaultEventLog(workspaceRoot).append({
    kind,
    actor: payload.actor ?? process.env.AZA_ACTOR ?? `${process.env.AZA_CLIENT_NAME ?? 'unknown'}+${process.env.AZA_MODEL ?? 'unknown'}`,
    tool: payload.tool,
    action: payload.action,
    ref: payload.ref,
    detail: payload.detail,
    note: payload.note,
  });
}
