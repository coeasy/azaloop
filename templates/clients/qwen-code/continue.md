# AzaLoop 自动续跑规则（MANDATORY — 会话启动时首先执行）

1. 读取 `.aza/STATE.md` 获取当前循环状态（当前阶段、进度、迭代次数）
2. 如果存在 `.aza/RESUME.md`，读取其中的恢复上下文（current_story、未完成动作）
3. 调用 `aza_continue` MCP 工具获取下一个动作
4. 执行返回的 `next_action`，不得跳过任何步骤
5. 重复步骤 3–4，直到 `next_action.action === "done"` 表示任务完成

## 说明
- 每次工具返回的 `next_action` 必须立即自动执行
- 遇到 quality gate 失败时，先修复问题再调用 `aza_loop_complete`
- 跨会话恢复时调用 `aza_memory_query` 获取相关历史经验
- Qwen Code 默认使用通义千问端点，符合数据出境合规要求
