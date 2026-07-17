import { z } from 'zod';

export const RecoveryReasonSchema = z.enum([
  'hash_mismatch',
  'terminal',
  'unsupported_state',
  'residual_artifacts',
]);

export const ArtifactResetRequestSchema = z.object({
  aza_dir: z.string().trim().min(1),
  next_fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  reason: RecoveryReasonSchema,
});

export const ArtifactResetResultSchema = z.object({
  committed: z.literal(true),
  non_retryable: z.literal(true),
  warnings: z.array(z.string()),
  transaction_id: z.string().uuid(),
  history_dir: z.string().min(1),
  moved: z.array(z.string()),
  new_fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  reason: RecoveryReasonSchema,
});

export type RecoveryReason = z.infer<typeof RecoveryReasonSchema>;
export type ArtifactResetRequest = z.infer<typeof ArtifactResetRequestSchema>;
export type ArtifactResetResult = z.infer<typeof ArtifactResetResultSchema>;
