# AzaLoop × Qwen Code (阿里)

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client qwen-code
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.qwen/mcp.json` |
| 规则文件 | `.qwen/rules.md` |

### MCP 配置 `.qwen/mcp.json`

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

Qwen Code 支持规则注入和自动 next_action 链。

## Troubleshooting

- 阿里 Qwen Code 的 MCP 配置在 `.qwen/` 目录
- 规则文件驱动自动循环
