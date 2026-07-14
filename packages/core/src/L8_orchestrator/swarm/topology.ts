/**
 * v13 — P2.2: Swarm topology + consensus + ANTI_DRIFT defaults
 *
 * Expands the L8 swarm coordinator from 3 stub topologies to 5 production
 * topologies with 5 consensus strategies and a TopologySelector that
 * picks the right combination based on team characteristics.
 *
 * Reference: ruvnet/ruflo swarm coordination patterns.
 *
 * ## Topologies
 *   - `sequential`         — single agent, strict order
 *   - `parallel`           — N agents, no coordination needed
 *   - `hierarchical`       — central coordinator + workers
 *   - `mesh`               — peer-to-peer, no leader
 *   - `hierarchical-mesh`  — multiple coordinators each managing a mesh
 *
 * ## Consensus strategies
 *   - `unanimous` — all agents must agree
 *   - `majority`  — >50% must agree
 *   - `weighted`  — weights sum > threshold
 *   - `leader`    — leader's vote decides
 *   - `raft`      — leader + heartbeat + log replication (5+ nodes)
 *
 * ## ANTI_DRIFT_DEFAULTS
 * The global anti-drift rules that the TopologySelector enforces. These
 * prevent accidental weakening of safety guarantees.
 */

import { SwarmCoordinator, type SwarmCoordinatorConfig } from './coordinator';
import {
  ANTI_DRIFT_DEFAULTS as ANTI_DRIFT_DEFAULTS_FROM_PARSER,
  enforceAntiDrift,
  loadAntiDriftDefaults,
  type AntiDriftConfig,
  type AntiDriftViolation,
} from '../anti-drift';

// Re-export the canonical AntiDriftConfig from the anti-drift module so
// downstream imports of `{ AntiDriftConfig } from './swarm/topology'` keep
// working.
export type { AntiDriftConfig, AntiDriftViolation } from '../anti-drift';

// ---------------------------------------------------------------------------
// Topology + consensus types
// ---------------------------------------------------------------------------

export type Topology = 'sequential' | 'parallel' | 'hierarchical' | 'mesh' | 'hierarchical-mesh';

export type Consensus = 'unanimous' | 'majority' | 'weighted' | 'leader' | 'raft';

export interface TopologyRecommendation {
  topology: Topology;
  consensus: Consensus;
  /** Number of worker agents the recommendation expects. */
  expectedAgents: number;
  /** Confidence score 0-1. */
  confidence: number;
  /** Human-readable rationale for the recommendation. */
  rationale: string;
}

export interface TeamCharacteristics {
  /** Number of agents in the team. */
  teamSize: number;
  /** Task criticality: 'low' | 'medium' | 'high'. */
  criticality?: 'low' | 'medium' | 'high';
  /** Deadline urgency: 'relaxed' | 'normal' | 'tight'. */
  deadline?: 'relaxed' | 'normal' | 'tight';
  /** Whether the work requires strict isolation between agents. */
  isolation?: boolean;
  /** Number of independent tasks to run. */
  taskCount?: number;
}

export interface ConsensusVote {
  agentId: string;
  /** The agent's vote: true=yes, false=no. */
  vote: boolean;
  /** Optional weight (default 1). Used by `weighted` consensus. */
  weight?: number;
}

export interface ConsensusResult {
  /** Whether consensus was reached. */
  approved: boolean;
  consensus: Consensus;
  /** Tally of yes/no votes. */
  yesVotes: number;
  noVotes: number;
  /** For weighted: total weight. */
  totalWeight?: number;
  /** Human-readable explanation. */
  reason: string;
}

// ---------------------------------------------------------------------------
// ANTI_DRIFT_DEFAULTS — re-exported from `../anti-drift` for single source of truth
// ---------------------------------------------------------------------------

/**
 * v14 — P8.2: re-export from the canonical `anti-drift` module so the
 * TopologySelector and the global enforcer share one source of truth.
 * The old v13 inline shape (hardGateRequired/recursionGuardRequired/...) is
 * kept as a compatibility shim below.
 *
 * We merge the v14 shape with the v13 shim so existing tests that read
 * `ANTI_DRIFT_DEFAULTS.hardGateRequired` keep working. New code should use
 * the v14 fields (`lockHardGate`, etc.) and the canonical `enforceAntiDrift`.
 */
export const ANTI_DRIFT_DEFAULTS = {
  ...ANTI_DRIFT_DEFAULTS_FROM_PARSER,
  // v13 compatibility shim:
  hardGateRequired: ANTI_DRIFT_DEFAULTS_FROM_PARSER.lockHardGate,
  recursionGuardRequired: ANTI_DRIFT_DEFAULTS_FROM_PARSER.lockRecursionGuard,
  circuitBreakerMaxStrikes: 3,
  tddStrikeIntegration: ANTI_DRIFT_DEFAULTS_FROM_PARSER.lockTddIronLaw,
  workerHeartbeatMs: 270_000,
} as const;

/**
 * v13 — AntiDriftConfig kept as a compatibility shim. New code should use
 * the canonical `AntiDriftConfig` from `../anti-drift` (which has
 * `lockHardGate`, `lockRecursionGuard`, etc.).
 */
export interface AntiDriftConfigLegacy {
  hardGateRequired?: boolean;
  recursionGuardRequired?: boolean;
  circuitBreakerMaxStrikes?: number;
  tddStrikeIntegration?: boolean;
  workerHeartbeatMs?: number;
}

/** @deprecated Use {@link AntiDriftConfig} from `../anti-drift` instead. */
export type AntiDriftConfigCompat = AntiDriftConfigLegacy;

/**
 * Validate a legacy v13 AntiDriftConfig against ANTI_DRIFT_DEFAULTS. Returns
 * an array of violation messages (empty = valid).
 *
 * The new v14 path is {@link enforceAntiDrift} from `../anti-drift`.
 */
export function validateAntiDrift(config: AntiDriftConfigLegacy): string[] {
  const violations: string[] = [];
  if (config.hardGateRequired === false) {
    violations.push('ANTI_DRIFT: hardGateRequired must not be false');
  }
  if (config.recursionGuardRequired === false) {
    violations.push('ANTI_DRIFT: recursionGuardRequired must not be false');
  }
  if (config.circuitBreakerMaxStrikes !== undefined && config.circuitBreakerMaxStrikes > 3) {
    violations.push(`ANTI_DRIFT: circuitBreakerMaxStrikes=${config.circuitBreakerMaxStrikes} exceeds the safe ceiling of 3`);
  }
  if (config.tddStrikeIntegration === false) {
    violations.push('ANTI_DRIFT: tddStrikeIntegration must not be false');
  }
  if (config.workerHeartbeatMs !== undefined && config.workerHeartbeatMs < 30_000) {
    violations.push(`ANTI_DRIFT: workerHeartbeatMs=${config.workerHeartbeatMs}ms is below the safety floor of 30s`);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// TopologySelector
// ---------------------------------------------------------------------------

/**
 * Pick the best {topology, consensus} pair for the given team.
 *
 * Rules (in priority order):
 *   1. teamSize >= 10  → hierarchical-mesh (for scale)
 *   2. criticality=high + teamSize >= 5  → hierarchical + raft
 *   3. isolation=true  → mesh (peer-to-peer, no central coord)
 *   4. taskCount >= 5 + deadline=tight  → parallel + majority
 *   5. taskCount === 1  → sequential + leader
 *   6. default  → hierarchical + majority
 *
 * v14 — P8.2: When `clientConfig` is supplied, the function calls
 * `enforceAntiDrift(clientConfig, ANTI_DRIFT_DEFAULTS)` first. Any violation
 * is reported via the returned `antiDriftViolations` field AND the
 * `antiDriftCompliant` flag is set to `false`. The recommendation itself is
 * still returned (so the caller can decide how to react) but callers should
 * check the flag before dispatching.
 */
export function recommendTopology(
  team: TeamCharacteristics,
  clientConfig?: Record<string, unknown>,
  options?: { defaults?: AntiDriftConfig; throwOnViolation?: boolean },
): TopologyRecommendation & { antiDriftCompliant: boolean; antiDriftViolations: AntiDriftViolation[] } {
  const defaults = options?.defaults ?? ANTI_DRIFT_DEFAULTS;

  // ANTI_DRIFT enforcement
  let antiDriftViolations: AntiDriftViolation[] = [];
  if (clientConfig) {
    antiDriftViolations = enforceAntiDrift(clientConfig, defaults);
    if (antiDriftViolations.length > 0 && options?.throwOnViolation) {
      throw new Error(
        `ANTI_DRIFT violation: ${antiDriftViolations.map((v) => v.field).join(', ')}`,
      );
    }
  }

  const { teamSize, criticality, deadline, isolation, taskCount } = team;

  // Rule 1: scale
  if (teamSize >= 10) {
    return {
      topology: 'hierarchical-mesh',
      consensus: 'raft',
      expectedAgents: teamSize,
      confidence: 0.95,
      rationale: `teamSize=${teamSize} >= 10: use hierarchical-mesh + raft for scale`,
      antiDriftCompliant: antiDriftViolations.length === 0,
      antiDriftViolations,
    };
  }

  // Rule 2: high criticality
  if (criticality === 'high' && teamSize >= 5) {
    return {
      topology: 'hierarchical',
      consensus: 'raft',
      expectedAgents: teamSize,
      confidence: 0.9,
      rationale: `criticality=high and teamSize=${teamSize} >= 5: use hierarchical + raft`,
      antiDriftCompliant: antiDriftViolations.length === 0,
      antiDriftViolations,
    };
  }

  // Rule 3: isolation required
  if (isolation === true) {
    return {
      topology: 'mesh',
      consensus: 'unanimous',
      expectedAgents: teamSize,
      confidence: 0.85,
      rationale: 'isolation=true: use mesh + unanimous for tight coupling',
      antiDriftCompliant: antiDriftViolations.length === 0,
      antiDriftViolations,
    };
  }

  // Rule 4: tight deadline + multiple tasks
  if (deadline === 'tight' && (taskCount ?? 0) >= 5) {
    return {
      topology: 'parallel',
      consensus: 'majority',
      expectedAgents: teamSize,
      confidence: 0.8,
      rationale: `deadline=tight and taskCount=${taskCount} >= 5: use parallel + majority`,
      antiDriftCompliant: antiDriftViolations.length === 0,
      antiDriftViolations,
    };
  }

  // Rule 5: single task
  if (taskCount === 1) {
    return {
      topology: 'sequential',
      consensus: 'leader',
      expectedAgents: Math.max(1, teamSize),
      confidence: 0.95,
      rationale: 'taskCount=1: use sequential + leader',
      antiDriftCompliant: antiDriftViolations.length === 0,
      antiDriftViolations,
    };
  }

  // Default
  return {
    topology: 'hierarchical',
    consensus: 'majority',
    expectedAgents: teamSize,
    confidence: 0.7,
    rationale: 'default: hierarchical + majority',
    antiDriftCompliant: antiDriftViolations.length === 0,
    antiDriftViolations,
  };
}

// ---------------------------------------------------------------------------
// Consensus evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a set of votes reaches consensus under the given strategy.
 */
export function evaluateConsensus(consensus: Consensus, votes: ConsensusVote[]): ConsensusResult {
  if (votes.length === 0) {
    return {
      approved: false,
      consensus,
      yesVotes: 0,
      noVotes: 0,
      reason: 'no votes cast',
    };
  }
  const yesVotes = votes.filter((v) => v.vote).length;
  const noVotes = votes.length - yesVotes;
  const totalWeight = votes.reduce((sum, v) => sum + (v.weight ?? 1), 0);
  const yesWeight = votes.filter((v) => v.vote).reduce((sum, v) => sum + (v.weight ?? 1), 0);

  switch (consensus) {
    case 'unanimous':
      return {
        approved: noVotes === 0,
        consensus,
        yesVotes,
        noVotes,
        reason: noVotes === 0 ? 'all voted yes' : `${noVotes} agent(s) voted no`,
      };
    case 'majority':
      return {
        approved: yesVotes > noVotes,
        consensus,
        yesVotes,
        noVotes,
        reason: yesVotes > noVotes ? 'majority yes' : 'majority no',
      };
    case 'weighted': {
      const halfWeight = totalWeight / 2;
      return {
        approved: yesWeight > halfWeight,
        consensus,
        yesVotes,
        noVotes,
        totalWeight,
        reason: yesWeight > halfWeight
          ? `weighted yes=${yesWeight} > ${halfWeight}`
          : `weighted yes=${yesWeight} <= ${halfWeight}`,
      };
    }
    case 'leader': {
      // The first vote is treated as the leader's vote
      const leader = votes[0]!;
      return {
        approved: leader.vote,
        consensus,
        yesVotes,
        noVotes,
        reason: leader.vote ? 'leader voted yes' : 'leader voted no',
      };
    }
    case 'raft': {
      // raft: leader + majority of followers
      const leader = votes[0]!;
      const followers = votes.slice(1);
      const followerYes = followers.filter((v) => v.vote).length;
      const followersAgree = followerYes > followers.length / 2;
      return {
        approved: leader.vote && followersAgree,
        consensus,
        yesVotes,
        noVotes,
        reason: leader.vote && followersAgree
          ? 'leader + majority of followers'
          : 'no raft quorum',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Topology-annotated SwarmCoordinator
// ---------------------------------------------------------------------------

/**
 * Extended SwarmCoordinator that records the selected topology and
 * consensus at dispatch time. This is the entry point the rest of the
 * system uses to actually pick a topology.
 */
export class TopologyAwareSwarmCoordinator extends SwarmCoordinator {
  private currentTopology: Topology = 'sequential';
  private currentConsensus: Consensus = 'leader';

  setTopology(topology: Topology): void {
    this.currentTopology = topology;
  }

  setConsensus(consensus: Consensus): void {
    this.currentConsensus = consensus;
  }

  getCurrentTopology(): Topology {
    return this.currentTopology;
  }

  getCurrentConsensus(): Consensus {
    return this.currentConsensus;
  }

  /**
   * Start a swarm by applying a recommendation. Convenience helper.
   *
   * v14 — P8.2: pass `clientConfig` to enforce ANTI_DRIFT defaults. The
   * returned recommendation carries `antiDriftCompliant` and
   * `antiDriftViolations` for the caller to act on.
   */
  startSwarm(
    team: TeamCharacteristics,
    config: SwarmCoordinatorConfig,
    clientConfig?: Record<string, unknown>,
  ): TopologyRecommendation & { antiDriftCompliant: boolean; antiDriftViolations: AntiDriftViolation[] } {
    const rec = recommendTopology(team, clientConfig);
    this.setTopology(rec.topology);
    this.setConsensus(rec.consensus);
    return rec;
  }

  /**
   * v14 — P8.2: explicitly check ANTI_DRIFT defaults against a client
   * configuration. Returns the list of violations; an empty list means
   * the client config is safe to use.
   */
  checkAntiDrift(
    clientConfig: Record<string, unknown>,
    defaults?: AntiDriftConfig,
  ): AntiDriftViolation[] {
    return enforceAntiDrift(clientConfig, defaults);
  }
}
