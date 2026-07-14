# AzaLoop × Zed

**Tier:** T3 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client zed
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.zed/mcp.json` |

### MCP 配置 `.zed/mcp.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"]
    }
  }
}
```

## 使用

Zed 支持 MCP 协议，重启后工具自动可用。

## Troubleshooting

- Zed 的 MCP 配置在项目级 `.zed/mcp.json`
- 在 Zed 设置中也可配置全局 MCP
