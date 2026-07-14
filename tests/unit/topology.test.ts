/**
 * v13 — P2.2: Topology + consensus + ANTI_DRIFT unit tests
 *
 * Covers:
 *   1) recommendTopology — scale rule (teamSize >= 10)
 *   2) recommendTopology — high criticality rule
 *   3) recommendTopology — isolation rule
 *   4) recommendTopology — tight deadline + many tasks rule
 *   5) recommendTopology — single task rule
 *   6) recommendTopology — default fallback
 *   7) evaluateConsensus — unanimous
 *   8) evaluateConsensus — majority
 *   9) evaluateConsensus — weighted
 *  10) evaluateConsensus — leader
 *  11) evaluateConsensus — raft
 *  12) validateAntiDrift — rejects disabling hard-gate
 *  13) validateAntiDrift — accepts defaults
 *  14) TopologyAwareSwarmCoordinator — startSwarm applies recommendation
 */

import { describe, it, expect } from 'vitest';
import {
  recommendTopology,
  evaluateConsensus,
  validateAntiDrift,
  TopologyAwareSwarmCoordinator,
  ANTI_DRIFT_DEFAULTS,
  type ConsensusVote,
} from '@azaloop/core';

describe('v13 P2.2 — TopologySelector', () => {
  it('1) teamSize >= 10 → hierarchical-mesh + raft', () => {
    const rec = recommendTopology({ teamSize: 12 });
    expect(rec.topology).toBe('hierarchical-mesh');
    expect(rec.consensus).toBe('raft');
    expect(rec.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('2) criticality=high + teamSize >= 5 → hierarchical + raft', () => {
    const rec = recommendTopology({ teamSize: 6, criticality: 'high' });
    expect(rec.topology).toBe('hierarchical');
    expect(rec.consensus).toBe('raft');
  });

  it('3) isolation=true → mesh + unanimous', () => {
    const rec = recommendTopology({ teamSize: 4, isolation: true });
    expect(rec.topology).toBe('mesh');
    expect(rec.consensus).toBe('unanimous');
  });

  it('4) tight deadline + taskCount >= 5 → parallel + majority', () => {
    const rec = recommendTopology({ teamSize: 5, deadline: 'tight', taskCount: 8 });
    expect(rec.topology).toBe('parallel');
    expect(rec.consensus).toBe('majority');
  });

  it('5) taskCount === 1 → sequential + leader', () => {
    const rec = recommendTopology({ teamSize: 3, taskCount: 1 });
    expect(rec.topology).toBe('sequential');
    expect(rec.consensus).toBe('leader');
  });

  it('6) default → hierarchical + majority', () => {
    const rec = recommendTopology({ teamSize: 4, taskCount: 3 });
    expect(rec.topology).toBe('hierarchical');
    expect(rec.consensus).toBe('majority');
  });

  it('7) recommendation includes expectedAgents and rationale', () => {
    const rec = recommendTopology({ teamSize: 7, criticality: 'medium', taskCount: 4 });
    expect(rec.expectedAgents).toBe(7);
    expect(rec.rationale).toMatch(/hierarchical|majority/);
  });
});

describe('v13 P2.2 — Consensus evaluation', () => {
  const v = (agentId: string, vote: boolean, weight?: number): ConsensusVote =>
    ({ agentId, vote, weight });

  it('1) unanimous — all yes → approved', () => {
    const r = evaluateConsensus('unanimous', [v('a', true), v('b', true), v('c', true)]);
    expect(r.approved).toBe(true);
  });

  it('2) unanimous — one no → rejected', () => {
    const r = evaluateConsensus('unanimous', [v('a', true), v('b', false), v('c', true)]);
    expect(r.approved).toBe(false);
  });

  it('3) majority — 3 yes vs 1 no → approved', () => {
    const r = evaluateConsensus('majority', [v('a', true), v('b', true), v('c', true), v('d', false)]);
    expect(r.approved).toBe(true);
  });

  it('4) majority — tie (2 vs 2) → rejected', () => {
    const r = evaluateConsensus('majority', [v('a', true), v('b', true), v('c', false), v('d', false)]);
    expect(r.approved).toBe(false);
  });

  it('5) weighted — high weight yes beats low weight no', () => {
    const r = evaluateConsensus('weighted', [
      v('a', true, 10),
      v('b', false, 1),
      v('c', false, 1),
    ]);
    expect(r.approved).toBe(true);
  });

  it('6) leader — first vote decides', () => {
    const r = evaluateConsensus('leader', [v('leader', false), v('b', true), v('c', true)]);
    expect(r.approved).toBe(false);
  });

  it('7) raft — leader yes + majority of followers → approved', () => {
    const r = evaluateConsensus('raft', [
      v('leader', true),
      v('f1', true),
      v('f2', true),
      v('f3', false),
    ]);
    expect(r.approved).toBe(true);
  });

  it('8) raft — leader no → rejected regardless of followers', () => {
    const r = evaluateConsensus('raft', [
      v('leader', false),
      v('f1', true),
      v('f2', true),
      v('f3', true),
    ]);
    expect(r.approved).toBe(false);
  });

  it('9) empty votes → not approved', () => {
    const r = evaluateConsensus('majority', []);
    expect(r.approved).toBe(false);
  });
});

describe('v13 P2.2 — ANTI_DRIFT validation', () => {
  it('1) rejecting hard-gate is a violation', () => {
    const violations = validateAntiDrift({ hardGateRequired: false });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!).toMatch(/hardGateRequired/);
  });

  it('2) rejecting recursion-guard is a violation', () => {
    const violations = validateAntiDrift({ recursionGuardRequired: false });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!).toMatch(/recursionGuardRequired/);
  });

  it('3) maxStrikes > 3 is a violation', () => {
    const violations = validateAntiDrift({ circuitBreakerMaxStrikes: 5 });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!).toMatch(/circuitBreakerMaxStrikes/);
  });

  it('4) heartbeatMs < 30000 is a violation', () => {
    const violations = validateAntiDrift({ workerHeartbeatMs: 5000 });
    expect(violations.length).toBeGreaterThan(0);
  });

  it('5) defaults are valid (no violations)', () => {
    const violations = validateAntiDrift({});
    expect(violations).toEqual([]);
  });

  it('6) ANTI_DRIFT_DEFAULTS exports expected values', () => {
    expect(ANTI_DRIFT_DEFAULTS.hardGateRequired).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.recursionGuardRequired).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.circuitBreakerMaxStrikes).toBe(3);
    expect(ANTI_DRIFT_DEFAULTS.workerHeartbeatMs).toBe(270_000);
  });
});

describe('v13 P2.2 — TopologyAwareSwarmCoordinator', () => {
  it('1) startSwarm applies recommendation to coordinator state', () => {
    const coord = new TopologyAwareSwarmCoordinator({
      enabled: true,
      max_parallel: 5,
      agents: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'],
    });
    const rec = coord.startSwarm({ teamSize: 11, criticality: 'high' }, coord.getConfig());
    expect(coord.getCurrentTopology()).toBe('hierarchical-mesh');
    expect(coord.getCurrentConsensus()).toBe('raft');
    expect(rec.topology).toBe('hierarchical-mesh');
  });

  it('2) setTopology and setConsensus are independent setters', () => {
    const coord = new TopologyAwareSwarmCoordinator({
      enabled: true,
      max_parallel: 2,
      agents: ['a', 'b'],
    });
    coord.setTopology('parallel');
    coord.setConsensus('unanimous');
    expect(coord.getCurrentTopology()).toBe('parallel');
    expect(coord.getCurrentConsensus()).toBe('unanimous');
  });
});
