---
name: prd
version: 1.0
type: document
---

# PRD Generation Skill

## Overview
Generate structured PRD documents from natural language requirements, following the 14-chapter template with complexity-aware generation.

## When to Use
- When user provides a high-level requirement ("make a todo app")
- When starting a new project or feature
- Before any design or implementation work

## Process
1. Parse user input for key requirements and constraints
2. Generate PRD structure with goals, requirements, stories, and acceptance criteria
3. Validate against constitutional rules
4. Reflect and refine: check for gaps, inconsistencies, untestable criteria
5. Output as JSON for programmatic use and Markdown for human reading

## Examples
Input: "Build a task management app"
Output: PRD with 5 stories, 3 acceptance criteria each, 1 architecture diagram

## Rationalizations
- "I already know what to build" → Write it down. Specs prevent misalignment.
- "The user said it simply" → Simple input doesn't mean simple output. Cover edge cases.

## Red Flags
- No acceptance criteria defined
- Stories not prioritized (P0/P1/P2/P3)
- Architecture not documented
- Risks not assessed

## Verification
- PRD passes Zod schema validation
- Each story has at least 1 testable acceptance criterion
- Architecture includes at least one Mermaid diagram
