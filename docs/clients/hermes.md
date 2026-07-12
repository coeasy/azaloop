# AzaLoop × Hermes

**Tier:** T3 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual trigger)

## 快速开始

```bash
npx @azaloop/cli init --client hermes
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.hermes/mcp.json` |
| Rules (skill) | `.hermes/skills/aza-loop.md` |

### MCP 配置 `.hermes/mcp.json`

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

Hermes 的 skill 系统帮助加载 AzaLoop 使用规则。循环需手动触发。

## Troubleshooting

- Hermes 使用 skill-based 规则加载
- 无自动 next_action 跟踪