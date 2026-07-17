import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostActionLedger } from '../../packages/mcp-server/src/workflows/auto/host-contract';
import { executeVerifiedHostReport } from '../../packages/mcp-server/src/unified-handlers';

const roots: string[] = [];
const fingerprint = 'c'.repeat(32);

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-host-report-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe('host report boundary', () => {
  it('rejects malformed and mismatched reports before advancing the workflow', async () => {
    const workspace = root();
    const ledger = new HostActionLedger(path.join(workspace, '.aza'));
    const action = await ledger.issue({
      task_fingerprint: fingerprint,
      kind: 'implement',
      tool_name: 'aza_spec',
      instruction: 'implement the accepted plan',
      acceptance: ['tests pass'],
    });
    let steps = 0;
    const advance = async () => {
      steps += 1;
      return { host_action: null };
    };

    await expect(
      executeVerifiedHostReport(
        workspace,
        {
          action_id: action.action_id,
          task_fingerprint: fingerprint,
          tool_name: 'wrong_tool',
          evidence: ['not relevant'],
        },
        advance,
      ),
    ).rejects.toThrow(/tool/i);

    expect(steps).toBe(0);
  });

  it('advances once and returns the cached exact-shape v1 response for duplicate reports', async () => {
    const workspace = root();
    const ledger = new HostActionLedger(path.join(workspace, '.aza'));
    const action = await ledger.issue({
      task_fingerprint: fingerprint,
      kind: 'implement',
      tool_name: 'aza_spec',
      instruction: 'implement the accepted plan',
      acceptance: ['tests pass'],
    });
    const report = {
      action_id: action.action_id,
      task_fingerprint: fingerprint,
      tool_name: 'aza_spec',
      evidence: ['unit tests: 10/10'],
      payload: { changed: ['src/a.ts'] },
    };
    let steps = 0;
    const advance = async () => {
      steps += 1;
      return { host_action: null } as const;
    };

    const first = await executeVerifiedHostReport(workspace, report, advance);
    const duplicate = await executeVerifiedHostReport(workspace, report, advance);

    expect(first).toEqual({ host_action: null });
    expect(duplicate).toEqual(first);
    expect(steps).toBe(1);
    expect(Object.keys(first)).toEqual(['host_action']);
    expect(first).not.toHaveProperty('next_action');
    expect(first).not.toHaveProperty('data');
  });
});
