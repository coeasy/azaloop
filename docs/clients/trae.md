# AzaLoop × Trae

**Tier:** T1 Full | **MCP:** ✅ | **Hooks:** ✅ | **Auto-Loop:** ✅

## 快速开始

```bash
npx @azaloop/cli init --client trae
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.trae/mcp.json` |
| 规则文件 | `.trae/rules.md` |

### MCP 配置 `.trae/mcp.json`

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

在 Trae 聊天中输入需求，AzaLoop 自动执行五阶段开发循环。

## Troubleshooting

- 重启 Trae 使 MCP 配置生效
- Trae 的 MCP 配置在项目级生效
