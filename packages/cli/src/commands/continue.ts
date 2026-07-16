import {
  StateManager,
  ResumeGenerator,
  MCPContinueService,
  detectClient,
  detectClientSwitch,
} from '@azaloop/core';
import * as path from 'path';

/**
 * R10 第1轮：跨客户端自动续航触发器
 *
 * 增强版 continue 命令：
 * 1. 检测客户端切换，输出明确警告
 * 2. 调用 validateAndResume 校验版本兼容性
 * 3. 输出续跑指令（next_tool:next_action）供宿主 AI 执行
 */
export async function continueCommand(baseDir?: string): Promise<void> {
  const root = baseDir || process.cwd();
  const azaDir = path.join(root, '.aza');
  const stateManager = new StateManager(azaDir);
  await stateManager.load();
  const resumeGenerator = new ResumeGenerator(azaDir);

  // 客户端切换检测
  const currentClient = detectClient().name;
  const validation = await resumeGenerator.validateAndResume(currentClient);
  const switchResult = detectClientSwitch(validation.resume?.client);

  const continueService = new MCPContinueService(stateManager, resumeGenerator);
  const result = await continueService.continue();

  if (result.resumed && result.resume) {
    console.log(`\n  ✓ Session resumed`);
    console.log(`  Stage: ${result.resume.current_stage}`);
    console.log(`  Iteration: ${result.resume.iteration}`);
    console.log(`  Progress: ${result.resume.progress}`);
    console.log(`  Client: ${result.resume.client}`);
    console.log(`  Model: ${result.resume.model}`);

    if (switchResult.switched) {
      console.log(`\n  ⚠ Client switched: ${switchResult.previous_client} → ${switchResult.current_client}`);
      if (switchResult.tier_changed) {
        console.log(`  ⚠ Tier changed — degradation may apply`);
      }
    }

    if (validation.client_switched) {
      console.log(`\n  ℹ Cross-client resume detected — context rebuilt from RESUME.md`);
    }

    console.log(`\n  Next: ${result.resume.next_tool}:${result.resume.next_action}`);
    console.log(`  → Auto-continue by calling aza_loop(action=full)\n`);

    // Record client switch to run-ledger (best-effort)
    if (switchResult.switched) {
      try {
        await resumeGenerator.appendLedger(
          `Client switch: ${switchResult.previous_client} → ${switchResult.current_client}`,
          { previous_client: switchResult.previous_client, current_client: switchResult.current_client },
          result.resume.current_stage,
          result.resume.iteration,
        );
      } catch {
        // best-effort
      }
    }
  } else if (validation.action === 'restart') {
    console.log(`\n  ⚠ ${validation.reason}`);
    console.log(`  → Run 'aza init' to start a fresh loop.\n`);
  } else {
    console.log(`\n  ✗ No resume data found. Start with 'aza init' or create a PRD.\n`);
  }
}
