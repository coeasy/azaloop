---
id: ADR-0001
title: Record architecture decisions
status: accepted
date: 2026-07-13
deciders:
  - azaloop-core-team
tags:
  - process
  - documentation
supersedes: []
superseded_by: []
---

# Record architecture decisions

## Context and Problem Statement

We need to record the architectural decisions made on this project so
that future contributors (and our future selves) understand why the
system looks the way it does.

## Decision Drivers

* Cognitive load: every contributor has to understand the system as a
  whole before they can usefully contribute.
* Onboarding: new team members need a single place to read the design
  constraints.
* Drift: without a written record, architectural choices erode over
  time as people forget the rationale.

## Considered Options

* ADR (this document) — explicit, version-controlled, discoverable.
* Wiki — easy to write, but un-versioned and easily edited away.
* Slack messages — write-only.

## Decision Outcome

Chosen option: "ADR", because ADRs live in the repo, are diff-able,
and are referenced by code.

### Consequences

* Good, because all architectural decisions are in one place.
* Good, because rationale is preserved as the system evolves.
* Bad, because writing ADRs is overhead.

### Confirmation

The team has agreed to follow MADR 4.x for all new ADRs.

## Rules

This ADR does not impose any code-level rules. See other ADRs for
specific restrictions.
