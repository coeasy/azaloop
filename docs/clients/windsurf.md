# AzaLoop × Windsurf

**Tier:** T2 Partial | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ❌ (manual loop)

## 快速开始

```bash
npx @azaloop/cli init --client windsurf
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `.windsurf/mcp.json` |
| 规则文件 | `.windsurf/rules/azaloop.md` |

### MCP 配置 `.windsurf/mcp.json`

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

需要手动调用循环步骤：

```
1. aza_session_start
2. aza_prd_generate
3. aza_loop_next (手动触发)
```

## Troubleshooting

- Windsurf 无自动 next_action 链跟踪
