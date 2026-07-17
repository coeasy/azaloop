import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateManager } from '../../packages/core/src/state/state-manager';

describe('atomicWriteState Windows fallback', () => {
  let tmp: string;
  let aza: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aza-atomic-'));
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

  it('writes content even when rename would race (overwrite path)', async () => {
    const sm = new StateManager(aza);
    const target = path.join(aza, 'probe.txt');
    await sm.atomicWriteState(target, 'hello-1');
    expect(fs.readFileSync(target, 'utf8')).toBe('hello-1');
    await sm.atomicWriteState(target, 'hello-2');
    expect(fs.readFileSync(target, 'utf8')).toBe('hello-2');
    expect(fs.existsSync(target + '.tmp')).toBe(false);
  });
});
