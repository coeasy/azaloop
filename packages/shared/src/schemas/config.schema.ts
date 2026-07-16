import { z } from 'zod';

export const MCPServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

export const ClientConfigSchema = z.object({
  name: z.string(),
  tier: z.enum(['T1', 'T2', 'T3']),
  rules_file: z.string().optional(),
  mcp_config: z.union([
    z.object({ path: z.string() }),
    MCPServerConfigSchema,
  ]).optional(),
});

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  episodic_max: z.number().int().default(100),
  compression_threshold: z.number().int().default(50),
});

export const LoopConfigSchema = z.object({
  max_iterations: z.number().int().default(50),
  /** Max phase iterations per stage (maker→checker→optimizer cycles).
   *  Real builds need multiple write→test→fix cycles, so default is 20
   *  (was hardcoded to 5, which was too low for genuine engineering work). */
  max_stage_iterations: z.number().int().default(20),
  /** Outer loop (sequential story batch over the board). Default on; set false to disable. */
  outer_enabled: z.boolean().default(true),
  deadlock_threshold: z.number().int().default(3),
  hard_stop_on_security: z.boolean().default(true),
});

export const QualityConfigSchema = z.object({
  gates: z.object({
    lint: z.boolean().default(true),
    test: z.boolean().default(true),
    regression: z.boolean().default(true),
    security: z.boolean().default(true),
    acceptance: z.boolean().default(true),
  }),
});

/** ralphy-style project rules + boundaries (0.3.x). */
export const BoundariesConfigSchema = z.object({
  never_touch: z.array(z.string()).default([]),
});

export const AzaloopConfigSchema = z.object({
  version: z.string().default('4.0'),
  project: z.object({
    name: z.string(),
    root: z.string().default('.'),
  }),
  client: ClientConfigSchema.optional(),
  loop: LoopConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  quality: QualityConfigSchema.default({
    gates: { lint: true, test: true, regression: true, security: true, acceptance: true },
  }),
  /** Persistent agent rules applied to every task. */
  rules: z.array(z.string()).default([]),
  /** Paths/globs the agent must never modify. */
  boundaries: BoundariesConfigSchema.default({ never_touch: [] }),
  mcp_servers: z.array(z.object({
    name: z.string(),
    config: MCPServerConfigSchema,
  })).default([]),
});

export type AzaloopConfig = z.infer<typeof AzaloopConfigSchema>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
