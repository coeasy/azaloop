import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MCPEventSimulator } from '../../packages/core/src/continuity/mcp-event-simulator';
import { StateManager } from '../../packages/core/src/state/state-manager';
import { ResumeGenerator } from '../../packages/core/src/continuity/resume-generator';
import { EventBus } from '../../packages/core/src/Hook/event-bus';
import { StrikeSystem } from '../../packages/core/src/L4_discipline/strike-system';

describe('idle next_action after archive@100%', () => {
  let tmp: string;
  let aza: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-idle-'));
    aza = path.join(tmp, '.aza');
    fs.mkdirSync(aza, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('points to aza_auto run instead of ship', async () => {
    const sm = new StateManager(aza);
    await sm.update({
      pipeline: {
        current_stage: 'archive',
        stages: {
          open: { status: 'completed' },
          design: { status: 'completed' },
          build: { status: 'completed' },
          verify: { status: 'completed' },
          archive: { status: 'completed' },
        },
      },
      loop: { iteration: 1, progress: '100%', current_story: '' },
    } as any);
    const sim = new MCPEventSimulator(
      new EventBus(),
      sm,
      new ResumeGenerator(aza),
      new StrikeSystem(),
      aza,
    );
    const post = await sim.simulatePostTool('aza_session', { success: true });
    expect(post.nextAction.tool).toBe('aza_auto');
    expect(post.nextAction.action).toBe('run');
    expect(String(post.nextAction.reason)).toMatch(/aza_auto|新需求|已交付/);
  });
});
