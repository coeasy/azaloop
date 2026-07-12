# AzaLoop × Roo Code

**Tier:** T2 Partial | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client roo-code
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.roo/mcp.json` |
| 规则文件 | `.roo/azaloop.md` |

### MCP 配置 `.roo/mcp.json`

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

Roo Code 支持自动 next_action 链跟踪，输入需求即可。

## Troubleshooting

- 确保 `.roo/` 目录在项目根目录
- 规则文件自动加载到聊天上下文
