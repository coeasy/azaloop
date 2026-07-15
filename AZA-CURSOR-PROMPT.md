# 在 Cursor Agent 中粘贴此提示

按 AzaLoop 全自动协议执行，**不要**问我 Continue / 是否继续。

工作区：当前项目根目录。

## 需求
实现 `add(a: number, b: number): number`，并用 vitest 写单元测试。

## 强制步骤
1. `aza_session` → `action: calibrate`
2. `aza_prd` → `action: review`, title=`Add utility`, description=上面需求, `auto_approve: true`
3. 跟随返回的 `next_action`：`aza_loop` → `action: full`
4. 若有 `awaitingAction`：先执行该工具，再 `aza_loop` → `action: report_tool`, `tool_name`=刚才工具名
5. 循环直到 `aza_finish` → `action: ship`

只用这 8 个工具：aza_session / aza_prd / aza_loop / aza_spec / aza_quality / aza_finish / aza_memory / aza_meta
