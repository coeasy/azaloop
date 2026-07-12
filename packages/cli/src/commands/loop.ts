import { LoopController } from '@azaloop/core';
import * as path from 'path';

export interface LoopOptions {
  stage?: string;
  dir?: string;
}

export async function loopCommand(options: LoopOptions): Promise<void> {
  const azaDir = options.dir || path.join(process.cwd(), '.aza');
  const lc = new LoopController({
    enableV12: true,
    azaDir,
  });
  const result = await lc.next(options.stage as any);
  console.log(JSON.stringify(result, null, 2));
}
