# AzaLoop × VS Code (GitHub Copilot)

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client vscode
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP + 设置 | `.vscode/settings.json` |
| 规则文件 | `.github/copilot-instructions.md` |

### 设置 `.vscode/settings.json`

```json
{
  "mcp.enabled": true,
  "mcp.servers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"]
    }
  },
  "chat.mcpTools": true
}
```

## 使用

在 VS Code Chat (Ctrl+Shift+I) 中：
```
@azaloop 帮我添加用户登录功能
```

## Troubleshooting

- 需要 VS Code 1.95+ 和 GitHub Copilot Chat
- 在设置中搜索 `mcp` 确保已启用
