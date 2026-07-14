/**
 * v14 — P8.6: aza_plugin — plugin loader/unloader tool.
 *
 * Exposes the `PluginLoader` as an MCP tool so clients can dynamically
 * load third-party plugins from `.aza/plugins/*.yaml` manifests.
 *
 * Actions:
 *   - `load`    — read + validate + register a plugin from a path.
 *   - `unload`  — detach a previously-registered plugin by name.
 *   - `list`    — list all registered plugins in this workspace.
 *
 * State is persisted in `.aza/plugins.json` so handles survive across
 * MCP calls within the same workspace.
 *
 * Reference:
 *   • ruvnet/ruflo v3.10.33 — `plugins/` directory loader.
 */

import { EventBus, loadPlugin, type PluginHandle } from '@azaloop/core';
import type { LoopResponse } from '@azaloop/shared';
import * as fs from 'fs';
import * as path from 'path';

export interface PluginInput {
  action: 'load' | 'unload' | 'list';
  /** Manifest path (for action='load'). */
  path?: string;
  /** Plugin name (for action='unload'). */
  name?: string;
  /** Working directory (defaults to process.cwd()). */
  workspace_path?: string;
}

export interface PluginResult {
  action: 'load' | 'unload' | 'list';
  plugins: Array<{ name: string; version: string; hooks: string[] }>;
  message: string;
  error?: string;
}

const STATE_FILE = 'plugins.json';
const REGISTRY: Map<string, { handle: PluginHandle; bus: EventBus }> = new Map();

interface PersistedPlugin {
  name: string;
  version: string;
  hooks: string[];
  manifestPath: string;
}

function loadPersisted(azaDir: string): PersistedPlugin[] {
  const fp = path.join(azaDir, STATE_FILE);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8')) as PersistedPlugin[];
  } catch {
    return [];
  }
}

function savePersisted(azaDir: string, plugins: PersistedPlugin[]): void {
  const fp = path.join(azaDir, STATE_FILE);
  try {
    fs.mkdirSync(azaDir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(plugins, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

function snapshot(): PersistedPlugin[] {
  return Array.from(REGISTRY.values()).map((v) => ({
    name: v.handle.name,
    version: v.handle.version,
    hooks: [...v.handle.hooks],
    manifestPath: '',
  }));
}

export async function handlePlugin(input: PluginInput): Promise<LoopResponse> {
  const workspace = input.workspace_path ?? process.cwd();
  const azaDir = path.join(workspace, '.aza');
  const action = input.action ?? 'list';

  if (action === 'load') {
    if (!input.path) {
      return {
        success: false,
        data: null,
        next_action: { tool: 'aza_plugin', action: 'retry', reason: 'load requires a `path` argument' },
        metadata: { iteration: 0, progress: '0%', stage: 'build' },
      };
    }
    const bus = new EventBus();
    const r = loadPlugin({ sourcePath: input.path, eventBus: bus });
    if (!r.ok || !r.handle) {
      return {
        success: false,
        data: { action: 'load', plugins: snapshot(), message: 'load failed', error: r.reason },
        next_action: { tool: 'aza_plugin', action: 'retry', reason: r.reason ?? 'load failed' },
        metadata: { iteration: 0, progress: '0%', stage: 'build' },
      };
    }
    REGISTRY.set(r.handle.name, { handle: r.handle, bus });
    savePersisted(azaDir, snapshot());
    return {
      success: true,
      data: {
        action: 'load',
        plugins: snapshot(),
        message: `✓ Loaded plugin '${r.handle.name}' v${r.handle.version} (${r.handle.hooks.length} hooks)`,
      },
      next_action: { tool: 'aza_plugin', action: 'continue', reason: 'plugin loaded' },
      metadata: { iteration: 0, progress: '100%', stage: 'build' },
    };
  }

  if (action === 'unload') {
    if (!input.name) {
      return {
        success: false,
        data: null,
        next_action: { tool: 'aza_plugin', action: 'retry', reason: 'unload requires a `name` argument' },
        metadata: { iteration: 0, progress: '0%', stage: 'build' },
      };
    }
    const entry = REGISTRY.get(input.name);
    if (!entry) {
      return {
        success: false,
        data: { action: 'unload', plugins: snapshot(), message: 'plugin not found', error: input.name },
        next_action: { tool: 'aza_plugin', action: 'retry', reason: `plugin '${input.name}' not registered` },
        metadata: { iteration: 0, progress: '0%', stage: 'build' },
      };
    }
    entry.handle.unregister();
    REGISTRY.delete(input.name);
    savePersisted(azaDir, snapshot());
    return {
      success: true,
      data: {
        action: 'unload',
        plugins: snapshot(),
        message: `✓ Unloaded plugin '${input.name}'`,
      },
      next_action: { tool: 'aza_plugin', action: 'continue', reason: 'plugin unloaded' },
      metadata: { iteration: 0, progress: '100%', stage: 'build' },
    };
  }

  // list
  // Reconcile with persisted state in case the process restarted
  const persisted = loadPersisted(azaDir);
  return {
    success: true,
    data: {
      action: 'list',
      plugins: REGISTRY.size > 0 ? snapshot() : persisted,
      message: REGISTRY.size > 0
        ? `${REGISTRY.size} plugin(s) registered in this session`
        : `${persisted.length} plugin(s) persisted from previous session`,
    },
    next_action: { tool: 'aza_plugin', action: 'continue', reason: 'listed' },
    metadata: { iteration: 0, progress: '0%', stage: 'build' },
  };
}
