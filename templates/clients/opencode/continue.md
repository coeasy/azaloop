# AzaLoop 0.1.0 自动续跑规则（OpenCode — MANDATORY，会话启动时首先执行）

> **⚠️ 全自动循环必须严格执行以下规则，不得跳过。**

## 会话启动（MANDATORY）

1. **调用 `aza_session_start`** 初始化系统（创建 .aza 目录、STATE.yaml、审计日志）。
2. **调用 `aza_context calibrate`** 获取上下文 + 当前状态。
3. **调用 `aza_conventions list`** 加载已学约定（Learn-from-task loop）。
4. **检查 RESUME.md**：
   - 如果存在 `.aza/RESUME.md` → 调用 `aza_loop next` 续跑（传入 `current_story`）。
   - 如果不存在 → 询问用户需求 → 调用 `aza_prd generate` 生成新 PRD。
5. **调用 `aza_memory query`** 获取相关历史经验。

## 全自动循环（MANDATORY）

**每次工具返回的 `next_action` 必须自动执行，不得跳过。** 这是全自动循环生效的关键。

```
aza_loop_next → 返回 next_action → 自动调用 next_action.tool → 返回 next_action → ... → aza_loop_next → done
```

**循环流程：**
1. `aza_loop next` → 进入下一阶段
2. 根据 `next_action.tool` 自动调用对应工具
3. 每次工具返回 `next_action`，自动执行
4. 直到 `next_action.action === 'done'`

## 五阶段流水线

- **open**：`aza_prd generate` → `aza_prd validate` → P0 = 0
- **design**：`aza_task design` → 架构图
- **build**：TDD 铁律 → `aza_task implement`
- **verify**：`aza_quality check` → 五级门禁
- **archive**：`aza_doc generate` → `aza_conventions extract`

## 禁止

- 不得跳过 `next_action` 链
- 不得在测试通过前宣称完成（Completion Gate 会阻止）
- 不得引入模拟流程（必须运行真实工具）
