/**
 * Model tier — classifies models by capability level.
 *
 * - **fast**      — lightweight models for simple tasks (low cost, low latency)
 * - **balanced**  — mid-tier models for moderate tasks
 * - **powerful**  — high-capability models for complex reasoning / codegen
 */
export type ModelTier = 'fast' | 'balanced' | 'powerful';

export interface ModelRoute {
  model: string;
  capability: string[];
  cost_per_token: number;
  max_tokens: number;
  /** Capability tier used by {@link ModelRouter.routeByComplexity}. */
  tier?: ModelTier;
}

/**
 * Describes the complexity of a task for model routing.
 */
export interface TaskComplexity {
  /** Human-readable description of the task. */
  description: string;
  /** Estimated token count for the response. */
  estimatedTokens?: number;
  /** Whether the task requires multi-step reasoning. */
  requiresReasoning?: boolean;
  /** Whether the task involves code generation. */
  requiresCodegen?: boolean;
  /** Size of the context window needed (in tokens). */
  contextSize?: number;
}

/**
 * ModelRouter — registers model routes and selects a model based on
 * task complexity.
 *
 * @example
 * ```ts
 * const router = new ModelRouter();
 * router.register({ model: 'gpt-4o-mini', tier: 'fast', ... });
 * router.register({ model: 'gpt-4o',      tier: 'balanced', ... });
 * router.register({ model: 'o1-preview',  tier: 'powerful', ... });
 *
 * const route = router.routeByComplexity({ description: 'refactor module', requiresCodegen: true });
 * // → selects the 'powerful' tier model
 * ```
 */
export class ModelRouter {
  private routes: ModelRoute[] = [];

  register(route: ModelRoute): void {
    this.routes.push(route);
  }

  getRoutes(): ModelRoute[] {
    return [...this.routes];
  }

  /**
   * Get all routes matching a given tier.
   *
   * @param tier - The model tier to filter by.
   * @returns Routes whose `tier` matches.
   */
  getRoutesByTier(tier: ModelTier): ModelRoute[] {
    return this.routes.filter(r => r.tier === tier);
  }

  /**
   * Route a task to a model based on its complexity.
   *
   * The task is assessed and assigned a {@link ModelTier}:
   *
   * | Score | Tier       | Typical use |
   * |-------|------------|-------------|
   * | 0–1   | `fast`     | Simple formatting, short answers |
   * | 2–3   | `balanced` | Moderate tasks, some reasoning |
   * | 4+    | `powerful` | Complex reasoning, large codegen |
   *
   * If no route matches the assessed tier, the first registered route
   * is returned as a fallback (or `undefined` if no routes exist).
   *
   * @param task - The task to route.
   * @returns The best-matching route, or `undefined` if no routes are registered.
   */
  routeByComplexity(task: TaskComplexity): ModelRoute | undefined {
    if (this.routes.length === 0) {
      return undefined;
    }

    const tier = this.assessComplexity(task);
    return this.routes.find(r => r.tier === tier) ?? this.routes[0];
  }

  /**
   * Assess a task and determine the appropriate model tier.
   *
   * Scoring:
   * - `requiresReasoning` → +2
   * - `requiresCodegen`   → +1
   * - `estimatedTokens` > 4000 → +2; > 1000 → +1
   * - `contextSize` > 10 000 → +1
   *
   * @param task - The task to assess.
   * @returns The recommended model tier.
   */
  private assessComplexity(task: TaskComplexity): ModelTier {
    let score = 0;

    if (task.requiresReasoning) {
      score += 2;
    }
    if (task.requiresCodegen) {
      score += 1;
    }

    const tokens = task.estimatedTokens ?? 0;
    if (tokens > 4000) {
      score += 2;
    } else if (tokens > 1000) {
      score += 1;
    }

    const ctx = task.contextSize ?? 0;
    if (ctx > 10_000) {
      score += 1;
    }

    if (score >= 4) {
      return 'powerful';
    }
    if (score >= 2) {
      return 'balanced';
    }
    return 'fast';
  }
}
