/**
 * R12 P6 Plus8 (P1 主链路拆分第8轮) — DLP sub_action handler。
 *
 * 借鉴 shellward「8-layer DLP」+ aza-shellward-guard：
 * 把 aza-meta-ext.ts 中 14 行的 dlp 子命令块抽出为独立 handler。
 *
 * 支持的 sub_action：
 *   - dlp_scan（默认）    对内容做 8 层 DLP 预扫（secret / exfil / mcp_poisoning）
 *   - dlp_strict          严格模式（blockOnFail = true）
 */
import { runShellwardGuard } from '@azaloop/core';
import type { MetaActionContext, MetaActionHandler } from './context';
import { buildMetaResponse } from './response-builder';

export const dlpHandler: MetaActionHandler = (ctx: MetaActionContext) => {
  const { args } = ctx;
  const content = String(args.content || args.text || JSON.stringify(args.payload || {}));
  const strict = args.strict === true || String(args.sub_action || '') === 'dlp_strict';
  const result = runShellwardGuard(content, String(args.source || 'aza_meta.dlp_scan'), {
    blockOnFail: strict,
  });
  return buildMetaResponse({
    data: {
      passed: result.passed,
      strict,
      reason: result.reason,
      findings: result.findings,
      layers_run: result.layers_run,
    },
    // 注意：DLP scan 失败时 result.passed=false，但 success 仍要返回 true（meta 不强约束）
    // 由调用方根据 data.passed 决定是否拦截
  });
};
