# AzaLoop × Workbuddy (字节跳动)

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client workbuddy
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.workbuddy/mcp.json` |
| 规则文件 | `.workbuddy/rules.md` |

### MCP 配置 `.workbuddy/mcp.json`

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

Workbuddy 支持 MCP 协议和 skills 系统，自动跟踪循环。

## Troubleshooting

- 字节跳动 Workbuddy 的 MCP 支持
- 规则文件自动加载到上下文
