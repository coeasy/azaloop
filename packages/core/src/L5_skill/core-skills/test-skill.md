---
name: test
version: 1.0
type: workflow
---

# TDD & Test Design Skill

## Overview
RED-GREEN-REFACTOR TDD workflow with test design patterns. Covers unit, integration, and e2e testing strategies.

## When to Use
- Before writing any production code (TDD)
- Adding tests to existing code
- Designing test strategy for new features
- Reviewing test coverage

## Process
1. RED: Write a failing test that defines expected behavior
2. GREEN: Write minimal code to pass the test
3. REFACTOR: Clean up while keeping tests green
4. Test behaviors, not implementation
5. Cover edge cases: empty, null, overflow, boundary

## Examples
- Unit: `describe('calculateTotal')` with table-driven tests
- Integration: API endpoint tests with db setup/teardown
- E2E: User flow tests with page objects

## Rationalizations
- "Test later" → Code without tests is technical debt with interest
- "Test is obvious" → If it's obvious, it's fast to write; write it
- "100% coverage" → Coverage is a guide, not a goal; focus on critical paths

## Red Flags
- Tests that test implementation details (brittle)
- Missing edge case tests (empty, error, boundary)
- Slow tests that discourage running them
- Tests sharing mutable state (flaky tests)
- No negative/scenario tests (only happy path)

## Verification
- RED step: test fails for the expected reason
- GREEN step: all tests pass
- REFACTOR step: tests still pass after cleanup
- Edge cases covered: empty/null/error/boundary
- Tests are independent and idempotent
