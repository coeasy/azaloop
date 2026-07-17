import { StateManager } from '../packages/core/src/state/state-manager.ts';
import * as path from 'path';

async function main() {
  const aza = path.resolve('d:/workspace/aza_0716/azaloop-main/.aza');
  const sm = new StateManager(aza);
  await sm.load();
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
    loops: {
      outer: {
        board: {
          pending: [],
          in_progress: [],
          done: [
            'STORY-001',
            'STORY-002',
            'openspec:path-b-capability-refactor',
            'STORY-FULL-AUTO-FIX',
          ],
          blocked: [],
        },
      },
      phase: { current: 'archive', iteration: 0 },
    },
    loop: { iteration: 0, progress: '100%', current_story: '' },
  } as any);
  console.log('board cleaned');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
