import { StateManager, ResumeGenerator, MCPContinueService } from '@azaloop/core';

export async function continueCommand(baseDir?: string): Promise<void> {
  const root = baseDir || process.cwd();
  const azaDir = require('path').join(root, '.aza');
  const stateManager = new StateManager(azaDir);
  await stateManager.load();
  const resumeGenerator = new ResumeGenerator(azaDir);
  const continueService = new MCPContinueService(stateManager, resumeGenerator);
  const result = await continueService.continue();

  if (result.resumed && result.resume) {
    console.log(`\n  ✓ Session resumed`);
    console.log(`  Stage: ${result.resume.current_stage}`);
    console.log(`  Iteration: ${result.resume.iteration}`);
    console.log(`  Progress: ${result.resume.progress}`);
    console.log(`  Client: ${result.resume.client}`);
    console.log(`  Model: ${result.resume.model}`);
    console.log(`\n  Next: ${result.resume.next_tool}:${result.resume.next_action}\n`);
  } else {
    console.log(`\n  ✗ No resume data found. Start with 'aza init' or create a PRD.\n`);
  }
}
