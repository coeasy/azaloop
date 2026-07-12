# AzaLoop × Cursor

**Tier:** T1 Full | **MCP:** ✅ | **Hooks:** ✅ | **Auto-Loop:** ✅

## 快速开始

```bash
npx @azaloop/cli init --client cursor
```

## 配置

自动生成：

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.cursor/mcp.json` |
| 规则文件 | `.cursor/rules/azaloop.mdc` |
| 续跑文件 | `.cursor/rules/continue.mdc` |

### MCP 配置 `.cursor/mcp.json`

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

**重启 Cursor** 后生效。

## 使用

```
用户: 帮我设计一个用户认证系统
```

自动流程：`aza_session_start` → `aza_prd_generate` → 循环 → 完成

## Troubleshooting

- MCP 配置后需重启 Cursor
- 检查 Cursor 设置中 MCP 服务器状态
