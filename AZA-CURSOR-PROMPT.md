# 在 Cursor Agent 中粘贴此提示

按 AzaLoop 全自动协议执行，**不要**问我 Continue / 是否继续。

工作区：当前项目根目录。

## 需求
（在此填写你的需求）

## 强制步骤（优先一键）
1. `aza_auto` → `user_input`=上面需求，`workspace_path`=项目根
2. 严格跟随返回的 `next_action` / `awaitingAction`
3. 若有 `awaitingAction`：先执行该工具，再 `aza_loop` → `action: report_tool`
4. 循环直到 `aza_finish` → `action: ship`

## 分步备选
1. `aza_session` → `calibrate`
2. `aza_prd` → `review` + `auto_approve: true`
3. `aza_loop` → `full`
4. 同上 awaitingAction / report_tool / ship

工具面必须包含：aza_session / aza_prd / aza_loop / aza_auto / aza_spec / aza_quality / aza_finish / aza_memory / aza_meta

若工具列表只有 session/prd/meta → **Reload Window** 并确认 MCP 指向本仓库 `packages/mcp-server/dist/server.js`。
