# AzaLoop 续跑规则（Claude Desktop — 手动触发）

Claude Desktop 不支持原生 Hook，也无法自动执行 next_action 链。
用户需手动触发每一步推进。请按以下步骤操作：

1. 读取 `.aza/STATE.md` 获取当前循环状态（当前阶段、进度、迭代次数）
2. 如果存在 `.aza/RESUME.md`，读取其中的恢复上下文（current_story、未完成动作）
3. 调用 `aza_continue` MCP 工具获取下一个动作
4. 执行返回的 `next_action`
5. 手动重复步骤 3–4，直到 `next_action.action === "done"` 表示任务完成

## 说明
- 每次执行完一个动作后，请手动调用 `aza_continue` 或 `aza_loop_next` 推进下一步
- 遇到 quality gate 失败时，先修复问题再调用 `aza_loop_complete`
- 跨会话恢复时调用 `aza_memory_query` 获取相关历史经验
- 使用 `aza_audit` 评估当前工作区的循环成熟度（L0–L3）
