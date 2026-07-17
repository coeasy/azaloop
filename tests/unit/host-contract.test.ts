import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutoResponseV1Schema,
  HostActionV1Schema,
  HostReportV1Schema,
  type HostActionKindV1,
} from '../../packages/shared/src/schemas/auto-response.schema';
import {
  HostContractError,
  HostActionLedger,
} from '../../packages/mcp-server/src/workflows/auto/host-contract';

const roots: string[] = [];
const fingerprint = 'a'.repeat(32);

function tempAzaDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-host-contract-'));
  roots.push(root);
  return path.join(root, '.aza');
}

function draft(kind: HostActionKindV1 = 'implement') {
  return {
    task_fingerprint: fingerprint,
    kind,
    tool_name: kind === 'implement' ? 'aza_spec' : 'aza_loop',
    instruction: `execute ${kind}`,
    acceptance: [`${kind} completed with evidence`],
  } as const;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Host Contract v1 schemas', () => {
  it.each(['implement', 'run_command', 'inspect', 'repair'] as const)(
    'creates a strict %s action with report identity',
    async (kind) => {
      const action = await new HostActionLedger(tempAzaDir()).issue(draft(kind));
      expect(HostActionV1Schema.parse(action)).toEqual(action);
      expect(action.task_fingerprint).toBe(fingerprint);
      expect(action.report).toMatchObject({
        tool: 'aza_loop',
        action: 'report_tool',
        action_id: action.action_id,
        task_fingerprint: fingerprint,
        tool_name: draft(kind).tool_name,
      });
    },
  );

  it('rejects actions without task identity and rejects legacy response fields', () => {
    expect(() =>
      HostActionV1Schema.parse({ contract_version: '1', kind: 'implement' }),
    ).toThrow();
    expect(() =>
      AutoResponseV1Schema.parse({
        host_action: null,
        next_action: { tool: 'aza_loop', action: 'full' },
      }),
    ).toThrow();
  });

  it('requires action id, fingerprint, tool name, and evidence on reports', () => {
    expect(() => HostReportV1Schema.parse({ tool_name: 'aza_spec' })).toThrow();
    expect(() =>
      HostReportV1Schema.parse({
        contract_version: '1',
        action_id: 'action-1',
        task_fingerprint: fingerprint,
        tool_name: 'aza_spec',
        evidence: [],
      }),
    ).toThrow();
  });
});

describe('HostActionLedger', () => {
  it('persists issued, processing, and completed receipts atomically', async () => {
    const azaDir = tempAzaDir();
    const ledger = new HostActionLedger(azaDir);
    const action = await ledger.issue(draft());
    let calls = 0;
    const report = {
      contract_version: '1' as const,
      action_id: action.action_id,
      task_fingerprint: fingerprint,
      tool_name: 'aza_spec',
      evidence: ['tests passed'],
      payload: { commit: 'abc123' },
    };

    const response = await ledger.executeReport(report, async () => {
      calls += 1;
      return { host_action: null };
    });
    const record = JSON.parse(
      fs.readFileSync(path.join(azaDir, 'host-actions', `${action.action_id}.json`), 'utf8'),
    );

    expect(response).toEqual({ host_action: null });
    expect(calls).toBe(1);
    expect(record.status).toBe('completed');
    expect(record.report_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.cached_response).toEqual({ host_action: null });
    expect(fs.readdirSync(path.join(azaDir, 'host-actions'))).toEqual([
      `${action.action_id}.json`,
    ]);
  });

  it('returns the cached response for the same report across ledger instances without stepping', async () => {
    const azaDir = tempAzaDir();
    const first = new HostActionLedger(azaDir);
    const action = await first.issue(draft());
    const report = {
      contract_version: '1' as const,
      action_id: action.action_id,
      task_fingerprint: fingerprint,
      tool_name: 'aza_spec',
      evidence: ['build complete'],
      payload: { files: ['src/a.ts'] },
    };
    let calls = 0;
    const expected = { host_action: null } as const;

    await first.executeReport(report, async () => {
      calls += 1;
      return expected;
    });
    const replayed = await new HostActionLedger(azaDir).executeReport(report, async () => {
      calls += 1;
      throw new Error('must not step twice');
    });

    expect(replayed).toEqual(expected);
    expect(calls).toBe(1);
  });

  it.each([
    ['different payload', { evidence: ['different'] }],
    ['different fingerprint', { task_fingerprint: 'b'.repeat(32) }],
    ['different tool', { tool_name: 'aza_quality' }],
  ])('rejects %s before executor or state mutation', async (_label, override) => {
    const azaDir = tempAzaDir();
    const ledger = new HostActionLedger(azaDir);
    const action = await ledger.issue(draft());
    const report = {
      contract_version: '1' as const,
      action_id: action.action_id,
      task_fingerprint: fingerprint,
      tool_name: 'aza_spec',
      evidence: ['build complete'],
      payload: { files: 1 },
    };
    await ledger.executeReport(report, async () => ({ host_action: null }));
    const before = fs.readFileSync(
      path.join(azaDir, 'host-actions', `${action.action_id}.json`),
      'utf8',
    );
    let calls = 0;

    await expect(
      new HostActionLedger(azaDir).executeReport(
        { ...report, ...override },
        async () => {
          calls += 1;
          return { host_action: null };
        },
      ),
    ).rejects.toBeInstanceOf(HostContractError);

    expect(calls).toBe(0);
    expect(
      fs.readFileSync(path.join(azaDir, 'host-actions', `${action.action_id}.json`), 'utf8'),
    ).toBe(before);
  });

  it('rejects unknown action ids and path traversal before creating files', async () => {
    const azaDir = tempAzaDir();
    const ledger = new HostActionLedger(azaDir);
    let calls = 0;
    const base = {
      contract_version: '1' as const,
      task_fingerprint: fingerprint,
      tool_name: 'aza_spec',
      evidence: ['proof'],
    };

    for (const actionId of ['unknown-action', '../escape']) {
      await expect(
        ledger.executeReport({ ...base, action_id: actionId }, async () => {
          calls += 1;
          return { host_action: null };
        }),
      ).rejects.toBeInstanceOf(HostContractError);
    }

    expect(calls).toBe(0);
    expect(fs.existsSync(path.join(path.dirname(azaDir), 'escape.json'))).toBe(false);
  });

  it('rejects a symlinked host-actions directory', async () => {
    if (process.platform === 'win32') return;
    const azaDir = tempAzaDir();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-host-contract-outside-'));
    roots.push(outside);
    fs.mkdirSync(azaDir, { recursive: true });
    fs.symlinkSync(outside, path.join(azaDir, 'host-actions'), 'dir');

    await expect(new HostActionLedger(azaDir).issue(draft())).rejects.toBeInstanceOf(
      HostContractError,
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
