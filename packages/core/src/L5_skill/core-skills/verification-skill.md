---
name: verification-before-completion
version: 1.0
type: process
when_to_use: about to claim work is done, fixed, or ready to ship
---

# Verification Before Completion

## Use when
- Saying "done", "fixed", or "ready to merge"
- Calling aza_finish / ship
- Closing a story

## Red Flags
- Claiming pass without running the verification command
- Empty quality gate inputs
- Ignoring failing secondary checks

## Process
1. State the exact command(s) that prove success
2. Run them; capture exit code / summary
3. Only then mark complete or call aza_finish(ship)

## Verification
- Quality gates (aza_quality check) returned passed=true
- No known failing tests remain
