# AzaLoop 自动续跑规则（MANDATORY — 会话启动时首先执行）

1. 调用 aza_context status 获取当前状态
2. 如果存在 .aza/RESUME.md：
   - 调用 aza_loop next 续跑（传入 RESUME 中的 current_story）
3. 如果不存在 RESUME.md：
   - 询问用户需求 → 调用 aza_prd generate 生成新 PRD
4. 每次工具返回的 next_action 必须自动执行，不得跳过
5. 跨会话恢复时调用 aza_memory query 获取相关历史经验
