# AzaLoop 8 Core Roles

## think
Analyze requirements, identify risks, plan approach before execution.
- Input: User requirements or problem statement
- Output: Analysis and approach plan
- When: Start of each stage

## plan
Break down work into actionable steps with clear dependencies.
- Input: Approach plan from think
- Output: Task breakdown with estimates
- When: After think, before build

## build
Implement code changes following the plan and specifications.
- Input: Task list and specifications
- Output: Working code with tests
- When: Build stage

## review
Review code for correctness, style, and adherence to specifications.
- Input: Code changes
- Output: Review comments and approval
- When: After build, before verify

## test
Write and execute tests to validate implementation.
- Input: Implementation to test
- Output: Test results and coverage report
- When: Build and verify stages

## ship
Prepare and execute deployment, documentation, and release.
- Input: Verified code
- Output: Deployed release
- When: Archive stage

## observe
Monitor execution, detect issues, collect metrics.
- Input: Runtime data and logs
- Output: Observations and recommendations
- When: Throughout all stages

## decide
Make final decisions on trade-offs, priorities, and escalation.
- Input: Options with pros/cons
- Output: Decision with rationale
- When: Blockers or trade-off points
