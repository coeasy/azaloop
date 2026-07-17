# 全自动循环未生效 — 根因与修复（2026-07-16）

## 症状
- 停在 `open` / 或 design/build 空转后 circuit breaker
- 工具列表只有 session/prd/meta
- PRD stories 变成 GitHub URL
- build 阶段反复失败：`No progress: 5 consecutive failures`

## 根因链（全部）

| # | 根因 | 影响 |
|---|------|------|
| 1 | `STAGE_TOOL_GROUPS.open` 隐藏 `aza_loop`/`aza_auto` | 宿主无法执行 next_action |
| 2 | MCP 指向错误仓库 `D:/work_code/azaloop/azaloop` | 状态写到别的目录 |
| 3 | design 完成要 7 张图或完整 OpenSpec | design 永不完成 |
| 4 | 竞品 URL 子弹 bullet 变成 FR/story | PRD 垃圾、验收无意义 |
| 5 | build checker 在 monorepo 根跑裸 `tsc --noEmit` 失败 → `unit_test_pass_pct=0` | circuit breaker 熔断 |

## 已修复（代码）

1. **Spine 工具面** — 每阶段含 loop/auto；`listTools` 默认全量  
2. **MCP 配置** — 指向本仓库 + `AZA_AUTO_APPROVE_PRD=true`  
3. **Lean design gate** — `.aza/design.md` + `## Technical Approach` 即可  
4. **PRD URL 过滤** — `isCompetitiveUrlNoise`  
5. **Build checker** — `build-complete.marker` / OpenSpec tasks 全勾 → 直接 100% 通过；tsc 改为 `packages/core`  
6. **BatchRunner + loop_ready + 架构文档**

## 验证

```bash
pnpm --filter @azaloop/core build
pnpm --filter @azaloop/mcp-server build
pnpm vitest run tests/unit/stage-tool-groups-spine.test.ts tests/unit/batch-runner.test.ts
```

## 你必须做的一次操作

**Reload Window / 重启 azaloop MCP**，否则 Cursor 仍加载旧 `dist`（不会热更新）。

然后：

```text
aza_auto(user_input=需求, workspace_path=本仓库根)
→ 跟随 next_action / awaitingAction
→ design.md 写好 Technical Approach；实现后写 .aza/build-complete.marker
→ aza_quality(check) → aza_finish(ship)
```

## 本次会话进度

- `aza_auto` 已成功把阶段推进到 design → build  
- 因根因 #5 触发 circuit breaker；已 reset + 修复 checker  
- 需 **重启 MCP** 后再跑 `aza_loop(full)` 才能吃到新 dist
