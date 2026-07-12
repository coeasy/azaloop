---
name: arch
version: 1.0
type: document
---

# Architecture Design Skill

## Overview
Generate architecture diagrams and documentation using Mermaid.js. Supports 7 diagram types: system, flow, deployment, data, component, sequence, class.

## When to Use
- Before starting implementation of a new feature
- When the PRD needs architecture documentation
- During design stage to document system structure
- When reviewing architecture decisions

## Process
1. Identify the system boundaries and key components
2. Choose the appropriate diagram type for each view
3. Draft Mermaid diagram syntax
4. Document key design decisions (ADR format)
5. Validate architecture against non-functional requirements

## Examples
- System architecture: `graph TD User-->API-->DB`
- Flow diagram: `flowchart LR User-->Auth-->Service`
- Sequence: `sequenceDiagram Client->>Server: Request`

## Rationalizations
- "Architecture is obvious, skip it" → Documented architecture catches design flaws early
- "Just use text description" → Visual diagrams reveal gaps text hides

## Red Flags
- Single diagram trying to show everything (should be multiple views)
- No explanation of key design decisions
- Components without clear responsibilities
- Missing error handling or failure modes

## Verification
- Mermaid syntax is valid (parses correctly)
- All key components from PRD are represented
- Architecture addresses non-functional requirements
- Design decisions include rationale
