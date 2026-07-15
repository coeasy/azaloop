import type { LoopResponse } from '@azaloop/shared';
import { CHANGE_FOLDER_FINGERPRINT, PRDChecker } from '@azaloop/core';
import { resolveWorkspaceRoot } from '../index';
import * as path from 'path';
import * as fs from 'fs';

const startTime = Date.now();
const BOOT_STAMP = new Date().toISOString();

export async function handleHealthCheck(): Promise<LoopResponse> {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const workspace = resolveWorkspaceRoot();
  const checker = new PRDChecker();
  const shallow = checker.check({
    id: 'health-probe',
    title: 'Health',
    version: '1.0.0',
    created_at: BOOT_STAMP,
    updated_at: BOOT_STAMP,
    overview: 'short',
    goals: [],
    target_users: [],
    functional_requirements: [],
    non_functional_requirements: [],
    stories: [],
    architecture: [],
    acceptance_criteria: [],
    risks: [],
  } as any);

  const projectAza = path.join(workspace, '.aza');
  const fingerprintOk = CHANGE_FOLDER_FINGERPRINT === 'lean-three-piece-v1-no-contract-embed';
  const workspaceOk =
    /azaloop/i.test(workspace) &&
    !/\\Users\\[^\\]+$/.test(workspace.replace(/[\\/]+$/, '')) &&
    fs.existsSync(projectAza);

  return {
    success: true,
    data: {
      status: 'healthy',
      version: '0.1.0',
      uptime_seconds: uptime,
      memory_usage: process.memoryUsage().heapUsed,
      boot_stamp: BOOT_STAMP,
      workspace,
      cwd: process.cwd(),
      aza_dir: projectAza,
      env: {
        AZA_WORKSPACE: process.env.AZA_WORKSPACE || null,
        AZA_BUILD_STAMP: process.env.AZA_BUILD_STAMP || null,
      },
      core: {
        change_folder_fingerprint: CHANGE_FOLDER_FINGERPRINT,
        prd_gate: {
          probe_passed: shallow.passed,
          probe_expects_fail: true,
          fingerprint: 'prd-gate-p0p1-score90',
        },
      },
      effective: fingerprintOk && shallow.passed === false && workspaceOk,
    },
    metadata: { iteration: 0, progress: '', stage: '' },
  };
}
