# Cursor (`cursor`)

> Tier1: ✅ | Category: ide | Since: 0.1.0

## 环境变量

- `AZA_CLIENT_NAME=cursor`
- `AZA_CLIENT_VERSION`

## 安装步骤

- 1. 安装 Cursor IDE (cursor.com)
- 2. 安装 AzaLoop MCP server: pnpm add -g @azaloop/mcp-server
- 3. 在 Cursor 设置 → Features → Model Context Protocol 添加 server
- 4. 配置 stdio 启动: aza mcp serve

## 启动命令

```bash
aza mcp serve --client cursor
```

## 推荐工具

- `aza_session`
- `aza_prd`
- `aza_auto`
- `aza_loop`
- `aza_meta`

## 已知限制

- Composer 不响应 next_action，需手动复制
- 没有 terminal 写入能力时降级到 file_write
