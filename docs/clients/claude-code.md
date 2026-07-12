# AzaLoop × Claude Code

**Tier:** T1 Full | **MCP:** ✅ | **Hooks:** ✅ | **Auto-Loop:** ✅

## 快速开始

```bash
npx @azaloop/cli init --client claude-code
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.claude/mcp.json` |
| 规则文件 | `CLAUDE.md` |
| Agent | `.claude/agents/azaloop.json` |

### MCP 配置 `.claude/mcp.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "env": {}
    }
  }
}
```

## 使用

```bash
cd your-project
claude
# 在 Claude Code 中：
# "帮我创建一个 API 服务"
```

## Troubleshooting

- 确保 `CLAUDE.md` 在项目根目录
- Claude Code 自动读取项目中配置的 MCP 服务器
