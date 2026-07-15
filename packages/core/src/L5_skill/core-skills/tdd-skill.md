---
name: tdd
version: 1.0
type: process
when_to_use: implementing behavior that should be covered by tests; any bug fix; new API or pure function
---

# Test-Driven Development Skill

## Use when
- Writing new logic
- Fixing a failing production bug
- Changing public APIs

## Red Flags
- "I'll add tests later"
- Implementing before a failing test exists
- Skipping RED phase because "it's trivial"

## Process
1. Write a failing test that names the behavior
2. Run it and confirm failure for the right reason
3. Write the minimal implementation
4. Refactor with tests green

## Verification
- Test was observed failing before pass
- Targeted test command documented in notes
