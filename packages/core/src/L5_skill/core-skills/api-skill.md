---
name: api
version: 1.0
type: document
---

# API Design Skill

## Overview
Design and document RESTful/GraphQL APIs with request/response schemas, authentication, and error handling.

## When to Use
- Designing new API endpoints
- Documenting existing APIs
- Reviewing API contracts
- Planning API versioning strategy

## Process
1. Identify resources and operations from requirements
2. Design URL structure following REST conventions
3. Define request/response schemas
4. Document authentication and authorization
5. Specify error responses and status codes
6. Plan versioning and deprecation strategy

## Examples
- `GET /api/v1/users/{id}` → `{ id, name, email, created_at }`
- `POST /api/v1/users` → Create user with validation
- Error response: `{ error: { code: "VALIDATION_ERROR", message: "...", details: [] } }`

## Rationalizations
- "API is internal, no need to document" → Undocumented APIs become unmaintainable
- "Just return everything" → Over-fetching hurts performance and coupling

## Red Flags
- No versioning strategy
- Inconsistent error response format
- Missing authentication/authorization docs
- No rate limiting documented
- Breaking changes without deprecation plan
- Missing input validation specification

## Verification
- All endpoints have request/response schemas
- Error responses are documented with status codes
- Authentication method is specified
- Rate limiting is documented
- API versioning strategy is defined
