# AzaLoop × OpenClaw

**Tier:** T3 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual trigger)

## 快速开始

```bash
npx @azaloop/cli init --client openclaw
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `mcp.json` (项目根目录) |
| 规则文件 | `clawhub.json` |

### MCP 配置 `mcp.json`

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

OpenClaw 的规则通过 `clawhub.json` 管理。循环步骤需手动跟踪。

## Troubleshooting

- 配置在项目根目录
- openclaw 是为 AGI 设计的编程平台