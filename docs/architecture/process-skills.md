# Process Skills 强制触发（superpowers 对齐）

AzaLoop 在 build 脊柱上强制以下 process skills（见 `packages/core/src/L5_skill/core-skills/`）：

| Skill | 触发时机 | 门控 |
|-------|----------|------|
| brainstorming | 新功能 / 方案选择前 | **硬门**：无 `.aza/design.md` 且无 `openspec/changes/*` 时禁止 `aza_spec(implement|apply)`（`process-skills-gate.ts`） |
| writing-plans / prd | design 批准后 | `.aza/task_plan.md` / OpenSpec tasks（软偏好；lean design 可过） |
| tdd-process | 任意生产代码 | verify 阶段 TDD Iron Law |
| verification-before-completion | 宣称完成前 | **硬门**：无 `quality-passed.marker` 禁止 `aza_finish(ship)` |

调试逃生：`AZA_SKIP_SKILL_GATE=1`（仅本地调试）。

查询：`aza_meta action=skills_list`  
注册源：`L5_skill/core-skills/*.md`  
实现：`packages/core/src/L5_skill/process-skills-gate.ts`（MCP `handleToolCall` 统一调用）
