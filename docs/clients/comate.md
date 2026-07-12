# AzaLoop × Comate (百度)

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client comate
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.comate/mcp.json` |
| 规则文件 | `.comate/rules.md` |

### MCP 配置 `.comate/mcp.json`

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

Comate 支持 MCP 协议和 skills 系统，自动跟踪循环。

## Troubleshooting

- 百度 Comate 的 MCP 配置在项目级 `.comate/` 目录
- 支持规则文件自动注入
