# State and Workflow Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复跨任务恢复污染，并将自动流程、状态转换和宿主动作收敛为唯一执行主干。

**Architecture:** 先以回归测试冻结 `aza_auto` 行为，再提取 TaskIdentity、RecoveryPolicy、HostContract、AutoWorkflow 和纯 TransitionPlanner。`RunState` 是唯一推进依据，RESUME/STATUS/BUDGET 逐步变为投影。

**Tech Stack:** TypeScript 5.9、Zod、Node.js 18+、Vitest、YAML/JSONL、pnpm workspaces。

---

### Task 1: Prove and fix cross-task plan isolation

**Files:**
- Create: `packages/mcp-server/src/workflows/auto/task-identity.ts`
- Create: `packages/mcp-server/src/workflows/auto/recovery-policy.ts`
- Modify: `packages/mcp-server/src/auto-plan.ts`
- Modify: `packages/mcp-server/src/unified-handlers.ts:340`
- Modify: `tests/unit/auto-plan.test.ts`

- [ ] **Step 1: Write the failing cross-task test**

```ts
it('does not hydrate a chosen plan before resume identity is accepted', async () => {
  const first = '重构认证模块';
  autoSelectBestPlan(root, first);
  await resume.write(fakeResume({ user_input_hash: fingerprint(first), current_stage: 'build' }));

  const result = await handleAzaAuto(
    { user_input: '实现全新的账单模块', workspace_path: root },
    new StateManager(azaDir),
    resume,
  ) as AutoToolResponse;

  expect(result.data?.task_fingerprint).toBe(fingerprint('实现全新的账单模块'));
  expect(result.data?.auto_plan_path).not.toContain('重构认证模块');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm.cmd exec vitest run tests/unit/auto-plan.test.ts`  
Expected: FAIL because `autoPlanSelected` is hydrated before stale RESUME reset.

- [ ] **Step 3: Define task identity**

```ts
export interface TaskIdentity {
  task_id: string;
  fingerprint: string;
}

export function createTaskIdentity(input: string, explicitTaskId?: string): TaskIdentity {
  const normalized = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('user_input is required');
  const fingerprint = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return { task_id: explicitTaskId?.trim() || `aza-${fingerprint}`, fingerprint };
}
```

- [ ] **Step 4: Define a pure recovery decision**

```ts
export type RecoveryDecision =
  | { kind: 'same_task'; state: RunState }
  | { kind: 'new_task'; reason: 'hash_mismatch' | 'terminal' | 'unsupported_state' }
  | { kind: 'fresh' };
```

- [ ] **Step 5: Reorder `handleAzaAuto`**

Compute TaskIdentity, call RecoveryPolicy, then load chosen plan only for `same_task`. For `new_task`, reset `autoPlanSelected` and `autoPlanPath` before creating a new plan.

- [ ] **Step 6: Bind persisted plan to fingerprint**

Add `task_fingerprint` to chosen-plan JSON and reject a mismatch in `loadChosenPlan(workspace, expectedFingerprint)`.

- [ ] **Step 7: Run tests and commit**

Run: `pnpm.cmd exec vitest run tests/unit/auto-plan.test.ts tests/unit/state-sync.test.ts`  
Expected: PASS.  
Commit: `git commit -am "fix: isolate automatic plans by task identity"`

### Task 2: Make artifact reset atomic and fail loud

**Files:**
- Create: `packages/mcp-server/src/workflows/auto/artifact-reset.ts`
- Create: `packages/shared/src/schemas/recovery.schema.ts`
- Modify: `packages/mcp-server/src/unified-handlers.ts:437`
- Create: `tests/unit/artifact-reset.test.ts`

- [ ] **Step 1: Write failure-injection tests**

```ts
it('never leaves a new epoch beside stale markers', async () => {
  const fs = new FailingFsPort({ failOn: 'commit-history' });
  await expect(resetArtifacts(request, fs)).rejects.toThrow(ArtifactResetError);
  expect(fs.exists('.aza/task-epoch')).toBe(false);
  expect(fs.exists('.aza/quality-passed.marker')).toBe(true);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/unit/artifact-reset.test.ts`  
Expected: FAIL because reset currently performs independent best-effort operations.

- [ ] **Step 3: Implement prepare/commit reset**

```ts
export interface ArtifactResetResult {
  history_dir: string;
  moved: string[];
  new_fingerprint: string;
}

export async function resetArtifacts(req: ResetRequest, fs: FsPort): Promise<ArtifactResetResult> {
  const prepared = await prepareHistoryMove(req, fs);
  await fs.rename(prepared.tempDir, prepared.historyDir);
  await fs.writeAtomic(req.epochPath, req.nextFingerprint);
  return { history_dir: prepared.historyDir, moved: prepared.files, new_fingerprint: req.nextFingerprint };
}
```

- [ ] **Step 4: Remove empty catches from the reset path**

Convert critical failures to `ArtifactResetError`; only optional projection cleanup may return warnings.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm.cmd exec vitest run tests/unit/artifact-reset.test.ts tests/unit/auto-plan.test.ts`  
Expected: PASS.  
Commit: `git commit -am "refactor: reset task artifacts atomically"`

### Task 3: Introduce Host Contract v1

**Files:**
- Create: `packages/shared/src/schemas/auto-response.schema.ts`
- Create: `packages/mcp-server/src/workflows/auto/host-contract.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/mcp-server/src/l3-hard-continue.ts`
- Modify: `packages/mcp-server/src/unified-handlers.ts`
- Create: `tests/unit/host-contract.test.ts`

- [ ] **Step 1: Write schema tests**

```ts
it.each(['implement', 'run_command', 'inspect', 'repair'] as const)(
  'creates a valid %s action',
  (kind) => expect(HostActionV1Schema.parse(makeAction(kind))).toBeTruthy(),
);

it('rejects actions without task identity', () => {
  expect(() => HostActionV1Schema.parse({ contract_version: '1', kind: 'implement' })).toThrow();
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/unit/host-contract.test.ts`  
Expected: FAIL because HostActionV1 does not exist.

- [ ] **Step 3: Add the discriminated contract**

```ts
export const HostActionV1Schema = z.object({
  contract_version: z.literal('1'),
  action_id: z.string().min(1),
  task_fingerprint: z.string().length(16),
  kind: z.enum(['implement', 'run_command', 'inspect', 'repair']),
  instruction: z.string().min(1),
  acceptance: z.array(z.string()).min(1),
  report: z.object({ tool: z.literal('aza_loop'), action: z.literal('report_tool'), tool_name: z.string() }),
  forbid_user_ask: z.literal(true),
});
```

- [ ] **Step 4: Route all host actions through `createHostAction`**

Delete legacy host-action fields. The public response contains only the v1 discriminated contract; no control flow parses instruction text.

- [ ] **Step 5: Add report idempotency and mismatch tests**

The same `action_id` may be reported twice with the same payload; a different fingerprint must be rejected.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm.cmd exec vitest run tests/unit/host-contract.test.ts tests/integration/auto-loop-three-pieces.test.ts`  
Expected: PASS.  
Commit: `git commit -am "feat: version the host execution contract"`

### Task 4: Extract AutoWorkflow and pure TransitionPlanner

**Files:**
- Create: `packages/mcp-server/src/workflows/auto/auto-workflow.ts`
- Create: `packages/mcp-server/src/workflows/auto/ports.ts`
- Create: `packages/core/src/L7_loop/runtime/transition-planner.ts`
- Create: `packages/core/src/L7_loop/runtime/types.ts`
- Modify: `packages/mcp-server/src/unified-handlers.ts:340`
- Modify: `packages/core/src/L7_loop/loop-controller.ts`
- Modify: `packages/core/src/L7_loop/auto-loop-driver.ts`
- Modify: `packages/core/src/L7_loop/auto-loop-scheduler.ts`
- Create: `tests/unit/auto-workflow.test.ts`
- Create: `tests/unit/transition-planner.test.ts`

- [ ] **Step 1: Write table-driven transition tests**

```ts
it.each([
  ['open', 'design', 'aza_spec'],
  ['build', 'verify', 'aza_quality'],
  ['archive', 'done', 'aza_finish'],
] as const)('%s selects %s through %s', (stage, expected, tool) => {
  expect(decideNext(stateAt(stage), policy())).toMatchObject({ next_stage: expected, tool });
});
```

- [ ] **Step 2: Write AutoWorkflow port tests**

Use in-memory PlanPort/StatePort/LoopPort/EvidencePort to cover fresh, resume, quality repair, max step and ship.

- [ ] **Step 3: Verify RED**

Run: `pnpm.cmd exec vitest run tests/unit/auto-workflow.test.ts tests/unit/transition-planner.test.ts`  
Expected: FAIL because the use case and planner are still embedded.

- [ ] **Step 4: Implement the pure decision API**

```ts
export type TransitionDecision =
  | { kind: 'internal'; next_stage: PipelineStage }
  | { kind: 'host_action'; action: HostActionDraft }
  | { kind: 'blocked'; failures: PolicyFailure[] }
  | { kind: 'complete'; evidence_ids: string[] };
```

- [ ] **Step 5: Move `handleAzaAuto` steps into `AutoWorkflow.run`**

The public handler validates arguments, creates ports, calls `run`, and maps one response.

- [ ] **Step 6: Remove duplicate next-step derivation**

Driver executes decisions; scheduler manages queue/time only; controller coordinates use cases only. Delete replaced decision branches instead of shadow-running them.

- [ ] **Step 7: Run focused and full verification**

Run: `pnpm.cmd exec vitest run tests/unit/auto-workflow.test.ts tests/unit/transition-planner.test.ts tests/unit/auto-loop-driver.test.ts tests/unit/auto-loop-scheduler.test.ts`  
Run: `pnpm.cmd check`  
Expected: all commands pass.  
Commit: `git commit -am "refactor: extract the autonomous workflow spine"`

### Task 5: Make RunState authoritative and projections rebuildable

**Files:**
- Modify: `packages/shared/src/schemas/state.schema.ts`
- Create: `packages/core/src/state/event-store.ts`
- Create: `packages/core/src/state/projection-writer.ts`
- Modify: `packages/core/src/state/state-manager.ts`
- Modify: `packages/core/src/state/run-ledger.ts`
- Modify: `packages/core/src/continuity/resume-generator.ts`
- Create: `tests/unit/state-projections.test.ts`

- [ ] **Step 1: Add projection rebuild tests**

```ts
it('rebuilds RESUME and BUDGET without changing RunState', async () => {
  const before = await states.load();
  await projections.rebuildAll(before.run_id);
  expect(await states.load()).toEqual(before);
  expect(readResume().task_fingerprint).toBe(before.task.fingerprint);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/unit/state-projections.test.ts`  
Expected: FAIL because projections currently have independent writers.

- [ ] **Step 3: Add revisioned RunState fields**

```ts
run: z.object({
  run_id: z.string(),
  revision: z.number().int().nonnegative(),
  task_fingerprint: z.string().length(16),
  last_event_id: z.string().optional(),
})
```

- [ ] **Step 4: Append state-transition events**

Use one JSONL EventStore entry with event id, revision, from/to, action id, evidence ids and timestamp.

- [ ] **Step 5: Convert RESUME/STATUS/BUDGET to projections**

Projection writers may be retried; they never update RunState.

- [ ] **Step 6: Reject old schemas and remove their old tests**

An old or invalid state is moved as a whole to `.aza/legacy/<timestamp>/`; vNext creates a fresh RunState and never parses legacy fields. Delete `tests/unit/state-migration.test.ts` after the new destructive-cutover test covers this behavior.

- [ ] **Step 7: Verify and commit**

Run: `pnpm.cmd exec vitest run tests/unit/state-projections.test.ts tests/integration/status-snapshot.test.ts`  
Run: `pnpm.cmd check`  
Expected: PASS.  
Commit: `git commit -am "refactor: make run state authoritative"`

## Exit criteria

- Cross-task stale plan/action/marker reuse is zero in fixtures.
- `unified-handlers.ts` no longer owns the auto use case.
- Driver/scheduler/controller do not derive conflicting next actions.
- RESUME/STATUS/BUDGET can be deleted and rebuilt from state/events.
- All existing public MCP contract snapshots pass.
