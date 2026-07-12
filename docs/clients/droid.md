# AzaLoop × Droid

**Tier:** T3 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client droid
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.droid/mcp.json` |

### MCP 配置 `.droid/mcp.json`

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

Droid 支持 MCP 协议，简单配置后即可使用。

## Troubleshooting

- 无 rules 文件支持
- 手动触发循环步骤