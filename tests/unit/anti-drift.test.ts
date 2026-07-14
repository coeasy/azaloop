import { describe, it, expect } from 'vitest';
import {
  ANTI_DRIFT_DEFAULTS,
  enforceAntiDrift,
  parseAntiDrift,
} from '../../packages/core/src/L8_orchestrator/anti-drift';

const SAMPLE_YAML = `
# comment
lock_hard_gate: true
lock_recursion_guard: true
lock_circuit_breaker: true
lock_tdd_iron_law: true
lock_verification_phrases: true
lock_audit_jsonl: true
lock_state_checksum: true

forbid_constructs:
  - eval
  - with
  - Function

forbid_modules:
  - moment
  - lodash
  - request
  - bluebird

topology:
  min_raft_threshold: 5
  max_parallel_uncoordinated: 3

budget:
  warn_at_pct: 80
  reject_at_pct: 100
  default_budget: 50000
`;

describe('ANTI_DRIFT (v14-P2.x)', () => {
  it('1) ANTI_DRIFT_DEFAULTS has all locks true', () => {
    expect(ANTI_DRIFT_DEFAULTS.lockHardGate).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.lockRecursionGuard).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.lockCircuitBreaker).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.lockTddIronLaw).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.lockVerificationPhrases).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.lockAuditJsonl).toBe(true);
    expect(ANTI_DRIFT_DEFAULTS.lockStateChecksum).toBe(true);
  });

  it('2) parseAntiDrift extracts locks and lists', () => {
    const cfg = parseAntiDrift(SAMPLE_YAML);
    expect(cfg.lockHardGate).toBe(true);
    expect(cfg.forbidConstructs).toEqual(['eval', 'with', 'Function']);
    expect(cfg.forbidModules).toEqual(['moment', 'lodash', 'request', 'bluebird']);
    expect(cfg.topology.minRaftThreshold).toBe(5);
    expect(cfg.budget.warnAtPct).toBe(80);
  });

  it('3) enforceAntiDrift passes on empty config', () => {
    expect(enforceAntiDrift({})).toEqual([]);
  });

  it('4) enforceAntiDrift rejects hard_gate=false', () => {
    const v = enforceAntiDrift({ hard_gate: false });
    expect(v).toHaveLength(1);
    expect(v[0].field).toBe('hard_gate');
  });

  it('5) enforceAntiDrift rejects recursion_guard=false', () => {
    const v = enforceAntiDrift({ recursion_guard: false });
    expect(v.some((x) => x.field === 'recursion_guard')).toBe(true);
  });

  it('6) enforceAntiDrift rejects circuit_breaker=false', () => {
    const v = enforceAntiDrift({ circuit_breaker: false });
    expect(v.some((x) => x.field === 'circuit_breaker')).toBe(true);
  });

  it('7) enforceAntiDrift rejects min_raft_threshold below floor', () => {
    const v = enforceAntiDrift({ min_raft_threshold: 2 });
    expect(v.some((x) => x.field === 'min_raft_threshold')).toBe(true);
  });

  it('8) enforceAntiDrift accepts min_raft_threshold at floor', () => {
    const v = enforceAntiDrift({ min_raft_threshold: 5 });
    expect(v).toEqual([]);
  });

  it('9) enforceAntiDrift rejects warn_at_pct < 80', () => {
    const v = enforceAntiDrift({ warn_at_pct: 50 });
    expect(v.some((x) => x.field === 'warn_at_pct')).toBe(true);
  });

  it('10) enforceAntiDrift allows compliant config', () => {
    const v = enforceAntiDrift({
      hard_gate: true,
      recursion_guard: true,
      min_raft_threshold: 10,
      warn_at_pct: 90,
    });
    expect(v).toEqual([]);
  });
});
