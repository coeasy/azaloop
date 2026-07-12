# AzaLoop × Goose

**Tier:** T3 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client goose
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `mcp.json` (项目根目录) |

### MCP 配置 `mcp.json`

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

Goose 自动读取项目根目录的 MCP 配置。

## Troubleshooting

- 配置文件名需要是 `mcp.json`（在项目根目录）
- 无自动 next_action 链跟踪
