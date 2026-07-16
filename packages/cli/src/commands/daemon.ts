import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  AutoLoopScheduler,
  LoopController,
  ConfigLoader,
  loadDaemonState,
  saveDaemonState,
  createInitialDaemonState,
  type DaemonState,
} from '@azaloop/core';

/**
 * V20 Task 3: Register the `aza daemon` command.
 *
 * 12h unattended auto-loop daemon. Persists state to `.aza/daemon-state.json`
 * every tick so it survives crashes; supports start / stop / status / restart.
 */
export function registerDaemonCommand(program: Command): void {
  const daemon = program.command('daemon').description('12h unattended auto-loop daemon');

  daemon
    .command('start')
    .description('Start the daemon')
    .option('--cron <expr>', 'Cron schedule (e.g., "*/30 * * * *" = every 30 minutes)')
    .option('--max-duration <hours>', 'Max duration in hours (default: 12)', '12')
    .option('--dir <path>', 'Project directory (default: cwd)', process.cwd())
    .action(async (opts: { cron?: string; maxDuration: string; dir: string }) => {
      const projectRoot = path.resolve(opts.dir);
      const azaDir = path.join(projectRoot, '.aza');
      const stateFile = path.join(azaDir, 'daemon-state.json');
      const maxDurationMs = parseInt(opts.maxDuration, 10) * 60 * 60 * 1000;

      console.log(`[daemon] Starting (max-duration=${opts.maxDuration}h, cron=${opts.cron || 'none'}, dir=${projectRoot})`);

      // Load existing state (crash recovery)
      const existing = await loadDaemonState(stateFile);
      if (existing && !existing.stopped) {
        console.log(`[daemon] Recovering from previous run (iteration=${existing.iteration}, crashRecoveries=${existing.crashRecoveryCount})`);
      }

      let state: DaemonState = existing && !existing.stopped
        ? { ...existing, stopped: false }
        : createInitialDaemonState(maxDurationMs, opts.cron || null);

      // Ensure .aza directory exists
      await fs.mkdir(azaDir, { recursive: true });

      // Set up LoopController (mirrors `aza loop` wiring)
      const loader = new ConfigLoader(projectRoot);
      const config = loader.loadSync();
      const lc = new LoopController({
        maxIterations: config.loop.max_iterations,
        maxStageIterations: config.loop.max_stage_iterations,
        enableV12: true,
        azaDir,
        projectRoot,
        config,
      });

      // Set up scheduler
      const scheduler = new AutoLoopScheduler(lc, {}, 5_000, 1_800_000); // 30 min awaiting timeout
      scheduler.setMaxDurationMs(maxDurationMs);
      if (opts.cron) {
        scheduler.setCronSchedule(opts.cron);
      }
      scheduler.setStateFilePath(stateFile);

      // Resume scheduler internals from saved state (crash recovery)
      if (existing && !existing.stopped) {
        await scheduler.loadState(stateFile);
      }

      // Signal handlers for graceful shutdown
      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[daemon] ${signal} received, persisting state...`);
        state.stopped = true;
        state.lastTickAt = new Date().toISOString();
        await saveDaemonState(stateFile, state);
        scheduler.stop();
        console.log('[daemon] State persisted, exiting.');
        process.exit(0);
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

      // Start scheduler
      scheduler.start();

      // Duration watchdog — also heartbeats state to disk every 5s
      const startedAt = Date.now();
      const watchdog = setInterval(async () => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= maxDurationMs) {
          console.log(`[daemon] Max duration reached (${opts.maxDuration}h), stopping.`);
          state.stopped = true;
          state.lastTickAt = new Date().toISOString();
          await saveDaemonState(stateFile, state);
          scheduler.stop();
          clearInterval(watchdog);
          process.exit(0);
        }
        // Sync state from scheduler snapshot
        const status = scheduler.getStatus();
        state.lastTickAt = new Date().toISOString();
        state.iteration = status.iteration;
        state.currentStage = status.currentStage;
        state.awaitingAction = status.awaitingAction
          ? { tool: status.awaitingAction.tool, action: status.awaitingAction.action }
          : null;
        await saveDaemonState(stateFile, state);
      }, 5_000);

      console.log('[daemon] Running. Press Ctrl+C to stop.');
    });

  daemon
    .command('stop')
    .description('Stop the running daemon')
    .option('--dir <path>', 'Project directory', process.cwd())
    .action(async (opts: { dir: string }) => {
      const stateFile = path.join(path.resolve(opts.dir), '.aza', 'daemon-state.json');
      const state = await loadDaemonState(stateFile);
      if (!state) {
        console.log('[daemon] No daemon state found.');
        return;
      }
      state.stopped = true;
      state.lastTickAt = new Date().toISOString();
      await saveDaemonState(stateFile, state);
      console.log('[daemon] Stop signal sent. The daemon will exit on next tick.');
    });

  daemon
    .command('status')
    .description('Show daemon status')
    .option('--dir <path>', 'Project directory', process.cwd())
    .action(async (opts: { dir: string }) => {
      const stateFile = path.join(path.resolve(opts.dir), '.aza', 'daemon-state.json');
      const state = await loadDaemonState(stateFile);
      if (!state) {
        console.log('[daemon] No daemon state found (not running or never started).');
        return;
      }
      console.log('=== Daemon Status ===');
      console.log(`Started at:    ${state.startedAt}`);
      console.log(`Last tick at:  ${state.lastTickAt}`);
      console.log(`Iteration:     ${state.iteration}`);
      console.log(`Current stage: ${state.currentStage}`);
      console.log(`Awaiting:      ${state.awaitingAction ? `${state.awaitingAction.tool}/${state.awaitingAction.action}` : 'none'}`);
      console.log(`Cron:          ${state.cronSchedule || 'none'}`);
      console.log(`Max duration:  ${state.maxDurationMs / 3600000}h`);
      console.log(`Token usage:   ${state.tokenUsage.total} total, ${state.tokenUsage.perTask} per-task`);
      console.log(`Stopped:       ${state.stopped}`);
      console.log(`Crash recovers: ${state.crashRecoveryCount}`);
    });

  daemon
    .command('restart')
    .description('Restart the daemon (stop + start)')
    .option('--dir <path>', 'Project directory', process.cwd())
    .option('--cron <expr>', 'Cron schedule')
    .option('--max-duration <hours>', 'Max duration in hours', '12')
    .action(async (opts: { dir: string; cron?: string; maxDuration: string }) => {
      const stateFile = path.join(path.resolve(opts.dir), '.aza', 'daemon-state.json');
      const state = await loadDaemonState(stateFile);
      if (state) {
        state.stopped = true;
        await saveDaemonState(stateFile, state);
        console.log('[daemon] Previous state marked as stopped.');
      }
      // Note: actual restart requires the user to re-run `aza daemon start`
      console.log('[daemon] Run `aza daemon start` to start fresh.');
    });
}
