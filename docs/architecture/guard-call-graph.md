# Guard call graph (full-auto)

> 2026-07-16 — documents which guards can block the T1 auto path.

```mermaid
flowchart TD
  Host[Host LLM] --> MCP[8 tools + aza_auto]
  MCP --> StageGuard[stage-tool-guard]
  StageGuard -->|AZA_AUTO_APPROVE_PRD| AutoBypass[AUTO_ALLOWED_TOOLS bypass]
  StageGuard --> Handler[tool handler]
  Handler --> Loop[AutoLoopDriver / PhaseLoop]
  Loop --> CB[circuit-breaker + errorSignature]
  Loop --> DL[deadlock-detector]
  Loop --> HS[hard-stop]
  Loop --> CG[completion-gate]
  Loop --> RF[red-flags]
  RF -->|auto mode| LogOnly[log only]
  CB --> Stop[trip / escalate]
  DL --> Stop
  HS --> Stop
```

## Auto mode policy

| Guard | Auto (`AZA_AUTO_APPROVE_PRD=true`) | Manual |
|-------|-------------------------------------|--------|
| stage-tool-guard | Bypass for prd/spec/finish/loop/quality/auto | Matrix |
| red-flags | Prefer log (`autoMode: log`) | May block |
| circuit-breaker | Hard stop on signature repeat / budget | Same |
| deadlock-detector | Hard stop | Same |
| hard-stop | Security / max iter | Same |
| completion-gate | Required for ship | Same |

## Design stage complete when

1. OpenSpec change has proposal + design (`## Technical Approach`) + tasks, **or**
2. `.aza/design.md` has `## Technical Approach` and length ≥ 80, **or**
3. `.aza/design.md` + ≥7 diagrams (legacy)

Do **not** require 7 diagrams for full-auto.
