/**
 * R12 P6 Plus17 (P1 主链路拆分第17轮) — Auto-Loop 响应重映射 + Soft-Recover 门控。
 *
 * 借鉴 gstack「soft-recover counter」+ Trellis「escalate guard」+ comet「next_action router」：
 * 把 unified-handlers.ts 中 122 行的 remapNext + remapAutoLoop + softRecoverCounts +
 * SOFT_RECOVER_MAX + breakLoop 串联逻辑抽到独立模块。
 *
 * 核心职责：
 * 1. **remapNext** — 把响应中的 next_action（含老 50 tool 名）重写为 8 unified tool
 * 2. **remapAutoLoop** — auto-loop 专用 remap（awaitingAction → next_action + soft-recover gate）
 * 3. **softRecoverCounts** — 每 workspace 的 soft-recover 计数器（防止 reset storm）
 * 4. **trySoftRecover()** — 单独 try soft-recover（N 次后真实 escalate）
 * 5. **clearSoftRecover()** — 成功路径清空计数器
 * 6. **persistBreakLoop()** — soft-recover 耗尽时持久化 break-loop note
 */
import { breakLoop } from '@azaloop/core';
import { remapToolAction, UNIFIED_TOOLS_SET } from './legacy-router';

// ── 1. remapNext — 通用 next_action 重写 ──

/**
 * 重写响应中的 next_action（兼容老 50 tool 名）。
 * 保留 data + metadata + response shape。
 *
 * 兼容老 composite tool 名称（如 aza_task_design / aza_doc_generate）。
 * 旧 composite tool 必须包含至少一个下划线才视为老格式。
 */
export function remapNext(
  result: unknown,
  onSuccess: { tool: string; action: string },
  onFail?: { tool: string; action: string },
): unknown {
  const r = result as any;
  if (!r || typeof r !== 'object') return result;

  const remapOne = (na: any) => {
    if (!na || typeof na.tool !== 'string') return na;
    const mapped = remapToolAction(na.tool, na.action);
    if (mapped) return { ...na, ...mapped };
    // Unknown legacy composite — only then fall back to onSuccess/onFail
    if (na.tool.startsWith('aza_') && na.tool.includes('_') && !UNIFIED_TOOLS_SET.has(na.tool)) {
      const target = r.success === false && onFail ? onFail : onSuccess;
      return {
        ...na,
        tool: target.tool,
        action: na.action === 'wait' ? 'wait' : target.action,
      };
    }
    return na;
  };

  if (r.next_action) r.next_action = remapOne(r.next_action);
  if (r.data?.next_action) r.data.next_action = remapOne(r.data.next_action);
  if (r.data?.awaitingAction) r.data.awaitingAction = remapOne(r.data.awaitingAction);
  return result;
}

// ── 2. Soft-Recover counter + gate ──

/** Soft-recover escalate 次数上限（每 workspace） */
export const SOFT_RECOVER_MAX = 3;

/** 每 workspace 的 soft-recover 计数 */
const softRecoverCounts = new Map<string, number>();

/** 检测是否触发 soft-recover（escalate + 错误模式匹配） */
export function isSoftRecoverTrigger(nextAction: { action?: string; reason?: string }): boolean {
  if (nextAction?.action !== 'escalate') return false;
  const reason = String(nextAction.reason || '');
  return /consecutive stage failures|Circuit breaker tripped|No progress/i.test(reason);
}

/** 增加 soft-recover 计数，返回新计数 */
export function incrementSoftRecover(workspaceKey?: string): number {
  const key = workspaceKey || 'default';
  const count = (softRecoverCounts.get(key) || 0) + 1;
  softRecoverCounts.set(key, count);
  return count;
}

/** 清空 soft-recover 计数（成功路径） */
export function clearSoftRecover(workspaceKey?: string): void {
  softRecoverCounts.delete(workspaceKey || 'default');
}

/** 持久化 break-loop note（soft-recover 耗尽时调用） */
export async function persistBreakLoop(
  nextAction: { reason?: string; action?: string },
  metadata: { stage?: string; iteration?: number } | undefined,
  workspaceKey: string | undefined,
  count: number,
): Promise<void> {
  const root = workspaceKey || process.cwd();
  const azaDir = root.endsWith('.aza') ? root : `${root.replace(/[\\/]$/, '')}/.aza`;
  const reason = String(nextAction.reason || '');
  try {
    await breakLoop(
      {
        // breakLoop expects a real Stage; fall back to 'open' when metadata is missing
        stage: (metadata?.stage as any) || 'open',
        iteration: metadata?.iteration || 0,
        error: reason,
        lastAction: { tool: 'aza_loop', action: 'escalate', reason },
        strikeCount: count,
      },
      azaDir,
    );
  } catch {
    /* best-effort */
  }
}

// ── 3. remapAutoLoop — auto-loop 专用 remap ──

/**
 * Auto-loop 响应 remap：等待动作优先化 + soft-recover gate。
 *
 * 1. 把 next_action 中老 50 tool 名重写为 8 unified tool
 * 2. 若有 awaitingAction（host 必须执行），提升为 next_action
 * 3. 若 next_action 是 escalate 且触发条件，soft-recover N 次后真实 escalate
 * 4. 成功路径（非 escalate/reset/stop）清空 soft-recover 计数
 */
export function remapAutoLoop(result: unknown, workspaceKey?: string): unknown {
  const r = result as any;
  if (!r?.next_action && !r?.data?.awaitingAction) return result;

  const remapOne = (na: any) => {
    if (!na || typeof na.tool !== 'string') return na;
    const mapped = remapToolAction(na.tool, na.action);
    return mapped ? { ...na, ...mapped } : na;
  };

  if (r.next_action) r.next_action = remapOne(r.next_action);
  if (r.data?.next_action) r.data.next_action = remapOne(r.data.next_action);
  if (r.data?.awaitingAction) r.data.awaitingAction = remapOne(r.data.awaitingAction);
  if (r.data?.awaiting_action) r.data.awaiting_action = remapOne(r.data.awaiting_action);

  // Prefer awaitingAction as next_action when host must execute a tool
  const awaitTool = r.data?.awaitingAction || r.data?.awaiting_action;
  if (awaitTool?.tool) {
    const instruction = awaitTool.instruction || r.next_action?.instruction;
    r.next_action = {
      tool: awaitTool.tool,
      action: awaitTool.action,
      reason: awaitTool.reason || r.next_action?.reason || `Execute ${awaitTool.tool} then aza_loop(report_tool)`,
      ...(instruction ? { instruction } : {}),
    };
  }

  // Soft-recover transient escalate — capped to avoid reset storms
  const na = r.next_action;
  if (isSoftRecoverTrigger(na)) {
    const reason = String(na.reason || '');
    const count = incrementSoftRecover(workspaceKey);
    if (count > SOFT_RECOVER_MAX) {
      r.data = {
        ...(r.data || {}),
        soft_recovered: false,
        soft_recover_exhausted: true,
        escalate_reason: reason,
        soft_recover_count: count,
      };
      r.next_action = {
        tool: 'aza_loop',
        action: 'stop',
        reason: `Escalate after ${SOFT_RECOVER_MAX} soft-resets: ${reason}`,
      };
      r.success = false;
      // Persist break-loop note (planning-with-files / loop-audit pattern)
      void persistBreakLoop(na, r.metadata, workspaceKey, count);
      return result;
    }
    r.data = {
      ...(r.data || {}),
      soft_recovered: true,
      escalate_reason: reason,
      soft_recover_count: count,
    };
    r.next_action = {
      tool: 'aza_loop',
      action: 'reset',
      reason: `Soft-recover (${count}/${SOFT_RECOVER_MAX}): ${reason} — reset caches then continue full loop`,
    };
    r.success = true;
    return result;
  }

  // Successful non-escalate clears soft-recover counter
  if (
    na?.action &&
    na.action !== 'escalate' &&
    na.action !== 'reset' &&
    na.action !== 'stop'
  ) {
    clearSoftRecover(workspaceKey);
  }
  return result;
}
