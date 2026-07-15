# AzaLoop 0.1.0 — 竞品分层分析报告

> **版本**: 0.1.0
> **日期**: 2026-07-12
> **原则**: 竞品对比锚定在 **十层架构（L0–L9）** 内，每个竞品对齐到它真正竞争的「层」，而不是把 AzaLoop 当成独立 IDE 去和 Cursor / Claude Code 比。独立 IDE/客户端只出现在 L0（平台适配）与 L8（编排器）的「被适配/被编排对象」维度。

---

## 0. 为什么按层对齐，而不按 IDE 对齐

用户明确指出：PRD 文档中的竞品对比应是 **10 层架构中的竞品**，不是独立 IDE。原因：

- AzaLoop 的差异化是「**宿主 LLM 优先**」——它复用 Cursor / Claude Code / OpenCode 等宿主的模型与执行能力，自身不提供 IDE。
- 因此真正该比的是「**每一层的能力模块**」：PRD 生成器（L1）、记忆（L2）、角色（L3）、纪律（L4）、技能（L5）、安全（L6）、循环（L7）、编排（L8）、知识（L9）、平台适配（L0）。
- 独立 IDE 仅在 L0 作为「被适配客户端」、在 L8 作为「被编排执行器」出现。

---

## 1. 竞品总览（24 个，对齐到层）

| # | 竞品 | 主对齐层 | 形态 | 热度/状态 |
|---|-------|---------|------|-----------|
| 1 | **Trellis** (mindfold-ai) | L0 / L2 / L3 | 仓库内 harness（spec+task+journal） | ~12k⭐，支持 OpenCode 等 16+ 平台 |
| 2 | **OpenSpec** (Fission-AI) | L1 / L9 | CLI + slash 命令的 spec 层 | ~60k⭐，25+ 工具，MIT |
| 3 | **AGENTS.md** (Agentic AI Foundation) | L0 | 规范指令面（canonical instruction surface） | 被 20+ 工具读取 |
| 4 | **Spec Kit** (github) | L1 | GitHub 官方 SDD 工具 | 官方背书，Python |
| 5 | **Kiro** (AWS) | L1 | 规格驱动 IDE | AWS 生态，锁定 Claud |
| 6 | **ralphy-openspec** | L1 / L7 | Ralph Loop × OpenSpec 生命周期 | 社区 |
| 7 | **create-prd-skill** | L1 | PRD 生成 skill（14 维自检） | 社区 skill |
| 8 | **GSD** | L1 | 轻量 SDD | 社区 |
| 9 | **Taskmaster AI** | L1 / L8 | 任务图管理 | 社区 |
| 10 | **BMAD** | L1 / L3 | 角色化 agentic SDLC | 社区 |
| 11 | **Mem0** | L2 | 托管记忆层 | 商业/开源 |
| 12 | **Claude Code memory / CLAUDE.md** | L2 | 原生记忆 | Anthropic |
| 13 | **superpowers** (obra) | L3 / L4 | 方法论工具箱（TDD/调试/评审） | ~社区标杆 |
| 14 | **OpenHands** (All-Hands-AI) | L3 / L8 | 自主编码 agent（多 agent） | ~开源头部 |
| 15 | **Devin** (Cognition) | L3 / L8 | 全自主 SWE agent | 商业闭源 |
| 16 | **agent-skills** (VoltagePark) | L5 | Red Flags 反借口护栏 skill | 社区 |
| 17 | **OpenClaw / clawhub** | L5 | skill 注册生态 | 社区 |
| 18 | **shellward** | L6 | 安全门 / 提示注入防御 | 社区 |
| 19 | **gstack** | L6 / L7 | `/review` 安全评审 | 社区 |
| 20 | **Ralph** (snarktank/ralph) | L7 | 自主 PRD 循环（git 持久化记忆） | ~17.5k⭐ |
| 21 | **loop-engineering** (Nickgalitsky) | L7 / L8 | 定时自动化 + 7 循环模式 + 断路器 | 研究/参考实现 |
| 22 | **comet** | L7 | 5 阶段状态机 + auto_transition + Guard | 社区 |
| 23 | **planning-with-files** | L7 / L0 | /plan-loop + /plan-goal + Completion Gate | Cursor 生态 |
| 24 | **Codex CLI / Gemini CLI / Claude Code** | L8 | 自主编码 CLI（子代理编排） | 厂商官方 |

> 另有多客户端（Cursor / Windsurf / VS Code Copilot / Trae / Cline / Aider / Roo / Qoder / Comate / WorkBuddy / Zed / Codeium / Droid / Goose / Hermes / Pi）仅在 **L0 适配矩阵** 与 **L8 执行器** 维度出现，见 §10。

---

## 2. L0 — 平台 / 客户端适配层

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **Trellis** | `.trellis/` 仓库内 harness，生成各平台适配文件；Hook + 子代理双轨；`[workflow-state:STATUS]` 每轮注入 next-action | 多平台最成熟（16+，含 OpenCode）；文件即事实源；团队共享 | AGPL 重；强依赖宿主 skill；无自身执行引擎 | 平台能力矩阵、per-turn 工作流态注入、spec 蒸馏 |
| **OpenSpec** | 30+ AI 助手通过 slash 命令接入；stores 跨仓 spec | 社区最大、最轻；artifact 自由迭代 | 无强制执行/循环；靠 agent 自觉 | artifact-guided workflow、跨仓 store |
| **AGENTS.md** | Linux Foundation Agentic AI Foundation 维护的规范指令面 | 20+ 工具共读，单一事实源；零依赖 | 仅指令，无引擎；需各工具生成指针文件 | 以 AGENTS.md 为 canonical，其余生成指针（已在 L0 采用） |

---

## 3. L1 — 规格 / PRD 层

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **OpenSpec** | propose→specs→tasks artifact 流；轻量 | 60k⭐、自由迭代无刚性门禁 | 无强制门禁、无自动循环 | artifact 结构、跨工具兼容 |
| **Spec Kit** | GitHub 官方 SDD；plan→specs→tasks 刚性阶段 | 官方、严谨 | 重（Python、大量 Markdown、刚性门禁） | 严谨阶段定义（降级的反面教材） |
| **Kiro** | AWS 规格驱动 IDE；steering | 原生 IDE 体验 | 锁定 IDE + Claude 模型 | steered spec 思路 |
| **ralphy-openspec** | Ralph Loop（AI 反复执行）× OpenSpec 生命周期 | 真正自主循环 + spec 治理 | 客户端覆盖有限 | Ralph Loop × 生命周期组合 |
| **create-prd-skill** | 多轮自优化 + 14 维审查 + check-prd | PRD 质量高、可测试验收标准 | 只做 PRD，无后续循环 | 14 章模板、14 维自检、双路径审查 |
| **GSD / Taskmaster / BMAD** | 轻量 SDD / 任务图 / 角色化 SDLC | 简单/可视化/角色化 | 缺执行强制 | 任务图（DAG）、角色化 |

---

## 4. L2 — 记忆层

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **Trellis journals** | `.trellis/workspace/<dev>/journal` 每开发者日志 | 会话连续性、团队共享、按人隔离避免冲突 | 非结构化、需 agent 自觉写 | 工作记忆 journal 模式 |
| **Mem0** | 托管/可自托管的记忆层 | 可扩展、即插即用、语义检索 | 外部服务、成本、隐私 | 语义记忆抽象接口 |
| **CLAUDE.md / 原生记忆** | 单文件指令+记忆 | 零配置 | 单体膨胀、无结构、无跨会话检索 | 反例：需要分层记忆 |

> AzaLoop 三层记忆（Working / Episodic / Semantic）对齐：Trellis journal≈Episodic，Mem0≈Semantic，CLAUDE.md≈Working 压缩。

---

## 5. L3 — 角色层（research / implement / check）

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **superpowers** | 方法论工具箱：TDD、系统调试、brainstorming、code review | 把工程最佳实践编码进 agent 行为；agent 无关 | 需自行接线；无执行引擎 | 角色纪律（research/implement/check 分离） |
| **OpenHands** | 多 agent 自主编码，含代码执行沙箱 | 真实自主执行、可跑代码 | 独立 agent，非可插入 harness | 执行沙箱、子代理调度 |
| **Devin** | 全自主 SWE agent | 端到端自主 | 商业闭源、贵、黑盒 | 自主度标杆（目标） |

---

## 6. L4 — 纪律层（TDD / 铁律）

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **superpowers TDD** | RED-GREEN-REFACTOR，绝对措辞（"NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST"） | 杜绝「先写功能再补测试」借口 | 需 agent 遵守 | 绝对铁律措辞、反借口表 |
| **Karpathy 4 铁律** | 先想再写 / 简单优先 / 外科手术式 / 目标驱动 | 简洁可记忆 | 原则非实现 | 纪律清单 |

> AzaLoop 已在 build 阶段内循环强制 TDD + 4 铁律 + 8 反借口（agent-skills 的 Red Flags 思路）。

---

## 7. L5 — 技能层

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **agent-skills** | Red Flags 明确提示（预判 AI 借口） | 实用护栏、可组合 | 需集成 | Red Flags → build 阶段反借口表 |
| **OpenClaw / clawhub** | skill 注册/分发生态 | 生态化、可发现 | 小众 | skill 注册表（aza_skill search/list） |

---

## 8. L6 — 安全层

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **shellward** | 安全门 / 提示注入与 PII 检测 | 聚焦、可嵌入 pre/post-tool | 面较窄 | pre-tool 输入审计、post-tool 输出扫描 |
| **gstack** | `/review` 安全/质量评审 | 评审闭环 | 偏评审非防御 | 评审门禁思路 |

> AzaLoop 已落地 8 层防御 + Policy-as-Code + 中国合规；建议补强 PII/注入的「工具级强制扫描」（shellward 思路）。

---

## 9. L7 — 循环 / 编排引擎层（核心竞争层）

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **Ralph** | 自主循环执行 PRD，git 持久化记忆，prd.json | 简单、已被验证的循环 + 持久化 | 单客户端倾向、无 spec 门禁 | prd.json 格式、git 持久化记忆 |
| **loop-engineering** | Scheduled Automation（daily_triage / pr_babysitter / ci_sweeper）+ 7 循环模式 + Circuit Breaker（4 维度）+ loop-audit（18 信号） | 循环治理最完备 | 研究/参考实现，未打包 | 定时触发、断路器、审计信号 |
| **comet** | 5 阶段状态机 + auto_transition + Guard 脚本 + Completion Gate | 阶段门控强、自动流转 | 维护状态不明 | 5 阶段机、Guard、Completion Gate |
| **planning-with-files** | `/plan-loop`（外）+ `/plan-goal`（内）双循环 + Completion Gate（5 条件）+ Run Ledger + 5-Question Reboot | 文件化恢复、防假完成 | 偏 Cursor 生态 | 双循环、Completion Gate、Run Ledger、Reboot Test |
| **ralphy-openspec** | Ralph Loop × OpenSpec 生命周期 | 自主 + spec 治理 | 客户端有限 | 组合模式 |

> **AzaLoop 差异化壁垒（三级循环）**：外循环（时间驱动分诊）× 内循环（目标驱动 5 阶段）× 阶段内循环（maker/checker 质量门控），三级全部接入断路器。这是上述竞品的超集组合。

---

## 10. L8 — 编排器层（swarm / worktree / 并行）

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **loop-engineering swarm** | 子代理分派、worktree 隔离 | 并行安全 | 参考实现 | sub-agent dispatch、worktree 隔离 |
| **Codex CLI** | OpenAI 官方自主 CLI，子代理 | 模型强 | 绑定 OpenAI | 子代理编排范式 |
| **Gemini CLI** | Google 开源自主 CLI，超长上下文 | 开源、上下文大 | 绑定 Google | 开源 CLI 范式 |
| **Claude Code** | 原生 hook + subagent + MCP | 工具链最佳 | 绑定 Anthropic | hook 驱动的续航范式 |
| **多客户端（Cursor/Windsurf/Copilot/Trae/Cline/Aider/Roo/Qoder/Comate/WorkBuddy/Zed/Codeium/Droid/Goose/Hermes/Pi）** | 仅作为「被适配客户端（L0）」或「被编排执行器（L8）」 | 覆盖广 | 各自能力不一 | 降级策略矩阵（Full→Manual-Trigger） |

---

## 11. L9 — 知识层

| 竞品 | 特点 | 优点 | 缺点 | 借鉴点 |
|------|------|------|------|--------|
| **OpenSpec Stores** | 跨仓 spec store，git push 共享 | 团队单一事实源 | 需独立仓 | 跨仓知识共享 |
| **Trellis spec distillation** | 任务经验提升为 `.trellis/spec/` | 经验复用、越用越聪明 | 需 agent 自觉提升 | 经验蒸馏回语义记忆 |

---

## 12. 关键差异化壁垒（AzaLoop 0.1.0）

1. **宿主 LLM 优先 + MCP 能力补偿层**：所有竞品（superpowers / Trellis / OpenSpec / comet / loop-engineering）都依赖客户端原生能力；AzaLoop 用 MCP Server 作为能力均衡器——无 Hook 用 `aza_continue` 补偿，无 Rules 用 `aza_context calibrate` 补偿，无循环用 `aza_loop next` + `next_action` 链补偿。
2. **三级循环引擎**：外循环（时间驱动分诊）+ 内循环（目标驱动 5 阶段）+ 阶段内循环（maker/checker 质量门控），三级全接断路器。
3. **Completion Gate（5 条件 + 5-Question Reboot）**：阻止「假完成」，来自 planning-with-files。
4. **跨 24 客户端等价全自动**：MCP 事件模拟器在工具层强制执行，不依赖 LLM 自觉（规则注入是「建议」，模拟器是「强制」）。

---

## 13. 待补强的借鉴项（本版本已落地 / 计划落地）

| 来源 | 借鉴点 | 0.1.0 状态 |
|------|--------|-----------|
| create-prd-skill | 14 章 + 14 维自检 | ✅ 已落地（L1） |
| superpowers | TDD 铁律 + 反借口 | ✅ 已落地（L4） |
| comet / planning-with-files | Completion Gate | ✅ 已落地（L7） |
| loop-engineering | 断路器 + loop-audit | ✅ 已落地（L7） |
| shellward | 工具级 PII/注入强制扫描 | 🔲 计划增强（L6） |
| Mem0 | 语义记忆抽象接口 | 🔲 计划增强（L2） |
| OpenSpec Stores / Trellis | 跨仓/蒸馏知识 | 🔲 计划增强（L9） |
| Trellis | OpenCode 平台适配 | ✅ 本版本新增（L0，见优化计划） |

---

**文档结束**
