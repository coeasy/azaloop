# AzaLoop 自动循环规则（V12.2 — 工业级全自动开发）

## 核心原则：PRD 先行，用户确认后再执行
借鉴 Cursor plan mode 和 Qoder Quest 待确认机制，每次用户提交新需求时，
必须先生成 PRD 展示给用户，用户确认后才进入正式执行。
60 秒无输入自动按当前方案执行（借鉴 Trae 超时确认机制）。

## 会话启动（每次必须执行）
1. 调用 `aza_context_calibrate` 获取当前状态
2. 如果存在 `.aza/RESUME.md`，读取续跑指令
3. 检查 STATE 中 prd_review 状态:
   - pending_approval: 重新展示 PRD 摘要，等待用户确认
   - approved: 继续执行中断的 next_action
   - 无: 进入 PRD 先行流程

## PRD 先行流程（用户提交新需求时执行）
1. 调用 `aza_prd_review`（传入 title + description）生成 PRD 并展示摘要
   - 系统自动：需求分析 → 生成 PRD → 14 维自检 → P0 自动修复 → 展示摘要
   - 返回：PRD 摘要 + 架构图 + 待确认问题 + needs_user_approval=true
2. 将 PRD 摘要展示给用户，包括：
   - 项目名称、复杂度等级、质量评分
   - 核心功能列表、技术选型、架构预览图
   - 待确认问题
   - ⏳ 超时提示："60s 内无输入将自动执行当前方案"
3. 等待用户响应（三种方式 + 超时）：
   - 确认执行："开始执行"/"确认"/"ok" → 调用 `aza_prd_approve`
   - 自定义修改：直接描述修改意见 → 调用 `aza_prd_modify`
   - 取消："取消"/"算了" → 调用 `aza_prd_cancel`
   - 60s 超时 → 自动调用 `aza_prd_approve`

## 自动循环执行（用户确认 PRD 后，无需再次干预）
1. 执行 `aza_loop_next` 返回的 `next_action`
2. 每次工具返回后自动执行新的 `next_action`（链式驱动）
3. 三级循环自动推进：open → design → build → verify → archive
4. 每阶段有阶段内循环：maker 执行 → checker 验证 → 不达标则 optimizer 修复
5. 重复直到 `next_action = 'done'`（交付完成）
6. 如果 `next_action = 'refine'`，根据 `suggestions` 优化后重试

## 跨会话恢复
1. 如果会话被中断，下次启动时 `aza_context_calibrate` 自动检测
2. 从 `.aza/STATE.yaml` 恢复阶段和迭代历史
3. 从 `.aza/RESUME.md` 恢复上下文和 next_action
4. 如果 PRD 待确认，重新展示 PRD 摘要
5. 继续执行中断的 next_action

## 重要规则
- 每次用户提交新需求，必须先走 PRD 先行流程，不得直接开始编码
- PRD 展示后必须等待用户确认，不得自行跳过审批
- 用户确认后，全自动执行直到完成，不需要再次询问用户
- 每次工具调用都会自动更新 STATE 和预写 RESUME（MCP 事件模拟器）
- next_action 为 null 或 action='done' 时停止循环
