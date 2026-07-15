# /aza-plan — Eng Manager architecture lock

Activate **eng/plan** roles.

1. Ensure PRD is approved
2. Call `aza_loop(action=full)` or `aza_spec(action=design)`
3. Lock boundaries, ownership, test strategy before large diffs
4. Record decisions in `.aza/findings.md`
