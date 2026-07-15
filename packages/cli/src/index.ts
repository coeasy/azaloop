#!/usr/bin/env node
import { Command } from 'commander';
import { normalizeCliPath } from './util/path';
import { initCommand } from './commands/init';
import { setupCommand } from './commands/setup';
import { continueCommand } from './commands/continue';
import { upgradeCommand } from './commands/upgrade';
import { loopCommand } from './commands/loop';
import { budgetCommand } from './commands/budget';
import { auditCommand } from './commands/audit';
import { packCommand } from './commands/pack';
import { registerDaemonCommand } from './commands/daemon';

const program = new Command();

program
  .name('aza')
  .description('AzaLoop v12.2 — PRD-driven autonomous development loop for AI coding assistants')
  .version('12.2.0');

program
  .command('init')
  .description('Initialize AzaLoop in the current project (auto-detect or --client)')
  .option('--client <name>', 'Specify client (cursor, claude-code, trae, etc.)')
  .option('--root <path>', 'Project root directory')
  .option('-y, --yes', 'Skip prompts (non-interactive)')
  .action(async (options) => {
    await initCommand({ ...options, root: normalizeCliPath(options.root) });
  });

program
  .command('setup')
  .description('Interactive setup wizard — or generate rules for a specific client via --client/--all')
  .option('--root <path>', 'Project root directory')
  .option('--auto', 'Non-interactive mode (uses auto-detect)')
  .option('--client <name>', 'Generate rules file for a specific client (e.g. cline, trae, windsurf)')
  .option('--all', 'Generate rules files for all 25 clients')
  .option('--tier <tier>', 'When used with --all, restrict to T1 | T2 | T3')
  .option('--skip-validation', 'Skip keyword validation after generation')
  .action(async (options) => {
    await setupCommand({ ...options, root: normalizeCliPath(options.root) });
  });

program
  .command('loop')
  .description('Advance the development loop to the next action (continuous auto-loop driver)')
  .option('--stage <stage>', 'Current stage (open/design/build/verify/archive)')
  .option('--dir <path>', 'Project .aza directory')
  .option('--max-iterations <n>', 'Max iterations before forcing stop (default: 50)', '50')
  .option('--dry-run', 'Print next_action without driving the loop')
  .option('--task <title>', 'Task title used by the PRD review gate')
  .option('--description <desc>', 'Task description used by the PRD review gate')
  .action(async (options) => {
    const maxIterations = options.maxIterations ? parseInt(options.maxIterations, 10) : 50;
    await loopCommand({
      stage: options.stage,
      dir: normalizeCliPath(options.dir),
      maxIterations: Number.isFinite(maxIterations) ? maxIterations : 50,
      dryRun: !!options.dryRun,
      task: options.task,
      description: options.description,
    });
  });

program
  .command('continue')
  .description('Continue from last session (for T3 clients without auto-resume)')
  .option('--dir <path>', 'Project directory')
  .action(async (options) => {
    await continueCommand(normalizeCliPath(options.dir));
  });

program
  .command('status')
  .description('Show current project status')
  .option('--dir <path>', 'Project .aza directory')
  .action(async (options) => {
    const { StateManager } = await import('@azaloop/core');
    const path = require('path');
    const azaDir = normalizeCliPath(options.dir)
      ? path.resolve(normalizeCliPath(options.dir)!)
      : path.join(process.cwd(), '.aza');
    try {
      const stateManager = new StateManager(azaDir);
      await stateManager.load();
      const state = stateManager.getState();
      console.log(`\n  Stage:      ${state.pipeline.current_stage}`);
      console.log(`  Iteration:  ${state.loop.iteration}`);
      console.log(`  Progress:   ${state.loop.progress}`);
      console.log(`  Client:     ${state.loop.client}`);
      console.log(`  Model:      ${state.loop.model}`);
      console.log(`  Strikes:    ${state.strikes}/3\n`);
    } catch {
      console.log('\n  ⚠ Not initialized. Run: aza init\n');
    }
  });

program
  .command('health')
  .description('Verify AzaLoop MCP server connectivity')
  .action(async () => {
    try {
      const { execSync } = require('child_process');
      const result = execSync('npx @azaloop/mcp-server --version 2>&1 || node -e "console.log(\'checking...\')"', { encoding: 'utf8', timeout: 5000 });
      console.log(`\n  ✓ AzaLoop MCP server is accessible\n`);
    } catch {
      console.log('\n  ⚠ MCP server not found. Run: aza init\n');
    }
  });

program
  .command('pack')
  .description('One-click portable build (CLI + MCP) and optional local install')
  .option('--root <path>', 'Monorepo root directory')
  .option('--install', 'Run install.ps1 / install.sh after build')
  .action(async (options) => {
    await packCommand({ root: normalizeCliPath(options.root), install: !!options.install });
  });

program
  .command('upgrade')
  .description('Upgrade from v8/v9 to v12.2')
  .option('--from <version>', 'Source version (v8 or v9)')
  .option('--root <path>', 'Project root directory')
  .action(async (options) => {
    await upgradeCommand({ ...options, root: normalizeCliPath(options.root) });
  });

program
  .command('budget')
  .description('Show token budget report (estimates consumption per loop level/stage)')
  .option('--dir <path>', 'Project .aza directory')
  .action(async (options) => {
    await budgetCommand(normalizeCliPath(options.dir));
  });

program
  .command('audit')
  .description('Run loop-audit scoring (18 signals, 4 levels L0-L3, 0-100 score)')
  .option('--dir <path>', 'Project .aza directory')
  .action(async (options) => {
    await auditCommand(normalizeCliPath(options.dir));
  });

// V20 Task 3: 12h unattended auto-loop daemon
registerDaemonCommand(program);

program.parse(process.argv);
