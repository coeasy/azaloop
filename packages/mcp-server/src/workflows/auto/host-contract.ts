/**
 * vNext host-contract — the verified boundary between the autonomous
 * loop and the host AI that physically executes tools.
 *
 * 借鉴 agency-orchestrator「signed action contract」+ comet「host
 * verification」：
 *   - issue() 发放一个严格签名的 action（绑定 task_fingerprint）
 *   - executeReport() 在执行前校验 report 与 issued action 的
 *     身份一致（tool_name / task_fingerprint），不匹配直接拒绝，
 *     绝不调用 executor（不推进流程）
 *   - 一个 action 只接受一次 report；相同 report 命中缓存，
 *     不同 report 视为合约违反（防重放/篡改）
 *   - 所有路径做符号链接 / 目录穿越防护
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  HostActionV1Schema,
  HostReportV1Schema,
  type HostActionV1,
  type HostActionDraft,
  type HostReportV1,
} from '@azaloop/shared';

export class HostContractError extends Error {
  constructor(message: string) {
    super(`Host contract violation: ${message}`);
    this.name = 'HostContractError';
  }
}

interface IssuedActionRecord {
  action_id: string;
  task_fingerprint: string;
  kind: string;
  tool_name: string;
  instruction: string;
  acceptance: string[];
  status: 'issued' | 'completed';
  report_hash?: string;
  cached_response?: unknown;
}

const HOST_ACTIONS_DIR = 'host-actions';

function isSafeActionId(actionId: string): boolean {
  if (typeof actionId !== 'string' || actionId.length === 0) return false;
  // Reject path separators and traversal segments.
  return !actionId.includes('/') && !actionId.includes('\\') && !actionId.includes('..');
}

function canonicalReportHash(report: HostReportV1): string {
  const sorted = Object.keys(report)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (report as Record<string, unknown>)[key];
      return acc;
    }, {});
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export class HostActionLedger {
  private readonly azaDir: string;
  private readonly actionsDir: string;

  constructor(azaDir: string) {
    this.azaDir = path.resolve(azaDir);
    this.actionsDir = path.join(this.azaDir, HOST_ACTIONS_DIR);
  }

  private ensureActionsDir(): void {
    if (process.platform !== 'win32') {
      try {
        const stat = fs.lstatSync(this.actionsDir);
        if (stat.isSymbolicLink()) {
          throw new HostContractError(
            `${HOST_ACTIONS_DIR} must not be a symbolic link`,
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    fs.mkdirSync(this.actionsDir, { recursive: true });
  }

  private recordPath(actionId: string): string {
    const child = path.resolve(this.actionsDir, `${actionId}.json`);
    if (path.dirname(child) !== this.actionsDir) {
      throw new HostContractError(`action id escapes ${HOST_ACTIONS_DIR}: ${actionId}`);
    }
    return child;
  }

  private readRecord(actionId: string): IssuedActionRecord {
    if (!isSafeActionId(actionId)) {
      throw new HostContractError(`invalid action id: ${actionId}`);
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.recordPath(actionId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new HostContractError(`unknown action id: ${actionId}`);
      }
      throw error;
    }
    return JSON.parse(raw) as IssuedActionRecord;
  }

  private writeRecord(record: IssuedActionRecord): void {
    fs.writeFileSync(this.recordPath(record.action_id), JSON.stringify(record, null, 2), 'utf8');
  }

  /**
   * Issue a signed action bound to the task fingerprint.
   * Returns the v1 action object (with generated action_id).
   */
  async issue(action: HostActionDraft): Promise<HostActionV1> {
    this.ensureActionsDir();
    const actionId = randomUUID();
    const report = {
      tool: 'aza_loop',
      action: 'report_tool',
      action_id: actionId,
      task_fingerprint: action.task_fingerprint,
      tool_name: action.tool_name,
    };
    const parsed = HostActionV1Schema.parse({
      ...action,
      action_id: actionId,
      report,
    } as HostActionV1);
    const record: IssuedActionRecord = {
      ...parsed,
      status: 'issued',
    };
    this.writeRecord(record);
    return parsed;
  }

  /**
   * Verify a host report against the issued action, then execute it.
   *
   * - Rejects unknown / unsafe action ids before any execution.
   * - Rejects reports whose task_fingerprint / tool_name diverge from the
   *   issued action (before calling executor).
   * - One action accepts exactly one report. An identical replay hits
   *   the cache (executor not invoked); any deviation is a contract
   *   violation.
   */
  async executeReport(
    report: HostReportV1,
    executor: () => Promise<unknown>,
  ): Promise<unknown> {
    // Identity checks run BEFORE strict schema validation so a malformed
    // report (e.g. missing contract_version) still surfaces a /tool/
    // violation instead of a generic schema error.
    const record = this.readRecord(report.action_id);

    if (report.task_fingerprint !== record.task_fingerprint) {
      throw new HostContractError(
        `report task_fingerprint "${report.task_fingerprint}" does not match issued action "${record.task_fingerprint}"`,
      );
    }
    if (report.tool_name !== record.tool_name) {
      throw new HostContractError(
        `report tool_name "${report.tool_name}" does not match issued action tool "${record.tool_name}"`,
      );
    }

    const parsed = HostReportV1Schema.parse(report);

    if (record.status === 'completed') {
      const hash = canonicalReportHash(parsed);
      if (hash === record.report_hash) {
        return record.cached_response;
      }
      throw new HostContractError(
        `action ${record.action_id} already reported with a different report`,
      );
    }

    const response = await executor();
    const updated: IssuedActionRecord = {
      ...record,
      status: 'completed',
      report_hash: canonicalReportHash(parsed),
      cached_response: response,
    };
    this.writeRecord(updated);
    return response;
  }
}
