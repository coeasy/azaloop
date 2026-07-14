/**
 * v14 — P8.2: ANTI_DRIFT enforcement integration test.
 *
 * Verifies that:
 *  1. `recommendTopology` accepts an optional `clientConfig` and checks it
 *     against ANTI_DRIFT defaults before returning.
 *  2. Compliant configs produce `antiDriftCompliant: true` and no violations.
 *  3. Non-compliant configs (e.g. `hard_gate: false`) produce violations and
 *     `antiDriftCompliant: false`.
 *  4. `throwOnViolation: true` causes the function to throw on violations.
 *  5. `TopologyAwareSwarmCoordinator.startSwarm` accepts the new `clientConfig`
 *     parameter and threads it through to `recommendTopology`.
 *  6. The `checkAntiDrift` method on the coordinator returns the same result
 *     as the standalone `enforceAntiDrift`.
 *  7. The v13 compatibility shim still works (hardGateRequired/etc.).
 *
 * Reference: ruvnet/ruflo v3.10.33 ANTI_DRIFT system.
 */

import { describe, it, expect } from 'vitest';
import {
  recommendTopology,
  evaluateConsensus,
  validateAntiDrift,
  TopologyAwareSwarmCoordinator,
  ANTI_DRIFT_DEFAULTS,
  enforceAntiDrift,
  loadAntiDriftDefaults,
  type TeamCharacteristics,
} from '@azaloop/core';

describe('v14-P8.2 ANTI_DRIFT enforcement', () => {
  describe('recommendTopology with clientConfig', () => {
    it('returns compliant recommendation for empty clientConfig', () => {
      const team: TeamCharacteristics = { teamSize: 3, criticality: 'medium' };
      const rec = recommendTopology(team, {});
      expect(rec.antiDriftCompliant).toBe(true);
      expect(rec.antiDriftViolations).toEqual([]);
      // Default rule 6: hierarchical + majority
      expect(rec.topology).toBe('hierarchical');
      expect(rec.consensus).toBe('majority');
    });

    it('returns compliant recommendation when no clientConfig is supplied', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      const rec = recommendTopology(team);
      expect(rec.antiDriftCompliant).toBe(true);
      expect(rec.antiDriftViolations).toEqual([]);
    });

    it('flags hard_gate=false as a violation', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      const rec = recommendTopology(team, { hard_gate: false });
      expect(rec.antiDriftCompliant).toBe(false);
      expect(rec.antiDriftViolations.length).toBeGreaterThan(0);
      expect(rec.antiDriftViolations.some((v) => v.field === 'hard_gate')).toBe(true);
      // The recommendation is still returned for the caller to decide.
      expect(rec.topology).toBeTruthy();
    });

    it('flags recursion_guard=false as a violation', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      const rec = recommendTopology(team, { recursion_guard: false });
      expect(rec.antiDriftCompliant).toBe(false);
      expect(rec.antiDriftViolations.some((v) => v.field === 'recursion_guard')).toBe(true);
    });

    it('flags tdd_iron_law=false as a violation', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      const rec = recommendTopology(team, { tdd_iron_law: false });
      expect(rec.antiDriftCompliant).toBe(false);
      expect(rec.antiDriftViolations.some((v) => v.field === 'tdd_iron_law')).toBe(true);
    });

    it('flags min_raft_threshold below the floor', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      const rec = recommendTopology(team, { min_raft_threshold: 2 });
      expect(rec.antiDriftCompliant).toBe(false);
      expect(rec.antiDriftViolations.some((v) => v.field === 'min_raft_threshold')).toBe(true);
    });

    it('throws when throwOnViolation=true and config is non-compliant', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      expect(() => recommendTopology(team, { hard_gate: false }, { throwOnViolation: true }))
        .toThrow(/ANTI_DRIFT violation/);
    });

    it('does not throw when throwOnViolation=true and config is compliant', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      expect(() => recommendTopology(team, { hard_gate: true }, { throwOnViolation: true }))
        .not.toThrow();
    });

    it('applies higher-priority rules with anti-drift metadata', () => {
      const team: TeamCharacteristics = { teamSize: 12, criticality: 'high' };
      const rec = recommendTopology(team, {});
      expect(rec.topology).toBe('hierarchical-mesh');
      expect(rec.consensus).toBe('raft');
      expect(rec.antiDriftCompliant).toBe(true);
    });

    it('preserves the v13 properties on the recommendation', () => {
      const team: TeamCharacteristics = { teamSize: 3 };
      const rec = recommendTopology(team, {});
      expect(rec.topology).toBeTruthy();
      expect(rec.consensus).toBeTruthy();
      expect(rec.expectedAgents).toBe(3);
      expect(rec.confidence).toBeGreaterThan(0);
      expect(rec.rationale).toBeTruthy();
    });
  });

  describe('TopologyAwareSwarmCoordinator integration', () => {
    it('startSwarm accepts clientConfig and threads it through', () => {
      const coord = new TopologyAwareSwarmCoordinator({
        enabled: true,
        max_parallel: 5,
        agents: ['a1', 'a2', 'a3'],
      });
      const rec = coord.startSwarm({ teamSize: 2 }, coord.getConfig(), {});
      expect(rec.antiDriftCompliant).toBe(true);
      expect(coord.getCurrentTopology()).toBe('hierarchical');
    });

    it('startSwarm flags non-compliant client config', () => {
      const coord = new TopologyAwareSwarmCoordinator({
        enabled: true,
        max_parallel: 5,
        agents: ['a1', 'a2', 'a3'],
      });
      const rec = coord.startSwarm({ teamSize: 2 }, coord.getConfig(), { hard_gate: false });
      expect(rec.antiDriftCompliant).toBe(false);
      // Coordinator state should still be updated with the recommendation
      // (so the caller can decide whether to dispatch).
      expect(coord.getCurrentTopology()).toBeTruthy();
    });

    it('checkAntiDrift returns the same result as enforceAntiDrift', () => {
      const coord = new TopologyAwareSwarmCoordinator({
        enabled: true,
        max_parallel: 5,
        agents: ['a1', 'a2', 'a3'],
      });
      const cfg = { hard_gate: false, recursion_guard: false };
      const fromCoord = coord.checkAntiDrift(cfg);
      const fromFn = enforceAntiDrift(cfg);
      expect(fromCoord).toEqual(fromFn);
    });
  });

  describe('v13 compatibility shim', () => {
    it('ANTI_DRIFT_DEFAULTS still has v13 hardGateRequired=true', () => {
      expect(ANTI_DRIFT_DEFAULTS.hardGateRequired).toBe(true);
    });

    it('ANTI_DRIFT_DEFAULTS still has v13 recursionGuardRequired=true', () => {
      expect(ANTI_DRIFT_DEFAULTS.recursionGuardRequired).toBe(true);
    });

    it('ANTI_DRIFT_DEFAULTS still has v13 circuitBreakerMaxStrikes=3', () => {
      expect(ANTI_DRIFT_DEFAULTS.circuitBreakerMaxStrikes).toBe(3);
    });

    it('ANTI_DRIFT_DEFAULTS still has v13 workerHeartbeatMs=270_000', () => {
      expect(ANTI_DRIFT_DEFAULTS.workerHeartbeatMs).toBe(270_000);
    });

    it('ANTI_DRIFT_DEFAULTS also has v14 lockHardGate=true (single source of truth)', () => {
      // @ts-expect-error — accessing v14 field via index
      expect(ANTI_DRIFT_DEFAULTS.lockHardGate).toBe(true);
    });

    it('validateAntiDrift still works against v13-style configs', () => {
      expect(validateAntiDrift({})).toEqual([]);
      expect(validateAntiDrift({ hardGateRequired: false }).length).toBeGreaterThan(0);
      expect(validateAntiDrift({ workerHeartbeatMs: 5000 }).length).toBeGreaterThan(0);
    });
  });

  describe('loadAntiDriftDefaults fallback', () => {
    it('returns built-in defaults when file is missing', () => {
      const cfg = loadAntiDriftDefaults('/nonexistent/path/anti-drift-defaults.yaml');
      expect(cfg.lockHardGate).toBe(true);
      expect(cfg.lockRecursionGuard).toBe(true);
      expect(cfg.forbidConstructs).toContain('eval');
    });
  });

  describe('consensus evaluation still works', () => {
    it('unanimous — all yes → approved', () => {
      const r = evaluateConsensus('unanimous', [
        { agentId: 'a', vote: true },
        { agentId: 'b', vote: true },
      ]);
      expect(r.approved).toBe(true);
    });
  });
});
