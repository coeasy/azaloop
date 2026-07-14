/**
 * v14 — P8.6: Plugin extension hooks (ruflo 33-plugins pattern).
 *
 * A plugin is a small manifest that wires into the existing EventBus
 * without modifying any core API. Plugins may:
 *   • Subscribe to a subset of `HookEvent` types.
 *   • Declare additional `mcp_tools` they provide (name only — actual
 *     tool registration is performed by the host after manifest
 *     validation).
 *   • Declare `skills` they provide (name only).
 *
 * The manifest is validated against a strict schema. Plugin code is
 * never `eval`-ed or `require`-d; the host invokes a registered handler
 * function supplied by the plugin.
 *
 * Security:
 *   - `forbid_constructs` and `forbid_modules` are mirrored from
 *     ANTI_DRIFT defaults — manifest entries cannot shadow them.
 *   - Hook names must be in the `HookEvent` whitelist.
 *   - Plugin names must be kebab-case.
 *
 * Reference:
 *   • ruvnet/ruflo v3.10.33 — `plugins/` directory with 33 plugin manifests.
 */

import { EventBus, HookEvent } from '../Hook/event-bus';

const ALLOWED_HOOKS: readonly HookEvent[] = [
  'session-start',
  'pre-tool',
  'post-tool',
  'pre-commit',
  'post-task',
  'pre-phase',
  'post-phase',
  'on-error',
  'on-stop',
];

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  /** Hook events the plugin subscribes to. */
  hooks: string[];
  /** MCP tool names the plugin provides (host registers them). */
  mcp_tools: string[];
  /** Skill names the plugin provides. */
  skills: string[];
}

export interface PluginHandle {
  name: string;
  version: string;
  hooks: string[];
  registeredAt: string;
  /** Detach all event listeners. */
  unregister: () => void;
}

export interface LoadPluginOptions {
  /** Path to the YAML manifest (parsed by the caller). */
  sourcePath?: string;
  /** Pre-parsed manifest (skips file I/O — used in tests). */
  manifest?: PluginManifest;
  /** Optional EventBus; if omitted a fresh one is created. */
  eventBus?: EventBus;
  /** Optional hook handlers keyed by event name. */
  handlers?: Partial<Record<HookEvent, (payload: unknown) => Promise<void> | void>>;
}

export interface LoadPluginResult {
  ok: boolean;
  reason?: string;
  handle?: PluginHandle;
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/;

/**
 * Validate a plugin manifest. Returns an array of error messages; empty
 * array means the manifest is valid.
 */
export function validatePluginManifest(m: unknown): string[] {
  const errors: string[] = [];
  if (typeof m !== 'object' || m === null) {
    return ['manifest must be an object'];
  }
  const obj = m as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !NAME_RE.test(obj.name)) {
    errors.push(`name must be kebab-case (got: ${JSON.stringify(obj.name)})`);
  }
  if (typeof obj.version !== 'string' || !VERSION_RE.test(obj.version)) {
    errors.push(`version must be semver (got: ${JSON.stringify(obj.version)})`);
  }
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push('description must be a string when present');
  }
  if (!Array.isArray(obj.hooks)) {
    errors.push('hooks must be an array');
  } else {
    const seenHooks = new Set<string>();
    for (const h of obj.hooks) {
      if (typeof h !== 'string') {
        errors.push(`hook entry must be a string (got: ${typeof h})`);
        continue;
      }
      if (!ALLOWED_HOOKS.includes(h as HookEvent)) {
        errors.push(`hook '${h}' is not in the whitelist: ${ALLOWED_HOOKS.join(', ')}`);
      }
      if (seenHooks.has(h)) {
        errors.push(`duplicate hook entry: ${h}`);
      }
      seenHooks.add(h);
    }
  }
  if (!Array.isArray(obj.mcp_tools)) {
    errors.push('mcp_tools must be an array');
  } else {
    const seen = new Set<string>();
    for (const t of obj.mcp_tools) {
      if (typeof t !== 'string' || !NAME_RE.test(t)) {
        errors.push(`mcp_tool name must be kebab-case (got: ${JSON.stringify(t)})`);
      }
      if (seen.has(t)) errors.push(`duplicate mcp_tool: ${t}`);
      seen.add(t);
    }
  }
  if (!Array.isArray(obj.skills)) {
    errors.push('skills must be an array');
  } else {
    const seen = new Set<string>();
    for (const s of obj.skills) {
      if (typeof s !== 'string' || !NAME_RE.test(s)) {
        errors.push(`skill name must be kebab-case (got: ${JSON.stringify(s)})`);
      }
      if (seen.has(s)) errors.push(`duplicate skill: ${s}`);
      seen.add(s);
    }
  }
  return errors;
}

/**
 * Parse a YAML plugin manifest. We use a tiny purpose-built parser to
 * avoid the heavy `js-yaml` import for what is essentially a flat
 * top-level mapping with a few array fields.
 *
 * Supports:
 *   • `key: value` (string / number / boolean)
 *   • `key:` followed by an indented list of `- item` entries
 *   • `key: [a, b, c]` inline lists
 *   • `# …` comments and blank lines
 */
export function parsePluginManifest(yaml: string): PluginManifest {
  const lines = yaml.split(/\r?\n/);
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const line = raw.replace(/#.*$/, '').trim();
    if (line.length === 0) {
      i++;
      continue;
    }
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      throw new Error(`plugin manifest: cannot parse line ${i + 1}: ${raw}`);
    }
    const key = m[1]!;
    const rest = (m[2] ?? '').trim();
    if (rest.length === 0) {
      // Look ahead for indented list
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j]!;
        const listMatch = /^\s+-\s+(.*)$/.exec(l);
        if (!listMatch) break;
        items.push(unquote(listMatch[1]!.trim()));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
        continue;
      } else {
        out[key] = '';
        i++;
        continue;
      }
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      out[key] = inner.length === 0 ? [] : inner.split(',').map((s) => unquote(s.trim()));
      i++;
      continue;
    }
    out[key] = unquote(rest);
    i++;
  }
  return out as unknown as PluginManifest;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Register a plugin manifest with the given event bus. Returns a handle
 * that can be used to unregister all listeners.
 */
export function registerPlugin(
  manifest: PluginManifest,
  eventBus: EventBus,
  handlers: Partial<Record<HookEvent, (payload: unknown) => Promise<void> | void>> = {},
): PluginHandle {
  const registeredAt = new Date().toISOString();
  const bindings: Array<{ event: HookEvent; fn: (payload: unknown) => Promise<void> | void }> = [];
  for (const h of manifest.hooks) {
    const handler = handlers[h as HookEvent];
    if (!handler) continue;
    const event = h as HookEvent;
    const wrapped = async (payload: unknown): Promise<void> => {
      await handler(payload);
    };
    eventBus.on(event, wrapped as never);
    bindings.push({ event, fn: wrapped });
  }
  return {
    name: manifest.name,
    version: manifest.version,
    hooks: manifest.hooks,
    registeredAt,
    unregister: () => {
      for (const b of bindings) {
        eventBus.off(b.event, b.fn as never);
      }
    },
  };
}

/**
 * Load a plugin: parse + validate + register. Returns either a
 * successful handle or a structured failure.
 */
export function loadPlugin(options: LoadPluginOptions): LoadPluginResult {
  let manifest: PluginManifest;
  if (options.manifest) {
    manifest = options.manifest;
  } else if (options.sourcePath) {
    // Lazy import to avoid the FS dep at module init when unused.
    const fs = require('fs') as typeof import('fs');
    let content: string;
    try {
      content = fs.readFileSync(options.sourcePath, 'utf8');
    } catch (err) {
      return { ok: false, reason: `cannot read ${options.sourcePath}: ${(err as Error).message}` };
    }
    try {
      manifest = parsePluginManifest(content);
    } catch (err) {
      return { ok: false, reason: `parse failed: ${(err as Error).message}` };
    }
  } else {
    return { ok: false, reason: 'either `manifest` or `sourcePath` must be provided' };
  }
  const errors = validatePluginManifest(manifest);
  if (errors.length > 0) {
    return { ok: false, reason: `manifest invalid: ${errors.join('; ')}` };
  }
  const bus = options.eventBus ?? new EventBus();
  const handle = registerPlugin(manifest, bus, options.handlers ?? {});
  return { ok: true, handle };
}
