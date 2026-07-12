# AzaLoop × Continue

**Tier:** T2 Partial | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client continue
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.continue/config.json` |
| 规则文件 | `.continuerules` |

### MCP 配置 `.continue/config.json`

```json
{
  "mcpServers": [
    {
      "name": "azaloop",
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "env": {}
    }
  ]
}
```

## 使用

Continue 使用 `mcpServers` 数组格式，重启后生效。

## Troubleshooting

- Continue 配置格式与其他客户端的 `mcpServers` 对象不同
