import { z } from 'zod';

export const StageStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'blocked']);

export const StageSchema = z.object({
  status: StageStatusSchema,
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  error: z.string().optional(),
});

export const LoopSchema = z.object({
  iteration: z.number().int().min(0).default(0),
  progress: z.string().default('0%'),
  current_story: z.string().optional(),
  client: z.string().default('unknown'),
  model: z.string().default('unknown'),
  max_iterations: z.number().int().default(50),
});

export const PhaseLoopSchema = z.object({
  current: z.enum(['open', 'design', 'build', 'verify', 'archive']).default('open'),
  iteration: z.number().int().min(0).default(0),
  max_iterations: z.number().int().default(5),
  history: z.array(z.object({
    iter: z.number().int(),
    result: z.enum(['pass', 'fail', 'pending']),
    reason: z.string().optional(),
    suggestions: z.string().optional(),
  })).default([]),
  maker_role: z.string().default('maker'),
  checker_role: z.string().default('checker'),
}).default({});

export const OuterLoopSchema = z.object({
  cadence: z.enum(['manual', 'daily', 'event']).default('manual'),
  triage_at: z.string().optional(),
  board: z.object({
    pending: z.array(z.string()).default([]),
    in_progress: z.array(z.string()).default([]),
    done: z.array(z.string()).default([]),
    blocked: z.array(z.string()).default([]),
  }).default({ pending: [], in_progress: [], done: [], blocked: [] }),
  budget: z.object({
    tokens_used: z.number().int().default(0),
    tokens_budget: z.number().int().default(50000),
    time_used_min: z.number().int().default(0),
  }).default({ tokens_used: 0, tokens_budget: 50000, time_used_min: 0 }),
}).default({});

export const InnerLoopSchema = z.object({
  current_story: z.string().optional(),
  story_attempts: z.number().int().min(0).default(0),
  max_story_attempts: z.number().int().default(3),
}).default({});

export const MemoryRefSchema = z.object({
  episodic_ref: z.string().optional(),
  semantic_keys: z.array(z.string()).default([]),
}).default({});

export const SecurityFindingSchema = z.object({
  id: z.string(),
  type: z.enum(['secret', 'sql_injection', 'xss', 'dependency', 'code_injection', 'path_traversal', 'deserialization', 'ssrf']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  file: z.string(),
  description: z.string(),
  created_at: z.string(),
});

export const StateSchema = z.object({
  pipeline: z.object({
    current_stage: z.enum(['open', 'design', 'build', 'verify', 'archive']).default('open'),
    stages: z.record(z.enum(['open', 'design', 'build', 'verify', 'archive']), StageSchema),
  }),
  loops: z.object({
    outer: OuterLoopSchema,
    inner: InnerLoopSchema,
    phase: PhaseLoopSchema,
  }).default({}),
  loop: LoopSchema,
  memory: MemoryRefSchema.default({}),
  security_findings: z.array(SecurityFindingSchema).default([]),
  strikes: z.number().int().min(0).default(0),
  prd_id: z.string().optional(),
  attestation: z.object({
    prd_hash: z.string().optional(),
    plan_hash: z.string().optional(),
    verified: z.boolean().default(true),
  }).default({ verified: true }),
  updated_at: z.string(),
});

export type State = z.infer<typeof StateSchema>;
export type StageStatus = z.infer<typeof StageStatusSchema>;
export type Loop = z.infer<typeof LoopSchema>;
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;
export type PhaseLoopState = z.infer<typeof PhaseLoopSchema>;
export type OuterLoopState = z.infer<typeof OuterLoopSchema>;
export type InnerLoopState = z.infer<typeof InnerLoopSchema>;
