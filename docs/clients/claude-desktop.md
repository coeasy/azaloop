# AzaLoop × Claude Desktop

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual trigger)

## 快速开始

```bash
npx @azaloop/cli init --client claude-desktop
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `claude_desktop_config.json` (项目根目录) |

> **注意**：Claude Desktop 通常使用全局配置而非项目级配置。`aza init` 生成项目级配置文件供参考。

### MCP 配置 `claude_desktop_config.json`

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

在 Claude Desktop 中，AzaLoop 工具自动可用。手动触发循环步骤。

## Troubleshooting

- Claude Desktop 全局配置通常在 `~/Library/Application Support/Claude/`
- 工具调用需要用户确认
