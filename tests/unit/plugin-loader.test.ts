import { describe, it, expect } from 'vitest';
import {
  EventBus,
} from '../../packages/core/src/Hook/event-bus';
import {
  validatePluginManifest,
  parsePluginManifest,
  registerPlugin,
  loadPlugin,
  type PluginManifest,
} from '../../packages/core/src/L0_platform/plugin-loader';

describe('v14-P8.6 Plugin extension hooks', () => {
  const validManifest: PluginManifest = {
    name: 'my-plugin',
    version: '0.1.0',
    description: 'Test plugin',
    hooks: ['pre-phase', 'post-phase'],
    mcp_tools: ['my-plugin-status'],
    skills: ['my-plugin-skill'],
  };

  it('1) loadPlugin registers handler and emits on event', async () => {
    const bus = new EventBus();
    let prePhaseCalls = 0;
    const r = loadPlugin({
      manifest: validManifest,
      eventBus: bus,
      handlers: {
        'pre-phase': () => {
          prePhaseCalls += 1;
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.handle).toBeDefined();
    expect(r.handle!.name).toBe('my-plugin');
    await bus.emit('pre-phase', { stage: 'design' });
    expect(prePhaseCalls).toBe(1);
  });

  it('2) loadPlugin rejects manifest with missing fields', () => {
    const r = loadPlugin({
      manifest: { name: 'no-version', version: '', hooks: [], mcp_tools: [], skills: [] },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('version');
  });

  it('3) loadPlugin rejects hooks outside the whitelist', () => {
    const r = loadPlugin({
      manifest: {
        ...validManifest,
        hooks: ['not-a-real-hook' as never],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('whitelist');
  });

  it('4) handle.unregister() detaches all listeners', async () => {
    const bus = new EventBus();
    let calls = 0;
    const r = loadPlugin({
      manifest: validManifest,
      eventBus: bus,
      handlers: {
        'pre-phase': () => { calls += 1; },
        'post-phase': () => { calls += 1; },
      },
    });
    expect(r.ok).toBe(true);
    await bus.emit('pre-phase');
    await bus.emit('post-phase');
    expect(calls).toBe(2);
    r.handle!.unregister();
    await bus.emit('pre-phase');
    await bus.emit('post-phase');
    expect(calls).toBe(2);
  });

  it('5) validatePluginManifest catches duplicate hooks and bad names', () => {
    const bad: PluginManifest = {
      name: 'BadName',  // uppercase
      version: '0.1',
      hooks: ['pre-phase', 'pre-phase'], // duplicate
      mcp_tools: ['ok-tool', 'BadTool'], // uppercase
      skills: [],
    };
    const errors = validatePluginManifest(bad);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('6) parsePluginManifest handles flat and list-style YAML', () => {
    const yaml = [
      'name: demo',
      'version: 1.0.0',
      'description: "A test"',
      'hooks:',
      '  - pre-phase',
      '  - post-phase',
      'mcp_tools: [demo-status]',
      'skills: []',
    ].join('\n');
    const m = parsePluginManifest(yaml);
    expect(m.name).toBe('demo');
    expect(m.version).toBe('1.0.0');
    expect(m.description).toBe('A test');
    expect(m.hooks).toEqual(['pre-phase', 'post-phase']);
    expect(m.mcp_tools).toEqual(['demo-status']);
    expect(m.skills).toEqual([]);
  });

  it('7) registerPlugin returns a handle with unregister function', () => {
    const bus = new EventBus();
    const handle = registerPlugin(validManifest, bus, {});
    expect(typeof handle.unregister).toBe('function');
    expect(handle.name).toBe('my-plugin');
    expect(handle.hooks).toEqual(['pre-phase', 'post-phase']);
  });
});
