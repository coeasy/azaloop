# 66 Programming Techniques — Context-Aware Knowledge Base

## Architecture & Design (1-10)
1. Use layered architecture (presentation/domain/data) for maintainability
2. Prefer composition over inheritance
3. SOLID principles: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
4. CQRS for separating read/write concerns
5. Event-driven architecture for loose coupling
6. Repository pattern for data access abstraction
7. Strategy pattern for interchangeable algorithms
8. Factory pattern for object creation
9. Observer pattern for event handling
10. Dependency Injection for testability

## TypeScript (11-20)
11. Use strict mode — no implicit any
12. Prefer interfaces over type aliases for public APIs
13. Use discriminated unions for state machines
14. Branded types for type-safe IDs
15. Use satisfies operator for type inference
16. Prefer const assertions (as const) for literals
17. Use template literal types for string patterns
18. Use satisfies for validation without widening
19. Prefer readonly for immutable data
20. Use satisfies operator over type assertions

## Testing (21-30)
21. TDD: RED (failing test) → GREEN (passing) → REFACTOR
22. Test behaviors, not implementation
23. Use describe/it for test structure
24. Prefer unit tests, supplement with integration
25. Mock external boundaries only
26. Use table-driven tests for multiple cases
27. Test edge cases: empty, null, overflow, boundary
28. Keep tests independent and idempotent
29. Use factories for test data
30. Coverage is a guide, not a goal

## Error Handling (31-40)
31. Fail fast — validate inputs at boundaries
32. Use Result/Option types instead of exceptions
33. Never swallow errors silently
34. Log errors with context (stack trace, input, state)
35. Use typed errors for different error categories
36. Implement graceful degradation
37. Circuit breaker for external dependencies
38. Retry with exponential backoff
39. Timeout all external calls
40. Use structured logging (JSON)

## Performance (41-50)
41. Profile before optimizing
42. Use indexes for database queries
43. Batch operations instead of N+1
44. Use connection pooling
45. Implement caching with TTL
46. Lazy loading for expensive operations
47. Use streaming for large datasets
48. Minimize memory allocations
49. Use async/await properly (no fire-and-forget)
50. Avoid premature optimization

## Security (51-60)
51. Validate all inputs (never trust user data)
52. Use parameterized queries for SQL
53. Escape all output (XSS prevention)
54. Store passwords hashed (bcrypt/argon2)
55. Use HTTPS everywhere
56. Implement rate limiting
57. Use helmet for security headers
58. Never hardcode secrets
59. Principle of least privilege
60. Regular dependency updates

## Development Process (61-66)
61. Atomic commits (one concern per commit)
62. Descriptive commit messages (conventional commits)
63. Code review before merge
64. Feature flags for gradual rollout
65. Documentation as code (ADRs, README)
66. Retrospectives after each iteration
