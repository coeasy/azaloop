<!-- V17 — 共享模板片段，所有客户端通过 include 引用 -->
# AzaLoop 自动循环规则（V17 — 单阶段调度 + 后台自动循环驱动器）

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
   - 超时提示："60s 内无输入将自动执行当前方案"
3. 等待用户响应（三种方式 + 超时）：
   - 确认执行："开始执行"/"确认"/"ok" → 调用 `aza_prd_approve`
   - 自定义修改：直接描述修改意见 → 调用 `aza_prd_modify`
   - 取消："取消"/"算了" → 调用 `aza_prd_cancel`
   - 60s 超时 → 自动调用 `aza_prd_approve`

## 自动循环执行（V17 — 单阶段调度 + 后台自动循环驱动器）

### V17 核心变更：单阶段调度
V17 将 InnerLoop 改为**单阶段调度**模式，每次 `next()` 只执行一个阶段。
当 maker 返回 `awaiting_agent` 信号时，`next_action` 成为真正的**事前指令**，
告诉 LLM 需要调用什么工具来产生真实代码。

### 后台自动循环（推荐）
用户确认 PRD 后，启动后台调度器自动执行整个循环：
1. 调用 `aza_auto_loop`（action="auto"）启动后台调度器
2. 调度器自动调用 `next()` 推进循环
3. 当需要 LLM 执行工具时（如 `aza_task_implement`），调度器自动暂停
4. LLM 执行完工具后，调用 `aza_auto_loop`（action="report_tool", tool_name="..."）通知调度器继续
5. 重复直到完成

### 单步模式（备选，每步可观察结果）
1. 调用 `aza_auto_loop`（action="step"）执行一步
2. 返回 `next_action` 指示下一步
3. 如果 `next_action.tool` 不是 `aza_loop_next`，执行该工具后再调用 `step`
4. 重复直到返回 `done: true`

### 全自动模式（一步到位）
1. 调用 `aza_auto_loop`（action="full"）执行完整循环
2. 自动处理：sentinel 检测 → PRD 审批门 → 升级处理
3. 返回完成状态和最终结果

### 状态监控
- 调用 `aza_auto_loop`（action="status"）查看当前驱动状态和调度器状态

## 跨会话恢复
1. 如果会话被中断，下次启动时 `aza_context_calibrate` 自动检测
2. 从 `.aza/STATE.yaml` 恢复阶段和迭代历史
3. 从 `.aza/RESUME.md` 恢复上下文和 next_action
4. 如果 PRD 待确认，重新展示 PRD 摘要
5. 使用 `aza_auto_loop` 继续执行中断的循环

## 重要规则
- 每次用户提交新需求，必须先走 PRD 先行流程，不得直接开始编码
- PRD 展示后必须等待用户确认，不得自行跳过审批
- 用户确认后，使用 `aza_auto_loop` 全自动执行直到完成
- V17: 启动后台调度器后，LLM 需要检查 `awaitingAction` 并执行对应工具
- V17: 执行完工具后调用 `report_tool` 通知调度器继续
- 每次工具调用都会自动更新 STATE 和预写 RESUME（防御性写入）
- 使用 `aza_auto_loop` 时无需手动处理 sentinel、PRD 审批门 — 全部自动处理
- 所有状态变更（阶段推进、迭代计数）自动落盘到 STATE.yaml 和 RESUME.md