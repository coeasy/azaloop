import { z } from 'zod';

export const NextActionSchema = z.object({
  tool: z.string(),
  action: z.string(),
  reason: z.string(),
  payload: z.record(z.unknown()).optional(),
  instruction: z.string().optional(),
});

export const LoopResponseMetadataSchema = z.object({
  iteration: z.number().int(),
  progress: z.string(),
  tokens_used: z.number().int().optional(),
  stage: z.string().optional(),
  loop_level: z.enum(['outer', 'inner', 'phase']).optional(),
  phase_iteration: z.number().int().optional(),
});

export const LoopResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  next_action: NextActionSchema.optional(),
  error: z.string().optional(),
  metadata: LoopResponseMetadataSchema.optional(),
});

export type NextAction = z.infer<typeof NextActionSchema>;
export type LoopResponse<T = unknown> = z.infer<typeof LoopResponseSchema> & { data: T };
export type LoopResponseMetadata = z.infer<typeof LoopResponseMetadataSchema>;
