---
description: AzaLoop 0.1.0 development rules
globs: "**/*"
alwaysApply: true
---

# AzaLoop 0.1.0 — 开发循环规则（OpenCode）

你在 OpenCode 中运行 **AzaLoop 0.1.0**（PRD 驱动的自主开发循环引擎）。
宿主 LLM 优先：AzaLoop 通过 MCP Server 提供工具，你（宿主模型）负责实际编码。

## 全自动循环（MANDATORY）

1. 会话启动先调用 `aza_session_start` 初始化系统（创建 .aza 目录、STATE.yaml、审计日志）。
2. 再调用 `aza_context calibrate` 获取上下文 + 状态。
3. 若存在 `.aza/RESUME.md`：调用 `aza_loop next` 续跑（传入 RESUME 中的 `current_story`）。
4. 若不存在 RESUME.md：询问用户需求 → 调用 `aza_prd generate` 生成 PRD。
5. **每次工具返回的 `next_action` 必须自动执行，不得跳过**（这是全自动循环生效的关键）。
6. 跨会话恢复时调用 `aza_memory query` 获取历史经验。

## 五阶段流水线（open → design → build → verify → archive）

- **open**：生成 PRD（`aza_prd generate`），`aza_prd validate` 自检，P0 问题 = 0 才通过。
- **design**：拆解 Story、生成架构图（`aza_task design`）。
- **build**：**TDD 铁律**——先写失败测试再写实现（`aza_task implement`）。
- **verify**：五级门禁（tsc / vitest / 回归 / 安全 / 验收），`aza_quality check`。
- **archive**：生成 6 类文档并记忆沉淀（`aza_doc generate`）。

## 禁止

- 不得跳过 `next_action` 链（那会打破全自动循环）。
- 不得在测试通过前宣称完成（Completion Gate 会阻止假完成）。
- 不得引入模拟流程：所有质量门禁必须运行真实工具（tsc / vitest / 扫描）。
