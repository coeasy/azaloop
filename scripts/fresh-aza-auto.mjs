import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const root = 'd:/workspace/aza_0716/azaloop-main';
process.chdir(root);
process.env.AZA_AUTO_APPROVE_PRD = 'true';
process.env.AZA_PROJECT_ROOT = root;
process.env.AZA_WORKSPACE = root;

const aza = path.join(root, '.aza');
for (const f of ['RESUME.md', 'build-complete.marker', 'quality-passed.marker', 'design.md']) {
  try {
    fs.unlinkSync(path.join(aza, f));
  } catch {
    /* ignore */
  }
}

const fresh = `pipeline:
  current_stage: open
  stages:
    open:
      status: pending
    design:
      status: pending
    build:
      status: pending
    verify:
      status: pending
    archive:
      status: pending
loops:
  outer:
    cadence: manual
    board:
      pending: []
      in_progress: []
      done: []
      blocked: []
    budget:
      tokens_used: 0
      tokens_budget: 50000
      time_used_min: 0
  inner:
    story_attempts: 0
    max_story_attempts: 3
  phase:
    current: open
    iteration: 0
    max_iterations: 5
    history: []
    maker_role: maker
    checker_role: checker
loop:
  iteration: 0
  progress: 0%
  client: cursor
  model: unknown
  max_iterations: 50
memory:
  semantic_keys: []
security_findings: []
strikes: 0
attestation:
  verified: true
updated_at: '${new Date().toISOString()}'
`;
fs.writeFileSync(path.join(aza, 'STATE.yaml'), fresh, 'utf8');
for (const f of ['STATE.HASH', 'STATE.CHECKSUM']) {
  try {
    fs.unlinkSync(path.join(aza, f));
  } catch {
    /* ignore */
  }
}

const { handleToolCall } = require(path.join(root, 'packages/mcp-server/dist/index.js'));
const r = await handleToolCall('aza_auto', {
  user_input:
    '自动优化改进当前项目：完成 REFACTOR 计划剩余项——角色Slash文档化、process skills 强制触发说明、aza_finish archive 路由修复、STATE checksum 稳定性、客户端 continue 模板同步',
  workspace_path: root,
  max_iterations: 40,
});
console.log(
  JSON.stringify(
    {
      success: r.success,
      stage: r.data?.stage,
      status: r.data?.status,
      next: r.next_action,
      awaiting: r.data?.awaitingAction,
      steps: r.data?.stepsExecuted,
      error: r.error,
    },
    null,
    2,
  ),
);
