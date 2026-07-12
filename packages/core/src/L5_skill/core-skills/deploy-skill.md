---
name: deploy
version: 1.0
type: workflow
---

# Deployment & Release Skill

## Overview
Plan and execute deployment pipelines, release management, and rollback strategies.

## When to Use
- Planning deployment architecture
- Setting up CI/CD pipeline
- Preparing a release
- Planning rollback strategy

## Process
1. Design deployment architecture (environments, infrastructure)
2. Define CI/CD pipeline stages (build → test → stage → deploy)
3. Plan release strategy (blue-green, canary, feature flags)
4. Document rollback procedure
5. Set up monitoring and alerting
6. Define deployment verification steps

## Examples
- Pipeline: `build → test → security scan → stage → e2e → deploy`
- Rollback: `kubectl rollout undo deployment/app -n production`
- Feature flag: `if (featureFlags.isEnabled('new-checkout')) { ... }`

## Rationalizations
- "Just deploy manually" → Manual deploys are error-prone and not repeatable
- "Rollback is easy" → Without a tested rollback plan, it's not easy

## Red Flags
- No rollback plan documented
- Single environment (no staging)
- Manual deployment steps not automated
- No health check endpoint
- Missing feature flag strategy for risky changes
- No monitoring or alerting configured

## Verification
- Deployment pipeline is fully automated
- Rollback procedure is documented and tested
- Health check endpoint exists and responds correctly
- At least staging + production environments configured
- Feature flags are documented with owners
