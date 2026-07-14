import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleTestLoop } from '../../packages/mcp-server/src/tools/aza-test-loop';

describe('v14-P9.2 aza test-loop', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-test-loop-'));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1) smoke scenario runs 3 steps and returns', async () => {
    const r = await handleTestLoop({ scenario: 'smoke', workspace_path: tmpDir });
    expect(r.success).toBe(true);
    const data = r.data as {
      passed: boolean;
      steps: Array<{ iteration: number }>;
      summary: string;
    };
    expect(data.passed).toBe(true);
    expect(data.steps.length).toBe(3);
    expect(data.steps[0]!.iteration).toBe(1);
    expect(data.summary).toMatch(/passed/);
  });

  it('2) full scenario runs the loop until completion or cap', async () => {
    const r = await handleTestLoop({ scenario: 'full', workspace_path: tmpDir });
    expect(r.success).toBe(true);
    const data = r.data as {
      passed: boolean;
      steps: Array<{ iteration: number }>;
      summary: string;
    };
    expect(data.passed).toBe(true);
    expect(data.steps.length).toBeGreaterThan(0);
  });

  it('3) sentinel scenario detects <promise>TASK_COMPLETE</promise>', async () => {
    const r = await handleTestLoop({ scenario: 'sentinel', workspace_path: tmpDir });
    expect(r.success).toBe(true);
    const data = r.data as {
      passed: boolean;
      steps: Array<{ action: string; reason: string }>;
      summary: string;
    };
    expect(data.passed).toBe(true);
    expect(data.steps[0]!.action).toBe('done');
    expect(data.steps[0]!.reason).toContain('sentinel');
  });

  it('4) unknown scenario returns a retry next_action', async () => {
    const r = await handleTestLoop({
      scenario: 'unknown' as never,
      workspace_path: tmpDir,
    });
    expect(r.success).toBe(false);
    expect(r.next_action?.action).toBe('retry');
  });
});
