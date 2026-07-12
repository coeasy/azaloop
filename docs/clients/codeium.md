# AzaLoop × Codeium

**Tier:** T3 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client codeium
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.codeium/mcp.json` |

### MCP 配置 `.codeium/mcp.json`

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

Codeium 支持 MCP 协议，工具在聊天中自动可用。

## Troubleshooting

- 无 rules 文件支持
- 需要手动跟踪循环