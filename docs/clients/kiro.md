# AzaLoop × Kiro

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client kiro
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.kiro/mcp.json` |
| 规则文件 | `.kiro/azaloop.md` |

### MCP 配置 `.kiro/mcp.json`

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

Kiro 支持 MCP 协议，无自动 next_action 跟踪。

## Troubleshooting

- 手动跟踪循环步骤
- MCP 工具需要用户确认
