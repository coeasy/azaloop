/**
 * L3 hard-continue: after host reports implement (or any tool),
 * inline quality → ship in the same MCP turn so the human is never asked.
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadAutonomy, StateManager, ResumeGenerator } from '@azaloop/core';

export function isHardContinueEnabled(workspace: string): boolean {
  if (process.env.AZA_HARD_CONTINUE === '0' || process.env.AZA_HARD_CONTINUE === 'false') {
    return false;
  }
  if (process.env.AZA_HARD_CONTINUE === '1' || process.env.AZA_AUTO_INLINE === '1') {
    return true;
  }
  try {
    const level = loadAutonomy(workspace || process.cwd()).level;
    if (level === 'L3') return true;
  } catch {
    /* fall through */
  }
  return process.env.AZA_AUTO_APPROVE_PRD === 'true';
}

export const HARD_CONTINUE_HOST_PROTOCOL =
  'hard_continue_to_ship_no_user_ask';

export const HARD_CONTINUE_FORBID_ASK =
  '禁止向用户确认是否继续、是否执行下一步、是否 ship。写码后立即 aza_spec(implement)→aza_loop(report_tool)；L3 将同轮硬续 quality+ship。';

function nextOf(r: any): { tool: string; action: string } | null {
  const na = r?.next_action || r?.data?.awaitingAction || r?.data?.awaiting_action;
  if (!na?.tool) return null;
  return { tool: String(na.tool), action: String(na.action || '') };
}

function stampProtocol(r: any, extra?: string): any {
  if (!r || typeof r !== 'object') return r;
  const data = { ...(r.data || {}) };
  data.host_protocol = HARD_CONTINUE_HOST_PROTOCOL;
  data.forbid_user_ask = true;
  data.hard_continue = data.hard_continue ?? false;
  const instruction = [data.instruction, HARD_CONTINUE_FORBID_ASK, extra]
    .filter(Boolean)
    .join(' ');
  data.instruction = instruction;
  if (r.next_action && typeof r.next_action === 'object') {
    r.next_action = {
      ...r.next_action,
      instruction: HARD_CONTINUE_FORBID_ASK,
      forbid_user_ask: true,
    };
  }
  r.data = data;
  return r;
}

/**
 * If next_action is quality/ship under L3, run them inline until shipped or blocked.
 */
export async function maybeHardContinueToShip(
  result: unknown,
  workspace: string | undefined,
  deps: {
    handleQualityCheck: (ws: string) => Promise<unknown>;
    handleAutoLoop: (
      action: string,
      stage: string | undefined,
      workspace: string | undefined,
      toolName?: string,
      client?: string,
    ) => Promise<unknown>;
    handleAzaFinish: (
      args: Record<string, unknown>,
      sm: InstanceType<typeof StateManager>,
      rg: InstanceType<typeof ResumeGenerator>,
    ) => Promise<unknown>;
    remapAutoLoop?: (r: unknown, ws?: string) => unknown;
  },
): Promise<unknown> {
  const root = workspace || process.cwd();
  let current: any = stampProtocol(result);

  if (!isHardContinueEnabled(root)) {
    return current;
  }

  const azaDir = path.join(root, '.aza');
  const sm = new StateManager(azaDir);
  const rg = new ResumeGenerator(azaDir);
  try {
    await sm.load();
  } catch {
    /* fresh */
  }

  const maxInline = Number(process.env.AZA_HARD_CONTINUE_MAX ?? 8);
  const steps: string[] = [];

  for (let i = 0; i < maxInline; i++) {
    const na = nextOf(current);
    if (!na) break;

    const isQuality =
      na.tool === 'aza_quality' && (na.action === 'check' || na.action === '' || na.action === 'run');
    const isShip =
      na.tool === 'aza_finish' &&
      (na.action === 'ship' || na.action === 'archive' || na.action === '');

    if (!isQuality && !isShip) {
      // Still paused (e.g. implement) — stamp forbid-ask and return
      return stampProtocol(current, `（硬续待命：当前需宿主执行 ${na.tool}(${na.action})）`);
    }

    try {
      if (isQuality) {
        steps.push('quality');
        const qMarker = path.join(azaDir, 'quality-passed.marker');
        let passed = fs.existsSync(qMarker);
        let q: any = null;
        if (!passed) {
          q = await deps.handleQualityCheck(root);
          passed =
            (q as any)?.success !== false && (q as any)?.data?.passed !== false;
        }
        let reported = await deps.handleAutoLoop(
          'report_tool',
          undefined,
          root,
          'aza_quality',
        );
        if (deps.remapAutoLoop) reported = deps.remapAutoLoop(reported, root);
        if (!passed) {
          return stampProtocol({
            success: false,
            data: {
              status: 'quality_failed',
              hard_continue: true,
              hard_continue_steps: steps,
              quality: q?.data,
              forbid_user_ask: true,
            },
            next_action: {
              tool: 'aza_spec',
              action: 'implement',
              reason: '质量门未过 — 修复代码后 aza_spec(implement)+report_tool；禁止询问用户',
              forbid_user_ask: true,
              instruction: HARD_CONTINUE_FORBID_ASK,
            },
          });
        }
        current = stampProtocol(reported);
        current.data = {
          ...(current.data || {}),
          hard_continue: true,
          hard_continue_steps: [...steps],
        };
        continue;
      }

      if (isShip) {
        steps.push('ship');
        const shipped = await deps.handleAzaFinish(
          {
            action: 'ship',
            workspace_path: root,
            stop_loop: true,
            work_summary: `L3 hard-continue ship (${steps.join('→')})`,
          },
          sm,
          rg,
        );
        return {
          success: true,
          data: {
            stage: 'archive',
            status: 'completed',
            shipped: true,
            hard_continue: true,
            hard_continue_steps: steps,
            forbid_user_ask: true,
            host_protocol: HARD_CONTINUE_HOST_PROTOCOL,
            finish: shipped,
            mode: 'l3_hard_continue',
          },
          next_action: {
            tool: 'aza_session',
            action: 'continue',
            reason: 'L3 硬续已 ship — 会话空闲；禁止再问用户',
            forbid_user_ask: true,
          },
          metadata: {
            progress: '100%',
            stage: 'archive',
            hard_continue: true,
          },
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return stampProtocol({
        success: false,
        error: `hard_continue_failed: ${msg}`,
        data: {
          ...(typeof current?.data === 'object' ? current.data : {}),
          hard_continue: true,
          hard_continue_steps: steps,
          hard_continue_error: msg,
        },
        next_action: current?.next_action,
      });
    }
  }

  if (current?.data) {
    current.data.hard_continue = true;
    current.data.hard_continue_steps = steps;
  }
  return stampProtocol(current);
}
