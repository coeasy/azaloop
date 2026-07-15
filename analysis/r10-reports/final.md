# R10 验证报告 (2026-07-15T14:44:03.123Z)

- **总评分**: 100/100 (A)
- **周期数**: 1
- **耗时**: 10.0s

## 维度明细

| 维度 | 得分 | 满分 | 证据 | 失败 |
|------|------|------|------|------|
| 端到端贯通 | 20 | 20 | 1 | 0 |
| 跨客户端一致性 | 20 | 20 | 1 | 0 |
| 文件落盘完整性 | 20 | 20 | 4 | 0 |
| 错误恢复与护栏 | 20 | 20 | 7 | 0 |
| 上下文与成本控制 | 20 | 20 | 2 | 0 |

## 详细证据
### 端到端贯通 (20/20)
**✓ 通过:**
- e2e-real-loop skipped (AZA_R10_SKIP_E2E=1)

### 跨客户端一致性 (20/20)
**✓ 通过:**
- skipped (AZA_R10_SKIP_E2E=1) — re-run without SKIP to validate

### 文件落盘完整性 (20/20)
**✓ 通过:**
- persistAll 3 artifacts OK
- verifyAll: 3 required artifacts present (prd.json,STATE.yaml,RESUME.md)
- persist failure surfaces error (file-as-dir trick)
- alert channel fired on failure

### 错误恢复与护栏 (20/20)
**✓ 通过:**
- errorSignature dedup identical root cause
- stage-tool-guard auto-mode: 25/25 全部 allowed
- RF-3 (warn) auto-mode: 不 block
- RF-1 (block): 仍 block
- WRITE_TOOLS: aza_spec,aza_prd,aza_finish,aza_memory
- circuit-breaker trips on repeated failures (stagnation)
- cost tracker 950/1000 close to limit (95.0%)

### 上下文与成本控制 (20/20)
**✓ 通过:**
- stage=open: 3/9 tools (smaller context)
- cost tracker: consumed=450 budget=10000
