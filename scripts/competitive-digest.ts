/**
 * R10 第11轮 (P5 竞品清单) — 18 竞品全量 digest 自动生成。
 *
 * 借鉴 spec-kit「constitution / values」+ OpenSpec「reviewable artifacts」：
 *
 * 把 18 竞品的能力映射 + AzaLoop 跨越点 + 证据链接整合到一份机器可读
 * manifest，供 CI / 文档 / 客户端安装器消费。
 *
 * 输出：
 *   .aza/evidence/competitive-digest.json + .md
 *
 * 格式：每个竞品一个 card（id/name/summary/azaAlignment/evidence/diffWithAza）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CompetitorCard {
  id: string;
  name: string;
  category: 'spec' | 'loop' | 'review' | 'memory' | 'orchestration' | 'security' | 'parallel';
  oneLine: string;
  azaAlignment: string;
  evidence: string[];
  diffWithAza: string;
}

const COMPETITORS: readonly CompetitorCard[] = [
  { id: 'planning-with-files', name: 'Planning with Files', category: 'spec', oneLine: 'Claude Code skill: Markdown 三文件 plan/notes/tasks', azaAlignment: 'STATE.yaml + RESUME.md + task-epoch 三件套', evidence: ['packages/core/src/state/', 'packages/core/src/continuity/'], diffWithAza: 'PWF 是手写 Markdown；AzaLoop 自动维护 + 跨客户端续跑' },
  { id: 'spec-kit', name: 'GitHub spec-kit', category: 'spec', oneLine: 'Specify/Plan/Tasks 三阶段 + constitution', azaAlignment: 'open/design/build/verify/archive 五阶段 + capability 矩阵', evidence: ['packages/core/src/L1_spec/', 'packages/core/src/evidence/capability-registry.ts'], diffWithAza: 'spec-kit 是 GitHub CLI；AzaLoop 是 MCP 服务 + 跨客户端' },
  { id: 'OpenSpec', name: 'OpenSpec', category: 'spec', oneLine: 'change folder 提案 + archive 流程', azaAlignment: 'change-folder.ts + archive marker', evidence: ['packages/core/src/L1_spec/change-folder.ts'], diffWithAza: 'OpenSpec 单客户端；AzaLoop 状态收敛到中间件' },
  { id: 'superpowers', name: 'Superpowers', category: 'spec', oneLine: 'process skills 软门控 + mandatory workflows', azaAlignment: 'process-skills-gate.ts 硬门控（design/plan/quality/tdd）', evidence: ['packages/core/src/L5_skill/process-skills-gate.ts'], diffWithAza: 'AzaLoop 用 ProcessEvidence 显式传递证据，sb 软偏好 → 硬门' },
  { id: 'superpowers-zh', name: 'Superpowers-zh', category: 'spec', oneLine: '中文版 Superpowers + Claude Code 模板', azaAlignment: 'cursor/trae/opencode/claude-code 4 客户端模板', evidence: ['docs/clients/', 'scripts/client-certify.ts'], diffWithAza: 'AzaLoop 4 T1 客户端 6/6 认证 + e2e 验证' },
  { id: 'claude-skills', name: 'Claude Skills', category: 'spec', oneLine: 'Claude Code skills 注册表', azaAlignment: 'packages/core/skills/ + SkillRegistry', evidence: ['packages/core/src/L5_skill/'], diffWithAza: 'Claude Skills 是 Claude-only；AzaLoop 跨客户端 + 内核硬门' },
  { id: 'ai-coding-guide', name: 'AI Coding Guide', category: 'spec', oneLine: 'AI 编程规范 + 工具对比', azaAlignment: 'AzaLoop README + capability matrix', evidence: ['README.md', 'packages/core/src/evidence/capability-registry.ts'], diffWithAza: 'AICG 是静态文档；AzaLoop 是动态注册表 + README 自动注入' },
  { id: 'comet', name: 'Comet (replit)', category: 'loop', oneLine: '纯函数 resume probe + checkpoint 恢复', azaAlignment: 'resume-generator.ts + heartbeat + transition-planner 纯函数', evidence: ['packages/core/src/continuity/resume-generator.ts', 'packages/core/src/L7_loop/runtime/transition-planner.ts'], diffWithAza: 'Comet 是 prompt-time resume；AzaLoop 是 plan-time resume + watchdog 60s 主动恢复' },
  { id: 'loop-engineering', name: 'Loop Engineering', category: 'loop', oneLine: 'autonomy L1-L3 级别 + 流程强制', azaAlignment: 'autonomy.ts 硬门控 (L1 禁写码/ship，L2 ship 必 quality)', evidence: ['packages/core/src/L7_loop/autonomy.ts'], diffWithAza: 'LE 是文档级 autonomy；AzaLoop 升级为硬门 + redirect' },
  { id: 'ralphy', name: 'Ralphy', category: 'parallel', oneLine: '--parallel 并发任务 + git worktree', azaAlignment: 'batch-runner.ts + spawnBatchWorktrees 真 worktree', evidence: ['packages/core/src/L7_loop/batch-runner.ts', 'packages/core/src/L8_orchestrator/worktree/manager.ts'], diffWithAza: 'Ralphy 是 CLI flag；AzaLoop 是声明式 parallel_group + 真 worktree' },
  { id: 'ralphy-openspec', name: 'Ralphy-OpenSpec', category: 'parallel', oneLine: 'Ralphy + OpenSpec 集成', azaAlignment: 'batch + change-folder 集成', evidence: ['packages/core/src/L7_loop/batch-runner.ts'], diffWithAza: '同 ralphy' },
  { id: 'agency-orchestrator', name: 'Agency Orchestrator', category: 'orchestration', oneLine: 'YAML workflow + middleware chain', azaAlignment: 'tool-orchestrator.ts middleware 链 + yaml-orchestrator', evidence: ['packages/mcp-server/src/orchestrator/tool-orchestrator.ts', 'packages/core/src/L8_orchestrator/yaml-orchestrator.ts'], diffWithAza: 'AO 是通用 YAML；AzaLoop 8 工具面 + 5 middleware' },
  { id: 'ruflo', name: 'Ruflo (AgentDB)', category: 'memory', oneLine: 'HNSW 向量记忆 + ReasoningBank + swarm', azaAlignment: 'hnsw-index.ts + project-memory.ts + HNSWStats 可观测', evidence: ['packages/core/src/L2_memory/hnsw-index.ts', 'packages/core/src/L2_memory/stores.ts'], diffWithAza: 'Ruflo 是独立服务；AzaLoop 嵌入式 + 跨上下文检索' },
  { id: 'Trellis', name: 'Trellis (VRCA)', category: 'memory', oneLine: 'JSONL context (implement.jsonl/check.jsonl)', azaAlignment: 'context-orchestrator.ts 5 阶段 JSONL', evidence: ['packages/core/src/L2_memory/context-orchestrator.ts'], diffWithAza: 'Trellis 2 阶段；AzaLoop 5 阶段 + 真实产物注入' },
  { id: 'shellward', name: 'ShellWard', category: 'security', oneLine: '8 层 DLP 扫描工具调用', azaAlignment: 'shellward-guard.ts + server.ts tools/call 默认扫', evidence: ['packages/core/src/L6_security/shellward-guard.ts', 'packages/mcp-server/src/server.ts'], diffWithAza: 'ShellWard 是 pass-through；AzaLoop 默认开 + next_action redirect' },
  { id: 'gstack', name: 'GStack', category: 'review', oneLine: 'CEO/Eng/QA 角色化 review + 浏览器验证', azaAlignment: 'risk-router.ts 5 risk × 8 reviewer + review plan', evidence: ['packages/core/src/L8_orchestrator/risk-router.ts'], diffWithAza: 'GStack 是固定 20 角色；AzaLoop 按风险动态路由' },
  { id: 'agent-skills', name: 'Agent Skills', category: 'spec', oneLine: '多 skill 组合 + spec 合规', azaAlignment: 'capability-registry.ts + process-skills-gate', evidence: ['packages/core/src/evidence/capability-registry.ts'], diffWithAza: 'AS 是 skill 文件；AzaLoop 是 capability 矩阵 + 3 档成熟度' },
  { id: 'arise', name: 'Arise', category: 'orchestration', oneLine: 'agent self-orchestration + budget 限流', azaAlignment: 'token-budget.ts + TransitionPlanner 限流', evidence: ['packages/core/src/L7_loop/token-budget.ts'], diffWithAza: 'Arise 通用；AzaLoop 与状态机深度集成' },
];

function writeManifest(azaDir: string): string {
  const outDir = path.join(azaDir, 'evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'competitive-digest.json');
  fs.writeFileSync(outPath, JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    competitors: COMPETITORS,
    summary: {
      total: COMPETITORS.length,
      byCategory: COMPETITORS.reduce<Record<string, number>>((acc, c) => {
        acc[c.category] = (acc[c.category] ?? 0) + 1;
        return acc;
      }, {}),
    },
  }, null, 2), 'utf8');
  return outPath;
}

function renderMarkdown(): string {
  const lines: string[] = [];
  lines.push(`# 18 竞品 Digest`);
  lines.push('');
  lines.push(`> AzaLoop 跨竞品对齐卡片 — 来源: \`scripts/competitive-digest.ts\``);
  lines.push('');
  const cats = [...new Set(COMPETITORS.map((c) => c.category))];
  for (const cat of cats) {
    const subs = COMPETITORS.filter((c) => c.category === cat);
    lines.push(`## ${cat} (${subs.length})`);
    lines.push('');
    for (const c of subs) {
      lines.push(`### ${c.name} (\`${c.id}\`)`);
      lines.push(``);
      lines.push(`- **What**: ${c.oneLine}`);
      lines.push(`- **AzaLoop alignment**: ${c.azaAlignment}`);
      lines.push(`- **Evidence**: ${c.evidence.map((e) => `\`${e}\``).join(', ')}`);
      lines.push(`- **Diff with AzaLoop**: ${c.diffWithAza}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main() {
  const root = process.cwd();
  const azaDir = path.join(root, '.aza');
  const jsonPath = writeManifest(azaDir);
  const mdPath = path.join(azaDir, 'evidence', 'competitive-digest.md');
  fs.writeFileSync(mdPath, renderMarkdown(), 'utf8');
  console.log(`[competitive-digest] manifest: ${jsonPath}`);
  console.log(`[competitive-digest] markdown: ${mdPath}`);
  console.log(`[competitive-digest] ${COMPETITORS.length} competitors across ${new Set(COMPETITORS.map((c) => c.category)).size} categories`);
}

main();
