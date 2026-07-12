import { detectClient, getClient, getAllClients, type ClientInfo } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * `aza_init` — one-shot project initialization from within the AI chat.
 *
 * Detects the current client, generates all required config files,
 * creates .aza directory structure, and returns a summary.
 */
export async function handleInit(workspacePath?: string, clientName?: string): Promise<LoopResponse> {
  const root = workspacePath ?? process.cwd();

  try {
    const client: ClientInfo = clientName ? getClient(clientName) : detectClient();

    // Create .aza directory
    const azaDir = path.join(root, '.aza');
    await fs.mkdir(azaDir, { recursive: true });

    const stateYaml = `pipeline:
  current_stage: open
  stages:
    open: { status: pending }
    design: { status: pending }
    build: { status: pending }
    verify: { status: pending }
    archive: { status: pending }
loop:
  iteration: 0
  progress: '0%'
  client: ${client.name}
  model: unknown
  max_iterations: 50
memory: { semantic_keys: [] }
security_findings: []
strikes: 0
updated_at: ${new Date().toISOString()}
`;
    await fs.writeFile(path.join(azaDir, 'STATE.yaml'), stateYaml, 'utf8');
    await fs.writeFile(path.join(azaDir, 'RESUME.md'), '# AzaLoop Resume\n\nProject initialized.\n', 'utf8');
    await fs.writeFile(path.join(azaDir, 'run-state.json'), '{}', 'utf8');

    return {
      success: true,
      data: {
        initialized: true,
        client: client.name,
        client_tier: client.tier,
        aza_dir: azaDir,
        files_created: [
          '.aza/STATE.yaml',
          '.aza/RESUME.md',
          '.aza/run-state.json',
        ],
        next_steps: [
          'Call aza_session_start to begin',
          'Then describe your requirements',
        ],
      },
      next_action: {
        tool: 'aza_session_start',
        action: 'next',
        reason: `Project initialized for ${client.name}. Call aza_session_start to begin.`,
      },
      metadata: {
        iteration: 0,
        progress: 'initialized',
        stage: 'open',
      },
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err.message,
      metadata: { iteration: 0, progress: 'error', stage: 'open' },
    };
  }
}
