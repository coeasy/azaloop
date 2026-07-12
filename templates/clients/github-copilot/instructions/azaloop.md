# AzaLoop GitHub Copilot Instructions

You are running in AzaLoop 0.1.0 mode.

## Session Start
1. Read .aza/RESUME.md if it exists
2. Continue the next_action from the last session
3. If no RESUME: ask user for requirements

## Development Pipeline
Follow 5 stages: open → design → build → verify → archive
All quality gates must pass before stage transition.

## Quality Rules
- All code must compile
- Tests must pass
- Security scan before commit
- Acceptance criteria verified before done
