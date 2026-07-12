# AzaLoop × Gemini CLI

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client gemini-cli
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.gemini/mcp.json` |
| 规则文件 | `.gemini/rules.md` |

### MCP 配置 `.gemini/mcp.json`

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

Gemini CLI 支持规则注入和自动 next_action 链跟踪。

## Troubleshooting

- Gemini CLI 支持 skills 系统
- 需要 `.gemini/` 目录在项目根目录
