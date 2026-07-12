# AzaLoop × Cline

**Tier:** T2 Partial | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client cline
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `cline_mcp_settings.json` (项目根目录) |
| 规则文件 | `.clinerules` |

### MCP 配置 `cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "azaloop": {
      "command": "npx",
      "args": ["@azaloop/mcp-server"],
      "disabled": false,
      "autoApprove": [
        "aza_prd_generate",
        "aza_loop_next",
        "aza_loop_status",
        "aza_quality_check"
      ]
    }
  }
}
```

## 使用

在 Cline 中直接输入需求，自动执行 AzaLoop 循环。

## Troubleshooting

- `autoApprove` 列表可减少确认步骤
- MCP 服务器需在项目中可见
