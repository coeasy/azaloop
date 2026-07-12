# AzaLoop × Codex CLI

**Tier:** T2 | **MCP:** ✅ | **Hooks:** ❌ | **Auto-Loop:** ✅ (via rules)

## 快速开始

```bash
npx @azaloop/cli init --client codex-cli
```

## 配置

| 文件 | 位置 |
|------|------|
| MCP 配置 | `mcp.json` (项目根目录) |
| 规则文件 | `AGENTS.md` |

### MCP 配置 `mcp.json`

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

Codex CLI 读取根目录的 MCP 配置和 `AGENTS.md` 规则。

## Troubleshooting

- `AGENTS.md` 在项目根目录，用于定义 agent 行为
- 支持自动 next_action 链
