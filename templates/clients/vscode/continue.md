<!-- V17 — 引用共享模板 -->
> 本文件是共享模板的引用，完整内容见 `templates/clients/_shared/v16-auto-loop.md`

# VS Code 客户端配置 — AzaLoop 自动循环规则（V17）

<!-- 引用共享模板内容 -->
_请参考共享模板 [templates/clients/_shared/v16-auto-loop.md](https://github.com/azaloop/azaloop/tree/main/templates/clients/_shared/v16-auto-loop.md)_

## VS Code 特定配置

### MCP 配置
- 使用 `.vscode/azaloop.md` 配置规则
- 使用 `mcp.json` 配置 MCP 服务器
- 使用 `settings.json` 配置扩展设置

### 自动循环执行
用户确认 PRD 后，使用 `aza_auto_loop` 工具自动执行整个循环：

1. **后台自动循环**（推荐）：调用 `aza_auto_loop`（action="auto"）启动后台调度器
2. **单步模式**：调用 `aza_auto_loop`（action="step"）执行一步
3. **全自动模式**：调用 `aza_auto_loop`（action="full"）执行完整循环

## 重要规则
- 每次用户提交新需求，必须先走 PRD 先行流程
- 用户确认后，使用 `aza_auto_loop` 全自动执行直到完成
- 每次工具调用都会自动更新 STATE 和预写 RESUME
- 所有状态变更自动落盘到 STATE.yaml 和 RESUME.md