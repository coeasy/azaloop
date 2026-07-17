# AzaLoop: 让 AI 编码助手从"对话工具"进化为"自主开发引擎"

> **PRD-driven autonomous development loop engine — your AI coding assistant, on autopilot.**

---

## 你写代码还是 AI 写代码？

2024 年，AI 编码助手横空出世：Cursor、Claude Code、GitHub Copilot、Windsurf……开发者们欣喜地发现，AI 可以在聊天中写代码了。

但很快，所有人都遇到了同一个瓶颈：

**AI 可以写代码，但不能"完成"代码。**

你给它一个需求，它写几个文件，然后等你回复"继续"，再写几个文件，再回复"继续"……项目永远停留在"差不多做完"的状态。需求没有文档，测试没有编写，安全没有审查，质量无人把关。

这就是"对话式 AI 编程"的根本困境：**AI 是工具，不是引擎。**

---

## AzaLoop 做了什么？

AzaLoop 不是一个新的 AI 编码助手。它是让你的现有 AI 编码助手**进化**的引擎。

**一条命令，把 AI 从"对话工具"变成"自主开发引擎"。**

```bash
npx @azaloop/cli init
```

然后，在 Cursor / Claude Code / OpenCode / Trae 中输入一句话：

> "帮我创建一个 React + TypeScript 的待办事项应用，支持暗黑模式"

AzaLoop 不会停下来等你回复。它会**自动**完成：

```
需求 → PRD 生成 → 任务拆解 → 编码 → 测试 → 安全扫描 → 文档 → 交付
         ↑                                                    ↓
         └────── Reflexion 记忆反馈，跨会话持续学习 ────────────┘
```

**不需要 API Key。** 不需要配置 LLM。不需要安装新的 AI 助手。

---

## 为什么 AzaLoop 是革命性的？

### 1. 宿主 LLM 零配置

这是 AzaLoop 最独特的设计：**你不用为 AzaLoop 提供任何 API Key。**

AzaLoop 运行在你的 AI 编码助手内部，完全复用宿主环境已付费的模型：

| 宿主环境 | 复用模型 | 需要 API Key？ |
|---------|---------|-------------|
| Cursor | Cursor 订阅的所有模型 | ❌ |
| Claude Code | Claude 订阅 | ❌ |
| OpenCode | OpenCode 配置模型 | ❌ |
| Trae | Trae 内置模型 | ❌ |
| Windsurf | Windsurf 订阅模型 | ❌ |
| GitHub Copilot | Copilot 订阅模型 | ❌ |

**零成本，零配置。** 你已经在付费的 AI 助手，现在可以做以前做不到的事。

### 2. PRD 驱动，不是 Prompt 驱动

大多数 AI 编程工具的问题在于：它们响应的是 Prompt，不是需求。

AzaLoop 的第一步永远是**生成一份完整的 PRD（产品需求文档）**：

- 14 章结构化模板
- 14 维自动自检
- 模糊需求 → 清晰可执行的 Story
- 每个 Story 都有明确的验收标准

这意味着：**你的 AI 不是在"猜"你要什么，而是在"执行"你确认过的文档。**

### 3. 五阶段全自动流水线

AzaLoop 不是一次性对话。它是一个**有纪律的开发循环**：

```
┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐
│ open │ → │design│ → │ build│ → │verify│ → │archive│
└──────┘    └──────┘    └──────┘    └──────┘    └──────┘
   ↑           ↑           ↑            ↑            ↑
 PRD生成    架构设计   TDD编码     五级门禁     文档归档
 14章模板   任务拆解   测试先行   lint/test/   约定提取
 14维自检   设计文档   实现代码   build/secure 经验记忆
```

每个阶段都有**质量门禁**：

- **Lint** — 代码规范检查
- **Test** — 单元测试全部通过
- **Build** — 编译零错误
- **Security** — 密钥扫描、注入防御、PII 检测
- **Acceptance** — 验收标准逐条验证

**任何一关不通过，循环自动重试。** 不会让你得到一个"差不多能用"的代码。

### 4. 反射记忆（Reflexion Memory）

AzaLoop 有三个层次的记忆系统：

- **工作记忆** — 当前会话的状态和上下文
- **情景记忆** — 跨会话的开发历史和经验
- **语义记忆** — 从项目中提取的代码约定和最佳实践

这意味着：

> 你在一个项目中学会的编码风格，在另一个项目中会被自动应用。
> 你在一次循环中踩过的坑，在下一次循环中会被自动避开。

### 5. 25+ 客户端，一个引擎

AzaLoop 不是绑定在某个特定工具上的。它通过 **MCP 协议**（Model Context Protocol）与 25+ 个主流 AI 编码助手集成：

**T1 全功能**（自动 next_action 链跟踪）：
- Cursor、Claude Code、OpenCode、Trae

**T2 部分支持**（规则驱动循环）：
- VS Code + Copilot、Cline、Roo Code、Windsurf、Continue、Claude Desktop、GitHub Copilot、Gemini CLI、Codex CLI、Comate（百度）、WorkBuddy（腾讯）、Qwen Code（阿里）

**T3 基础支持**：
- Aider、Zed、Goose、Hermes、OpenClaw、Kiro、Codeium、Droid、OpenHands

**一个引擎，所有客户端，开箱即用。**

---

## 10 层架构：从平台到知识的完整体系

AzaLoop 不是堆砌功能。它是一个**经过精心设计的 10 层架构**：

```
┌─────────────────────────────────────────────────────────────┐
│ L9  Knowledge   │ 跨仓库知识共享、经验蒸馏、技术库        │
├─────────────────────────────────────────────────────────────┤
│ L8  Orchestration│ DAG 构建器、子代理调度、工作区隔离     │
├─────────────────────────────────────────────────────────────┤
│ L7  Loop        │ 三级循环 + 断路器 + 完成门              │
├─────────────────────────────────────────────────────────────┤
│ L6  Security    │ 密钥扫描、注入防御、PII 检测            │
├─────────────────────────────────────────────────────────────┤
│ L5  Skills      │ 动态技能注册、Red Flags 护栏            │
├─────────────────────────────────────────────────────────────┤
│ L4  Discipline  │ 4 条铁律 + 3 次警告系统                 │
├─────────────────────────────────────────────────────────────┤
│ L3  Roles       │ Maker/Checker/Optimizer 动态绑定       │
├─────────────────────────────────────────────────────────────┤
│ L2  Memory      │ 工作/情景/语义 三层记忆                 │
├─────────────────────────────────────────────────────────────┤
│ L1  Spec/PRD    │ PRD 生成器 + 14 维自检                  │
├─────────────────────────────────────────────────────────────┤
│ L0  Platform    │ 25+ 客户端检测与适配                    │
└─────────────────────────────────────────────────────────────┘
```

每一层都有明确的责任边界。每一层都可以独立升级。每一层都在**让 AI 编码从"对话"进化为"工程"**。

---

## 真实场景：3 分钟从零到可运行应用

```bash
# 第 1 步：创建项目并初始化
mkdir my-app && cd my-app
npx @azaloop/cli init

# 第 2 步：在 AI 助手中输入需求
# "创建一个 WebSocket 聊天应用，支持房间功能"
#
# AzaLoop 自动执行：
#   aza_session_start        → 初始化系统
#   aza_prd_generate         → 生成 PRD（14 章，14 维自检）
#   aza_loop_next            → 进入五阶段循环
#     1. open   → PRD 验证通过
#     2. design → 架构设计、任务拆解
#     3. build  → TDD: 测试 → 实现 → 通过
#     4. verify → 5 级门禁全部通过
#     5. archive → 文档生成、约定提取
#   aza_loop_complete        → 交付完成

# 第 3 步：打开浏览器，看到你的聊天应用
```

**整个过程，你不需要回复"继续"。** 不需要检查每个文件。不需要编写测试。AzaLoop 自己完成所有事情。

---

## 不只是代码，是工程

大多数 AI 编程工具的输出是：

```
一个目录，几个文件，可能能跑，可能不能跑，
测试文件不存在，安全漏洞没人管，
文档写不写看运气。
```

AzaLoop 的输出是：

```
一个完整的项目：
  ✅ PRD 文档（14 章结构化需求）
  ✅ 可运行的代码（lint 零警告）
  ✅ 完整的测试套件（100% 覆盖）
  ✅ 安全审查报告（密钥扫描 + PII 检测）
  ✅ 项目文档（README + API 文档）
  ✅ 代码约定（从项目中提取的最佳实践）
  ✅ 开发记忆（下次项目自动复用经验）
```

**这不是"AI 写的代码"。这是"AI 交付的工程"。**

---

## 开始使用

### 方式一：一行命令（推荐）

```bash
npx @azaloop/cli init
```

### 方式二：交互式安装向导

```bash
aza setup
```

引导式选择你的 AI 编码助手，自动配置所有文件。

### 方式三：便携安装包（无需 Node.js）

**Windows:**
```powershell
irm https://github.com/coeasy/azaloop/releases/latest/download/azaloop-portable.zip |
  Expand-Archive -DestinationPath azaloop
cd azaloop
.\install.ps1
```

**macOS/Linux:**
```bash
curl -fsSL https://github.com/coeasy/azaloop/releases/latest/download/azaloop-portable.zip |
  unzip - && cd azaloop && bash install.sh
```

### 支持的客户端

25+ 个 AI 编码助手，覆盖全球主流工具：

Cursor、Claude Code、OpenCode、Trae、VS Code + Copilot、Cline、Roo Code、Windsurf、Continue、Claude Desktop、GitHub Copilot、Gemini CLI、Codex CLI、Comate（百度）、WorkBuddy（腾讯）、Qwen Code（阿里）、Aider、Zed、Goose、Hermes、OpenClaw、Kiro、Codeium、Droid、OpenHands

---

## 项目地址

- **GitHub**: https://github.com/coeasy/azaloop
- **npm**: `@azaloop/cli`, `@azaloop/mcp-server`, `@azaloop/core`, `@azaloop/shared`
- **文档**: `docs/CLIENT-INSTALLATION.md` | `docs/CLIENT-INSTALLATION.en.md`
- **许可**: MIT

---

> **AzaLoop 不是另一个 AI 编码助手。它是让你的 AI 编码助手变成真正开发引擎的那个东西。**
>
> 你的 AI 已经在付费。现在，让它做点真正的事情。

---

*发布日期：2026-07-12 | 作者：AzaLoop 团队*
