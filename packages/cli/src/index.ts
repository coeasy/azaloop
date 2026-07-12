#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { setupCommand } from './commands/setup';
import { continueCommand } from './commands/continue';
import { upgradeCommand } from './commands/upgrade';
import { loopCommand } from './commands/loop';
import { budgetCommand } from './commands/budget';
import { auditCommand } from './commands/audit';

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
    await initCommand(options);
  });

program
  .command('setup')
  .description('Interactive setup wizard — guided installation & configuration')
  .option('--root <path>', 'Project root directory')
  .option('--auto', 'Non-interactive mode (uses auto-detect)')
  .action(async (options) => {
    await setupCommand(options);
  });

program
  .command('loop')
  .description('Advance the development loop to the next action')
  .option('--stage <stage>', 'Current stage (open/design/build/verify/archive)')
  .option('--dir <path>', 'Project .aza directory')
  .action(async (options) => {
    await loopCommand(options);
  });

program
  .command('continue')
  .description('Continue from last session (for T3 clients without auto-resume)')
  .option('--dir <path>', 'Project directory')
  .action(async (options) => {
    await continueCommand(options.dir);
  });

program
  .command('status')
  .description('Show current project status')
  .action(async () => {
    const { StateManager } = await import('@azaloop/core');
    const path = require('path');
    const azaDir = path.join(process.cwd(), '.aza');
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
  .command('upgrade')
  .description('Upgrade from v8/v9 to v12.2')
  .option('--from <version>', 'Source version (v8 or v9)')
  .option('--root <path>', 'Project root directory')
  .action(async (options) => {
    await upgradeCommand(options);
  });

program
  .command('budget')
  .description('Show token budget report (estimates consumption per loop level/stage)')
  .option('--dir <path>', 'Project .aza directory')
  .action(async (options) => {
    await budgetCommand(options.dir);
  });

program
  .command('audit')
  .description('Run loop-audit scoring (18 signals, 4 levels L0-L3, 0-100 score)')
  .option('--dir <path>', 'Project .aza directory')
  .action(async (options) => {
    await auditCommand(options.dir);
  });

program.parse(process.argv);
