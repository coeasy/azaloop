# AzaLoop V12.2 循环规则

## 自动循环驱动
- 每次工具调用返回的 `next_action` 必须自动执行
- `next_action.action = 'done'` 时停止
- 不得跳过 `next_action` 或自行决定下一步

## PRD 先行
- 用户提交新需求时，先调用 `aza_prd_review`
- 展示 PRD 摘要后，等待用户确认
- 60s 无输入自动确认

## 状态持久化
- 每次工具调用自动更新 `.aza/STATE.yaml`
- 每次工具调用自动预写 `.aza/RESUME.md`
- 会话启动时调用 `aza_context_calibrate` 恢复状态

## 工具调用链
aza_context_calibrate → aza_prd_review → aza_prd_approve → aza_loop_next → 
aza_task_design → aza_task_implement → aza_quality_check → aza_doc_generate → done
