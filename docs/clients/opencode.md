# AzaLoop × OpenCode

**Tier:** T1 Full | **MCP:** ✅ | **Hooks:** ✅ | **Auto-Loop:** ✅

## 快速开始（Quick Start）

```bash
# 一行命令初始化
npx @azaloop/cli init --client opencode

# 或在项目目录中自动检测
npx @azaloop/cli init
```

## 配置（Configuration）

自动生成文件：

| 文件 | 位置 | 作用 |
|------|------|------|
| MCP 配置 | `.opencode/mcp.json` | 连接 AzaLoop MCP 服务器 |
| 规则文件 | `.opencode/rules.md` | 会话启动规则 |
| 续跑文件 | `.opencode/continue.md` | 自动续跑流程 |

### 手动配置

如果 `aza init` 不可用，手动创建 `.opencode/mcp.json`：

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "node",
      "args": ["packages/mcp-server/dist/server.js"],
      "env": {}
    }
  }
}
```

## 使用（Usage）

在 OpenCode 聊天中输入：

```
用户: 帮我创建一个 React 待办事项应用
```

AI 助手将自动执行：
1. `aza_session_start` — 初始化系统
2. `aza_prd_generate` — 生成 PRD
3. 五阶段全自动循环 → 完成交付

## Troubleshooting

- **MCP 连接失败**：检查 `.opencode/mcp.json` 中的 `command` 路径是否正确
- **工具未找到**：运行 `pnpm build` 确保服务器已编译
- **Workspace 模式**：确保从 monorepo 根目录运行 OpenCode
