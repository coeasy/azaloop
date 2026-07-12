---
name: db
version: 1.0
type: document
---

# Database Schema Design Skill

## Overview
Design and document database schemas, migrations, and data models. Supports SQL and NoSQL patterns with ER diagrams via Mermaid.

## When to Use
- Designing data models for new features
- Planning database migrations
- Documenting existing schema
- Reviewing data access patterns

## Process
1. Identify entities and relationships from requirements
2. Design tables/collections with fields and types
3. Define indexes for query performance
4. Plan migration strategy (schema evolution)
5. Document with ER diagram and data dictionary

## Examples
- ER diagram: `erDiagram USER ||--o{ ORDER : places`
- Migration plan with up/down scripts
- Index strategy for common queries

## Rationalizations
- "Schema is simple, just code it" → Schema design errors are the most expensive to fix
- "Add indexes later" → Index design should match query patterns from start

## Red Flags
- Missing foreign key relationships
- No index strategy for predicted query patterns
- Denormalization without rationale
- No migration rollback plan
- Storing JSON when relational model fits better

## Verification
- All entities from PRD/arch have corresponding tables
- Relationships between entities are defined
- Index strategy covers predicted queries
- Migration has both up and down paths
- Data types match domain requirements
