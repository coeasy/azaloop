/**
 * Autonomy levels — loop-engineering L1→L3 enforcement.
 * Reads azaloop.yaml via ConfigLoader (must be present in AzaloopConfigSchema).
 *
 * P0 竞品超越 (loop-engineering 对齐)：
 * - L1: 硬禁 implement/ship/finish
 * - L2: implement 允许；ship 必须 qualityPassed=true
 * - L3: 全自动
 */
import * as path from 'path';
import * as fs from 'fs';
import { ConfigLoader } from '../config/config-loader';
import type { AutonomyConfig } from '@azaloop/shared';

export type AutonomyLevel = 'L1' | 'L2' | 'L3';

export interface AutonomyDecision {
  allowed: boolean;
  level: AutonomyLevel;
  reason?: string;
  redirect?: { tool: string; action: string; reason: string };
}

export function loadAutonomy(workspaceRoot: string): AutonomyConfig {
  const loader = new ConfigLoader(workspaceRoot);
  const cfg = loader.loadSync();
  return cfg.autonomy ?? { level: 'L2', auto_approve_prd: false };
}

/**
 * Gate tool/action pairs against autonomy.level.
 *
 * L1: 硬禁 production implement + ship + finish work（仅 draft/report）
 * L2: implement ok；ship 必须 qualityPassed=true（硬检，借鉴 loop-engineering）
 * L3: 全自动
 *
 * 借鉴 loop-engineering「autonomy enforcement」：把 autonomy.level
 * 从文档声明升级为代码层硬门控。
 */
export function checkAutonomyGate(
  workspaceRoot: string,
  tool: string,
  action: string,
  opts?: { qualityPassed?: boolean },
): AutonomyDecision {
  const autonomy = loadAutonomy(workspaceRoot);
  const level = (autonomy.level || 'L2') as AutonomyLevel;
  const act = String(action || '').toLowerCase();
  const t = String(tool || '').toLowerCase();

  // L1: 硬禁 production 写码和 ship
  if (level === 'L1') {
    if (
      (t === 'aza_spec' && (act === 'implement' || act === 'apply')) ||
      (t === 'aza_finish' && (act === 'ship' || act === 'work' || act === 'archive'))
    ) {
      return {
        allowed: false,
        level,
        reason: `autonomy.level=L1 forbids ${t}(${act}) — draft/report only`,
        redirect: {
          tool: 'aza_prd',
          action: 'review',
          reason: 'Raise autonomy.level to L2+ in azaloop.yaml to write code',
        },
      };
    }
  }

  // L2: ship 必须 qualityPassed=true（硬检）
  if (level === 'L2') {
    if (t === 'aza_finish' && (act === 'ship' || act === 'archive')) {
      if (!opts?.qualityPassed) {
        const marker = path.join(workspaceRoot, '.aza', 'quality-passed.marker');
        const hasMarker = fs.existsSync(marker);
        if (!hasMarker) {
          return {
            allowed: false,
            level,
            reason: `autonomy.level=L2 requires qualityPassed=true for ${t}(${act}); no quality-passed.marker found`,
            redirect: {
              tool: 'aza_quality',
              action: 'check',
              reason: 'Run aza_quality check and produce quality-passed.marker before ship',
            },
          };
        }
      }
    }
  }

  // L3 + env auto-approve: sync process env for PRD gate consumers
  if (level === 'L3' && autonomy.auto_approve_prd) {
    process.env.AZA_AUTO_APPROVE_PRD = process.env.AZA_AUTO_APPROVE_PRD || 'true';
  }

  return { allowed: true, level };
}

export function resolveAzaDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.aza');
}
