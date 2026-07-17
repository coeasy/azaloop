/**
 * R12 P6 (P1 主编排解耦) — Meta Workflow 子模块。
 *
 * 借鉴 spec-kit「executable specification」+ agency-orchestrator「workflow runtime」：
 *
 * 痛点：unified-handlers.ts 中 handleAzaMeta 474 行；case 块散落：
 *   - loop_ready  (L1199-1300, 100 行)
 *   - plugin (L1304-1310)
 *   - worktree/swarm (L1311-1326)
 *   - competitive_refresh (L1327-1352)
 *   - stores/dlp (L1353-1361)
 *   - presets (L1362-1390)
 *   - constitution (L1391-1415)
 *   - federation (L1416-1445)
 *   - cost (L1446-1450)
 *   - test_loop (L1451-1455)
 *
 * 解法：把每个 case 块抽到独立函数；handleAzaMeta 退化为 dispatch。
 */
import * as path from 'node:path';
import {
  applyPreset,
  listPresets,
  loadFederation,
  syncFederationDigest,
  registerFederationPeer,
  readConstitution,
  ensureConstitution,
  writeConstitution,
  runCompetitiveResearch,
  loadAutonomy,
} from '@azaloop/core';
import {
  handleMetaWorktree,
  handleMetaSwarm,
  handleMetaStores,
  handleMetaDlp,
} from '../../tools/aza-meta-ext';
import { handleCost } from '../../tools/aza-cost';
import { handleBudget } from '../../tools/aza-budget';
import { handleAudit } from '../../tools/aza-audit';
import { handlePlugin } from '../../tools/aza-plugin';
import { handleTestLoop } from '../../tools/aza-test-loop';
import { handleSkillSearch, handleSkillList } from '../../tools/aza-skill';
import {
  handleRunstateStatus,
  handleRunstateUpdate,
  handleAuditLogRecent,
  handleAuditLogSearch,
} from '../../tools/aza-runstate';

export function dispatchMetaWorktree(args: Record<string, unknown>, action: string): unknown {
  if (action === 'worktree_list') args.sub_action = 'list';
  if (action === 'worktree_create') args.sub_action = 'create';
  if (action === 'worktree_remove') args.sub_action = 'remove';
  return handleMetaWorktree(args);
}

export function dispatchMetaSwarm(args: Record<string, unknown>, action: string): unknown {
  if (action === 'swarm_dispatch') args.sub_action = 'dispatch';
  if (action === 'swarm_report') args.sub_action = 'report';
  if (action === 'swarm_status') args.sub_action = 'status';
  return handleMetaSwarm(args);
}

export function dispatchMetaStores(args: Record<string, unknown>, action: string): unknown {
  if (action === 'stores_put') args.sub_action = 'put';
  if (action === 'stores_search') args.sub_action = 'search';
  return handleMetaStores(args);
}

export async function handleCompetitiveRefresh(
  workspace: string | undefined,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = workspace || process.cwd();
  const aza = `${root.replace(/[\\/]$/, '')}/.aza`;
  const query = String(args.query || args.title || args.focus || 'azaloop agent loop');
  const result = await runCompetitiveResearch(aza, query, query, {
    force: true,
    complexity: 'L2',
  });
  return {
    success: true,
    data: {
      refreshed: !result.fromCache,
      fromCache: result.fromCache,
      mode: result.mode,
      skipped: result.skipped,
      competitors: result.research?.competitors?.slice?.(0, 8) || [],
      artifact: '.aza/competitive-research.md',
    },
    next_action: { tool: 'aza_prd', action: 'review', reason: 'Competitive cache refreshed — continue PRD review' },
  };
}

export async function handlePresetsList(workspace: string | undefined): Promise<unknown> {
  const root = workspace || process.cwd();
  return {
    success: true,
    data: { presets: listPresets(root) },
    next_action: { tool: 'aza_meta', action: 'preset_apply', reason: 'Apply a preset via aza_meta(action=preset_apply, preset_id=...)' },
  };
}

export async function handlePresetApply(workspace: string | undefined, args: Record<string, unknown>): Promise<unknown> {
  const root = workspace || process.cwd();
  const id = String(args.preset_id || args.id || 'full-auto');
  const preset = applyPreset(root, id);
  return {
    success: true,
    data: { applied: preset },
    next_action: { tool: 'aza_session', action: 'calibrate', reason: `Preset ${id} applied — recalibrate session` },
  };
}

export async function handleConstitutionRead(workspace: string | undefined): Promise<unknown> {
  const root = workspace || process.cwd();
  ensureConstitution(root);
  return {
    success: true,
    data: { path: '.aza/constitution.md', content: readConstitution(root) },
    next_action: { tool: 'aza_prd', action: 'review', reason: 'Constitution loaded — continue PRD' },
  };
}

export async function handleConstitutionWrite(workspace: string | undefined, args: Record<string, unknown>): Promise<unknown> {
  const root = workspace || process.cwd();
  const content = String(args.content || '');
  if (!content.trim()) {
    return { success: false, error: 'content required for constitution_write' };
  }
  writeConstitution(root, content);
  return {
    success: true,
    data: { path: '.aza/constitution.md' },
    next_action: { tool: 'aza_session', action: 'calibrate', reason: 'Constitution updated' },
  };
}

export async function handleFederationStatus(workspace: string | undefined): Promise<unknown> {
  const root = workspace || process.cwd();
  return {
    success: true,
    data: loadFederation(root),
    next_action: { tool: 'aza_loop', action: 'status', reason: 'Federation digest loaded' },
  };
}

export async function handleFederationSync(workspace: string | undefined, args: Record<string, unknown>): Promise<unknown> {
  const root = workspace || process.cwd();
  if (args.peer_id && args.shared_aza) {
    registerFederationPeer(root, {
      id: String(args.peer_id),
      label: String(args.peer_label || args.peer_id),
      shared_aza: String(args.shared_aza),
    });
  }
  const peerId = String(args.peer_id || '');
  const result = peerId
    ? syncFederationDigest(root, peerId)
    : { ok: false, detail: 'peer_id required for federation_sync' };
  return {
    success: result.ok,
    data: result,
    next_action: { tool: 'aza_loop', action: 'status', reason: 'Federation synced' },
  };
}

/**
 * Loop Ready 评分 — 取代 handleAzaMeta 中 100+ 行的 loop_ready case
 */
export async function handleLoopReady(workspace: string | undefined): Promise<unknown> {
  const pathMod = await import('path');
  const fs = await import('fs');
  const root = workspace || process.cwd();
  const aza = pathMod.join(root, '.aza');
  let autonomyLevel = 'L2';
  try {
    autonomyLevel = loadAutonomy(root).level;
  } catch {
    autonomyLevel = process.env.AZA_AUTO_APPROVE_PRD === 'true' ? 'L3' : 'L2';
  }

  // 评分：state 完整 + PRD 已审 + capability verified + quality 通过
  let score = 60;
  const suggest: string[] = [];
  if (fs.existsSync(`${aza}/STATE.yaml`)) score += 10;
  else suggest.push('STATE.yaml missing — call aza_session(calibrate)');
  if (fs.existsSync(`${aza}/prd.md`)) score += 10;
  else suggest.push('prd.md missing — call aza_prd(draft)');
  if (fs.existsSync(`${aza}/quality-passed.marker`)) score += 10;
  else suggest.push('quality-passed.marker missing — call aza_quality(check)');
  if (autonomyLevel === 'L3') score += 10;
  if (score > 100) score = 100;
  return {
    success: true,
    data: {
      score,
      autonomy_level: autonomyLevel,
      ready: score >= 80,
      suggest: suggest.slice(0, 5),
    },
    next_action:
      score >= 80
        ? { tool: 'aza_auto', action: 'run', reason: `Loop Ready ${score}/100 — start aza_auto` }
        : {
            tool: 'aza_meta',
            action: 'loop_ready',
            reason: `Loop Ready ${score}/100 — address suggest[] (${suggest.length} items)`,
          },
  };
}

export function dispatchCost(action: string, args: Record<string, unknown>): unknown {
  if (action === 'cost_consume') return handleCost({ ...args, action: 'consume' });
  return handleCost({ ...args, action: 'status' });
}

export function dispatchPlugin(action: string, args: Record<string, unknown>): unknown {
  if (action === 'plugin_list') return handlePlugin({ ...args, action: 'list' } as unknown as Parameters<typeof handlePlugin>[0]);
  if (action === 'plugin_load') return handlePlugin({ ...args, action: 'load' } as unknown as Parameters<typeof handlePlugin>[0]);
  if (action === 'plugin_unload') return handlePlugin({ ...args, action: 'unload' } as unknown as Parameters<typeof handlePlugin>[0]);
  return handlePlugin(args as unknown as Parameters<typeof handlePlugin>[0]);
}

export function dispatchTestLoop(args: Record<string, unknown>): unknown {
  const scenarioRaw = (args.scenario as string) || 'smoke';
  const validScenarios = ['smoke', 'l3', 'cross-client'];
  const validSet = new Set(validScenarios);
  const scenario = validSet.has(scenarioRaw) ? scenarioRaw : 'smoke';
  return handleTestLoop({ ...args, scenario } as unknown as Parameters<typeof handleTestLoop>[0]);
}

export {
  handleSkillSearch,
  handleSkillList,
  handleRunstateStatus,
  handleRunstateUpdate,
  handleAuditLogRecent,
  handleAuditLogSearch,
  handleBudget,
  handleAudit,
  handleMetaDlp,
};
