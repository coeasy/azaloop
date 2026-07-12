# AzaLoop × GitHub Copilot

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual)

## 快速开始

```bash
npx @azaloop/cli init --client github-copilot
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.github/mcp.json` |
| 指令文件 | `.github/copilot-instructions.md` |

### MCP 配置 `.github/mcp.json`

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

在 GitHub Copilot Chat 中，通过 `@azaloop` 调用工具。

## Troubleshooting

- 需要 GitHub Copilot Chat 权限
- 确保 `.github/mcp.json` 格式正确
