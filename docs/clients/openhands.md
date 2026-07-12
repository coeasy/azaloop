# AzaLoop × OpenHands

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client openhands
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.openhands/mcp.json` |
| 规则文件 | `.openhands/instructions.md` |

### MCP 配置 `.openhands/mcp.json`

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

OpenHands（原 OpenDevin）通过 MCP 协议调用 AzaLoop 工具。

## Troubleshooting

- 需要 OpenHands MCP 支持
- 规则文件指导 agent 行为但无法强制执行
