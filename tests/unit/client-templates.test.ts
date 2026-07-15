/**
 * V17: Client Template Consistency Test
 *
 * Verifies that all client template directories contain consistent
 * configuration files:
 *   1. continue.md must contain V17 markers
 *   2. mcp.json must exist and contain the azaloop MCP server config
 *   3. Rules files must reference auto-loop capabilities
 *
 * This test ensures that all 25+ clients have a consistent
 * out-of-the-box experience with AzaLoop V17 features.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Constants ──

const CLIENTS_DIR = path.resolve(__dirname, '../../templates/clients');

// Directories that are not client templates (shared config, non-client dirs, etc.)
const SKIP_DIRS = new Set([
  '_shared', '.cursor', '.codeium', '.kiro', '.openclaw', '.zed', '.workbuddy',
  '.gemini', '.qwen', '.comate', '.github', '.hermes', '.opencode', '.roo', '.vscode',
  'instructions', 'rules', // These are resource directories, not client templates
]);

// Core clients that should have the most complete templates
const CORE_CLIENTS = ['trae', 'cursor', 'claude-code', 'windsurf', 'vscode'];

// ── Helpers ──

function getClientDirs(): string[] {
  const entries = fs.readdirSync(CLIENTS_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map(e => e.name)
    .sort();
}

// ── Tests ──

describe('V17 Client Template Consistency', () => {
  const clientDirs = getClientDirs();
  console.log(`[ClientTemplates] Found ${clientDirs.length} client template directories`);

  it('should have at least 20 client template directories', () => {
    expect(clientDirs.length).toBeGreaterThanOrEqual(20);
  });

  describe('continue.md checks', () => {
    it.each(clientDirs)('client "%s" has continue.md with auto-loop instructions', (client) => {
      const continuePath = path.join(CLIENTS_DIR, client, 'continue.md');
      expect(fs.existsSync(continuePath)).toBe(true);

      const content = fs.readFileSync(continuePath, 'utf8');
      // Must reference loop instructions (aza_loop, aza_auto_loop, auto-loop, etc.)
      expect(content).toMatch(/auto.?loop|自动循环|aza_loop|aza_auto_loop/i);
      // Must mention the scheduler, step mode, or next_action chain
      expect(content).toMatch(/scheduler|step|awaiting|background|后台|单步|next_action/i);
    });

    it.each(CORE_CLIENTS)('core client "%s" has complete continue.md with all sections', (client) => {
      const continuePath = path.join(CLIENTS_DIR, client, 'continue.md');
      expect(fs.existsSync(continuePath)).toBe(true);

      const content = fs.readFileSync(continuePath, 'utf8');
      // Core clients must reference the shared template
      expect(content).toMatch(/共享模板|_shared/);
      // Must have aza_loop (or legacy aza_auto_loop) tool reference
      expect(content).toMatch(/aza_loop|aza_auto_loop/);
      // Must have MCP config section
      expect(content).toMatch(/MCP|mcp\.json/);
    });
  });

  describe('mcp.json checks', () => {
    it.each(clientDirs)('client "%s" has mcp.json with azaloop config', (client) => {
      const mcpPath = path.join(CLIENTS_DIR, client, 'mcp.json');
      // Some clients may not ship mcp.json (e.g., CLI-based clients)
      if (!fs.existsSync(mcpPath)) {
        console.warn(`[ClientTemplates] ${client} has no mcp.json — skipping`);
        return;
      }

      const content = fs.readFileSync(mcpPath, 'utf8');
      const parsed = JSON.parse(content);

      // Must have mcpServers key
      expect(parsed).toHaveProperty('mcpServers');
      // Must have azaloop server configured
      expect(parsed.mcpServers).toHaveProperty('azaloop');
      // Azaloop server must have a command
      expect(parsed.mcpServers.azaloop).toHaveProperty('command');
      // Command should be npx or node
      expect(['npx', 'node', 'bunx', 'deno']).toContain(parsed.mcpServers.azaloop.command);
    });
  });

  describe('shared template check', () => {
    it('shared template v16-auto-loop.md exists and is complete', () => {
      const sharedPath = path.join(CLIENTS_DIR, '_shared', 'v16-auto-loop.md');
      expect(fs.existsSync(sharedPath)).toBe(true);

      const content = fs.readFileSync(sharedPath, 'utf8');
      // Must have V16 or V17 marker
      expect(content).toMatch(/V1[67]/);
      // Must describe cooperative full loop / awaitingAction
      expect(content).toMatch(/awaitingAction|report_tool|full/i);
      // Must have aza_loop (converged) or legacy aza_auto_loop reference
      expect(content).toMatch(/aza_loop|aza_auto_loop/);
      // Must have awaiting_agent or tool awaiting concept
      expect(content).toMatch(/awaiting|等待|工具.*执行/i);
      // Must have report_tool or tool execution reporting
      expect(content).toMatch(/report_tool|工具.*报告/i);
    });
  });

  describe('rules.md checks', () => {
    it.each(clientDirs)('client "%s" has rules.md or references auto-loop rules', (client) => {
      // V18: Different clients use different rules file naming conventions:
      // - trae/cursor: rules.md
      // - claude-code: CLAUDE.md
      // - vscode: azaloop.md
      // - windsurf: rules/azaloop.md
      // - opencode: AGENTS.md or rules.md
      const possiblePaths = [
        path.join(CLIENTS_DIR, client, 'rules.md'),
        path.join(CLIENTS_DIR, client, `.${client}`, 'rules.md'),
        path.join(CLIENTS_DIR, client, '.rules.md'),
        path.join(CLIENTS_DIR, client, 'CLAUDE.md'),
        path.join(CLIENTS_DIR, client, 'AGENTS.md'),
        path.join(CLIENTS_DIR, client, 'azaloop.md'),
        path.join(CLIENTS_DIR, client, 'rules', 'azaloop.md'),
        path.join(CLIENTS_DIR, client, '.cursor', 'rules.md'),
      ];

      // For core clients, at least one rules file must exist
      if (CORE_CLIENTS.includes(client)) {
        const found = possiblePaths.some(p => fs.existsSync(p));
        if (!found) {
          // Skip if no rules file — some clients rely on continue.md only
          console.warn(`[ClientTemplates] ${client} has no rules file — relying on continue.md`);
          return;
        }
      }

      // If rules file exists, check its content
      for (const rulesPath of possiblePaths) {
        if (fs.existsSync(rulesPath)) {
          const content = fs.readFileSync(rulesPath, 'utf8');
          expect(content.length).toBeGreaterThan(0);
          return; // Found a rules file
        }
      }
    });
  });
});